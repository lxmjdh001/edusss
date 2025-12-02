"""激活码管理API路由"""
from __future__ import annotations

import csv
from datetime import datetime
from io import StringIO
from typing import Annotated, Iterable, List, Optional, Set

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, joinedload

from .. import models, schemas
from ..database import get_db
from ..utils import generate_code

router = APIRouter(prefix="/api/activation-codes", tags=["激活码管理"])

# 固定的管理员密码
ADMIN_PASSWORD = "ddjia2022"


def verify_admin_password(password: str) -> bool:
    """验证管理员密码"""
    return password == ADMIN_PASSWORD


def _generate_unique_activation_code(
    db: Session,
    reserved_codes: Optional[Set[str]] = None
) -> str:
    """
    生成数据库中唯一的激活码
    reserved_codes: 已在当前请求中生成过的激活码，用于批量创建时避免重复校验
    """
    if reserved_codes is None:
        reserved_codes = set()

    while True:
        code = generate_code(10)
        if code in reserved_codes:
            continue
        existing = (
            db.query(models.InviteCode)
            .filter(models.InviteCode.code == code)
            .first()
        )
        if not existing:
            reserved_codes.add(code)
            return code


def _attach_activation_user_info(codes: Iterable[models.InviteCode]):
    """为激活码实例补充激活用户名信息"""
    for code in codes:
        user = getattr(code, "used_by_member", None)
        code.activated_by_username = user.account if user else None


@router.post("/verify-admin")
def verify_admin(auth: schemas.AdminAuth):
    """验证管理员密码"""
    if not verify_admin_password(auth.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="密码错误"
        )
    return {"message": "验证成功"}


@router.get("", response_model=List[schemas.ActivationCodeResponse])
def list_activation_codes(
    password: str,
    db: Annotated[Session, Depends(get_db)],
    skip: int = 0,
    limit: int = 100
):
    """
    获取激活码列表
    - 需要管理员密码
    """
    if not verify_admin_password(password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="密码错误"
        )

    codes = (
        db.query(models.InviteCode)
        .options(joinedload(models.InviteCode.used_by_member))
        .order_by(models.InviteCode.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )

    _attach_activation_user_info(codes)

    return codes


@router.post("", response_model=schemas.ActivationCodeResponse, status_code=status.HTTP_201_CREATED)
def create_activation_code(
    code_data: schemas.ActivationCodeCreate,
    password: str,
    db: Annotated[Session, Depends(get_db)]
):
    """
    创建新激活码
    - 需要管理员密码
    - 自动生成唯一激活码
    """
    if not verify_admin_password(password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="密码错误"
        )

    code = _generate_unique_activation_code(db)

    new_code = models.InviteCode(
        code=code,
        valid_days=code_data.valid_days,
        is_used=False
    )

    db.add(new_code)
    db.commit()
    db.refresh(new_code)

    return new_code


@router.post("/batch", response_model=List[schemas.ActivationCodeResponse], status_code=status.HTTP_201_CREATED)
def create_activation_code_batch(
    batch_data: schemas.ActivationCodeBatchCreate,
    password: str,
    db: Annotated[Session, Depends(get_db)]
):
    """
    批量创建激活码
    - 需要管理员密码
    - 一次可创建多个有效期相同的激活码
    """
    if not verify_admin_password(password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="密码错误"
        )

    reserved_codes: Set[str] = set()
    new_codes: List[models.InviteCode] = []

    for _ in range(batch_data.count):
        code = _generate_unique_activation_code(db, reserved_codes)
        activation_code = models.InviteCode(
            code=code,
            valid_days=batch_data.valid_days,
            is_used=False
        )
        db.add(activation_code)
        new_codes.append(activation_code)

    db.commit()
    for code in new_codes:
        db.refresh(code)

    return new_codes


@router.get("/export")
def export_activation_codes(
    password: str,
    db: Annotated[Session, Depends(get_db)],
    valid_days: Optional[int] = None,
    is_used: Optional[bool] = None
):
    """
    导出激活码为 CSV
    - 可按有效天数和使用状态筛选
    """
    if not verify_admin_password(password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="密码错误"
        )

    query = (
        db.query(models.InviteCode)
        .options(joinedload(models.InviteCode.used_by_member))
        .order_by(models.InviteCode.created_at.desc())
    )

    if valid_days is not None:
        query = query.filter(models.InviteCode.valid_days == valid_days)

    if is_used is not None:
        query = query.filter(models.InviteCode.is_used == is_used)

    codes = query.all()
    _attach_activation_user_info(codes)

    output = StringIO()
    writer = csv.writer(output)
    writer.writerow(["激活码", "有效天数", "状态", "生成时间", "使用时间", "激活用户名"])

    for code in codes:
        writer.writerow([
            code.code,
            code.valid_days,
            "已使用" if code.is_used else "未使用",
            code.generated_at.strftime("%Y-%m-%d %H:%M:%S"),
            code.used_at.strftime("%Y-%m-%d %H:%M:%S") if code.used_at else "",
            code.activated_by_username or ""
        ])

    output.seek(0)
    filename = f"activation_codes_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.csv"

    response = StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv; charset=utf-8"
    )
    response.headers["Content-Disposition"] = f"attachment; filename={filename}"
    return response


@router.delete("/{code_id:int}")
def delete_activation_code(
    code_id: int,
    password: str,
    db: Annotated[Session, Depends(get_db)]
):
    """
    删除激活码
    - 需要管理员密码
    - 只能删除未使用的激活码
    """
    if not verify_admin_password(password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="密码错误"
        )

    code = db.query(models.InviteCode).filter(models.InviteCode.id == code_id).first()

    if not code:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="激活码不存在"
        )

    if code.is_used:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="已使用的激活码不能删除"
        )

    db.delete(code)
    db.commit()

    return {"message": "激活码已删除"}


@router.get("/stats/summary")
def get_activation_stats(password: str, db: Annotated[Session, Depends(get_db)]):
    """
    获取激活码统计信息
    - 需要管理员密码
    """
    if not verify_admin_password(password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="密码错误"
        )

    total = db.query(models.InviteCode).count()
    used = db.query(models.InviteCode).filter(models.InviteCode.is_used == True).count()
    unused = total - used

    return {
        "total": total,
        "used": used,
        "unused": unused
    }
