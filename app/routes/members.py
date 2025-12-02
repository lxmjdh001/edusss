from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_

from .. import models, schemas
from ..database import get_db
from ..dependencies import get_admin_user
from ..utils import hash_password

router = APIRouter(prefix="/api/members", tags=["members"])


@router.get("/", response_model=List[schemas.Member])
def list_members(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    vip_level: Optional[int] = Query(None, ge=1, le=3),
    keyword: Optional[str] = Query(
        None,
        description="支持手机号、账号或学生姓名模糊搜索",
    ),
    db: Session = Depends(get_db),
    admin: models.Member = Depends(get_admin_user),
):
    query = db.query(models.Member)
    if vip_level:
        query = query.filter(models.Member.vip_level == vip_level)
    if keyword:
        like_expr = f"%{keyword}%"
        query = query.filter(
            or_(
                models.Member.phone.ilike(like_expr),
                models.Member.account.ilike(like_expr),
                models.Member.student_name.ilike(like_expr),
            )
        )
    members = query.order_by(models.Member.id.desc()).offset(skip).limit(limit).all()
    return members


@router.get("/{member_id}", response_model=schemas.Member)
def get_member(member_id: int, db: Session = Depends(get_db)):
    member = db.get(models.Member, member_id)
    if not member:
        raise HTTPException(status_code=404, detail="会员不存在")
    return member


@router.post("/", response_model=schemas.Member, status_code=201)
def create_member(payload: schemas.MemberCreate, db: Session = Depends(get_db)):
    if db.query(models.Member).filter_by(phone=payload.phone).first():
        raise HTTPException(status_code=400, detail="手机号已被注册")
    if db.query(models.Member).filter_by(account=payload.account).first():
        raise HTTPException(status_code=400, detail="账号已存在")

    expires_at = payload.expires_at
    if expires_at and expires_at < datetime.utcnow():
        raise HTTPException(status_code=400, detail="到期时间不能早于当前时间")

    member = models.Member(
        phone=payload.phone,
        vip_level=payload.vip_level,
        account=payload.account,
        password_hash=hash_password(payload.password),
        student_name=payload.student_name,
        expires_at=payload.expires_at,
    )
    db.add(member)
    db.commit()
    db.refresh(member)
    return member


@router.put("/{member_id}", response_model=schemas.Member)
def update_member(member_id: int, payload: schemas.MemberUpdate, db: Session = Depends(get_db)):
    member = db.get(models.Member, member_id)
    if not member:
        raise HTTPException(status_code=404, detail="会员不存在")

    if payload.phone and payload.phone != member.phone:
        if db.query(models.Member).filter_by(phone=payload.phone).first():
            raise HTTPException(status_code=400, detail="手机号已被注册")
        member.phone = payload.phone

    if payload.account and payload.account != member.account:
        if db.query(models.Member).filter_by(account=payload.account).first():
            raise HTTPException(status_code=400, detail="账号已存在")
        member.account = payload.account

    if payload.vip_level is not None:
        member.vip_level = payload.vip_level

    if payload.student_name is not None:
        member.student_name = payload.student_name

    if payload.expires_at is not None:
        if payload.expires_at < datetime.utcnow():
            raise HTTPException(status_code=400, detail="到期时间不能早于当前时间")
        member.expires_at = payload.expires_at

    if payload.is_active is not None:
        member.is_active = payload.is_active

    if payload.password:
        member.password_hash = hash_password(payload.password)

    db.add(member)
    db.commit()
    db.refresh(member)
    return member


@router.delete("/{member_id}", status_code=204)
def delete_member(member_id: int, db: Session = Depends(get_db)):
    member = db.get(models.Member, member_id)
    if not member:
        raise HTTPException(status_code=404, detail="会员不存在")
    db.delete(member)
    db.commit()
    return None

