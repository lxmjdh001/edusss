from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..utils import generate_code

router = APIRouter(prefix="/api/invite-codes", tags=["invite-codes"])


@router.get("/", response_model=List[schemas.InviteCode])
def list_invite_codes(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    is_used: Optional[bool] = None,
    db: Session = Depends(get_db),
):
    query = db.query(models.InviteCode).order_by(models.InviteCode.generated_at.desc())
    if is_used is not None:
        query = query.filter(models.InviteCode.is_used == is_used)
    return query.offset(skip).limit(limit).all()


@router.post("/", response_model=schemas.InviteCode, status_code=201)
def create_invite_code(payload: schemas.InviteCodeCreate, db: Session = Depends(get_db)):
    code = payload.code or generate_code()
    if db.query(models.InviteCode).filter_by(code=code).first():
        raise HTTPException(status_code=400, detail="邀请码重复，请重新生成")

    invite_code = models.InviteCode(
        code=code,
        vip_level=payload.vip_level,
        valid_days=payload.valid_days,
    )
    db.add(invite_code)
    db.commit()
    db.refresh(invite_code)
    return invite_code


@router.put("/{invite_code_id}", response_model=schemas.InviteCode)
def update_invite_code(
    invite_code_id: int,
    payload: schemas.InviteCodeUpdate,
    db: Session = Depends(get_db),
):
    invite_code = db.get(models.InviteCode, invite_code_id)
    if not invite_code:
        raise HTTPException(status_code=404, detail="邀请码不存在")

    if payload.vip_level is not None:
        invite_code.vip_level = payload.vip_level
    if payload.valid_days is not None:
        invite_code.valid_days = payload.valid_days
    if payload.is_used is not None:
        invite_code.is_used = payload.is_used

    db.add(invite_code)
    db.commit()
    db.refresh(invite_code)
    return invite_code


@router.delete("/{invite_code_id}", status_code=204)
def delete_invite_code(invite_code_id: int, db: Session = Depends(get_db)):
    invite_code = db.get(models.InviteCode, invite_code_id)
    if not invite_code:
        raise HTTPException(status_code=404, detail="邀请码不存在")
    db.delete(invite_code)
    db.commit()
    return None

