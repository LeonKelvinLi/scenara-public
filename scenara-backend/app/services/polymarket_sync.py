"""
Polymarket ingestion — pulls active prediction markets from the public Gamma
API and mirrors them into Scenara's `events` table as external markets.

Positioning:
  Polymarket = real-world *crowd consensus signal* used as an intelligence
  layer. Scenara remains simulation-only — no real-money trading is ever
  performed. We never call CLOB authenticated endpoints.

Sources used:
  - https://gamma-api.polymarket.com/markets   (no auth)

Strategy:
  - Pull active, binary, decent-volume markets ending within 90 days
  - Insert as new Scenara events tagged with external_source="polymarket"
  - Refresh probabilities on existing external events from the same feed
  - Fail-closed: any network/parse error logs and skips, never raises
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime
from typing import Any, Optional

import httpx
from sqlalchemy.orm import Session, joinedload

from app.db import SessionLocal
from app.models.event import Event
from app.models.scenario import Scenario
from app.models.probability_history import ScenarioProbabilityHistory
from app.services.resolution import void_event
from app.services.polymarket_data import snapshot, number

logger = logging.getLogger(__name__)

GAMMA_BASE = "https://gamma-api.polymarket.com"
SOURCE = "polymarket"

# Quality gates — defensive defaults. Tighten/loosen via env later if needed.
MIN_VOLUME_USD       = 1_000.0      # below this is dust
MIN_LIQUIDITY_USD    = 500.0
MAX_DAYS_TO_CLOSE    = 90           # ignore evergreen multi-year markets
MAX_INGEST_PER_RUN   = 30           # don't dump 200 new markets in one cycle
DEFAULT_FETCH_LIMIT  = 100          # markets to fetch per Gamma request

# Lopsided-odds gate.  Outcomes priced outside [5%, 95%] are near-decided
# and make boring prediction-game markets ("Yes 2% / No 98%").  Moderate
# band chosen by the operator.  Tune these two numbers to widen/narrow.
MIN_INTERESTING_PROB = 0.05         # 5%
MAX_INTERESTING_PROB = 0.95         # 95%

# Polymarket categories → Scenara categories. Anything unmapped lands in
# "general" and admin can re-bucket later.
_CATEGORY_MAP = {
    "crypto":         "crypto",
    "cryptocurrency": "crypto",
    "politics":       "politics",
    "elections":      "politics",
    "us elections":   "politics",
    "sports":         "sports",
    "soccer":         "sports",
    "basketball":     "sports",
    "tennis":         "sports",
    "nfl":            "sports",
    "nba":            "sports",
    "geopolitics":    "geopolitics",
    "world":          "geopolitics",
    "economy":        "economy",
    "macro":          "economy",
    "tech":           "technology",
    "technology":     "technology",
    "ai":             "technology",
    "pop culture":    "entertainment",
    "entertainment":  "entertainment",
    "music":          "music",
    "tv":             "tv",
    "science":        "science",
    "weather":        "weather",
}

NSFW_KEYWORDS = (
    "porn", "nsfw", "sex tape", "onlyfans",
)


def _slugify(text: str, max_len: int = 140) -> str:
    s = re.sub(r"[^\w\s-]", "", (text or "").lower()).strip()
    s = re.sub(r"[\s_-]+", "-", s)
    return s[:max_len] or "polymarket-market"


def _parse_json_field(raw: Any) -> Optional[list]:
    """Polymarket returns `outcomes` and `outcomePrices` as JSON-encoded strings."""
    if raw is None:
        return None
    if isinstance(raw, list):
        return raw
    if isinstance(raw, str):
        try:
            v = json.loads(raw)
            return v if isinstance(v, list) else None
        except Exception:
            return None
    return None


def _normalize_category(raw: str | None) -> str:
    if not raw:
        return "general"
    return _CATEGORY_MAP.get(raw.strip().lower(), "general")


# ── Keyword → category inference ──────────────────────────────────────────────
# Polymarket's Gamma /markets endpoint rarely returns a usable `category`
# field, so classify from the question + description text instead.  Order
# matters: the FIRST matching rule wins, so list specific/high-signal terms
# before broad ones (e.g. "crypto" before "economy", since a Bitcoin price
# question is crypto-first even though it's economically themed).
_KEYWORD_CATEGORY: list[tuple[str, tuple[str, ...]]] = [
    # crypto first — most distinctive keywords, near-zero false positives
    ("crypto", (
        "bitcoin", "ethereum", " btc", " eth ", "solana", "crypto", "blockchain",
        "dogecoin", " xrp", "stablecoin", "defi", " nft", "binance", "coinbase",
        "altcoin", "memecoin", "satoshi", "halving", "polymarket token",
    )),
    # esports BEFORE sports — "LoL: A vs B (BO3)" must NOT fall into generic
    # sports.  League acronyms + game names are unambiguous esports signals.
    ("esports", (
        "league of legends", "lol:", " lol ", " dota", "counter-strike",
        " cs2", " csgo", "cs:go", "valorant", "overwatch", "rocket league",
        "starcraft", "esports", "e-sports", " lck", " lpl", " lec", " lcs",
        "rainbow six", "apex legends", " bo3", " bo5", "best of 3",
        "best of 5", "the international", "evo 20", "fortnite", "pubg",
        "mobile legends", "honor of kings",
    )),
    # mentions BEFORE elections/politics — "Will Trump tweet X?" is a
    # mentions market, not a politics one.
    ("mentions", (
        "tweets from", "posts from", "truth posts", "say the word",
        "mention the word", "number of tweets", "number of posts",
        "number of mentions", "will say \"", "post between", "tweet between",
        "how many times will", "times will", "wear a", "appear on",
    )),
    # elections BEFORE politics — outcome-of-an-election markets get their
    # own bucket; broader political terms fall through to politics.
    ("elections", (
        "presidential election", "win the election", "election winner",
        "primary winner", "general election", "electoral college",
        "win the presidency", "next president", "win the primary",
        "republican nominee", "democratic nominee", "win the senate seat",
        "win the governorship", "popular vote", "swing state",
        "win the 2026", "win the 2028", "elected",
    )),
    ("politics", (
        "president", "senate", "congress", "parliament", " vote", "trump",
        "biden", "harris", "democrat", "republican", "governor",
        "prime minister", "referendum", "impeach", "cabinet", "midterm",
        "campaign", "approval rating", "secretary of", "supreme court",
        "legislation", "bill pass", "shutdown",
    )),
    ("geopolitics", (
        " war ", "ukraine", "russia", "gaza", "israel", "iran", "taiwan",
        " nato", "sanction", "ceasefire", "invasion", "military", "nuclear",
        "north korea", "diplomac", "hostage", "missile", "airstrike",
        "annex", "coup", "state of emergency",
    )),
    # sports AFTER esports.  Added soccer-club guards (" fc ", " sc ",
    # " cf ", " afc ") so e.g. "Shanghai Shenhua FC vs X" classifies as
    # sports instead of leaking into politics/general.
    ("sports", (
        " nba", " nfl", " mlb", " nhl", "soccer", "football", "fifa",
        "world cup", "champions league", "premier league", "super bowl",
        "olympic", " ufc", "boxing", "tennis", " golf", " f1 ",
        "formula 1", "cricket", "playoff", "championship", "grand slam",
        "wimbledon", "la liga", "serie a", "ballon d'or", "march madness",
        "stanley cup", " fc ", " fc.", " sc ", " cf ", " afc ", " sc.",
        " vs ", " v.s ", "matchday", "relegat", "promot", "transfer window",
    )),
    # finance BEFORE economy — stock/IPO/earnings questions are finance;
    # macro indicators (rates, GDP, inflation) stay in economy.
    ("finance", (
        " stock", " shares", " ipo", "earnings", "nasdaq", "s&p 500",
        "dow jones", "share price", "market cap", "valuation", "acquisition",
        "merger", "buyback", "dividend", "bankruptcy", "delisting",
        "all-time high", "stock split",
    )),
    ("economy", (
        "fed ", "federal reserve", "interest rate", "inflation", " gdp",
        "recession", "unemployment", "treasury", "jerome powell",
        "rate cut", "rate hike", "jobs report", "tariff", "debt ceiling",
        "consumer price", "trade deficit",
    )),
    ("technology", (
        " ai ", "artificial intelligence", "openai", "chatgpt", " gpt",
        "google", "apple", "tesla", "spacex", " meta ", "microsoft",
        "nvidia", "robot", "self-driving", "quantum", "startup", "anthropic",
        "claude", "gemini", "llm", "humanoid", "neuralink",
    )),
    # culture BEFORE entertainment/music/tv — anime, celebrities, awards,
    # internet culture.  Fixes "My Hero Academia"→music misclassification.
    ("culture", (
        "anime", "manga", "one piece", "my hero academia", "naruto",
        "jujutsu kaisen", "dragon ball", "demon slayer", "voice actor",
        "comic-con", "comic con", "person of the year", "time magazine",
        "influencer", "youtuber", "tiktok", "twitch streamer", "mrbeast",
        "kardashian", "celebrity", " viral", " meme ", "k-pop", "kpop",
        " bts ", "blackpink", "award show", "met gala", "fashion week",
        "miss universe",
    )),
    ("entertainment", (
        "movie", " film", "oscar", "box office", "netflix", "hollywood",
        " actor", "actress", " emmy", "marvel", "disney", "sequel",
        "premiere", "rotten tomatoes", "blockbuster",
    )),
    ("music", (
        " song", " album", "spotify", "billboard", "concert", " tour",
        "taylor swift", "drake", "rapper", "musician", "grammy",
        "coachella", " single ", "chart-topping",
    )),
    ("tv", (
        "tv show", " series", " season", " episode", " hbo", "disney+",
        "streaming", "reality show", "finale", "renewed", "spin-off",
    )),
    ("science", (
        "nasa", "rocket launch", " mars", " moon ", "asteroid", "vaccine",
        "clinical trial", "crispr", "discovery", "research", "study finds",
        "scientist", "telescope", "fusion", "genome", "particle",
    )),
    ("weather", (
        "hurricane", "storm", "temperature record", "heatwave", "el niño",
        "climate", " flood", "wildfire", "drought", "snowfall", "tornado",
        "category 5", "blizzard",
    )),
]


def _infer_category(market: dict) -> str:
    """Classify a Polymarket market by keyword-matching its question text.

    Falls back to Polymarket's declared category (if it maps cleanly via
    _CATEGORY_MAP), then "general".  Padding the text with leading/trailing
    spaces lets us use " btc"-style guards to avoid false matches inside
    longer words (e.g. "debt" shouldn't match "bt").
    """
    # The question defines the subject. Boilerplate about tokens or settlement
    # in descriptions must not turn elections and rate decisions into crypto.
    parent = next(iter(market.get("events") or []), {})
    for source_text in (market.get("question") or "", parent.get("title") or ""):
        text = " " + source_text.lower() + " "
        for category, keywords in _KEYWORD_CATEGORY:
            if any(k in text for k in keywords):
                return category
    if market.get("sportsMarketType"):
        return "sports"
    for tag in market.get("tags") or parent.get("tags") or []:
        category = _normalize_category(tag.get("label") if isinstance(tag, dict) else str(tag))
        if category != "general":
            return category
    return _normalize_category(market.get("category"))


def _looks_nsfw(text: str | None) -> bool:
    if not text:
        return False
    t = text.lower()
    return any(k in t for k in NSFW_KEYWORDS)


def _parse_iso(s: str | None) -> Optional[datetime]:
    if not s:
        return None
    try:
        # Polymarket dates: "2026-12-31T23:59:59Z" — strip Z for fromisoformat
        return datetime.fromisoformat(s.replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        return None


# ── HTTP ─────────────────────────────────────────────────────────────────────

async def _fetch_markets(limit: int = DEFAULT_FETCH_LIMIT, offset: int = 0) -> list[dict]:
    """One page of Gamma /markets. Returns [] on any failure."""
    params = {
        "active":  "true",
        "closed":  "false",
        "limit":   str(limit),
        "offset":  str(offset),
        # `volume` is a string in Gamma; numeric 24h volume selects current,
        # liquid markets instead of lexicographically sorted stale entries.
        "order":   "volume24hr",
        "ascending": "false",
    }
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(f"{GAMMA_BASE}/markets", params=params)
            resp.raise_for_status()
            data = resp.json()
            if isinstance(data, list):
                return data
            # Some Gamma deployments wrap in { "data": [...] }
            return data.get("data", []) if isinstance(data, dict) else []
    except Exception as e:
        logger.warning("[Polymarket] fetch failed (offset=%s): %s", offset, e)
        return []


# ── Filtering ────────────────────────────────────────────────────────────────

def _is_acceptable(market: dict) -> tuple[bool, str]:
    """Quality gate. Returns (ok, reason_if_not)."""
    if not market.get("active") or market.get("closed"):
        return False, "inactive"
    question = (market.get("question") or "").strip()
    if not question:
        return False, "no question"
    if _looks_nsfw(question) or _looks_nsfw(market.get("description") or ""):
        return False, "nsfw"

    outcomes = _parse_json_field(market.get("outcomes"))
    prices   = _parse_json_field(market.get("outcomePrices"))
    if not outcomes or not prices or len(outcomes) != len(prices):
        return False, "malformed outcomes"
    if len(outcomes) != 2:
        # v1: binary markets only — multi-outcome support is more complex
        return False, "non-binary"

    # Reject already-decided / lopsided markets.  A market priced at
    # 0.02 / 0.98 renders as "Yes 2% / No 98%" — there's no real
    # uncertainty, so it's a boring prediction-game market.  The user
    # chose the "moderate" band: keep only markets where BOTH outcomes
    # sit between 5% and 95%.
    try:
        p0 = float(prices[0])
        p1 = float(prices[1])
    except (TypeError, ValueError):
        return False, "bad prices"
    if not (MIN_INTERESTING_PROB <= p0 <= MAX_INTERESTING_PROB) or \
       not (MIN_INTERESTING_PROB <= p1 <= MAX_INTERESTING_PROB):
        return False, "lopsided (near-decided odds)"

    try:
        volume    = float(market.get("volume") or 0)
        liquidity = float(market.get("liquidity") or 0)
    except (TypeError, ValueError):
        return False, "bad volume/liquidity"
    if volume < MIN_VOLUME_USD:
        return False, f"volume<{MIN_VOLUME_USD}"
    if liquidity < MIN_LIQUIDITY_USD:
        return False, f"liquidity<{MIN_LIQUIDITY_USD}"

    end = _parse_iso(market.get("endDate"))
    if not end:
        return False, "no endDate"
    now = datetime.utcnow()
    if end <= now:
        return False, "already ended"
    if (end - now).days > MAX_DAYS_TO_CLOSE:
        return False, f"closes>{MAX_DAYS_TO_CLOSE}d"

    return True, ""


# ── Persistence ──────────────────────────────────────────────────────────────

def _existing_external_ids(db: Session) -> set[str]:
    rows = (
        db.query(Event.external_id)
        .filter(Event.external_source == SOURCE)
        .all()
    )
    return {r[0] for r in rows if r[0]}


def _insert_market(db: Session, market: dict) -> Optional[Event]:
    """Insert one Polymarket market as a new Scenara event with two scenarios."""
    outcomes = _parse_json_field(market.get("outcomes")) or []
    prices   = _parse_json_field(market.get("outcomePrices")) or []
    if len(outcomes) != 2 or len(prices) != 2:
        return None

    ext_id    = str(market.get("id") or market.get("conditionId") or "").strip()
    question  = (market.get("question") or "").strip()
    if not ext_id or not question:
        return None

    slug_base = market.get("slug") or _slugify(question)
    slug      = f"pm-{slug_base[:120]}-{ext_id[-8:]}"  # ensure uniqueness

    end_dt = _parse_iso(market.get("endDate"))
    image_url = market.get("image") or market.get("icon") or None
    data = snapshot(market)
    pm_url = data["url"]
    category = _infer_category(market)

    event = Event(
        slug=slug,
        title=question[:255],
        description=(market.get("description") or "")[:5000],
        category=category,
        source="polymarket",
        status="open",
        is_featured=False,
        closes_at=end_dt,
        external_source=SOURCE,
        external_id=ext_id,
        external_url=pm_url,
        external_volume=float(market.get("volume") or 0),
        external_liquidity=float(market.get("liquidity") or 0),
        external_synced_at=datetime.utcnow(),
        external_data=data,
        image_url=(image_url[:500] if image_url else None),
    )
    db.add(event)
    db.flush()  # need event.id for scenarios

    for i, (label, price) in enumerate(zip(outcomes, prices)):
        try:
            prob_pct = max(0.0, min(100.0, float(price) * 100.0))
        except (TypeError, ValueError):
            prob_pct = 50.0
        sc = Scenario(
            event_id=event.id,
            title=str(label)[:255],
            probability=prob_pct,
            sort_order=i,
            status="active",
        )
        db.add(sc)
        db.flush()
        # Snapshot the initial probability so charts have a starting point.
        db.add(ScenarioProbabilityHistory(
            scenario_id=sc.id,
            event_id=event.id,
            probability=prob_pct,
            source="polymarket-ingest",
            recorded_at=datetime.utcnow(),
        ))

    return event


def _refresh_existing_event(db: Session, event: Event, market: dict, record_history: bool = True) -> bool:
    """
    Update probabilities on an existing Polymarket-mirrored event from a fresh
    Gamma payload. Returns True if probabilities actually changed.
    """
    event = db.query(Event).filter(Event.id == event.id).with_for_update().populate_existing().one()
    data = snapshot(market)
    event.external_data = data
    event.external_url = data["url"] or event.external_url
    event.external_volume = data["volume"]
    event.external_liquidity = data["liquidity"]
    event.category = _infer_category(market)
    if market.get("description"):
        description = market["description"][:20000]
        if event.description != description:
            event.description_pt = event.description_zh = None
        event.description = description
    if event.status != "open":
        return False
    outcomes = _parse_json_field(market.get("outcomes")) or []
    prices   = _parse_json_field(market.get("outcomePrices")) or []
    if len(outcomes) != 2 or len(prices) != 2:
        return False

    scenarios_sorted = sorted(event.scenarios or [], key=lambda s: s.sort_order)
    if len(scenarios_sorted) != 2:
        return False

    changed = False
    price_by_label = {str(label).casefold(): price for label, price in zip(outcomes, prices)}
    if any(number(price_by_label.get(sc.title.casefold())) is None or not 0 <= float(price_by_label[sc.title.casefold()]) <= 1 for sc in scenarios_sorted):
        return False  # An incomplete source response cannot refresh the quote timestamp.
    for sc in scenarios_sorted:
        raw_price = price_by_label.get(sc.title.casefold())
        try:
            new_pct = max(0.0, min(100.0, float(raw_price) * 100.0))
        except (TypeError, ValueError):
            continue
        if number(raw_price) is None or not 0 <= float(raw_price) <= 1:
            continue
        if abs((sc.probability or 0) - new_pct) >= 0.000001:
            sc.probability = new_pct
            if record_history:
                db.add(ScenarioProbabilityHistory(
                    scenario_id=sc.id,
                    event_id=event.id,
                    probability=new_pct,
                    source="polymarket",
                    recorded_at=datetime.utcnow(),
                ))
            changed = True

    # Backfill image on events ingested before the image_url column existed.
    if not event.image_url:
        img = market.get("image") or market.get("icon") or None
        if img:
            event.image_url = img[:500]
    event.external_synced_at = datetime.utcnow()
    return changed


async def refresh_open_quotes_once() -> int:
    """Explicitly page Gamma so its default 20-row limit cannot truncate a batch."""
    with SessionLocal() as db:
        ids = [row[0] for row in db.query(Event.external_id).filter(
            Event.external_source == SOURCE, Event.status == "open",
        ).all() if row[0]]
    refreshed = 0
    async with httpx.AsyncClient(timeout=15.0) as client:
        for offset in range(0, len(ids), 100):
            params = [("limit", "100"), *(("id", ext_id) for ext_id in ids[offset:offset + 100])]
            response = await client.get(GAMMA_BASE + "/markets", params=params)
            response.raise_for_status()
            markets = response.json()
            if not isinstance(markets, list):
                continue
            with SessionLocal() as db:
                for market in markets:
                    event = db.query(Event).filter(Event.external_source == SOURCE, Event.external_id == str(market.get("id"))).first()
                    if event:
                        _refresh_existing_event(db, event, market, record_history=False)
                        refreshed += 1
                db.commit()
    from app.routers.events import _EVENTS_CACHE
    _EVENTS_CACHE.clear()
    return refreshed


async def start_polymarket_price_loop() -> None:
    """Refresh every imported open market, including ones outside discovery's top page."""
    await asyncio.sleep(2)
    while True:
        try:
            await refresh_open_quotes_once()
        except Exception:
            logger.exception("[Polymarket] price refresh failed; retaining the last source snapshot")
        await asyncio.sleep(60)


# ── Event lifecycle: expire past-closes_at markets and refund predictions ────

def _expire_old_events(db: Session) -> int:
    """Close events whose closes_at has passed.  Refunds any still-open
    predictions (they were never resolved — return the user's stake).

    For Polymarket events this is the safety net when neither the AI auto-
    resolver nor a manual admin call has settled the market by close time.
    Previously lived in the deleted event_generator.py — moved here so
    market lifecycle stays alongside the (now sole) market source.
    """
    now = datetime.utcnow()
    expired = db.query(Event).filter(
        Event.status == "open",
        Event.closes_at < now,
    ).all()
    count = 0
    for event in expired:
        if event.source == "CoinGecko":
            continue
        result = void_event(db, event, note="Market closed — unconfirmed outcomes refunded")
        count += int(result.get("ok", False))
    return count


# ── Backfill: fix categories + close lopsided markets on existing rows ───────

def _backfill_categories_and_lopsided(db: Session) -> dict:
    """Repair Polymarket events that were ingested before the keyword
    classifier and lopsided-odds filter existed.

    1. Re-categorize any open Polymarket event still sitting in "general"
       by running the stored title+description through _infer_category.
    2. Close any open Polymarket event whose odds are now lopsided
       (a scenario at ≤5% or ≥95%) and refund open predictions, exactly
       like _expire_old_events does.

    Idempotent: correctly-categorized rows are skipped, already-closed
    rows are never re-touched, so this is safe to run on every sync.
    """
    recategorized = 0
    closed_lopsided = 0
    refunded = 0

    open_pm = (
        db.query(Event)
        .options(joinedload(Event.scenarios))
        .filter(Event.status == "open", Event.external_source == SOURCE)
        .all()
    )

    for event in open_pm:
        scenarios = event.scenarios or []

        # ── Close lopsided ──────────────────────────────────────────────────
        # DB stores probability as a 0–100 percentage; thresholds are fractions.
        lo = MIN_INTERESTING_PROB * 100.0   # 5.0
        hi = MAX_INTERESTING_PROB * 100.0   # 95.0
        is_lopsided = any(
            (s.probability is not None) and (s.probability <= lo or s.probability >= hi)
            for s in scenarios
        )
        if is_lopsided and len(scenarios) == 2:
            result = void_event(db, event, note="Closed — odds too lopsided for a useful market")
            refunded += result.get("refunded", 0)
            closed_lopsided += int(result.get("ok", False))
            continue  # don't bother recategorizing a row we're closing

        # ── Re-categorize "general" ─────────────────────────────────────────
        if event.status == "open":
            new_cat = _infer_category({
                "question": event.title or "",
                "description": event.description or "",
                "category": None,
            })
            if new_cat != "general" and new_cat != event.category:
                event.category = new_cat
                recategorized += 1

    if recategorized or closed_lopsided:
        db.commit()
        logger.info(
            "[Polymarket] backfill — recategorized=%d closed_lopsided=%d refunded=%d",
            recategorized, closed_lopsided, refunded,
        )
    return {
        "recategorized": recategorized,
        "closed_lopsided": closed_lopsided,
        "refunded": refunded,
    }


# ── Legacy purge ──────────────────────────────────────────────────────────────

def _purge_legacy_non_polymarket_events(db: Session) -> dict:
    """One-time-style cleanup: close every open event whose source isn't
    Polymarket and refund any still-open predictions on them.

    These rows are leftovers from the deleted STATIC_EVENTS template
    generator — they show up in the markets feed mixed in with real
    Polymarket events, with no probability updates.

    Safety gate: only runs once Polymarket has produced ≥5 open events,
    so a transient sync failure can't wipe the table to zero.

    Idempotent: once every legacy row is closed, subsequent calls find
    nothing to do and return early.
    """
    pm_count = (
        db.query(Event)
        .filter(Event.status == "open", Event.external_source == SOURCE)
        .count()
    )
    if pm_count < 5:
        # Not enough real markets yet — keep legacy fallback alive.
        return {"closed": 0, "skipped_reason": f"only_{pm_count}_polymarket"}

    from sqlalchemy import or_ as _or
    legacy = (
        db.query(Event)
        .filter(
            Event.status == "open",
            _or(Event.external_source.is_(None), Event.external_source != SOURCE),
        )
        .all()
    )
    if not legacy:
        return {"closed": 0}

    closed = refunded_count = 0
    for event in legacy:
        result = void_event(db, event, note="Legacy market closed during Polymarket migration")
        closed += int(result.get("ok", False))
        refunded_count += result.get("refunded", 0)
    logger.info("[Polymarket] Legacy purge — closed=%d refunded=%d", closed, refunded_count)
    return {"closed": closed, "voided": refunded_count, "refunded": refunded_count}


# ── Orchestration ────────────────────────────────────────────────────────────

async def sync_markets_once(max_new: int = MAX_INGEST_PER_RUN) -> dict:
    """
    Run one sync pass.
      - Pull markets from Gamma
      - Refresh probabilities on already-imported events
      - Insert up to `max_new` brand-new ones that pass quality filters
    Returns a small report dict.
    """
    raw = await _fetch_markets(limit=DEFAULT_FETCH_LIMIT, offset=0)

    # Always run the lifecycle sweep — even if the Gamma fetch failed, we
    # should still close events past their closes_at and refund open bets.
    expired_count = 0
    db: Session = SessionLocal()
    try:
        expired_count = _expire_old_events(db)
        if expired_count:
            logger.info("[Polymarket] expired %d past-due events", expired_count)
    finally:
        db.close()

    if not raw:
        return {"ok": False, "fetched": 0, "refreshed": 0, "inserted": 0, "skipped": 0, "expired": expired_count}

    db = SessionLocal()
    refreshed = 0
    inserted  = 0
    skipped   = 0
    skip_reasons: dict[str, int] = {}
    try:
        existing = _existing_external_ids(db)

        # Index existing events by external_id for refresh path
        existing_events: dict[str, Event] = {}
        if existing:
            rows = (
                db.query(Event)
                .options(joinedload(Event.scenarios))
                .filter(Event.external_source == SOURCE,
                        Event.external_id.in_(existing),
                        Event.status == "open")
                .all()
            )
            existing_events = {e.external_id: e for e in rows if e.external_id}

        for market in raw:
            ext_id = str(market.get("id") or market.get("conditionId") or "").strip()
            if not ext_id:
                skipped += 1
                skip_reasons["no_id"] = skip_reasons.get("no_id", 0) + 1
                continue

            # Refresh path
            ev = existing_events.get(ext_id)
            if ev is not None:
                try:
                    if _refresh_existing_event(db, ev, market):
                        refreshed += 1
                except Exception as e:
                    logger.exception("[Polymarket] refresh failed for %s: %s", ext_id, e)
                    db.rollback()
                continue

            # New-insert path — quality gate first
            ok, reason = _is_acceptable(market)
            if not ok:
                skipped += 1
                skip_reasons[reason] = skip_reasons.get(reason, 0) + 1
                continue
            if inserted >= max_new:
                skipped += 1
                skip_reasons["batch_cap"] = skip_reasons.get("batch_cap", 0) + 1
                continue

            try:
                ev = _insert_market(db, market)
                if ev is not None:
                    inserted += 1
            except Exception as e:
                logger.exception("[Polymarket] insert failed for %s: %s", ext_id, e)
                db.rollback()
                skipped += 1
                skip_reasons["exception"] = skip_reasons.get("exception", 0) + 1

        db.commit()
    finally:
        db.close()

    logger.info(
        "[Polymarket] sync done — refreshed=%d inserted=%d skipped=%d reasons=%s",
        refreshed, inserted, skipped, skip_reasons,
    )
    # After every successful sync: (1) backfill categories + close lopsided
    # markets on already-ingested rows, (2) run the legacy purge.  Both are
    # idempotent and self-gated, so safe to run every pass.
    backfill: dict = {"recategorized": 0, "closed_lopsided": 0, "refunded": 0}
    try:
        db = SessionLocal()
        try:
            backfill = _backfill_categories_and_lopsided(db)
        finally:
            db.close()
    except Exception as e:
        logger.exception("[Polymarket] category/lopsided backfill failed: %s", e)

    purged: dict = {"closed": 0}
    try:
        db = SessionLocal()
        try:
            purged = _purge_legacy_non_polymarket_events(db)
        finally:
            db.close()
    except Exception as e:
        logger.exception("[Polymarket] legacy purge failed: %s", e)

    return {
        "ok": True,
        "fetched": len(raw),
        "refreshed": refreshed,
        "inserted": inserted,
        "skipped": skipped,
        "expired": expired_count,
        "backfill": backfill,
        "purged": purged,
        "skip_reasons": skip_reasons,
    }


async def start_polymarket_sync_loop(interval_seconds: int = 20 * 60) -> None:
    """Background task: run sync_markets_once on an interval.

    Polymarket is now Scenara's sole market source, so the default cadence
    is 20 minutes — frequent enough that probabilities feel live, infrequent
    enough that the public Gamma API stays happy under sustained load."""
    logger.info("[Polymarket] sync loop started — interval=%ds", interval_seconds)
    # Small startup delay so we don't compete with migration / other startup work
    await asyncio.sleep(60)
    while True:
        try:
            await sync_markets_once()
        except Exception as e:
            logger.exception("[Polymarket] sync loop tick failed: %s", e)
        await asyncio.sleep(interval_seconds)
