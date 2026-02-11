"""
用户认证路由：注册、登录、登出
"""
from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..dependencies import get_current_user, get_active_member
from ..utils import hash_password, verify_password, generate_session_token, get_session_expiry

router = APIRouter(prefix="/api/auth", tags=["auth"])

# 远程锁屏状态存储（内存字典，按用户ID隔离）
# 格式: { member_id: { "locked": True, "password_hash": "..." } }
_remote_lock_store: dict[int, dict] = {}


@router.post("/register", response_model=schemas.AuthResponse, status_code=status.HTTP_201_CREATED)
def register(
    payload: schemas.RegisterRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    """
    用户注册
    需要提供有效的激活码
    """
    # 验证激活码
    invite_code = db.query(models.InviteCode).filter(
        models.InviteCode.code == payload.invite_code
    ).first()

    if not invite_code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="激活码不存在"
        )

    if invite_code.is_used:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="激活码已被使用"
        )

    # 检查用户名是否已存在
    if db.query(models.Member).filter(models.Member.account == payload.username).first():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="用户名已存在"
        )

    # 计算会员到期时间
    expires_at = datetime.utcnow() + timedelta(days=invite_code.valid_days)

    # 创建会员（使用username作为account，phone设为username）
    member = models.Member(
        phone=payload.username,  # 使用username作为phone（保持兼容）
        account=payload.username,
        password_hash=hash_password(payload.password),
        student_name=None,  # 教师账号不需要学生姓名
        vip_level=invite_code.vip_level,
        expires_at=expires_at,
        is_active=True,
    )
    db.add(member)
    db.flush()  # 获取member.id

    # 标记激活码为已使用
    invite_code.is_used = True
    invite_code.used_at = datetime.utcnow()
    invite_code.used_by_member_id = member.id

    # 创建登录会话
    session_token = generate_session_token()
    session = models.Session(
        session_token=session_token,
        member_id=member.id,
        expires_at=get_session_expiry(days=7),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    db.add(session)

    db.commit()
    db.refresh(member)

    # 设置Cookie
    response.set_cookie(
        key="session_token",
        value=session_token,
        httponly=True,
        max_age=7 * 24 * 60 * 60,  # 7天
        samesite="lax",
    )

    return schemas.AuthResponse(
        token=session_token,
        member=member,
        message="注册成功"
    )


@router.post("/login", response_model=schemas.AuthResponse)
def login(
    payload: schemas.LoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    """
    用户登录
    支持使用账号或手机号登录
    """
    # 查找用户（通过用户名）
    member = db.query(models.Member).filter(
        models.Member.account == payload.username
    ).first()

    if not member:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误"
        )

    # 验证密码
    if not verify_password(payload.password, member.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误"
        )

    # 检查账号状态
    if not member.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="账号已被禁用"
        )

    if member.expires_at and member.expires_at < datetime.utcnow():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="账号已过期，请联系客服续费"
        )

    # 创建登录会话
    session_token = generate_session_token()
    session = models.Session(
        session_token=session_token,
        member_id=member.id,
        expires_at=get_session_expiry(days=7),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    db.add(session)
    db.commit()

    # 设置Cookie
    response.set_cookie(
        key="session_token",
        value=session_token,
        httponly=True,
        max_age=7 * 24 * 60 * 60,  # 7天
        samesite="lax",
    )

    # 检查是否在到期前7天内，生成到期提醒
    warning = None
    if member.expires_at:
        days_left = (member.expires_at - datetime.utcnow()).days
        if 0 <= days_left <= 7:
            warning = f"您的账号将在{days_left}天后到期，续费请添加客服微信：ddjia2022"

    return schemas.AuthResponse(
        token=session_token,
        member=member,
        message="登录成功",
        warning=warning,
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    """
    用户登出
    直接通过token删除会话，不依赖用户解析
    """
    # 从Cookie或Header中提取token
    token = request.cookies.get("session_token")
    if not token:
        auth_header = request.headers.get("authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]

    if token:
        # 先查到session获取member_id，删除该用户所有会话
        session_obj = db.query(models.Session).filter(
            models.Session.session_token == token
        ).first()
        if session_obj:
            db.query(models.Session).filter(
                models.Session.member_id == session_obj.member_id
            ).delete()
            db.commit()

    # 清除Cookie（参数需与 set_cookie 一致才能正确清除）
    response.delete_cookie(key="session_token", httponly=True, samesite="lax")

    return None


@router.get("/me", response_model=schemas.Member)
def get_current_user_info(
    current_user: models.Member = Depends(get_active_member),
):
    """
    获取当前登录用户信息
    """
    return current_user


@router.get("/check", response_model=dict)
def check_auth_status(
    current_user: models.Member = Depends(get_current_user),
):
    """
    检查登录状态
    """
    return {
        "authenticated": True,
        "user_id": current_user.id,
        "account": current_user.account,
        "vip_level": current_user.vip_level,
        "is_active": current_user.is_active,
        "expires_at": current_user.expires_at,
    }


@router.post("/change-password", status_code=status.HTTP_200_OK)
def change_password(
    payload: schemas.ChangePasswordRequest,
    current_user: models.Member = Depends(get_active_member),
    db: Session = Depends(get_db),
):
    """
    修改当前登录用户的密码
    """
    current_user.password_hash = hash_password(payload.password)
    db.add(current_user)
    db.commit()
    return {"success": True}


@router.post("/redeem-invite", status_code=status.HTTP_200_OK)
def redeem_invite_code(
    payload: schemas.RedeemInviteCodeRequest,
    current_user: models.Member = Depends(get_active_member),
    db: Session = Depends(get_db),
):
    """
    使用激活码为当前账号续期
    """
    code = payload.code.strip()
    if not code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="激活码不能为空")

    invite_code = db.query(models.InviteCode).filter(
        models.InviteCode.code == code
    ).first()
    if not invite_code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="激活码不存在")
    if invite_code.is_used:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="激活码已被使用")

    base_time = current_user.expires_at
    now = datetime.utcnow()
    if not base_time or base_time < now:
        base_time = now

    new_expires_at = base_time + timedelta(days=invite_code.valid_days)
    current_user.expires_at = new_expires_at
    if invite_code.vip_level and invite_code.vip_level > current_user.vip_level:
        current_user.vip_level = invite_code.vip_level

    invite_code.is_used = True
    invite_code.used_at = now
    invite_code.used_by_member_id = current_user.id

    db.add(current_user)
    db.add(invite_code)
    db.commit()

    return {
        "success": True,
        "expires_at": current_user.expires_at,
        "vip_level": current_user.vip_level,
    }


class RemoteLockRequest(schemas.BaseModel):
    lock_password: str


@router.post("/remote-lock")
def remote_lock(
    payload: RemoteLockRequest,
    current_user: models.Member = Depends(get_active_member),
):
    """手机端调用：设置远程锁定"""
    if not payload.lock_password.strip():
        raise HTTPException(status_code=400, detail="锁屏密码不能为空")
    _remote_lock_store[current_user.id] = {
        "locked": True,
        "password_hash": hash_password(payload.lock_password),
    }
    return {"success": True, "message": "远程锁定已生效"}


@router.get("/lock-status")
def lock_status(
    current_user: models.Member = Depends(get_active_member),
):
    """电脑端轮询：检查是否被远程锁定"""
    info = _remote_lock_store.get(current_user.id)
    locked = bool(info and info.get("locked"))
    return {"locked": locked}


class RemoteUnlockRequest(schemas.BaseModel):
    password: str


@router.post("/remote-unlock")
def remote_unlock(
    payload: RemoteUnlockRequest,
    current_user: models.Member = Depends(get_active_member),
):
    """电脑端调用：验证密码解锁"""
    info = _remote_lock_store.get(current_user.id)
    if not info or not info.get("locked"):
        return {"success": True, "message": "未处于锁定状态"}
    if not verify_password(payload.password, info["password_hash"]):
        raise HTTPException(status_code=400, detail="密码错误")
    _remote_lock_store.pop(current_user.id, None)
    return {"success": True, "message": "解锁成功"}
