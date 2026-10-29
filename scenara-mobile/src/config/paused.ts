/**
 * src/config/paused.ts — project-pause switch
 *
 * Live mode is the default. Set EXPO_PUBLIC_PROJECT_PAUSED=true at build time
 * to serve the July 2026 static archive again:
 *
 *   - components/ProjectPausedNotice.tsx  — entry notice
 *   - app/(tabs)/index.tsx  LiveStatsBar  — trader count reads 0
 *
 * Backend counters always report actual database activity in either mode.
 */

export const PROJECT_PAUSED = process.env.EXPO_PUBLIC_PROJECT_PAUSED === "true";

/** Displayed user/trader count while the project is paused. */
export const PAUSED_TRADER_COUNT = 0;

/**
 * The moment the archive froze — when scenara-db was dumped, just before it was
 * deleted. Every market, probability and chart on the site is the state of the
 * world at this instant and will never move again, so the stats bar stamps it
 * rather than implying anything is current.
 */
export const ARCHIVE_FROZEN_AT = "2026-07-30";

export const ARCHIVE_FROZEN_LABEL: Record<string, string> = {
  en: "FROZEN 30 JUL 2026",
  pt: "CONGELADO 30 JUL 2026",
  zh: "定格于 2026 年 7 月 30 日",
};
