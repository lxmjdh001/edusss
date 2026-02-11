"""
认证依赖项和中间件
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import Cookie, Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from . import models
from .database import get_db


async def get_current_user(
    session_token: Optional[str] = Cookie(None, alias="session_token"),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
) -> models.Member:
    """
    获取当前登录用户
    支持从Cookie或Authorization Header中读取token
    """
    token = session_token

    # 如果Cookie中没有token，尝试从Authorization Header中获取
    if not token and authorization:
        if authorization.startswith("Bearer "):
            token = authorization[7:]

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="未登录或登录已过期",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 查询session
    session = db.query(models.Session).filter(
        models.Session.session_token == token
    ).first()

    if not session:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="无效的登录令牌",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 检查session是否过期
    if session.expires_at < datetime.utcnow():
        db.delete(session)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="登录已过期，请重新登录",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 获取用户
    member = db.get(models.Member, session.member_id)
    if not member:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户不存在",
        )

    return member


async def get_active_member(
    current_user: models.Member = Depends(get_current_user),
) -> models.Member:
    """
    获取当前激活的用户
    检查用户是否激活且未过期
    """
    if not current_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="账号已被禁用",
        )

    if current_user.expires_at and current_user.expires_at < datetime.utcnow():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="账号已过期，点击【联系客服】续费",
        )

    return current_user


async def get_admin_user(
    current_user: models.Member = Depends(get_active_member),
) -> models.Member:
    """
    获取管理员用户（VIP等级3）
    """
    if current_user.vip_level < 3:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="需要管理员权限",
        )

    return current_user


async def get_optional_user(
    session_token: Optional[str] = Cookie(None, alias="session_token"),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
) -> Optional[models.Member]:
    """
    获取当前用户（可选）
    如果未登录返回None，不抛出异常
    """
    try:
        return await get_current_user(session_token, authorization, db)
    except HTTPException:
        return None
