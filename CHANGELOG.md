# Changelog

## 0.8.5 — 2026-10-28

- Added a news briefing at the top of the home page, before onboarding and market data, with source names, publication times and links to article details.
- Headlines follow the selected language, refresh automatically and exclude reports older than 48 hours. News loads independently of the market feed, with localized retry and empty states.

## 0.8.4 — 2026-10-27

- Fixed mixed-language market pages: titles, rules, source tags, outcome labels, order books, trade directions and chart periods follow the selected language.
- Added a language selector to market details and locale-aware number, currency and time formatting. New visitors use their browser language instead of an arbitrary Portuguese default.
- Added cached Portuguese market translations and local OPUS-MT translation for new content, replacing the rate-limited remote service. Originals are available explicitly without silently replacing translated rules.

## 0.8.3 — 2026-10-27

- Compare both outcomes on a shared chart with matching colors, endpoint probabilities and a two-outcome hover readout.
- Added source team logos, colors and scheduled game times to sports matchups. Outcome rows, order-book selectors and simulation tickets share the same identities.
- Restored parent-event context during detail refreshes and added links to related Scenara markets, ordered by activity.
- Adapted history sampling to the market's age so new markets retain detail in ALL and monthly views. Added a labelled shared scale and readable dates.

## 0.8.2 — 2026-10-27

- Added Polymarket market snapshots, actual CLOB token history, order-book depth, recent source trades, open interest, parent-event outcomes, tags and resolution rules.
- Rebuilt the market detail view and made feed cards denser with real sparklines, price movement, volume and liquidity. Added market pulse and activity/movement/liquidity sorting.
- Source prices refresh every minute; active detail pages refresh every 30 seconds using cached public APIs. Simulated orders no longer shift imported prices. Stale or closed source quotes cannot create positions.
- Removed generated history from the legacy chart endpoints. All source charts use actual observations.

## 0.8.1 — 2026-10-27

- Restored live markets and simulation trading on the original database.
- Rebuilt the market desk, desktop navigation, account screens and order ticket; unified the interface around the original dark palette and blue–purple–pink brand gradient.
- Removed fabricated activity and leaderboard padding.
- Fixed expired-market refunds, voting joins and concurrent settlement.
- Added production configuration guards, database-aware health checks and automated application checks.
- Updated backend and web dependencies; enabled clean TypeScript and production builds.


All notable changes to **Scenara** — the zero-risk prediction-market simulation.

The format roughly follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [semantic versioning](https://semver.org/). Versions before `0.7.0` are reconstructed from git history.

---

## [0.8.0] — 2026-07-30 · Paused

> Scenara stopped active development in April 2026. This release turns the site into an archive: it says so on entry, and it fixes the bugs found in the audit that came with it.

### ✨ New
- **Project-paused notice on entry** — a dismissible card in English, Portuguese and Chinese explaining that development stopped and the site is now an archive. Waits for the language choice so it never stacks on top of the language modal.
- **`render.yaml` blueprint** — brings both services up on Render in one apply. The web export used to depend on a Vercel rewrite (`/api/backend/*` → the Render backend) for a same-origin API; on Render that rewrite does not exist, so the static site sets `EXPO_PUBLIC_API_URL` and the browser calls the backend directly. Includes the SPA rewrite expo-router needs for deep links.
- **`PROJECT_PAUSED` switch** — one flag per side (`app/config.py`, `src/config/paused.ts`) puts the platform into archive mode. Nothing was deleted; flip both to bring it back to life.

### 🐛 Fixed
- **Every bet on mobile froze for up to 58 seconds** — `placePrediction` raced a `fetch('/health')` warm-up against a 58s timer before the POST was even attempted. That warm-up exists to dodge a *browser* CORS-preflight timeout on Render cold starts; native has no CORS and no preflight, so it bought nothing there. React Native's `fetch` has no default timeout, so an unreachable or sleeping host left the race to be decided by the timer, with the BUY button disabled behind a spinner the whole time. The daily challenge was the most visible casualty. Now web-only, aborted on timeout, and the timer is cleared instead of leaking.
- **Position-opened modal stuttering and outstaying its welcome** — `onDismiss` is an inline arrow at every call site, and it sat in the auto-dismiss effect's dependency array. The portfolio refresh that follows a successful bet fires several state updates in a row, and each one restarted the entrance spring and re-armed the 2.5s timer. Held in a ref now.
- **Market detail stuck on the skeleton forever** — opening `/market-detail` without an `eventId` returned early from the fetch effect without ever clearing `loading`.
- **`/kyc` and `/funding` crashed on load** — both call `useSession()`, but `SessionProvider` was never mounted anywhere, so the hook threw during render. The routes are hidden from the tab bar but expo-router still registers them, leaving them reachable by direct URL on web. Provider is now mounted in the root layout.
- **Funding screen stuck on "Loading session…"** — it destructured `hydrated` from the session context, which exposes `isReady`. `undefined` is falsy, so the loading line never cleared.
- **Password-reset confirmation rendered in the system font** — it asked for `DMSans_600Medium`, a weight the app never loads (400/500/700 only).
- **`.claude/` was committed for months** — the `.gitignore` line was written in UTF-16LE and appended to a UTF-8 file, so git read it as a pattern that matches nothing. Rewritten, and 83 tracked junk files (73 AppleDouble `._*` forks, 2 `.DS_Store`, the 8 `.claude/` entries) untracked.
- **15 duplicate keys** in the Chinese fallback dictionary — no conflicting values, so purely dead lines.

### 🔒 Security
- **`axios` 1.16.0 → 1.19.0** — the app's HTTP client, and the only *direct* dependency with an open advisory.
- **`cryptography` 46.0.7 → 48.0.1, `pyasn1` 0.6.3 → 0.6.4, `python-multipart` 0.0.27 → 0.0.31** — verified by reinstalling on Python 3.11 and round-tripping a JWT and a bcrypt hash, since `python-jose` sits on top of them.

---

## [0.7.0] — 2026-05-13 · Polymarket migration

> Scenara now sources real prediction markets from Polymarket instead of hand-crafted templates. Every market you see is something the world is actually betting on.

### ✨ New
- **Polymarket integration** as Scenara's sole market source. Public Gamma API, no auth required, no real money involved — Scenara stays a simulation.
- **`/events/trending` endpoint** — open markets sorted by Polymarket trading volume.
- **Position-opened modal** — centered overlay with spring-scaled checkmark appears after every successful prediction. Auto-dismisses after 2.5s or tap to dismiss.
- **Market hero images** — `image_url` field added to events; ingested from Polymarket on every sync.
- **`/admin/purge-legacy-events`** — manual trigger for the legacy event cleanup.

### 🛠 Improved
- **Polymarket sync cadence** dropped from 60 min → **20 min**. Probabilities feel live without hammering the public API.
- **`_expire_old_events`** moved into `polymarket_sync` and now runs on every sync pass, automatically refunding open predictions on past-due markets.

### 🐛 Fixed
- **Silent random-walk bug** — the deleted `_snapshot_open_events` was overwriting real Polymarket probabilities with Gaussian noise every 5 min. Removed entirely.
- **Legacy events showing in trending** — `/events/` and `/events/trending` now filter to `external_source = 'polymarket'` by default. An `?include_legacy=true` escape hatch exists for debugging.
- **Legacy purge safety gate** — moved out of startup migrations (where the Polymarket count was always 0) into the sync loop where the count is fresh.

### 🗑 Removed
- **2,360+ lines of `event_generator.py`** — `STATIC_EVENTS` templates, `_generate_crypto_events`, `_insert_event`, `_snapshot_open_events`, `run_event_generator`. Kept as a thin compat shim so old import paths keep working.
- **`news_market_generator.py`** — 324 lines of dead Groq-LLM market generator, never imported.

---

## [0.6.5] — 2026-05-12 · News revamp

> The News tab is now pure breaking news. Worldwide coverage for every UI language, real images, and zero clutter.

### ✨ New
- **News tab is news-only** — markets removed entirely; they live in their own tab. ~282 lines deleted from `news.tsx`.
- **Image fallback chain** — article image → category stock photo → source favicon → placeholder. Cards always show something meaningful.
- **Source favicon overlay** — each news card shows the publisher's logo (BBC, NBC, etc.) as a small badge over the hero image.

### 🛠 Improved
- **Worldwide queries for all languages** — PT users no longer get Brazil-only news, ZH users no longer get China-only news. Headline language stays per-locale, but the search keywords are globally scoped.

### 🐛 Fixed
- **News tab showing markets when news loaded empty** — the old conditional rendering put markets above news, making a slow news fetch look like the entire tab had turned into a markets list.

---

## [0.6.4] — 2026-05-11 · Translation overhaul

> Swapped Google Cloud Translation for the keyless, free MyMemory API. No billing card, no quota anxiety, no log spam.

### ✨ New
- **MyMemory translation service** (`translate.py`) — keyless, free up to 50K words/day with an optional contact email.
- **Circuit breaker** — after 5 translation failures in 60s, all calls pause for 10 minutes. Auto-recovers when service is healthy again.

### 🐛 Fixed
- **Infinite-loop bug in ZH backfill** — when the Translate API was down, the same 50 rows matched `WHERE title_zh IS NULL` forever, generating ~3 failed API calls per second indefinitely. Now detects two no-progress batches in a row and aborts cleanly with a clear error.
- **Server crash on startup** — missing `Query` import in `predictions.py` after the batch sentiment refactor. Container was crash-looping for several deploys.

### 🔒 Security
- **API key leak scrubbed from error logs** — `httpx.HTTPStatusError.__str__()` includes the request URL with `?key=...` query params. Error logging now records only the status code, never the URL.

---

## [0.6.3] — 2026-05-10 · Performance round

> Cut ~28 HTTP round-trips per page load by batching what used to be parallel-fanout requests. Free-tier hosting feels much snappier.

### ⚡ Performance
- **`/events/history/batch?ids=1,2,3`** — single endpoint replaces up to 20 parallel `/events/{id}/history` calls. 60s server-side cache.
- **`/predictions/events/sentiment/batch?ids=1,2,3`** — same treatment for sentiment data.
- **Database egress cut ~70–80%** — Polymarket events use less bandwidth than the LLM-summarized template events that came before, plus the new caches absorb repeat hits.

### 🛠 Improved
- **`EventListOut` slim schema** — `/events/` list responses omit long description fields (~40% smaller JSON). Detail endpoint still returns the full payload.
- **ZH translation gated by `lang=zh` requests** — backfill no longer fires on every English / Portuguese list response.

---

## [0.6.2] — 2026-05-09 · Cold-start resilience

> Survived a real production incident: Neon data-transfer quota exceeded. Backend now starts gracefully even when the DB is unreachable.

### ✨ New
- **Resilient startup** — DB migrations are wrapped in try/except. Server boots even when the database is down; only DB-backed endpoints return 503.
- **3-attempt retry loop on markets load** — replaces the single 12s retry. Shows "Server waking up…" / "Still warming up…" / "One last try…" messages during retries. Total patience ≈ 60s.

### 🐛 Fixed
- **"Failed to load markets" on cold server** — Render free-tier wakes in 30–60s, but the old retry waited only 12s. Now patient enough to cover the realistic cold-start window.
- **Two-round-trip window function** — `list_events` for "all" categories used `ROW_NUMBER() OVER (PARTITION BY category)` + a second query. Replaced with a single `ORDER BY` query + Python-side round-robin interleaving.

### ⚡ Performance
- **Events cache TTL raised** from 30s → 120s. Warm-server repeat loads almost never touch the DB.

---

## [0.6.1] — 2026-05-08 · Charts & data integrity

> Probability charts now render immediately on fresh databases, no more empty boxes for the first 10 minutes.

### ✨ New
- **History backfill on first sync** — every scenario with fewer than 2 history points gets 5 deterministic synthetic points spread over the past hour. Charts render the moment markets load.

### 🐛 Fixed
- **Empty-array truthiness cache bug** — `if (!cache[key])` returned `false` for cached empty arrays, so once the frontend cached "no history" it never refetched. Now refetches whenever cached data is too sparse to render a chart.
- **Live stats bar showing $0 / 0 traders briefly** — added localStorage cache + cold-start defaults.

---

## [0.6.0] — 2026-05-07 · Public launch

> First version deployed at scenara.vercel.app with full simulation features.

### ✨ New
- **Migrated to Render Postgres** — replaced Neon (data-transfer quota issues) with Render's internal Postgres.
- **Render-internal `DATABASE_URL`** — backend talks to Postgres over Render's private network. Zero public-internet egress.
