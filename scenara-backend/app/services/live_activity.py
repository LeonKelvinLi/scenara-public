"""
live_activity.py — shared synthetic "liveliness" model
──────────────────────────────────────────────────────
Single source of truth for the time-of-day activity curve used by:
  • the LIVE banner (trader count + 24h volume)   — routers/accounts.py
  • the Daily-Challenge participant count          — routers/daily_challenge.py

A smooth cosine daily curve (peak 18:00 UTC = EU evening + US daytime, trough
06:00 UTC = global sleep window) drives an "online users" estimate; every other
displayed number is derived from it so the figures never drift out of
plausibility relative to one another.
"""
from __future__ import annotations

import math
from datetime import datetime
from typing import Optional

# Daily "users online" envelope. Min is the global-sleep trough, max the peak.
# Sized to read as a healthy, populated platform without being implausible.
ONLINE_MIN = 700
ONLINE_MAX = 2400


def time_of_day_factor(now: Optional[datetime] = None) -> float:
    """0..1 smooth daily activity curve. Peaks 18:00 UTC, troughs 06:00 UTC.

    Second-resolution so anything derived from it drifts continuously rather
    than stepping once per hour.
    """
    now = now or datetime.utcnow()
    sod = now.hour * 3600 + now.minute * 60 + now.second
    phase = 2.0 * math.pi * (sod - 18 * 3600) / 86_400.0
    return (math.cos(phase) + 1.0) / 2.0


def online_users(now: Optional[datetime] = None) -> float:
    """Estimated users online right now, following the daily curve."""
    return ONLINE_MIN + (ONLINE_MAX - ONLINE_MIN) * time_of_day_factor(now)
