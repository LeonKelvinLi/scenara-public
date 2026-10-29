/**
 * src/data/users.ts — Shared synthetic user pool
 * ──────────────────────────────────────────────
 * Single source of truth for the 120-user ghost pool used across:
 *   • Leaderboard ghost entries (mirrors backend _GHOST_NAMED exactly)
 *   • Activity ticker player names
 *   • Sidebar live-comment names
 *
 * Names are realistic anonymous prediction-market / quant handles — no real
 * human identities, no obvious placeholders. The username pool and generation
 * logic live in src/lib/mockUsers.ts so this file stays focused on stats.
 * All stats are deterministically derived from the display name so the
 * UI never flickers on re-render.  user_id is NEGATIVE (synthetic).
 */

import { getUniqueMockUsernames } from "@/src/lib/mockUsers";

export type PoolUser = {
  id: number;              // negative = synthetic
  displayName: string;
  balance: number;
  totalPnL: number;
  winRate: number;         // 0–100
  currentStreak: number;
  bestStreak: number;
  wonCount: number;
  lostCount: number;
  totalPredictions: number;
  level: number;
  xp: number;
  rankScore: number;
};

// ── Tiny deterministic LCG ───────────────────────────────────────────────────
function mkRng(seed: number) {
  let s = (seed ^ 0xDEADBEEF) & 0x7FFFFFFF;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) & 0x7FFFFFFF;
    return s / 0x7FFFFFFF;
  };
}
function nameHash(name: string): number {
  let h = 5381;
  for (let i = 0; i < name.length; i++) h = ((h << 5) + h) ^ name.charCodeAt(i);
  return Math.abs(h);
}

// ── Named pool — mirrors backend accounts.py _GHOST_NAMED exactly ────────────
// [displayName, balance, totalPnL, winRate%, currentStreak]
// Anonymous prediction-market / quant handles — no real human names.
const NAMED_RAW: [string, number, number, number, number][] = [
  ["macrofox",        14220,  4220, 70.0, 6],
  ["novaquant",       11820,  1820, 61.2, 3],
  ["bayesrunner",      8910, -1090, 41.7, 0],
  ["marketmoth",      11200,  1200, 58.9, 2],
  ["signalatlas",     10870,   870, 55.3, 1],
  ["riskdrift",       13450,  3450, 68.5, 5],
  ["trendpilot",      15780,  5780, 72.4, 7],
  ["probabilitynerd", 12100,  2100, 59.8, 2],
  ["eventhawk",        9340,  -660, 44.1, 0],
  ["kalshiwhale",     13900,  3900, 66.7, 4],
  ["deltahedge",      12680,  2680, 63.0, 3],
  ["thetagang",       10540,   540, 52.4, 1],
  ["vegabender",      14050,  4050, 69.8, 5],
  ["sharperatio",      9720,  -280, 47.2, 0],
  ["kellybettor",      8430, -1570, 39.5, 0],
  ["volsurfer",       13100,  3100, 65.4, 4],
  ["tailhedge",       15600,  5600, 74.1, 8],
  ["arbseeker",       12340,  2340, 62.7, 3],
  ["yieldhunter",     11490,  1490, 60.5, 2],
  ["basisflow",       10050,    50, 50.8, 1],
  ["convexedge",      11950,  1950, 59.2, 2],
  ["oddsmaker",       14510,  4510, 71.6, 6],
  ["spreadwolf",       9880,  -120, 48.9, 0],
  ["carrytrader",     10660,   660, 54.0, 1],
  ["sigmaowl",        13670,  3670, 67.3, 5],
  ["parlaymonk",      14800,  4800, 71.0, 6],
  ["ledgerlynx",      13220,  3220, 66.0, 4],
  ["oraclewave",      12050,  2050, 61.5, 3],
  ["quantcrane",      10780,   780, 54.8, 1],
];

// ── Procedural pool ───────────────────────────────────────────────────────────
// Handles come from getUniqueMockUsernames (src/lib/mockUsers.ts), which
// guarantees uniqueness and excludes the named handles above so the full pool
// has zero duplicate display names. Stats are still seeded per-name below.
const PROC_COUNT = 90;
const PROC_NAMES = getUniqueMockUsernames(PROC_COUNT, NAMED_RAW.map(([name]) => name));

// ── Build the pool ───────────────────────────────────────────────────────────
const XP_BY_STREAK = [120, 200, 350, 500, 750, 900, 1100, 1400];

function buildUser(
  displayName: string, balance: number, totalPnL: number,
  winRate: number, currentStreak: number, id: number
): PoolUser {
  const rng = mkRng(nameHash(displayName));
  const bestStreak = currentStreak + Math.floor(rng() * 5);
  const totalPredictions = 20 + Math.floor(rng() * 120);
  const wonCount = Math.round(totalPredictions * (winRate / 100));
  const lostCount = totalPredictions - wonCount;
  const xpBase = XP_BY_STREAK[Math.min(currentStreak, XP_BY_STREAK.length - 1)];
  const xp = xpBase + Math.floor(rng() * 80);
  const level = Math.max(1, Math.floor(Math.sqrt(xp / 50)));

  const volumeScore   = Math.min(totalPredictions * 8, 1000);
  const winRateScore  = winRate * 10;
  const activityScore = Math.min(currentStreak * 100, 1000);
  const streakScore   = Math.min(bestStreak * 50, 1000);
  const rankScore     = totalPnL * 0.45 + volumeScore * 0.20 + winRateScore * 0.20
                      + activityScore * 0.10 + streakScore * 0.05;

  return {
    id, displayName, balance, totalPnL, winRate, currentStreak, bestStreak,
    wonCount, lostCount, totalPredictions, level, xp, rankScore,
  };
}

function buildPool(): PoolUser[] {
  const users: PoolUser[] = [];

  NAMED_RAW.forEach(([name, bal, pnl, wr, streak], i) => {
    users.push(buildUser(name, bal, pnl, wr, streak, -(i + 1)));
  });

  for (let i = 0; i < PROC_COUNT; i++) {
    const name = PROC_NAMES[i];
    const rng  = mkRng(nameHash(name));
    const bal  = 7000 + Math.floor(rng() * 9000);
    const pnl  = Math.round((rng() * 2 - 0.5) * 4000);
    const wr   = 35 + Math.floor(rng() * 42);
    const str  = Math.floor(rng() * 8);
    users.push(buildUser(name, bal, pnl, wr, str, -(NAMED_RAW.length + i + 1)));
  }

  return users;
}

/** Full 120-user pool — sorted by rankScore descending. */
export const USER_POOL: PoolUser[] = buildPool().sort((a, b) => b.rankScore - a.rankScore);

export const USER_BY_NAME: ReadonlyMap<string, PoolUser> = new Map(
  USER_POOL.map(u => [u.displayName, u])
);

// ── Sidebar live-comment seed ─────────────────────────────────────────────────
const COMMENT_BODIES = [
  "just put $20 on Yes lol let's see",
  "been watching this one all week. finally moving",
  "nah the No side is way underpriced rn",
  "anyone else think the chart looks bullish?",
  "lost my last bet here but I still think Yes",
  "the market moved 12% in 2h... insane",
  "waiting for more info before I commit",
  "already up 40% this week on these markets",
  "is this safe to bet on? first time here",
  "people sleeping on the No side here imo",
  "this aged well lmao called it yesterday",
  "added more at 34%, feels like easy money",
  "honestly surprised how accurate these odds are",
  "anyone know when this resolves?",
  "diversifying across 5 markets today, no all-in",
  "chart says Yes but gut says No",
];

export const SIDEBAR_SEED: Array<{ uid: number; name: string; body: string }> = USER_POOL
  .slice(0, COMMENT_BODIES.length)
  .map((u, i) => ({ uid: -u.id, name: u.displayName, body: COMMENT_BODIES[i] }));

// ── Activity ticker fallback ─────────────────────────────────────────────────
export type FallbackActivity = {
  player: string; event_title: string; scenario_title: string;
  amount_label: string; seconds_ago: number;
};

const FALLBACK_EVENTS = [
  { event: "Bitcoin above $100k by June?",    scenario: "Yes" },
  { event: "Brazil wins Copa América?",         scenario: "Yes" },
  { event: "US rate cut this quarter?",         scenario: "No"  },
  { event: "ChatGPT retains top AI spot?",      scenario: "Yes" },
  { event: "USD/BRL above 5.80 by Dec?",        scenario: "No"  },
  { event: "Next iPhone release before Oct?",   scenario: "Yes" },
  { event: "Tesla stock above $300?",           scenario: "Yes" },
  { event: "EU recession confirmed?",           scenario: "No"  },
  { event: "Ethereum above $4k by Q3?",         scenario: "Yes" },
  { event: "Argentina inflation above 100%?",   scenario: "Yes" },
];

export const FALLBACK_ACTIVITY: FallbackActivity[] = USER_POOL.slice(0, 14).map((u, i) => {
  const ev  = FALLBACK_EVENTS[i % FALLBACK_EVENTS.length];
  const rng = mkRng(nameHash(u.displayName) ^ i);
  const amount = 10 + Math.floor(rng() * 190);
  return {
    player:         u.displayName,
    event_title:    ev.event,
    scenario_title: ev.scenario,
    amount_label:   `$${amount}`,
    seconds_ago:    30 + Math.floor(rng() * 3600),
  };
});
