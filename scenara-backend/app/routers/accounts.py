from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.db import get_db
from app import models
from app.routers.auth import get_current_user, get_current_user_optional

router = APIRouter()

# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class AccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    currency: str
    balance: float
    account_type: str
    is_active: bool


class LeaderboardEntry(BaseModel):
    rank: int
    user_id: int
    email: str
    display_name: str
    balance: float
    total_pnl: float
    total_predictions: int
    won_count: int
    lost_count: int
    win_rate: float
    current_streak: int
    best_streak: int
    is_following: bool = False   # whether the calling user follows this one
    follower_count: int = 0      # for "popular trader" sorting later
    level: int = 1               # derived from user.xp via sqrt curve
    xp: int = 0


class LeaderboardOut(BaseModel):
    entries: list[LeaderboardEntry]
    total_users: int


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

class LiveStatsOut(BaseModel):
    """Public counters powering the home-screen LIVE banner."""
    traders: int          # total active users
    volume_24h: float     # USD-equivalent simulated volume in last 24h
    open_markets: int     # events with status="open"


def _is_admin(user: Optional[models.User]) -> bool:
    return bool(user and getattr(user, "is_admin", False))


@router.get("/live-stats", response_model=LiveStatsOut)
def get_live_stats(
    db: Session = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_current_user_optional),
):
    """Actual account, prediction-volume and open-market counts for every viewer."""
    from datetime import datetime, timedelta
    from sqlalchemy import func

    cutoff = datetime.utcnow() - timedelta(hours=24)
    real_traders = (
        db.query(func.count(models.User.id))
        .filter(models.User.is_active.is_(True))
        .scalar() or 0
    )
    real_volume = (
        db.query(func.coalesce(func.sum(models.Prediction.simulated_amount), 0.0))
        .filter(models.Prediction.created_at >= cutoff)
        .scalar() or 0.0
    )
    open_markets = (
        db.query(func.count(models.Event.id))
        .filter(models.Event.status == "open")
        .scalar() or 0
    )

    return LiveStatsOut(
        traders=int(real_traders),
        volume_24h=float(real_volume),
        open_markets=int(open_markets),
    )


@router.get("/user/{user_id}", response_model=AccountOut)
def get_user_simulation_account(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    # Only the account owner or an admin may view account details.
    if current_user.id != user_id and not getattr(current_user, "is_admin", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorised to view this account",
        )

    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    account = (
        db.query(models.Account)
        .filter(
            models.Account.user_id == user_id,
            models.Account.account_type == "simulation",
            models.Account.is_active.is_(True),
        )
        .first()
    )
    if not account:
        raise HTTPException(status_code=404, detail="Simulation account not found")

    return account


@router.get("/leaderboard", response_model=LeaderboardOut)
def get_leaderboard(
    db: Session = Depends(get_db),
    sort_by: Literal["pnl", "balance", "win_rate"] = Query(default="pnl"),
    limit: int = Query(default=20, ge=1, le=300),
    viewer_id: Optional[int] = Query(default=None, description="If provided, returns is_following per row"),
    current_user: Optional[models.User] = Depends(get_current_user_optional),
):
    from sqlalchemy import func, case
    from app.models import UserFollow

    # Single query: aggregate predictions per user
    pred_agg = (
        db.query(
            models.Prediction.user_id,
            func.count(models.Prediction.id).label("total_predictions"),
            func.sum(case((models.Prediction.status == "won", 1), else_=0)).label("won_count"),
            func.sum(case((models.Prediction.status == "lost", 1), else_=0)).label("lost_count"),
            func.sum(
                case(
                    (models.Prediction.status.in_(["won", "lost"]), models.Prediction.pnl),
                    else_=0,
                )
            ).label("total_pnl"),
        )
        .group_by(models.Prediction.user_id)
        .subquery()
    )

    total_pnl_col = func.coalesce(pred_agg.c.total_pnl, 0.0).label("total_pnl")
    balance_col = models.Account.balance
    won_count_col = func.coalesce(pred_agg.c.won_count, 0).label("won_count")
    lost_count_col = func.coalesce(pred_agg.c.lost_count, 0).label("lost_count")

    base_q = (
        db.query(
            models.User.id,
            models.User.email,
            models.User.display_name,
            models.User.current_streak,
            models.User.best_streak,
            models.User.xp,
            balance_col,
            func.coalesce(pred_agg.c.total_predictions, 0).label("total_predictions"),
            won_count_col,
            lost_count_col,
            total_pnl_col,
        )
        .join(models.Account, models.Account.user_id == models.User.id)
        .outerjoin(pred_agg, pred_agg.c.user_id == models.User.id)
        .filter(
            models.Account.account_type == "simulation",
            models.Account.is_active.is_(True),
            models.User.is_active.is_(True),
        )
    )

    if sort_by == "balance":
        base_q = base_q.order_by(models.Account.balance.desc())
    elif sort_by == "win_rate":
        base_q = base_q.order_by(
            func.coalesce(pred_agg.c.won_count, 0).desc(),
        )
    else:
        base_q = base_q.order_by(func.coalesce(pred_agg.c.total_pnl, 0.0).desc())

    rows = base_q.all()

    from app.services.xp import level_from_xp
    entries = []
    for row in rows:
        settled = (row.won_count or 0) + (row.lost_count or 0)
        win_rate = round(((row.won_count or 0) / settled) * 100, 1) if settled > 0 else 0.0
        user_xp = int(row.xp or 0)
        entries.append(LeaderboardEntry(
            rank=0,
            user_id=row.id,
            email=row.email if _is_admin(current_user) else "",
            display_name=row.display_name or row.email.split("@")[0],
            balance=round(float(row.balance), 2),
            total_pnl=round(float(row.total_pnl or 0), 2),
            total_predictions=row.total_predictions or 0,
            won_count=row.won_count or 0,
            lost_count=row.lost_count or 0,
            win_rate=win_rate,
            current_streak=row.current_streak or 0,
            best_streak=row.best_streak or 0,
            xp=user_xp,
            level=level_from_xp(user_xp),
        ))

    # win_rate sort requires Python-side re-sort (depends on two columns: win_rate + won_count)
    if sort_by == "win_rate":
        entries.sort(key=lambda e: (e.win_rate, e.won_count), reverse=True)

    for i, entry in enumerate(entries):
        entry.rank = i + 1

    total_users = len(entries)
    entries = entries[:limit]

    # Decorate with social data (follower count, is_following) — only for the
    # trimmed top-N to keep it cheap. Two aggregate queries + one conditional.
    top_ids = [e.user_id for e in entries]
    if top_ids:
        fc_rows = (
            db.query(UserFollow.followee_id, func.count(UserFollow.id))
            .filter(UserFollow.followee_id.in_(top_ids))
            .group_by(UserFollow.followee_id)
            .all()
        )
        fc_map = {uid: int(cnt) for uid, cnt in fc_rows}

        following_set: set[int] = set()
        if viewer_id is not None:
            following_set = {
                r[0] for r in db.query(UserFollow.followee_id)
                .filter(
                    UserFollow.follower_id == viewer_id,
                    UserFollow.followee_id.in_(top_ids),
                ).all()
            }

        for e in entries:
            e.follower_count = fc_map.get(e.user_id, 0)
            e.is_following = e.user_id in following_set

    real_user_count = (
        db.query(func.count(models.User.id))
        .filter(models.User.is_active.is_(True))
        .scalar() or 0
    )

    return LeaderboardOut(entries=entries, total_users=int(real_user_count))
