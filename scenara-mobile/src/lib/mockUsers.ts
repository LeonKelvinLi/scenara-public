/**
 * src/lib/mockUsers.ts — fintech / prediction-market style username generator
 * ───────────────────────────────────────────────────────────────────────────
 * Hidden source of truth for synthetic ("ghost") usernames shown in demo /
 * fallback UI (home activity ticker, sidebar live-comments). The leaderboard
 * itself is server-driven; the backend mirror lives in
 * scenara-backend/app/services/ghost_names.py and shares this exact vocabulary.
 *
 * Design goals:
 *   • Realistic anonymous handles in a quant / markets voice
 *     (macrofox, novarunner, bayesatlas, riskdrift, trendpilot) — never real
 *     human names, never obvious placeholders (User123, DemoTrader, Player1).
 *   • Guaranteed uniqueness: getUniqueMockUsernames() returns no duplicates,
 *     enforced with a Set.
 *   • Deterministic ordering so the UI never flickers between renders. The
 *     pool is walked with a coprime stride (an effective fixed shuffle) rather
 *     than Math.random, which would re-order on every render.
 *
 * The base pool is PREFIXES × SUFFIXES distinct handles (well over the few
 * hundred any screen needs). If a caller asks for more than the pool holds,
 * unique numeric variants (macrofox2, …) keep the result duplicate-free
 * without producing ugly names.
 */

// Quant / markets / probability concepts. Disjoint from SUFFIXES so a handle
// never reads as a doubled word.
export const PREFIXES = [
  "macro", "nova", "bayes", "market", "signal", "risk", "trend", "alpha",
  "delta", "theta", "vega", "gamma", "sigma", "quant", "hedge", "yield",
  "basis", "spread", "drift", "momentum", "arb", "beta", "kelly", "sharpe",
  "carry", "ledger", "oracle", "vector", "convex", "skew", "payoff",
  "parlay", "wager", "ticker", "futures", "lattice",
] as const;

// Animal / role / object handles — the kind real people append to a username.
export const SUFFIXES = [
  "fox", "runner", "moth", "atlas", "pilot", "hawk", "whale", "wolf", "owl",
  "lab", "desk", "flow", "node", "wave", "byte", "ape", "lynx", "raven",
  "otter", "falcon", "heron", "crane", "mantis", "viper", "koi", "scout",
  "trader", "sage", "monk", "ghost",
] as const;

const POOL_SIZE = PREFIXES.length * SUFFIXES.length; // distinct base combinations
const STRIDE = 7; // coprime to POOL_SIZE → a full, non-repeating walk of the pool

function baseHandle(walk: number): string {
  const idx = (walk * STRIDE) % POOL_SIZE;
  return `${PREFIXES[idx % PREFIXES.length]}${SUFFIXES[Math.floor(idx / PREFIXES.length)]}`;
}

/**
 * Return `count` guaranteed-unique fintech-style usernames.
 *
 * @param count    how many usernames to generate
 * @param exclude  handles to reserve (e.g. curated names) so generated handles
 *                 never collide with them
 */
export function getUniqueMockUsernames(count: number, exclude: Iterable<string> = []): string[] {
  const used = new Set<string>([...exclude].map(h => h.toLowerCase()));
  const out: string[] = [];
  let walk = 0;

  while (out.length < count) {
    const base = baseHandle(walk);
    walk += 1;

    let candidate = base;
    let bump = 2;
    while (used.has(candidate)) {
      candidate = `${base}${bump}`;
      bump += 1;
    }

    used.add(candidate);
    out.push(candidate);
  }

  return out;
}
