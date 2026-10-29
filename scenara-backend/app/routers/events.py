from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy.orm import Session, joinedload

from app.db import get_db
from app.models.event import Event
from app.models.scenario import Scenario
from app.models.account import Account
from app.models.transaction import Transaction
from app.models.user import User
from app.models.probability_history import ScenarioProbabilityHistory
from app.services.resolution import settle_event
from app.routers.auth import get_admin_user, get_current_user

router = APIRouter()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class ScenarioCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    probability: float = Field(..., ge=0, le=100)
    sort_order: int = 0


class EventCreate(BaseModel):
    slug: str = Field(..., min_length=3, max_length=150)
    title: str = Field(..., min_length=3, max_length=255)
    description: str | None = None
    category: str = Field(default="macro", min_length=2, max_length=50)
    source: str | None = None
    is_featured: bool = False
    closes_at: datetime | None = None
    scenarios: list[ScenarioCreate]


class ScenarioOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    title: str
    title_pt: str | None = None
    title_zh: str | None = None
    description: str | None
    probability: float
    sort_order: int
    status: str


class EventOut(BaseModel):
    """Full event schema — used for the single-event detail endpoint."""
    model_config = ConfigDict(from_attributes=True)
    id: int
    slug: str
    title: str
    title_pt: str | None
    title_zh: str | None
    description: str | None
    description_pt: str | None
    description_zh: str | None
    category: str
    source: str | None
    status: str
    resolution_note: str | None
    is_featured: bool
    closes_at: datetime | None
    resolved_at: datetime | None
    scenarios: list[ScenarioOut]
    image_url:          str | None  = None
    external_source:    str | None  = None
    external_url:       str | None  = None
    external_volume:    float | None = None
    external_liquidity: float | None = None
    external_synced_at: datetime | None = None
    external_data: dict | None = None


class SourceSummary(BaseModel):
    volume_24h: float | None = None
    change_day: float | None = None
    best_bid: float | None = None
    best_ask: float | None = None
    accepting_orders: bool | None = None
    fetched_at: str | None = None


class EventListOut(BaseModel):
    """Slim list schema — omits long description text to cut data transfer ~40 %.
    The markets feed only needs title + category + scenarios + metadata;
    the full description is only loaded when a user opens the detail view."""
    model_config = ConfigDict(from_attributes=True)
    id: int
    slug: str
    title: str
    title_pt: str | None
    title_zh: str | None
    category: str
    source: str | None
    status: str
    is_featured: bool
    closes_at: datetime | None
    resolved_at: datetime | None
    scenarios: list[ScenarioOut]
    image_url:          str | None  = None
    external_source:    str | None  = None
    external_url:       str | None  = None
    external_volume:    float | None = None
    external_liquidity: float | None = None
    external_synced_at: datetime | None = None
    external_data: SourceSummary | None = None


class ScenarioUpdateProbability(BaseModel):
    probability: float = Field(..., ge=0, le=100)


class EventResolveRequest(BaseModel):
    winning_scenario_id: int
    resolution_note: str | None = None


class EventResolveResponse(BaseModel):
    ok: bool
    event_id: int
    winning_scenario_id: int
    status: str
    predictions_settled: int
    total_winners: int
    total_losers: int
    total_payout: float


class ProbabilityPoint(BaseModel):
    scenario_id: int
    scenario_title: str
    probability: float
    recorded_at: datetime
    source: str


class ScenarioHistoryOut(BaseModel):
    scenario_id: int
    scenario_title: str
    points: list[ProbabilityPoint]


class EventHistoryOut(BaseModel):
    event_id: int
    scenarios: list[ScenarioHistoryOut]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _fill_zh_translations(events: list) -> None:
    from app.services.event_translations import fill_event_translations
    fill_event_translations(events, "zh")


def _fill_translations(events: list, lang: str, include_rules: bool = True) -> None:
    from app.services.event_translations import fill_event_translations
    fill_event_translations(events, lang, include_rules=include_rules)


def _log_probability(
    db: Session,
    scenario: Scenario,
    source: str = "updated",
) -> None:
    """Insert one probability snapshot row."""
    db.add(ScenarioProbabilityHistory(
        scenario_id=scenario.id,
        event_id=scenario.event_id,
        probability=scenario.probability,
        source=source,
        recorded_at=datetime.utcnow(),
    ))


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/", response_model=EventOut)
def create_event(
    payload: EventCreate,
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
):
    if not payload.scenarios:
        raise HTTPException(status_code=400, detail="At least one scenario is required")

    existing = db.query(Event).filter(Event.slug == payload.slug).first()
    if existing:
        raise HTTPException(status_code=400, detail="Event slug already exists")

    event = Event(
        slug=payload.slug,
        title=payload.title,
        description=payload.description,
        category=payload.category,
        source=payload.source,
        is_featured=payload.is_featured,
        closes_at=payload.closes_at,
        status="open",
    )
    db.add(event)
    db.flush()

    # Normalize input probabilities so they sum to exactly 100%
    raw_total = sum(sp.probability for sp in payload.scenarios) or 100.0
    normalized_probs = [
        max(1.0, min(99.0, round(sp.probability / raw_total * 100.0, 2)))
        for sp in payload.scenarios
    ]
    # Re-check after clamping — redistribute any rounding remainder to first scenario
    norm_total = sum(normalized_probs)
    normalized_probs[0] = round(normalized_probs[0] + (100.0 - norm_total), 2)

    for idx, sp in enumerate(payload.scenarios):
        scenario = Scenario(
            event_id=event.id,
            title=sp.title,
            description=sp.description,
            probability=normalized_probs[idx],
            sort_order=sp.sort_order if sp.sort_order else idx,
            status="active",
        )
        db.add(scenario)
        db.flush()
        # Log initial probability snapshot
        _log_probability(db, scenario, source="created")

    db.commit()

    created = (
        db.query(Event)
        .options(joinedload(Event.scenarios))
        .filter(Event.id == event.id)
        .first()
    )
    return created


@router.get("/search", response_model=list[EventOut])
def search_events(
    q: str = Query(..., min_length=1, max_length=100),
    category: str | None = Query(None),
    lang: str = Query(default="en"),
    include_closed: bool = Query(default=False),
    db: Session = Depends(get_db),
):
    """Search events by keyword across all three language title/description columns.

    On PostgreSQL we use a tsvector full-text index with ts_rank ordering —
    relevance-first, then recency. On SQLite (local dev) we fall back to the
    simple ILIKE path since tsvector isn't available.

    Why the `simple` text-search config:
      We store en/pt/zh text in the same row; an English stemmer would butcher
      Portuguese accents and vice-versa. The `simple` config just tokenizes +
      lowercases, which is the right cross-language compromise.

    Ranking weights:
      title  (A) — strongest signal; what users actually scan for
      description (B) — supporting keywords
    """
    from sqlalchemy import or_, text as sql_text
    from app.db import engine

    dialect = engine.dialect.name
    status_filter = [] if include_closed else [Event.status == "open"]

    if dialect == "postgresql":
        # plainto_tsquery is injection-safe: it treats the input as plain text,
        # stripping tsquery operators. No need to sanitize q.
        fts_expr = (
            "setweight(to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(title_pt,'') || ' ' || coalesce(title_zh,'')), 'A') || "
            "setweight(to_tsvector('simple', coalesce(description,'') || ' ' || coalesce(description_pt,'') || ' ' || coalesce(description_zh,'')), 'B')"
        )
        rank_sql = sql_text(f"ts_rank(({fts_expr}), plainto_tsquery('simple', :q)) AS rank")
        match_sql = sql_text(f"({fts_expr}) @@ plainto_tsquery('simple', :q)")
        query = (
            db.query(Event, rank_sql)
            .options(joinedload(Event.scenarios))
            .filter(*status_filter)
            .filter(match_sql)
            .params(q=q)
        )
        if category and category != "all":
            query = query.filter(Event.category == category)
        # Rank first, then recency tiebreaker. ts_rank returns 0 for terms not
        # found which shouldn't happen after the @@ filter, but the order_by
        # is tolerant either way.
        rows = query.order_by(sql_text("rank DESC"), Event.created_at.desc()).limit(30).all()
        events = [row[0] for row in rows]
    else:
        # SQLite fallback — no tsvector, so we do the ILIKE union and order
        # by recency. Correctness matches the prior behavior.
        query = db.query(Event).options(joinedload(Event.scenarios)).filter(
            *status_filter,
            or_(
                Event.title.ilike(f"%{q}%"),
                Event.title_pt.ilike(f"%{q}%"),
                Event.title_zh.ilike(f"%{q}%"),
                Event.description.ilike(f"%{q}%"),
                Event.description_zh.ilike(f"%{q}%"),
            ),
        )
        if category and category != "all":
            query = query.filter(Event.category == category)
        events = query.order_by(Event.created_at.desc()).limit(30).all()

    _fill_zh_translations(events)
    return events


# In-process response cache for /events/.  The event LIST is stable for
# several minutes (probabilities drift but new events are rare), so a 120 s
# TTL removes almost all repeat DB hits on free-tier Render+Neon while still
# surfacing newly created events within 2 minutes.
_EVENTS_CACHE: dict[tuple, tuple[float, list]] = {}
_EVENTS_CACHE_TTL_SECONDS = 120


@router.get("/trending", response_model=list[EventListOut])
def trending_events(
    limit: int = Query(default=20, ge=1, le=50),
    lang: str = Query(default="en"),
    db: Session = Depends(get_db),
):
    """Top open markets sorted by Polymarket trading volume.

    Returns the highest-volume open Polymarket-sourced markets — these are
    the markets the world is actually betting on right now.  Falls back to
    `is_featured` order when no Polymarket events exist yet (fresh DB).

    Cached for 60 s server-side so a tab-switch refresh on the markets
    screen never re-queries the DB within that window.
    """
    import time
    cache_key = ("trending", limit, lang)
    cached = _EVENTS_CACHE.get(cache_key)
    if cached and (time.time() - cached[0]) < _EVENTS_CACHE_TTL_SECONDS:
        return cached[1]

    # Polymarket-only.  Sorted by reported trading volume so the markets the
    # world is actually betting on appear first.  Legacy template-generated
    # events are excluded entirely (use /events/?include_legacy=true to see
    # them for admin / debug purposes).
    events = (
        db.query(Event)
        .options(joinedload(Event.scenarios))
        .filter(Event.status == "open", Event.external_source == "polymarket")
        .order_by(Event.external_volume.desc().nullslast(), Event.id.desc())
        .limit(limit)
        .all()
    )

    if lang in {"pt", "zh"}:
        _fill_translations(events, lang, include_rules=False)
    _EVENTS_CACHE[cache_key] = (time.time(), events)
    return events


@router.get("/", response_model=list[EventListOut])
def list_events(
    db: Session = Depends(get_db),
    status: Optional[str] = Query(default=None),
    featured_only: bool = Query(default=False),
    category: Optional[str] = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    lang: str = Query(default="en"),
    include_legacy: bool = Query(
        default=False,
        description="Set true to include non-Polymarket events. Default false hides legacy template-generated events still in the DB awaiting cleanup.",
    ),
):
    import time
    from collections import defaultdict

    cache_key = (status, featured_only, category, limit, offset, lang, include_legacy)
    cached = _EVENTS_CACHE.get(cache_key)
    if cached and (time.time() - cached[0]) < _EVENTS_CACHE_TTL_SECONDS:
        return cached[1]

    base_q = db.query(Event).options(joinedload(Event.scenarios))
    if status:
        base_q = base_q.filter(Event.status == status)
    if featured_only:
        base_q = base_q.filter(Event.is_featured.is_(True))
    if category and category != "all":
        base_q = base_q.filter(Event.category == category)
    # Polymarket-only by default — see brief: Polymarket is the sole market
    # source.  `include_legacy=true` is an escape hatch for admin tooling.
    if not include_legacy:
        base_q = base_q.filter(Event.external_source == "polymarket")

    # ── Fast single-query path ────────────────────────────────────────────────
    # Previously "all" categories used a two-round-trip approach:
    #   1) window-function query to get ordered IDs
    #   2) second query to fetch full Event objects
    # On cold Neon/Render connections this doubled latency and often caused
    # the "failed to load markets" error.  Now we use one ORDER BY id DESC
    # query (hits the ix_events_status_category index) and do a lightweight
    # Python-side round-robin interleave — no extra DB round-trip, no window
    # function overhead.
    events: list[Event] = (
        base_q
        .order_by(Event.is_featured.desc(), Event.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    # Round-robin category interleave (first page only — pagination pages are
    # already deterministic by id DESC so interleaving would break continuity).
    if offset == 0 and (not category or category == "all"):
        by_cat: dict[str, list] = defaultdict(list)
        for e in events:
            by_cat[e.category].append(e)
        # Featured events first, then round-robin by category
        featured = [e for e in events if e.is_featured]
        rest_by_cat: dict[str, list] = defaultdict(list)
        for e in events:
            if not e.is_featured:
                rest_by_cat[e.category].append(e)
        cats = sorted(rest_by_cat.keys())
        interleaved: list[Event] = list(featured)
        iters = [iter(rest_by_cat[c]) for c in cats]
        while iters:
            next_iters = []
            for it in iters:
                try:
                    interleaved.append(next(it))
                except StopIteration:
                    continue
                else:
                    next_iters.append(it)
            if not next_iters:
                break
            iters = next_iters
        events = interleaved[:limit]

    # Lists need localized titles; full rules are translated on the detail page.
    if lang in {"pt", "zh"}:
        _fill_translations(events, lang, include_rules=False)
    _EVENTS_CACHE[cache_key] = (time.time(), events)
    return events


@router.get("/{event_id}", response_model=EventOut)
def get_event(event_id: int, lang: str = Query(default="en"), db: Session = Depends(get_db)):
    event = (
        db.query(Event)
        .options(joinedload(Event.scenarios))
        .filter(Event.id == event_id)
        .first()
    )
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if lang in {"pt", "zh"}:
        _fill_translations([event], lang)
    return event


@router.get("/{event_id}/polymarket")
async def get_polymarket_data(event_id: int, interval: str = Query(default="1d", pattern="^(1h|6h|1d|1w|1m|max)$"), lang: str = Query(default="en", pattern="^(en|pt|zh)$"), db: Session = Depends(get_db)):
    from app.services.polymarket_data import public_json, enrich, GAMMA
    from app.services.polymarket_sync import _refresh_existing_event
    event = db.query(Event).options(joinedload(Event.scenarios)).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.external_source != "polymarket":
        raise HTTPException(status_code=404, detail="No Polymarket source for this event")
    external_id = str(event.external_id or "")
    data = dict(event.external_data or {})
    scenario_ids = {s.title.casefold(): s.id for s in event.scenarios}
    db.rollback()  # Release the connection before awaiting external APIs.
    # The individual market endpoint omits its parent event. The filtered list
    # includes it, preserving canonical links, related markets and team context.
    page = await public_json(GAMMA, "/markets", {"id": external_id, "limit": 1}, ttl=60) if external_id.isdigit() else None
    raw = next((row for row in page if isinstance(row, dict) and str(row.get("id")) == external_id), None) if isinstance(page, list) else None
    if isinstance(raw, dict) and str(raw.get("id")) == external_id:
        event = db.get(Event, event_id)
        _refresh_existing_event(db, event, raw, record_history=False)
        db.commit()
        data = dict(event.external_data or {})
        _EVENTS_CACHE.clear()
    db.rollback()
    result = await enrich(data, interval)
    for outcome in result["outcomes"]:
        outcome["scenario_id"] = scenario_ids.get(outcome["outcome"].casefold())
    related_ids = [row["market_id"] for row in result["related_markets"]]
    local_events = dict(db.query(Event.external_id, Event.id).filter(Event.external_source == "polymarket", Event.external_id.in_(related_ids)).all()) if related_ids else {}
    for row in result["related_markets"]:
        row["local_event_id"] = local_events.get(row["market_id"])
    from app.services.event_translations import localize_source
    localize_source(result, lang)
    return {**result, "event_id": event_id, "source": "polymarket", "stale": not isinstance(raw, dict) or str(raw.get("id")) != external_id}


@router.get("/polymarket/sparklines")
async def get_polymarket_sparklines(ids: str = Query(..., max_length=180), db: Session = Depends(get_db)):
    import asyncio
    from app.services.polymarket_data import public_json, history_points, CLOB
    try:
        event_ids = list(dict.fromkeys(int(value) for value in ids.split(",")))
    except ValueError:
        raise HTTPException(status_code=400, detail="Expected comma-separated event IDs")
    if not event_ids or len(event_ids) > 20 or any(value <= 0 for value in event_ids):
        raise HTTPException(status_code=400, detail="Choose 1–20 event IDs")
    rows = db.query(Event.id, Event.external_data).filter(Event.id.in_(event_ids), Event.external_source == "polymarket").all()
    db.rollback()
    gate = asyncio.Semaphore(5)
    async def fetch(row):
        tokens = (row[1] or {}).get("tokens") or []
        token = str(tokens[0].get("token_id") or "") if tokens else ""
        async with gate:
            history = await public_json(CLOB, "/prices-history", {"market": token, "interval": "1d", "fidelity": 30}, ttl=120) if token.isdigit() else None
        points = history_points((history or {}).get("history")) if isinstance(history, dict) else []
        if len(points) > 36:
            points = [points[round(i * (len(points) - 1) / 35)] for i in range(36)]
        return {"event_id": row[0], "points": points}
    return {"series": await asyncio.gather(*(fetch(row) for row in rows))}


@router.get("/{event_id}/history", response_model=EventHistoryOut)
def get_event_probability_history(
    event_id: int,
    db: Session = Depends(get_db),
):
    """
    Returns full probability history for all scenarios of an event.
    Used to render the live chart on each event card.
    """
    event = (
        db.query(Event)
        .options(joinedload(Event.scenarios))
        .filter(Event.id == event_id)
        .first()
    )
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    result: list[ScenarioHistoryOut] = []

    # Fetch all history for the event in ONE query, then partition in Python.
    # Cap at 200 points per scenario via reservoir downsampling to keep
    # response size bounded on long-running markets.
    MAX_POINTS = 200
    all_history = (
        db.query(ScenarioProbabilityHistory)
        .filter(ScenarioProbabilityHistory.event_id == event_id)
        .order_by(
            ScenarioProbabilityHistory.scenario_id,
            ScenarioProbabilityHistory.recorded_at.asc(),
        )
        .all()
    )
    # Group by scenario_id
    from collections import defaultdict as _dd
    history_by_scenario: dict = _dd(list)
    for h in all_history:
        history_by_scenario[h.scenario_id].append(h)

    def _downsample(rows, n):
        """Keep n evenly-spaced rows from a sorted list."""
        if len(rows) <= n:
            return rows
        step = len(rows) / n
        return [rows[int(i * step)] for i in range(n)]

    scenario_title_map = {s.id: s.title for s in event.scenarios}

    for scenario in event.scenarios:
        raw = history_by_scenario.get(scenario.id, [])
        history = _downsample(raw, MAX_POINTS)

        points = [
            ProbabilityPoint(
                scenario_id=h.scenario_id,
                scenario_title=scenario.title,
                probability=h.probability,
                recorded_at=h.recorded_at,
                source=h.source,
            )
            for h in history
        ]

        result.append(ScenarioHistoryOut(
            scenario_id=scenario.id,
            scenario_title=scenario.title,
            points=points,
        ))

    return EventHistoryOut(event_id=event_id, scenarios=result)


# ── Batch history cache ──────────────────────────────────────────────────────
# Same 5-min TTL as the natural snapshot cadence — within that window, history
# data hasn't actually changed.  Keyed by sorted-tuple of event IDs so the
# cache hits for the typical "fetch top 20 events on page load" pattern.
_BATCH_HISTORY_CACHE: dict[tuple, tuple[float, list]] = {}
_BATCH_HISTORY_CACHE_TTL_SECONDS = 60   # 1 minute — short enough to feel live


class BatchHistoryOut(BaseModel):
    """Response for /events/history/batch — one entry per requested event."""
    histories: list[EventHistoryOut]


@router.get("/history/batch", response_model=BatchHistoryOut)
def get_batch_probability_history(
    ids: str = Query(..., description="Comma-separated event IDs, e.g. ?ids=1,2,3"),
    db: Session = Depends(get_db),
):
    """Bulk-fetch probability history for many events in one round-trip.

    Massive speedup vs N parallel /events/{id}/history calls on free-tier
    hosting where each request needs its own DB connection from a small pool.
    Caches the assembled response for 60 s — within that window, real
    snapshots haven't moved (5-min cadence) so re-using is safe.
    """
    import time
    from collections import defaultdict as _dd

    # Parse + deduplicate IDs; cap at 50 to bound memory/query size.
    try:
        event_ids = sorted({int(x) for x in ids.split(",") if x.strip()})[:50]
    except ValueError:
        raise HTTPException(status_code=400, detail="ids must be comma-separated integers")
    if not event_ids:
        return BatchHistoryOut(histories=[])

    cache_key = tuple(event_ids)
    cached = _BATCH_HISTORY_CACHE.get(cache_key)
    if cached and (time.time() - cached[0]) < _BATCH_HISTORY_CACHE_TTL_SECONDS:
        return BatchHistoryOut(histories=cached[1])

    # ── ONE query for all events (with scenarios joined) ─────────────────────
    events = (
        db.query(Event)
        .options(joinedload(Event.scenarios))
        .filter(Event.id.in_(event_ids))
        .all()
    )
    events_by_id = {e.id: e for e in events}

    # ── ONE query for all history rows across all events ─────────────────────
    all_history = (
        db.query(ScenarioProbabilityHistory)
        .filter(ScenarioProbabilityHistory.event_id.in_(event_ids))
        .order_by(
            ScenarioProbabilityHistory.event_id,
            ScenarioProbabilityHistory.scenario_id,
            ScenarioProbabilityHistory.recorded_at.asc(),
        )
        .all()
    )
    history_by_scenario: dict = _dd(list)
    for h in all_history:
        history_by_scenario[h.scenario_id].append(h)

    MAX_POINTS = 100  # smaller than the single-endpoint cap (200) since we batch
    def _downsample(rows, n):
        if len(rows) <= n:
            return rows
        step = len(rows) / n
        return [rows[int(i * step)] for i in range(n)]

    histories: list[EventHistoryOut] = []
    for eid in event_ids:
        event = events_by_id.get(eid)
        if not event:
            continue
        scenario_results: list[ScenarioHistoryOut] = []
        for scenario in event.scenarios:
            raw = history_by_scenario.get(scenario.id, [])
            history = _downsample(raw, MAX_POINTS)
            points = [
                ProbabilityPoint(
                    scenario_id=h.scenario_id,
                    scenario_title=scenario.title,
                    probability=h.probability,
                    recorded_at=h.recorded_at,
                    source=h.source,
                )
                for h in history
            ]
            scenario_results.append(ScenarioHistoryOut(
                scenario_id=scenario.id,
                scenario_title=scenario.title,
                points=points,
            ))
        histories.append(EventHistoryOut(event_id=eid, scenarios=scenario_results))

    _BATCH_HISTORY_CACHE[cache_key] = (time.time(), histories)
    return BatchHistoryOut(histories=histories)


@router.patch("/scenarios/{scenario_id}/probability", response_model=ScenarioOut)
def update_scenario_probability(
    scenario_id: int,
    payload: ScenarioUpdateProbability,
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
):
    scenario = db.query(Scenario).filter(Scenario.id == scenario_id).first()
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")

    # Clamp the new value
    new_prob = max(1.0, min(99.0, payload.probability))
    scenario.probability = new_prob

    # Renormalize siblings so the whole event still sums to 100%
    siblings = (
        db.query(Scenario)
        .filter(
            Scenario.event_id == scenario.event_id,
            Scenario.id != scenario_id,
            Scenario.status == "active",
        )
        .all()
    )
    if siblings:
        remaining = 100.0 - new_prob
        sib_total = sum(max(0.001, s.probability) for s in siblings)
        for s in siblings:
            s.probability = round((max(0.001, s.probability) / sib_total) * remaining, 2)

    # Log history for all affected scenarios
    _log_probability(db, scenario, source="updated")
    for s in siblings:
        _log_probability(db, s, source="updated")

    db.commit()
    db.refresh(scenario)
    return scenario


@router.post("/{event_id}/resolve", response_model=EventResolveResponse)
def resolve_event(
    event_id: int,
    payload: EventResolveRequest,
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
):
    event = (
        db.query(Event)
        .options(joinedload(Event.scenarios))
        .filter(Event.id == event_id)
        .first()
    )
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.status == "resolved":
        raise HTTPException(status_code=400, detail="Event already resolved")

    scenario_ids = {s.id for s in event.scenarios}
    if payload.winning_scenario_id not in scenario_ids:
        raise HTTPException(status_code=400, detail="Winning scenario does not belong to this event")

    result = settle_event(db, event, payload.winning_scenario_id, payload.resolution_note or "")
    if not result["ok"]:
        raise HTTPException(status_code=400, detail=result.get("error", "Settlement failed"))

    total_winners = result["total_winners"]
    total_losers = result["total_losers"]
    total_payout = result["total_payout"]

    # Push notifications are fired inside settle_event via notify_prediction_settled
    # (background threads, one per prediction). No duplicate work needed here.

    return EventResolveResponse(
        ok=True,
        event_id=result["event_id"],
        winning_scenario_id=result["winning_scenario_id"],
        status="resolved",
        predictions_settled=total_winners + total_losers,
        total_winners=total_winners,
        total_losers=total_losers,
        total_payout=total_payout,
    )


def _resolve_event(event_id: int, winning_scenario_id: int, db: Session, resolution_note: str = "") -> EventResolveResponse:
    """Internal helper for programmatic resolution (used by voting, auto-resolver)."""
    from pydantic import BaseModel
    class _Req(BaseModel):
        winning_scenario_id: int
        resolution_note: str | None = None
    return resolve_event(event_id, _Req(winning_scenario_id=winning_scenario_id, resolution_note=resolution_note), db)


@router.post("/top-up")
async def top_up_events(
    _current_user: User = Depends(get_current_user),
):
    """
    On-demand market refresh — requires authentication.  Was previously a
    template-based event generator; now triggers a Polymarket sync pass so
    users who scroll past all current markets can pull in fresh ones from
    the live source.
    """
    from app.services.polymarket_sync import sync_markets_once
    report = await sync_markets_once()
    return {"ok": True, "report": report}
