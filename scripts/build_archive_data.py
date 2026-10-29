#!/usr/bin/env python3
"""Turn the recovered Postgres dump into static JSON the paused web app can read.

Scenara's backend and database are gone, so the app cannot fetch markets over
HTTP any more. This writes the same payloads the API used to return into
scenara-mobile/public/archive/, where src/api/archive.ts serves them from disk
whenever PROJECT_PAUSED is set.

Shapes deliberately mirror the FastAPI response models in
scenara-backend/app/routers/events.py so the client needs no per-field mapping:

  events/CAT-N.json   list[EventListOut]      one page, mirroring limit/offset
  details/NN.json     {id: {description...}}  the long fields EventListOut omits
  history/NN.json     {event_id: EventHistoryOut}  sharded by event_id % SHARDS
  meta.json           page counts per category + build provenance

Pagination is per category and matches the API's PAGE_SIZE, so the markets feed
fetches ~24 KB for first paint and pulls later pages on scroll exactly as it did
against the live backend — rather than a single 4 MB blob before anything draws.

Only market data is read. The users/accounts/predictions/transactions rows in
the dump are never touched — see scenara-backend/data/README.md.

Usage:  python3 scripts/build_archive_data.py [path/to/scenara_db.sql]
"""
from __future__ import annotations

import collections
import json
import pathlib
import re
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_DUMP = REPO.parent / "_database" / "scenara_db.sql"
OUT = REPO / "scenara-mobile" / "public" / "archive"

# Sharding the probability history keeps any single fetch small: 84k points is
# ~10 MB of JSON, far too much to load up front, but one shard is ~300 KB.
SHARDS = 32

# Must match PAGE_SIZE in scenara-mobile/app/(tabs)/index.tsx, so offset/limit
# arithmetic on the client lands exactly on a page boundary.
PAGE_SIZE = 100

# list_events() hides non-Polymarket rows by default — they are legacy
# template-generated events left over from before the migration. Match that.
KEEP_SOURCE = "polymarket"

NULL = "\\N"


def unesc(v: str) -> str | None:
    """Postgres COPY text format → Python."""
    if v == NULL:
        return None
    return (
        v.replace("\\t", "\t")
        .replace("\\n", "\n")
        .replace("\\r", "\r")
        .replace("\\\\", "\\")
    )


def num(v: str | None, cast):
    return None if v is None else cast(v)


def ts(v: str | None) -> str | None:
    """'2026-07-11 10:00:00' → ISO 8601, which is what the client's Date() and
    timeUntil() expect."""
    return None if v is None else v.replace(" ", "T")


def read_table(dump: pathlib.Path, table: str):
    """Yield dicts for one COPY block, streaming so 14 MB never lands in RAM."""
    header = f"COPY public.{table} ("
    cols: list[str] | None = None
    with dump.open(encoding="utf-8", errors="replace") as f:
        for line in f:
            if cols is None:
                if line.startswith(header):
                    cols = [
                        c.strip()
                        for c in re.match(rf"COPY public\.{table} \(([^)]*)\)", line)
                        .group(1)
                        .split(",")
                    ]
                continue
            if line.startswith("\\."):
                return
            yield dict(zip(cols, (unesc(v) for v in line.rstrip("\n").split("\t"))))


def main() -> None:
    dump = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_DUMP
    if not dump.exists():
        sys.exit(f"dump not found: {dump}")

    # ── scenarios, grouped by event ─────────────────────────────────────────
    scen_by_event: dict[int, list[dict]] = collections.defaultdict(list)
    scen_title: dict[int, str] = {}
    for r in read_table(dump, "scenarios"):
        eid = int(r["event_id"])
        scen_title[int(r["id"])] = r["title"]
        scen_by_event[eid].append(
            {
                "id": int(r["id"]),
                "title": r["title"],
                "title_pt": r["title_pt"],
                "title_zh": r["title_zh"],
                "description": r["description"],
                "probability": float(r["probability"]),
                "sort_order": int(r["sort_order"]),
                "status": r["status"],
            }
        )
    for s in scen_by_event.values():
        s.sort(key=lambda x: x["sort_order"])

    # ── events ──────────────────────────────────────────────────────────────
    events: list[dict] = []
    details: dict[str, dict] = {}
    cats: collections.Counter = collections.Counter()
    statuses: collections.Counter = collections.Counter()
    skipped = 0

    for r in read_table(dump, "events"):
        if r.get("external_source") != KEEP_SOURCE:
            skipped += 1
            continue
        eid = int(r["id"])
        common = {
            "id": eid,
            "slug": r["slug"],
            "title": r["title"],
            "title_pt": r["title_pt"],
            "title_zh": r["title_zh"],
            "category": r["category"],
            "source": r["source"],
            "status": r["status"],
            "is_featured": r["is_featured"] == "t",
            "closes_at": ts(r["closes_at"]),
            "resolved_at": ts(r["resolved_at"]),
            "scenarios": scen_by_event.get(eid, []),
            "image_url": r["image_url"],
            "external_source": r["external_source"],
            "external_url": r["external_url"],
            "external_volume": num(r["external_volume"], float),
            "external_liquidity": num(r["external_liquidity"], float),
        }
        events.append(common)
        # EventOut adds the long text EventListOut drops. Kept separately so the
        # list payload stays small; the detail screen merges the two.
        details[str(eid)] = {
            "description": r["description"],
            "description_pt": r["description_pt"],
            "description_zh": r["description_zh"],
            "resolution_note": r["resolution_note"],
        }
        cats[r["category"]] += 1
        statuses[r["status"]] += 1

    # list_events orders by is_featured DESC, id DESC. Nothing is featured in
    # this data, so id DESC alone reproduces it.
    events.sort(key=lambda e: (-int(e["is_featured"]), -e["id"]))
    keep_ids = {e["id"] for e in events}

    # ── probability history, sharded ────────────────────────────────────────
    pts: dict[int, dict[int, list]] = collections.defaultdict(
        lambda: collections.defaultdict(list)
    )
    total_points = 0
    for r in read_table(dump, "scenario_probability_history"):
        eid = int(r["event_id"])
        if eid not in keep_ids:
            continue
        pts[eid][int(r["scenario_id"])].append(
            {
                "scenario_id": int(r["scenario_id"]),
                "scenario_title": scen_title.get(int(r["scenario_id"]), ""),
                "probability": float(r["probability"]),
                "recorded_at": ts(r["recorded_at"]),
                "source": r["source"],
            }
        )
        total_points += 1

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "history").mkdir(exist_ok=True)

    shards: dict[int, dict] = collections.defaultdict(dict)
    for eid, by_scen in pts.items():
        series = []
        for sid, points in by_scen.items():
            points.sort(key=lambda p: p["recorded_at"] or "")
            series.append(
                {
                    "scenario_id": sid,
                    "scenario_title": scen_title.get(sid, ""),
                    "points": points,
                }
            )
        shards[eid % SHARDS][str(eid)] = {"event_id": eid, "scenarios": series}

    def dump_json(path: pathlib.Path, obj) -> int:
        path.write_text(
            json.dumps(obj, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        return path.stat().st_size

    # ── paginated list pages, per category ──────────────────────────────────
    (OUT / "events").mkdir(exist_ok=True)
    (OUT / "details").mkdir(exist_ok=True)

    by_cat: dict[str, list[dict]] = {"all": events}
    for e in events:
        by_cat.setdefault(e["category"], []).append(e)

    pages_per_cat: dict[str, int] = {}
    list_bytes = 0
    for cat, rows in by_cat.items():
        n_pages = max(1, -(-len(rows) // PAGE_SIZE))  # ceil
        for page in range(n_pages):
            chunk = rows[page * PAGE_SIZE : (page + 1) * PAGE_SIZE]
            list_bytes += dump_json(OUT / "events" / f"{cat}-{page}.json", chunk)
        pages_per_cat[cat] = n_pages

    # Details sharded the same way as history so no single fetch is large.
    detail_shards: dict[int, dict] = collections.defaultdict(dict)
    for eid_str, d in details.items():
        detail_shards[int(eid_str) % SHARDS][eid_str] = d
    detail_bytes = 0
    for shard in range(SHARDS):
        detail_bytes += dump_json(
            OUT / "details" / f"{shard}.json", detail_shards.get(shard, {})
        )

    hist_bytes = 0
    for shard in range(SHARDS):
        hist_bytes += dump_json(OUT / "history" / f"{shard}.json", shards.get(shard, {}))

    meta = {
        "generated_from": "scenara_db.sql, captured 2026-07-30 before scenara-db was deleted",
        "events": len(events),
        "scenarios": sum(len(e["scenarios"]) for e in events),
        "history_points": total_points,
        "shards": SHARDS,
        "page_size": PAGE_SIZE,
        "pages": pages_per_cat,
        "categories": dict(cats.most_common()),
        "statuses": dict(statuses),
    }
    meta_bytes = dump_json(OUT / "meta.json", meta)

    mb = lambda b: f"{b / 1_048_576:.1f} MB"
    kb = lambda b: f"{b / 1024:.0f} KB"
    first_page = (OUT / "events" / "all-0.json").stat().st_size
    print(f"events        {len(events):>7,}  ({skipped:,} non-Polymarket skipped)")
    print(f"scenarios     {meta['scenarios']:>7,}")
    print(f"history pts   {total_points:>7,}")
    print(f"categories    {len(pages_per_cat) - 1:>7}  + 'all'")
    print()
    print(f"  events/*.json    {mb(list_bytes)}   first paint fetches {kb(first_page)}")
    print(f"  details/*.json   {mb(detail_bytes)}   ({kb(detail_bytes / SHARDS)} per shard)")
    print(f"  history/*.json   {mb(hist_bytes)}   ({kb(hist_bytes / SHARDS)} per shard)")
    print(f"  meta.json        {kb(meta_bytes)}")
    print(f"\nwrote {OUT}")


if __name__ == "__main__":
    main()
