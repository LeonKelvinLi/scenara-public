import asyncio
import logging

from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.db import Base, engine
from app.observability import init_sentry

# Initialize Sentry FIRST — before any other imports that might emit errors
# we want captured. Safe no-op when SENTRY_DSN is unset.
init_sentry()

from app.routers.users import router as users_router
from app.routers.events import router as events_router
from app.routers.predictions import router as predictions_router
from app.routers.accounts import router as accounts_router
from app.routers.auth import router as auth_router, get_admin_user
from app.routers.news import router as news_router
from app.routers.comments import router as comments_router
from app.routers.push import router as push_router
from app.routers.voting import router as voting_router
from app.routers.admin import router as admin_router
from app.routers.social import router as social_router
from app.routers.notifications import router as notifications_router
from app.routers.signal_lab import router as signal_lab_router
from app.routers.daily_challenge import router as daily_challenge_router
from app.models.user import User

# event_generator is the legacy module — kept as a thin shim re-exporting
# from polymarket_sync.  Import from polymarket_sync directly going forward.
from app.services.polymarket_sync import start_polymarket_sync_loop, start_polymarket_price_loop, sync_markets_once
from app.services.auto_resolver import run_auto_resolver, start_auto_resolver

logger = logging.getLogger(__name__)
APP_VERSION = "0.8.5"


def _migrate_scenario_statuses() -> None:
    """Repair the legacy Polymarket importer status without reopening events."""
    from sqlalchemy import text
    with engine.begin() as conn:
        conn.execute(text(
            "UPDATE scenarios SET status = 'active' WHERE status = 'open' "
            "AND event_id IN (SELECT id FROM events WHERE status = 'open')"
        ))


def _migrate_is_admin_column() -> None:
    """Idempotent: add is_admin column to users table if missing."""
    from sqlalchemy import text as sql_text, inspect
    insp = inspect(engine)
    cols = [c["name"] for c in insp.get_columns("users")]
    if "is_admin" not in cols:
        with engine.begin() as conn:
            conn.execute(sql_text("ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT FALSE"))
        logger.info("[Migration] Added is_admin column to users.")


def _migrate_user_columns() -> None:
    """Idempotent: add any missing columns to the users table."""
    from sqlalchemy import text as sql_text, inspect
    insp = inspect(engine)
    cols = [c["name"] for c in insp.get_columns("users")]

    with engine.begin() as conn:
        if "last_login_at" not in cols:
            conn.execute(sql_text("ALTER TABLE users ADD COLUMN last_login_at TIMESTAMP NULL DEFAULT NULL"))
            logger.info("[Migration] Added last_login_at column to users.")
        if "updated_at" not in cols:
            conn.execute(sql_text("ALTER TABLE users ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT NOW()"))
            logger.info("[Migration] Added updated_at column to users.")
        if "display_name" not in cols:
            conn.execute(sql_text("ALTER TABLE users ADD COLUMN display_name VARCHAR(100) NOT NULL DEFAULT ''"))
            logger.info("[Migration] Added display_name column to users.")
        if "xp" not in cols:
            conn.execute(sql_text("ALTER TABLE users ADD COLUMN xp INTEGER NOT NULL DEFAULT 0"))
            logger.info("[Migration] Added xp column to users.")
        if "streak_freeze_active" not in cols:
            conn.execute(sql_text("ALTER TABLE users ADD COLUMN streak_freeze_active BOOLEAN NOT NULL DEFAULT FALSE"))
            logger.info("[Migration] Added streak_freeze_active column to users.")
        if "last_streak_freeze_at" not in cols:
            conn.execute(sql_text("ALTER TABLE users ADD COLUMN last_streak_freeze_at TIMESTAMP NULL DEFAULT NULL"))
            logger.info("[Migration] Added last_streak_freeze_at column to users.")
        for pref in ("notify_settled", "notify_followers", "notify_closing", "notify_weekly_recap"):
            if pref not in cols:
                conn.execute(sql_text(
                    f"ALTER TABLE users ADD COLUMN {pref} BOOLEAN NOT NULL DEFAULT TRUE"
                ))
                logger.info("[Migration] Added %s column to users.", pref)
        if "reset_code_hash" not in cols:
            conn.execute(sql_text("ALTER TABLE users ADD COLUMN reset_code_hash VARCHAR(64) NULL DEFAULT NULL"))
            logger.info("[Migration] Added reset_code_hash column to users.")
        if "reset_code_expires_at" not in cols:
            conn.execute(sql_text("ALTER TABLE users ADD COLUMN reset_code_expires_at TIMESTAMP NULL DEFAULT NULL"))
            logger.info("[Migration] Added reset_code_expires_at column to users.")


def _migrate_zh_columns() -> None:
    """Idempotent: add Chinese translation columns to events and scenarios if missing."""
    from sqlalchemy import text as sql_text, inspect
    insp = inspect(engine)
    event_cols = [c["name"] for c in insp.get_columns("events")]
    scenario_cols = [c["name"] for c in insp.get_columns("scenarios")]
    with engine.begin() as conn:
        if "title_zh" not in event_cols:
            conn.execute(sql_text("ALTER TABLE events ADD COLUMN title_zh VARCHAR(255) NULL"))
            logger.info("[Migration] Added title_zh to events.")
        if "description_zh" not in event_cols:
            conn.execute(sql_text("ALTER TABLE events ADD COLUMN description_zh TEXT NULL"))
            logger.info("[Migration] Added description_zh to events.")
        if "title_zh" not in scenario_cols:
            conn.execute(sql_text("ALTER TABLE scenarios ADD COLUMN title_zh VARCHAR(255) NULL"))
            logger.info("[Migration] Added title_zh to scenarios.")


def _migrate_event_external_columns() -> None:
    """Idempotent: add external-market origin columns to events table."""
    from sqlalchemy import text as sql_text, inspect
    insp = inspect(engine)
    cols = [c["name"] for c in insp.get_columns("events")]
    with engine.begin() as conn:
        if "external_source" not in cols:
            conn.execute(sql_text("ALTER TABLE events ADD COLUMN external_source VARCHAR(40) NULL"))
            conn.execute(sql_text("CREATE INDEX IF NOT EXISTS ix_events_external_source ON events (external_source)"))
            logger.info("[Migration] Added external_source to events.")
        if "external_id" not in cols:
            conn.execute(sql_text("ALTER TABLE events ADD COLUMN external_id VARCHAR(120) NULL"))
            conn.execute(sql_text("CREATE INDEX IF NOT EXISTS ix_events_external_id ON events (external_id)"))
            logger.info("[Migration] Added external_id to events.")
        if "external_url" not in cols:
            conn.execute(sql_text("ALTER TABLE events ADD COLUMN external_url VARCHAR(500) NULL"))
            logger.info("[Migration] Added external_url to events.")
        if "external_volume" not in cols:
            conn.execute(sql_text("ALTER TABLE events ADD COLUMN external_volume DOUBLE PRECISION NULL"))
            logger.info("[Migration] Added external_volume to events.")
        if "external_liquidity" not in cols:
            conn.execute(sql_text("ALTER TABLE events ADD COLUMN external_liquidity DOUBLE PRECISION NULL"))
            logger.info("[Migration] Added external_liquidity to events.")
        if "external_synced_at" not in cols:
            conn.execute(sql_text("ALTER TABLE events ADD COLUMN external_synced_at TIMESTAMP NULL"))
            logger.info("[Migration] Added external_synced_at to events.")
        if "external_data" not in cols:
            conn.execute(sql_text("ALTER TABLE events ADD COLUMN external_data JSON NULL"))
        if "image_url" not in cols:
            conn.execute(sql_text("ALTER TABLE events ADD COLUMN image_url VARCHAR(500) NULL"))
            logger.info("[Migration] Added image_url to events.")


def _migrate_event_ai_columns() -> None:
    """Idempotent: add AI auto-resolver state columns to events table."""
    from sqlalchemy import text as sql_text, inspect
    insp = inspect(engine)
    cols = [c["name"] for c in insp.get_columns("events")]
    with engine.begin() as conn:
        if "ai_attempt_count" not in cols:
            conn.execute(sql_text("ALTER TABLE events ADD COLUMN ai_attempt_count INTEGER NOT NULL DEFAULT 0"))
            logger.info("[Migration] Added ai_attempt_count to events.")
        if "last_ai_attempt_at" not in cols:
            conn.execute(sql_text("ALTER TABLE events ADD COLUMN last_ai_attempt_at TIMESTAMP NULL"))
            logger.info("[Migration] Added last_ai_attempt_at to events.")
        if "ai_last_confidence" not in cols:
            conn.execute(sql_text("ALTER TABLE events ADD COLUMN ai_last_confidence INTEGER NULL"))
            logger.info("[Migration] Added ai_last_confidence to events.")
        if "ai_last_note" not in cols:
            conn.execute(sql_text("ALTER TABLE events ADD COLUMN ai_last_note TEXT NULL"))
            logger.info("[Migration] Added ai_last_note to events.")
        if "ai_source_url" not in cols:
            conn.execute(sql_text("ALTER TABLE events ADD COLUMN ai_source_url VARCHAR(500) NULL"))
            logger.info("[Migration] Added ai_source_url to events.")
        if "ai_needs_review" not in cols:
            conn.execute(sql_text("ALTER TABLE events ADD COLUMN ai_needs_review BOOLEAN NOT NULL DEFAULT FALSE"))
            logger.info("[Migration] Added ai_needs_review to events.")


def _backfill_xp() -> None:
    """
    Idempotent: retroactively award XP to users who placed bets before XP existed.

    Matches the live award rule (services.xp.xp_for_bet):
      xp = floor(amount / 5)  for each bet >= $5, summed per user.

    Targets only users whose xp = 0 AND who have at least one prediction — i.e.
    users that have never had XP awarded. New users who join post-migration
    will start with xp=0 and accrue through normal play.
    """
    from sqlalchemy import text as sql_text
    with engine.begin() as conn:
        # Any candidates? If not, skip entirely to keep startup fast.
        probe = conn.execute(sql_text(
            "SELECT COUNT(*) FROM users u "
            "WHERE u.xp = 0 "
            "AND EXISTS (SELECT 1 FROM predictions p WHERE p.user_id = u.id)"
        )).scalar() or 0
        if probe == 0:
            return

        # Per-user sum(floor(amount/5)) over all their predictions.
        # Use FLOOR() because Postgres integer division rounds toward zero for
        # positive numbers anyway, but being explicit prevents surprises if
        # simulated_amount is stored as a DECIMAL/NUMERIC type.
        conn.execute(sql_text("""
            UPDATE users
            SET xp = sub.total_xp
            FROM (
                SELECT user_id, FLOOR(SUM(FLOOR(simulated_amount / 5)))::INTEGER AS total_xp
                FROM predictions
                WHERE simulated_amount >= 5
                GROUP BY user_id
            ) AS sub
            WHERE users.id = sub.user_id
              AND users.xp = 0
        """))
    logger.info("[Migration] Backfilled XP for %d legacy users.", probe)


def _migrate_brazil_category() -> None:
    """One-time idempotent migration: set category='brazil' for all Brazil-specific events."""
    from sqlalchemy import text as sql_text
    brazil_slugs = [
        "copa-brasil-flamengo", "world-cup-2026-brazil", "libertadores-2026",
        "brazil-5g-coverage", "trump-tariffs-brazil", "ufc-next-brazilian-champ",
    ]
    placeholders = ", ".join(f"'{s}'" for s in brazil_slugs)
    with engine.begin() as conn:
        # All events whose slug starts with "br-"
        conn.execute(sql_text(
            "UPDATE events SET category = 'brazil' WHERE slug LIKE 'br-%' AND category != 'brazil'"
        ))
        # Specific non-br- slugs that are also Brazilian
        conn.execute(sql_text(
            f"UPDATE events SET category = 'brazil' WHERE slug IN ({placeholders}) AND category != 'brazil'"
        ))
    logger.info("[Migration] brazil category sync complete.")


# NB: _purge_legacy_non_polymarket_events moved to app/services/polymarket_sync.py
# so it can run after every successful sync (where the Polymarket-event count
# is fresh and the safety gate works as intended).


def create_app() -> FastAPI:
    app = FastAPI(title=settings.app_name, version=APP_VERSION, debug=settings.app_debug)
    app.state.database_ready = False
    background_tasks: list[asyncio.Task] = []

    raw = settings.cors_allow_origins.strip()
    # "*" means allow all origins; otherwise parse comma-separated list
    cors_allow_origins = ["*"] if raw == "*" else [o.strip() for o in raw.split(",") if o.strip()]

    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_allow_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Accept"],
        max_age=86400,
    )

    async def _backfill_market_translations() -> None:
        from app.services.event_translations import warm_open_events
        await asyncio.to_thread(warm_open_events)

    @app.on_event("startup")
    async def _startup() -> None:
        # ── DB-dependent startup: wrapped so the process never exits on quota
        # errors or transient DB failures.  If the DB is unreachable (e.g. Neon
        # free-tier data-transfer quota exceeded), the server still starts and
        # serves the /health endpoint.  DB-backed endpoints return 500 until the
        # quota resets, but Render.com won't loop-crash the container.
        from app.models import user_follow  # noqa: F401  (must import before create_all)
        try:
            Base.metadata.create_all(bind=engine)
            _migrate_is_admin_column()
            _migrate_user_columns()
            _migrate_zh_columns()
            _migrate_brazil_category()
            _migrate_event_ai_columns()
            _migrate_event_external_columns()
            _migrate_scenario_statuses()
            from app.db import SessionLocal
            from app.services.resolution import repair_incomplete_legacy_refunds
            with SessionLocal() as recovery_db:
                repair_incomplete_legacy_refunds(recovery_db)
            _backfill_xp()
            from app.migrations.indexes import ensure_indexes
            ensure_indexes(engine)
            app.state.database_ready = True
            logger.info("[Startup] DB migrations and indexes applied.")
            # NB: legacy event purge moved out of startup — it needs the
            # current Polymarket-event count to be accurate, and on startup
            # the sync loop hasn't fired yet so the gate would always block.
            # The purge now runs after every successful sync inside
            # polymarket_sync.sync_markets_once().
        except Exception as db_err:
            # Log clearly so the Render dashboard shows the root cause, but do
            # NOT re-raise — let the server start so /health stays reachable.
            logger.error(
                "[Startup] DB unavailable — skipping migrations: %s. "
                "Check database availability and redeploy.",
                db_err,
            )

        # Background tasks start regardless of DB state; each will fail
        # gracefully when they first try to use the DB and will retry on their
        # normal schedule.
        #
        # Polymarket sync is Scenara's sole market source — runs every 20 min,
        # ingests new markets, refreshes probabilities on existing ones, and
        # expires past-due events with prediction refunds.
        if app.state.database_ready and settings.enable_background_tasks and not settings.project_paused:
            background_tasks.extend([
                asyncio.create_task(start_polymarket_sync_loop(interval_seconds=20 * 60)),
                asyncio.create_task(start_polymarket_price_loop()),
                asyncio.create_task(start_auto_resolver()),
                asyncio.create_task(_backfill_market_translations()),
            ])
        logger.info("[Startup] Scenara backend v%s initialized.", APP_VERSION)

    @app.on_event("shutdown")
    async def _shutdown() -> None:
        for task in background_tasks:
            task.cancel()
        await asyncio.gather(*background_tasks, return_exceptions=True)
        engine.dispose()

    @app.get("/", tags=["health"])
    @app.head("/", tags=["health"])
    def health():
        return {"status": "ok", "name": settings.app_name, "version": APP_VERSION}

    @app.get("/health", tags=["health"])
    @app.head("/health", tags=["health"])
    def health_check():
        # Check DB is reachable
        try:
            from sqlalchemy import text as sql_text
            with engine.connect() as conn:
                conn.execute(sql_text("SELECT 1"))
            db_ok = app.state.database_ready
        except Exception:
            db_ok = False
        return JSONResponse(
            status_code=200 if db_ok else 503,
            content={"ok": db_ok, "db": db_ok, "version": APP_VERSION},
        )

    @app.post("/admin/generate-events", tags=["admin"])
    async def trigger_event_generation(current_user: User = Depends(get_admin_user)):
        """Manually trigger one Polymarket sync pass — fetches fresh markets,
        refreshes probabilities on existing ones, expires past-due events."""
        from app.services.polymarket_sync import sync_markets_once
        report = await sync_markets_once()
        return {"ok": True, "message": "Polymarket sync triggered", "report": report}

    @app.post("/admin/snapshot", tags=["admin"])
    async def trigger_snapshot(current_user: User = Depends(get_admin_user)):
        """Kept for backward compatibility.  Polymarket sync handles probability
        updates natively, so this is now a no-op alias for /admin/generate-events."""
        from app.services.polymarket_sync import sync_markets_once
        report = await sync_markets_once()
        return {"ok": True, "message": "Polymarket sync triggered", "report": report}

    @app.post("/admin/resolve-expired", tags=["admin"])
    async def trigger_auto_resolve(current_user: User = Depends(get_admin_user)):
        await run_auto_resolver()
        return {"ok": True, "message": "Auto-resolution complete"}

    @app.post("/admin/purge-legacy-events", tags=["admin"])
    async def trigger_legacy_purge(current_user: User = Depends(get_admin_user)):
        """Manually trigger the legacy non-Polymarket event purge.  Useful if
        the safety gate (≥5 Polymarket events) hasn't cleared yet on the
        normal sync schedule and you want to force the cleanup now.

        Refunds any open predictions on the purged events to the user's
        virtual balance.  Idempotent — safe to call repeatedly.
        """
        from app.services.polymarket_sync import _purge_legacy_non_polymarket_events
        from app.db import SessionLocal
        db = SessionLocal()
        try:
            result = _purge_legacy_non_polymarket_events(db)
        finally:
            db.close()
        return {"ok": True, "result": result}

    @app.get("/admin/sentry-test", tags=["admin"])
    def sentry_test(current_user: User = Depends(get_admin_user)):
        """Deliberately throw to verify Sentry capture end-to-end.
        Admin-only. The 500 response is expected — check the Sentry dashboard."""
        if not current_user.is_admin:
            raise HTTPException(status_code=403, detail="Admin only")
        raise RuntimeError("Sentry verification — this should appear in the Sentry dashboard")

    app.include_router(auth_router,        prefix="/auth",        tags=["auth"])
    app.include_router(users_router,       prefix="/users",       tags=["users"])
    app.include_router(events_router,      prefix="/events",      tags=["events"])
    app.include_router(predictions_router, prefix="/predictions",  tags=["predictions"])
    app.include_router(accounts_router,    prefix="/accounts",    tags=["accounts"])
    app.include_router(news_router,        prefix="/news",        tags=["news"])
    app.include_router(comments_router,    prefix="/comments",    tags=["comments"])
    app.include_router(push_router,        prefix="/push",        tags=["push"])
    app.include_router(voting_router,      prefix="/voting",      tags=["voting"])
    app.include_router(admin_router,       prefix="/admin",       tags=["admin"])
    app.include_router(social_router,        prefix="/social",        tags=["social"])
    app.include_router(notifications_router, prefix="/notifications", tags=["notifications"])
    app.include_router(signal_lab_router,    prefix="/signal-lab",    tags=["signal-lab"])
    app.include_router(daily_challenge_router, prefix="/daily-challenge", tags=["daily-challenge"])

    return app


app = create_app()
