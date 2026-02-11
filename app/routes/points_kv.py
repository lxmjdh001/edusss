"""
积分系统键值存储（SQLite）
用于替代前端 localStorage 的持久化
"""
from __future__ import annotations

import os
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..dependencies import get_optional_user
from ..models import Member, PointsKV

router = APIRouter(prefix="/api/points-kv", tags=["points-kv"])


def _is_desktop_mode() -> bool:
    return os.getenv("DESKTOP_MODE", "false").lower() == "true"


def _resolve_owner(current_user: Optional[Member]) -> tuple[str, Optional[int]]:
    if _is_desktop_mode():
        return ("offline", None)
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="未登录或登录已过期",
        )
    if not current_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="账号已被禁用",
        )
    if current_user.expires_at and current_user.expires_at < datetime.utcnow():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="账号已过期，请联系客服续费",
        )
    return ("user", current_user.id)


class KVItem(BaseModel):
    key: str = Field(..., max_length=200)
    value: str


class KVBatch(BaseModel):
    items: List[KVItem]


@router.get("/all")
def get_all(
    db: Session = Depends(get_db),
    current_user: Optional[Member] = Depends(get_optional_user),
):
    owner_type, owner_id = _resolve_owner(current_user)
    rows = db.query(PointsKV).filter(
        PointsKV.owner_type == owner_type,
        PointsKV.owner_id == owner_id,
    ).all()
    return [
        {"key": row.key, "value": row.value}
        for row in rows
    ]


@router.post("/set")
def set_item(
    payload: KVItem,
    db: Session = Depends(get_db),
    current_user: Optional[Member] = Depends(get_optional_user),
):
    owner_type, owner_id = _resolve_owner(current_user)
    row = db.query(PointsKV).filter(
        PointsKV.owner_type == owner_type,
        PointsKV.owner_id == owner_id,
        PointsKV.key == payload.key,
    ).first()
    if row:
        row.value = payload.value
    else:
        row = PointsKV(
            owner_type=owner_type,
            owner_id=owner_id,
            key=payload.key,
            value=payload.value,
        )
        db.add(row)
    db.commit()
    return {"saved": True}


@router.post("/batch")
def set_batch(
    payload: KVBatch,
    db: Session = Depends(get_db),
    current_user: Optional[Member] = Depends(get_optional_user),
):
    owner_type, owner_id = _resolve_owner(current_user)
    if not payload.items:
        return {"saved": 0}
    keys = [item.key for item in payload.items]
    existing = {
        row.key: row
        for row in db.query(PointsKV).filter(
            PointsKV.owner_type == owner_type,
            PointsKV.owner_id == owner_id,
            PointsKV.key.in_(keys),
        ).all()
    }
    for item in payload.items:
        row = existing.get(item.key)
        if row:
            row.value = item.value
        else:
            db.add(PointsKV(
                owner_type=owner_type,
                owner_id=owner_id,
                key=item.key,
                value=item.value,
            ))
    db.commit()
    return {"saved": len(payload.items)}


@router.delete("/{key}")
def delete_item(
    key: str,
    db: Session = Depends(get_db),
    current_user: Optional[Member] = Depends(get_optional_user),
):
    owner_type, owner_id = _resolve_owner(current_user)
    deleted = db.query(PointsKV).filter(
        PointsKV.owner_type == owner_type,
        PointsKV.owner_id == owner_id,
        PointsKV.key == key,
    ).delete()
    db.commit()
    return {"deleted": deleted}
