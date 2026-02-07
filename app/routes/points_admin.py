"""积分宠物系统 - 管理后台API路由"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Annotated, List, Optional, Set

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, joinedload

from .. import models
from ..database import get_db
from ..utils import generate_code, hash_password

router = APIRouter(prefix="/api/points-admin", tags=["积分系统管理后台"])

# 管理员固定密码
ADMIN_PASSWORD = "doudoujia2022"


def verify_admin_password(password: str) -> bool:
    """验证管理员密码"""
    return password == ADMIN_PASSWORD


# ---------- Schemas ----------

class AdminAuth(BaseModel):
    password: str


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=6)
    valid_days: int = Field(default=365, ge=1)


class UserUpdate(BaseModel):
    password: Optional[str] = Field(default=None, min_length=6)
    is_active: Optional[bool] = None
    extend_days: Optional[int] = Field(default=None, ge=1)


class UserResponse(BaseModel):
    id: int
    account: str
    vip_level: int
    is_active: bool
    registered_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ActivationCodeCreate(BaseModel):
    valid_days: int = Field(default=365, ge=1)


class ActivationCodeBatchCreate(BaseModel):
    valid_days: int = Field(default=365, ge=1)
    count: int = Field(default=1, ge=1, le=500)


class ActivationCodeResponse(BaseModel):
    id: int
    code: str
    valid_days: int
    is_used: bool
    used_at: Optional[datetime] = None
    generated_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    activated_by_username: Optional[str] = None

    class Config:
        from_attributes = True


# ---------- 密码验证 ----------

@router.post("/verify-admin")
def verify_admin(auth: AdminAuth):
    """验证管理员密码"""
    if not verify_admin_password(auth.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="密码错误"
        )
    return {"message": "验证成功"}


# ---------- 用户管理 ----------

@router.get("/users", response_model=List[UserResponse])
def list_users(
    password: str,
    db: Annotated[Session, Depends(get_db)],
    skip: int = 0,
    limit: int = 100,
    keyword: Optional[str] = None,
):
    """获取用户列表"""
    if not verify_admin_password(password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="密码错误")

    query = db.query(models.Member)
    if keyword:
        query = query.filter(models.Member.account.contains(keyword))
    query = query.order_by(models.Member.created_at.desc())
    users = query.offset(skip).limit(limit).all()
    return users


@router.post("/users", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def create_user(
    user_data: UserCreate,
    password: str,
    db: Annotated[Session, Depends(get_db)],
):
    """管理员直接创建用户"""
    if not verify_admin_password(password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="密码错误")

    if db.query(models.Member).filter(models.Member.account == user_data.username).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="用户名已存在")

    expires_at = datetime.utcnow() + timedelta(days=user_data.valid_days)
    member = models.Member(
        phone=user_data.username,
        account=user_data.username,
        password_hash=hash_password(user_data.password),
        vip_level=1,
        expires_at=expires_at,
        is_active=True,
    )
    db.add(member)
    db.commit()
    db.refresh(member)
    return member


@router.put("/users/{user_id}", response_model=UserResponse)
def update_user(
    user_id: int,
    user_data: UserUpdate,
    password: str,
    db: Annotated[Session, Depends(get_db)],
):
    """编辑用户（改密码、启停、续期）"""
    if not verify_admin_password(password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="密码错误")

    member = db.get(models.Member, user_id)
    if not member:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")

    if user_data.password is not None:
        member.password_hash = hash_password(user_data.password)

    if user_data.is_active is not None:
        member.is_active = user_data.is_active

    if user_data.extend_days is not None:
        base = member.expires_at if member.expires_at and member.expires_at > datetime.utcnow() else datetime.utcnow()
        member.expires_at = base + timedelta(days=user_data.extend_days)

    db.commit()
    db.refresh(member)
    return member


@router.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    password: str,
    db: Annotated[Session, Depends(get_db)],
):
    """删除用户"""
    if not verify_admin_password(password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="密码错误")

    member = db.get(models.Member, user_id)
    if not member:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")

    # 删除关联的会话
    db.query(models.Session).filter(models.Session.member_id == user_id).delete()
    db.delete(member)
    db.commit()
    return {"message": "用户已删除"}


# ---------- 激活码管理 ----------

def _generate_unique_code(db: Session, reserved: Optional[Set[str]] = None) -> str:
    if reserved is None:
        reserved = set()
    while True:
        code = generate_code(10)
        if code in reserved:
            continue
        existing = db.query(models.InviteCode).filter(models.InviteCode.code == code).first()
        if not existing:
            reserved.add(code)
            return code


def _attach_user_info(codes):
    for code in codes:
        user = getattr(code, "used_by_member", None)
        code.activated_by_username = user.account if user else None


@router.get("/activation-codes", response_model=List[ActivationCodeResponse])
def list_activation_codes(
    password: str,
    db: Annotated[Session, Depends(get_db)],
    skip: int = 0,
    limit: int = 100,
):
    """获取激活码列表"""
    if not verify_admin_password(password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="密码错误")

    codes = (
        db.query(models.InviteCode)
        .options(joinedload(models.InviteCode.used_by_member))
        .order_by(models.InviteCode.created_at.desc())
        .offset(skip).limit(limit).all()
    )
    _attach_user_info(codes)
    return codes


@router.post("/activation-codes", response_model=ActivationCodeResponse, status_code=status.HTTP_201_CREATED)
def create_activation_code(
    code_data: ActivationCodeCreate,
    password: str,
    db: Annotated[Session, Depends(get_db)],
):
    """生成单个激活码"""
    if not verify_admin_password(password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="密码错误")

    code = _generate_unique_code(db)
    new_code = models.InviteCode(code=code, valid_days=code_data.valid_days, is_used=False)
    db.add(new_code)
    db.commit()
    db.refresh(new_code)
    return new_code


@router.post("/activation-codes/batch", response_model=List[ActivationCodeResponse], status_code=status.HTTP_201_CREATED)
def create_activation_codes_batch(
    batch_data: ActivationCodeBatchCreate,
    password: str,
    db: Annotated[Session, Depends(get_db)],
):
    """批量生成激活码"""
    if not verify_admin_password(password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="密码错误")

    reserved: Set[str] = set()
    new_codes: List[models.InviteCode] = []
    for _ in range(batch_data.count):
        code = _generate_unique_code(db, reserved)
        obj = models.InviteCode(code=code, valid_days=batch_data.valid_days, is_used=False)
        db.add(obj)
        new_codes.append(obj)

    db.commit()
    for c in new_codes:
        db.refresh(c)
    return new_codes


@router.delete("/activation-codes/{code_id}")
def delete_activation_code(
    code_id: int,
    password: str,
    db: Annotated[Session, Depends(get_db)],
):
    """删除未使用的激活码"""
    if not verify_admin_password(password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="密码错误")

    code = db.query(models.InviteCode).filter(models.InviteCode.id == code_id).first()
    if not code:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="激活码不存在")
    if code.is_used:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="已使用的激活码不能删除")

    db.delete(code)
    db.commit()
    return {"message": "激活码已删除"}


@router.get("/activation-codes/stats")
def get_activation_stats(
    password: str,
    db: Annotated[Session, Depends(get_db)],
):
    """获取激活码统计"""
    if not verify_admin_password(password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="密码错误")

    total = db.query(models.InviteCode).count()
    used = db.query(models.InviteCode).filter(models.InviteCode.is_used == True).count()
    return {"total": total, "used": used, "unused": total - used}
