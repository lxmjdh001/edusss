from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..utils import generate_code

router = APIRouter(prefix="/api/query-codes", tags=["query-codes"])


@router.get("/", response_model=List[schemas.QueryCode])
def list_query_codes(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    student_name: Optional[str] = None,
    is_active: Optional[bool] = None,
    db: Session = Depends(get_db),
):
    query = db.query(models.QueryCode).order_by(models.QueryCode.created_at.desc())
    if student_name:
        query = query.filter(models.QueryCode.student_name.ilike(f"%{student_name}%"))
    if is_active is not None:
        query = query.filter(models.QueryCode.is_active == is_active)
    return query.offset(skip).limit(limit).all()


@router.post("/", response_model=schemas.QueryCode, status_code=201)
def create_query_code(payload: schemas.QueryCodeCreate, db: Session = Depends(get_db)):
    code = payload.code or generate_code()
    if db.query(models.QueryCode).filter_by(code=code).first():
        raise HTTPException(status_code=400, detail="查询码已存在")
    if payload.expires_at <= datetime.utcnow():
        raise HTTPException(status_code=400, detail="有效期需要大于当前时间")

    query_code = models.QueryCode(
        code=code,
        expires_at=payload.expires_at,
        student_name=payload.student_name,
        description=payload.description,
        member_id=payload.member_id,
    )
    db.add(query_code)
    db.commit()
    db.refresh(query_code)
    return query_code


@router.get("/{query_code_id}", response_model=schemas.QueryCode)
def get_query_code(query_code_id: int, db: Session = Depends(get_db)):
    query_code = db.get(models.QueryCode, query_code_id)
    if not query_code:
        raise HTTPException(status_code=404, detail="查询码不存在")
    return query_code


@router.put("/{query_code_id}", response_model=schemas.QueryCode)
def update_query_code(
    query_code_id: int,
    payload: schemas.QueryCodeUpdate,
    db: Session = Depends(get_db),
):
    query_code = db.get(models.QueryCode, query_code_id)
    if not query_code:
        raise HTTPException(status_code=404, detail="查询码不存在")

    if payload.expires_at is not None:
        if payload.expires_at <= datetime.utcnow():
            raise HTTPException(status_code=400, detail="有效期需要大于当前时间")
        query_code.expires_at = payload.expires_at
    if payload.student_name is not None:
        query_code.student_name = payload.student_name
    if payload.description is not None:
        query_code.description = payload.description
    if payload.member_id is not None:
        query_code.member_id = payload.member_id
    if payload.is_active is not None:
        query_code.is_active = payload.is_active

    db.add(query_code)
    db.commit()
    db.refresh(query_code)
    return query_code


@router.delete("/{query_code_id}", status_code=204)
def delete_query_code(query_code_id: int, db: Session = Depends(get_db)):
    query_code = db.get(models.QueryCode, query_code_id)
    if not query_code:
        raise HTTPException(status_code=404, detail="查询码不存在")
    db.delete(query_code)
    db.commit()
    return None


@router.post("/verify", response_model=schemas.QueryCode)
def verify_query_code(code: str, db: Session = Depends(get_db)):
    query_code = (
        db.query(models.QueryCode)
        .filter(models.QueryCode.code == code)
        .first()
    )
    if not query_code or not query_code.is_active:
        raise HTTPException(status_code=404, detail="查询码无效")
    if query_code.expires_at <= datetime.utcnow():
        query_code.is_active = False
        db.commit()
        raise HTTPException(status_code=400, detail="查询码已过期")
    query_code.last_used_at = datetime.utcnow()
    db.add(query_code)
    db.commit()
    db.refresh(query_code)
    return query_code

