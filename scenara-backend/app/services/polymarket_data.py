"""Public Polymarket market data. No wallet, credentials or order submission."""
from __future__ import annotations

import asyncio
import json
import math
import re
import time
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

import httpx

GAMMA = "https://gamma-api.polymarket.com"
CLOB = "https://clob.polymarket.com"
DATA = "https://data-api.polymarket.com"
INTERVALS = {"1h": 1, "6h": 2, "1d": 10, "1w": 60, "1m": 240, "max": 1440}
_cache: dict[tuple, tuple[float, Any]] = {}
_inflight: dict[tuple, asyncio.Task] = {}


def number(value: Any) -> float | None:
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (TypeError, ValueError, OverflowError):
        return None


def array(value: Any) -> list:
    if isinstance(value, list):
        return value
    try:
        result = json.loads(value)
        return result if isinstance(result, list) else []
    except (TypeError, ValueError):
        return []


def public_url(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    parsed = urlparse(value)
    return value[:2000] if parsed.scheme in {"http", "https"} and parsed.hostname else None


def event_identity(parent: dict) -> dict:
    """Only source-provided matchup identities; records can be stale, so omit them."""
    sport = parent.get("sport") if isinstance(parent.get("sport"), dict) else {}
    teams = []
    for team in parent.get("teams") or []:
        if not isinstance(team, dict) or not team.get("name"):
            continue
        color = team.get("color")
        teams.append({"name": str(team["name"])[:120], "abbreviation": str(team.get("abbreviation") or "")[:12],
                      "alias": str(team.get("alias") or "")[:120], "logo": public_url(team.get("logo")),
                      "color": color if isinstance(color, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", color) else None,
                      "ordering": team.get("ordering") if team.get("ordering") in {"home", "away"} else None})
    return {"teams": teams[:8], "game_starts_at": parent.get("startTime"),
            "sport": {"name": sport.get("name"), "slug": sport.get("sport")}}


def snapshot(market: dict) -> dict:
    """Keep useful source fields together, with consistent units and nulls."""
    parent = next(iter(market.get("events") or []), {})
    parent = parent if isinstance(parent, dict) else {}
    labels, prices, tokens = (array(market.get(k)) for k in ("outcomes", "outcomePrices", "clobTokenIds"))
    numeric = {
        "volume": "volumeNum", "liquidity": "liquidityNum", "volume_24h": "volume24hr",
        "volume_week": "volume1wk", "volume_month": "volume1mo", "volume_year": "volume1yr",
        "change_hour": "oneHourPriceChange", "change_day": "oneDayPriceChange",
        "change_week": "oneWeekPriceChange", "change_month": "oneMonthPriceChange",
        "best_bid": "bestBid", "best_ask": "bestAsk", "spread": "spread",
        "last_trade_price": "lastTradePrice", "minimum_order_size": "orderMinSize",
        "tick_size": "orderPriceMinTickSize", "resolution_bond": "umaBond",
        "resolution_reward": "umaReward",
    }
    result = {key: number(market.get(raw)) for key, raw in numeric.items()}
    result["volume"] = result["volume"] if result["volume"] is not None else number(market.get("volume"))
    result["liquidity"] = result["liquidity"] if result["liquidity"] is not None else number(market.get("liquidity"))
    for key in ("change_hour", "change_day", "change_week", "change_month"):
        if result[key] is not None:
            result[key] = round(result[key] * 100, 6)  # percentage points, not percent returns
    result.update({
        "market_id": str(market.get("id") or ""), "condition_id": market.get("conditionId"),
        "slug": market.get("slug"), "question": market.get("question"),
        "rules": market.get("description"), "resolution_source": public_url(market.get("resolutionSource")),
        "resolution_status": market.get("umaResolutionStatus"), "group_title": market.get("groupItemTitle"),
        "starts_at": market.get("startDate"), "ends_at": market.get("endDate"),
        "game_starts_at": market.get("gameStartTime"),
        "created_at": market.get("createdAt"), "updated_at": market.get("updatedAt"),
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "accepting_orders": market.get("acceptingOrders"), "active": market.get("active"),
        "closed": market.get("closed"), "restricted": market.get("restricted"),
        "order_book_enabled": market.get("enableOrderBook"), "negative_risk": market.get("negRisk"),
        "fees_enabled": market.get("feesEnabled"), "fee_schedule": market.get("feeSchedule"),
        "image": public_url(market.get("image")), "icon": public_url(market.get("icon")),
        "tags": [t.get("label") for t in market.get("tags") or [] if isinstance(t, dict) and t.get("label")],
        "event": {"id": str(parent.get("id") or ""), "title": parent.get("title"),
                  "slug": parent.get("slug"), "comment_count": parent.get("commentCount"),
                  "open_interest": number(parent.get("openInterest")), **event_identity(parent)},
        "tokens": [{"outcome": str(label), "token_id": str(tokens[i]) if i < len(tokens) else None,
                    "probability": round(p * 100, 6) if (p := number(prices[i] if i < len(prices) else None)) is not None and 0 <= p <= 1 else None}
                   for i, label in enumerate(labels)],
    })
    slug = parent.get("slug") or market.get("slug")
    result["url"] = f"https://polymarket.com/event/{slug}" if slug else None
    return result


async def public_json(base: str, path: str, params: dict | None = None, ttl: int = 30) -> Any:
    key = (base, path, tuple(sorted((params or {}).items())))
    cached = _cache.get(key)
    if cached and time.monotonic() - cached[0] < ttl:
        return cached[1]

    async def fetch():
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                response = await client.get(base + path, params=params)
                response.raise_for_status()
                value = response.json()
            if len(_cache) >= 256:
                _cache.pop(next(iter(_cache)))
            _cache[key] = (time.monotonic(), value)
            return value
        except (httpx.HTTPError, ValueError):
            # Keep network failure distinct from an empty book/history.
            return None

    if key not in _inflight:
        _inflight[key] = asyncio.create_task(fetch())
    task = _inflight[key]
    try:
        return await asyncio.shield(task)
    finally:
        if task.done() and _inflight.get(key) is task:
            _inflight.pop(key, None)


def book_levels(raw: Any, reverse: bool) -> list[dict]:
    levels = []
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        price, size = number(item.get("price")), number(item.get("size"))
        if price is not None and size is not None and 0 <= price <= 1 and size > 0:
            levels.append({"price": price, "size": size, "value": round(price * size, 2)})
    return sorted(levels, key=lambda level: level["price"], reverse=reverse)[:8]


def history_points(raw: Any) -> list[dict]:
    points = {}
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        stamp, price = number(item.get("t")), number(item.get("p"))
        if stamp is not None and 0 <= stamp <= 32_503_680_000 and price is not None and 0 <= price <= 1:
            points[stamp] = {"probability": round(price * 100, 6),
                             "recorded_at": datetime.fromtimestamp(stamp, timezone.utc).isoformat(),
                             "source": "polymarket-clob"}
    ordered = [points[key] for key in sorted(points)]
    if len(ordered) > 240:
        ordered = [ordered[round(i * (len(ordered) - 1) / 239)] for i in range(240)]
    return ordered


def history_fidelity(data: dict, interval: str, now: datetime | None = None) -> int:
    """Keep new markets useful in ALL/1M, which otherwise sample once a day."""
    try:
        start = datetime.fromisoformat(str(data.get("starts_at") or data.get("created_at")).replace("Z", "+00:00"))
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)
        minutes = ((now or datetime.now(timezone.utc)) - start).total_seconds() / 60
        minimum = 10 if interval == "1m" else 1  # CLOB rejects monthly fidelity below 10.
        return max(minimum, min(INTERVALS[interval], max(1, int(minutes / 180))))
    except (ValueError, TypeError, OverflowError):
        return INTERVALS[interval]


async def enrich(data: dict, interval: str) -> dict:
    """Bounded, cached requests; missing sources leave useful partial results."""
    tokens = [t for t in data.get("tokens", []) if str(t.get("token_id") or "").isdigit()][:8]
    async def token_data(token):
        token_id = token["token_id"]
        book, history = await asyncio.gather(
            public_json(CLOB, "/book", {"token_id": token_id}, ttl=20),
            public_json(CLOB, "/prices-history", {"market": token_id, "interval": interval, "fidelity": history_fidelity(data, interval)}, ttl=60),
        )
        book = book if isinstance(book, dict) else None
        history = history if isinstance(history, dict) else None
        return {**token, "book_available": isinstance(book, dict),
                "book_timestamp": (book or {}).get("timestamp"),
                "bids": book_levels((book or {}).get("bids"), True),
                "asks": book_levels((book or {}).get("asks"), False),
                "history_available": isinstance(history, dict),
                "history": history_points((history or {}).get("history"))}

    parent_id = str(data.get("event", {}).get("id") or "")
    condition = data.get("condition_id")
    outcomes, parent, trades, interest = await asyncio.gather(
        asyncio.gather(*(token_data(token) for token in tokens)),
        public_json(GAMMA, f"/events/{parent_id}", ttl=300) if parent_id.isdigit() else asyncio.sleep(0, result=None),
        public_json(DATA, "/trades", {"market": condition, "limit": 20}, ttl=30) if condition else asyncio.sleep(0, result=None),
        public_json(DATA, "/oi", {"market": condition}, ttl=60) if condition else asyncio.sleep(0, result=None),
    )
    event = dict(data.get("event") or {})
    if isinstance(parent, dict):
        event.update({"title": parent.get("title"), "open_interest": number(parent.get("openInterest")),
                      "comment_count": parent.get("commentCount"), "volume": number(parent.get("volume")),
                      "volume_24h": number(parent.get("volume24hr")), "liquidity": number(parent.get("liquidity")),
                      **event_identity(parent)})
    related = []
    for market in (parent or {}).get("markets", []) if isinstance(parent, dict) else []:
        if str(market.get("id")) == data.get("market_id"):
            continue
        prices = array(market.get("outcomePrices"))
        labels = array(market.get("outcomes"))
        price = number(prices[0]) if prices else None
        related.append({"market_id": str(market.get("id") or ""), "title": market.get("groupItemTitle") or market.get("question"),
                        "outcome": str(labels[0]) if labels else None, "market_type": market.get("sportsMarketType"),
                        "probability": round(price * 100, 6) if price is not None and 0 <= price <= 1 else None,
                        "closed": bool(market.get("closed")), "volume": number(market.get("volumeNum", market.get("volume"))),
                        "url": data.get("url")})
    # Public trade tape deliberately omits wallets, profiles and identifiers.
    tape = [{"side": t.get("side"), "outcome": t.get("outcome"), "price": number(t.get("price")),
             "size": number(t.get("size")), "timestamp": t.get("timestamp")}
            for t in trades if isinstance(t, dict)] if isinstance(trades, list) else []
    open_interest = next((number(row.get("value")) for row in interest if isinstance(row, dict) and row.get("market") == condition), None) if isinstance(interest, list) else None
    tags = list(dict.fromkeys([*(data.get("tags") or []), *[tag.get("label") for tag in (parent or {}).get("tags") or [] if isinstance(tag, dict) and tag.get("label")]])) if isinstance(parent, dict) else data.get("tags") or []
    return {"market": {**data, "event": event, "open_interest": open_interest, "tags": tags[:16]}, "interval": interval, "outcomes": outcomes,
            "related_markets": sorted(related, key=lambda m: m["volume"] if m["volume"] is not None else -1, reverse=True)[:30],
            "trades": tape, "trades_available": isinstance(trades, list)}
