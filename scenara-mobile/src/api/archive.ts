/**
 * src/api/archive.ts — read-only backend, served from static JSON
 *
 * Scenara's API and database are gone. Rather than let every screen sit on a
 * spinner until it times out, PROJECT_PAUSED swaps axios' transport for this
 * adapter, which answers the same routes out of /archive/*.json — built from
 * the recovered Postgres dump by scripts/build_archive_data.py.
 *
 * What still works: the markets feed, category filters, market detail, and the
 * probability charts. What cannot: anything that needed a server to compute or
 * store something — sign-in, placing a prediction, comments, the leaderboard,
 * news. Those return empty payloads immediately, so the UI draws its own empty
 * state instead of hanging.
 *
 * Shapes mirror scenara-backend/app/routers/events.py exactly, so no screen
 * needed changing to read from here.
 */
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from "axios";

const BASE = "/archive";

type Meta = {
  events: number;
  shards: number;
  page_size: number;
  pages: Record<string, number>;
  categories: Record<string, number>;
};

// Every fetch is memoised: the data is immutable, so a page or shard is only
// ever pulled once per session no matter how many screens ask for it.
const cache = new Map<string, Promise<any>>();

function load<T>(path: string): Promise<T> {
  let hit = cache.get(path);
  if (!hit) {
    hit = fetch(`${BASE}/${path}`).then(r => {
      if (!r.ok) throw new Error(`archive: ${path} -> ${r.status}`);
      return r.json();
    });
    cache.set(path, hit);
  }
  return hit as Promise<T>;
}

const meta = () => load<Meta>("meta.json");

/** Pull whatever pages cover [offset, offset+limit) and slice to size. */
async function listEvents(
  category: string | undefined,
  limit: number,
  offset: number,
): Promise<any[]> {
  const m = await meta();
  const cat = category && category !== "all" ? category : "all";
  const total = m.pages[cat];
  if (!total) return [];

  const first = Math.floor(offset / m.page_size);
  const last = Math.floor(Math.max(offset + limit - 1, offset) / m.page_size);

  const pages = await Promise.all(
    Array.from({ length: last - first + 1 }, (_, i) => first + i)
      .filter(p => p < total)
      .map(p => load<any[]>(`events/${cat}-${p}.json`)),
  );

  const flat = pages.flat();
  const start = offset - first * m.page_size;
  return flat.slice(start, start + limit);
}

/** Find one event by scanning its category-agnostic pages. */
async function findEvent(id: number): Promise<any | null> {
  const m = await meta();
  for (let p = 0; p < m.pages.all; p++) {
    const page = await load<any[]>(`events/all-${p}.json`);
    const hit = page.find(e => e.id === id);
    if (hit) return hit;
    // Pages are ordered id DESC, so once a page starts below the id we want,
    // it cannot appear later. Stop instead of walking all 54 pages.
    if (page.length && page[page.length - 1].id < id) break;
  }
  return null;
}

async function eventDetail(id: number): Promise<any | null> {
  const base = await findEvent(id);
  if (!base) return null;
  const m = await meta();
  const shard = await load<Record<string, any>>(`details/${id % m.shards}.json`);
  // EventOut = EventListOut + the long text fields the list payload omits.
  return { ...base, ...(shard[String(id)] ?? {
    description: null, description_pt: null, description_zh: null, resolution_note: null,
  }) };
}

async function eventHistory(id: number): Promise<any> {
  const m = await meta();
  const shard = await load<Record<string, any>>(`history/${id % m.shards}.json`);
  return shard[String(id)] ?? { event_id: id, scenarios: [] };
}

function ok(data: any, config: InternalAxiosRequestConfig): AxiosResponse {
  return { data, status: 200, statusText: "OK", headers: {}, config };
}

/** Shaped like an axios error so the interceptor in client.ts handles it. */
function notFound(detail: string) {
  return Promise.reject({ response: { status: 404, data: { detail } } });
}

export const archiveAdapter: AxiosAdapter = async config => {
  const url = (config.url ?? "").replace(/^\/+/, "");
  const p = (config.params ?? {}) as Record<string, any>;
  const method = (config.method ?? "get").toLowerCase();

  // The archive is read-only. Nothing can be created, and pretending otherwise
  // would leave the user staring at a spinner.
  if (method !== "get") {
    return Promise.reject({
      response: { status: 405, data: { detail: "Scenara is an archive — this is read-only." } },
    });
  }

  let m: RegExpMatchArray | null;

  if (/^events\/?$/.test(url)) {
    // status is ignored on purpose: the live API served only open markets, but
    // 5,448 of the 5,798 archived events resolved before shutdown, and hiding
    // them would leave an archive showing almost nothing.
    return ok(await listEvents(p.category, Number(p.limit) || 100, Number(p.offset) || 0), config);
  }

  if (/^events\/trending\/?$/.test(url)) {
    return ok(await listEvents("all", Number(p.limit) || 20, 0), config);
  }

  if ((m = url.match(/^events\/history\/batch\/?$/))) {
    const ids = String(p.ids ?? "").split(",").map(Number).filter(Boolean);
    const all = await Promise.all(ids.map(eventHistory));
    return ok({ events: all }, config);
  }

  if ((m = url.match(/^events\/(\d+)\/history\/?$/))) {
    return ok(await eventHistory(Number(m[1])), config);
  }

  if ((m = url.match(/^events\/(\d+)\/?$/))) {
    const ev = await eventDetail(Number(m[1]));
    return ev ? ok(ev, config) : notFound("Event not found in the archive.");
  }

  // ── Everything that needed a live server ────────────────────────────────
  if (/^accounts\/live-stats/.test(url)) {
    // Traders and volume are genuinely 0 — nobody is here and nothing is being
    // traded. The market count is not: 5,310 of them are sitting in this
    // archive, browsable. Reporting 0 there contradicted the catalogue the user
    // is looking at, so it carries the real archived total and the banner
    // stamps it with the date the data froze.
    const m = await meta().catch(() => null);
    return ok({ traders: 0, volume_24h: 0, open_markets: m?.events ?? 0 }, config);
  }
  if (/^accounts\/leaderboard/.test(url)) {
    return ok({ entries: [], total_users: 0 }, config);
  }
  if (/^predictions\/activity/.test(url)) return ok([], config);
  if (/^predictions\/events\/sentiment\/batch/.test(url)) return ok({ events: [] }, config);
  if (/^predictions\/events\/\d+\/sentiment/.test(url)) {
    return ok({ total_players: 0, scenarios: [] }, config);
  }
  if (/^comments\//.test(url)) return ok([], config);
  if (/^news\//.test(url)) return ok({ articles: [] }, config);
  if (/^health\/?$/.test(url)) return ok({ status: "archive" }, config);

  return notFound("Not available in the archive.");
};
