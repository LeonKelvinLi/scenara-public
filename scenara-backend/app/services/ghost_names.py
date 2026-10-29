"""
ghost_names.py — fintech / prediction-market style synthetic handle generator
─────────────────────────────────────────────────────────────────────────────
Single source of truth for the *procedural* portion of the synthetic
ghost-trader pool used to pad a sparse leaderboard.

Design goals (mirrors the frontend helper src/lib/mockUsers.ts):
  • Realistic anonymous handles in a prediction-market / quant / fintech voice
    (e.g. macrofox, novarunner, bayesatlas, riskdrift, trendpilot) — never real
    human names, never obvious placeholders (user123, demotrader, player1).
  • Guaranteed uniqueness: every handle returned by `procedural_handles` is
    distinct within a single call, enforced with a set.
  • Deterministic ordering so the same slot always maps to the same handle and
    the leaderboard never flickers between requests.

The pool is large: len(PREFIXES) * len(SUFFIXES) distinct base combinations,
which comfortably exceeds the 300-entry leaderboard cap.  If a caller ever asks
for more handles than the base pool holds, unique numeric variants are appended
(e.g. macrofox2) — still clean, never ugly.
"""

from __future__ import annotations

from math import gcd
from typing import Iterable

# ── Vocabulary ────────────────────────────────────────────────────────────────
# Quant / markets / probability concepts.  Kept disjoint from SUFFIXES so a
# handle never reads as a doubled word.
PREFIXES: list[str] = [
    "macro", "nova", "bayes", "market", "signal", "risk", "trend", "alpha",
    "delta", "theta", "vega", "gamma", "sigma", "quant", "hedge", "yield",
    "basis", "spread", "drift", "momentum", "arb", "beta", "kelly", "sharpe",
    "carry", "ledger", "oracle", "vector", "convex", "skew", "payoff",
    "parlay", "wager", "ticker", "futures", "lattice",
]

# Animal / role / object handles — the kind real people append to a username.
SUFFIXES: list[str] = [
    "fox", "runner", "moth", "atlas", "pilot", "hawk", "whale", "wolf", "owl",
    "lab", "desk", "flow", "node", "wave", "byte", "ape", "lynx", "raven",
    "otter", "falcon", "heron", "crane", "mantis", "viper", "koi", "scout",
    "trader", "sage", "monk", "ghost",
]

_POOL_SIZE = len(PREFIXES) * len(SUFFIXES)   # distinct base combinations

# Stride coprime to the pool size → walking idx = (slot * STRIDE) % _POOL_SIZE
# visits every base combination exactly once before repeating, and consecutive
# slots land on visually unrelated prefix/suffix pairs.
_STRIDE = 7
assert gcd(_STRIDE, _POOL_SIZE) == 1, "stride must be coprime to the pool size for a full walk"


def _base_handle(walk: int) -> str:
    """Map a 0-based walk index to a `prefix+suffix` handle (bijective over the pool)."""
    idx = (walk * _STRIDE) % _POOL_SIZE
    return f"{PREFIXES[idx % len(PREFIXES)]}{SUFFIXES[idx // len(PREFIXES)]}"


def procedural_handles(count: int, exclude: Iterable[str] = ()) -> list[str]:
    """Return `count` guaranteed-unique fintech-style handles.

    `exclude` lets callers reserve the curated/named handles so a procedural
    handle never collides with them.  Uniqueness is enforced with a set; once
    the base pool is exhausted, numeric variants (`handle2`, `handle3`, …) keep
    the output unique without producing ugly placeholder names.
    """
    used: set[str] = {h.lower() for h in exclude}
    out: list[str] = []
    walk = 0

    while len(out) < count:
        base = _base_handle(walk)
        walk += 1

        candidate = base
        bump = 2
        while candidate in used:
            candidate = f"{base}{bump}"
            bump += 1

        used.add(candidate)
        out.append(candidate)

    return out
