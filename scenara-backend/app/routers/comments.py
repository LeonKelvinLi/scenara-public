from __future__ import annotations

from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session, joinedload

from app.db import get_db
from app import models
from app.routers.auth import get_current_user

router = APIRouter()

# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class CommentCreate(BaseModel):
    body: str = Field(..., min_length=1, max_length=2000)
    event_id: int | None = None
    news_url: str | None = None


class CommentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    user_id: int
    body: str
    body_en: str | None = None
    created_at: datetime
    display_name: str | None = None
    event_id: int | None = None
    news_url: str | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _format(c: models.Comment) -> CommentOut:
    return CommentOut(
        id=c.id,
        user_id=c.user_id,
        body=c.body,
        created_at=c.created_at,
        display_name=c.user.display_name if c.user else None,
        event_id=c.event_id,
        news_url=c.news_url,
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/event/{event_id}", response_model=list[CommentOut])
def get_event_comments(
    event_id: int,
    lang: str = Query(default="pt"),
    db: Session = Depends(get_db),
):
    real = (
        db.query(models.Comment)
        .filter(models.Comment.event_id == event_id)
        .options(joinedload(models.Comment.user))
        .order_by(models.Comment.created_at.desc())
        .limit(100)
        .all()
    )
    formatted = [_format(c) for c in real]

    return formatted


@router.get("/news", response_model=list[CommentOut])
def get_news_comments(
    url: str = Query(...),
    lang: str = Query(default="pt"),
    db: Session = Depends(get_db),
):
    real = (
        db.query(models.Comment)
        .filter(models.Comment.news_url == url)
        .options(joinedload(models.Comment.user))
        .order_by(models.Comment.created_at.desc())
        .limit(100)
        .all()
    )
    formatted = [_format(c) for c in real]

    return formatted


@router.post("/", response_model=CommentOut, status_code=201)
def post_comment(
    payload: CommentCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if not payload.body.strip():
        raise HTTPException(status_code=400, detail="Comment cannot be empty")
    if not payload.event_id and not payload.news_url:
        raise HTTPException(status_code=400, detail="Provide event_id or news_url")

    comment = models.Comment(
        user_id=current_user.id,  # always use JWT identity — never trust caller-supplied ID
        body=payload.body.strip(),
        event_id=payload.event_id,
        news_url=payload.news_url,
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)

    # reload with user relationship for display_name
    comment = (
        db.query(models.Comment)
        .options(joinedload(models.Comment.user))
        .filter(models.Comment.id == comment.id)
        .first()
    )
    return _format(comment)


@router.delete("/{comment_id}", status_code=204)
def delete_comment(
    comment_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    comment = db.query(models.Comment).filter(models.Comment.id == comment_id).first()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    if comment.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your comment")
    db.delete(comment)
    db.commit()