from __future__ import annotations

import hashlib
import secrets
import string
import uuid
from datetime import datetime, timedelta

import bcrypt


def hash_password(password: str) -> str:
    """使用bcrypt加密密码，返回hash字符串"""
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password.encode("utf-8"), salt)
    return hashed.decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    """验证密码是否匹配"""
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except Exception:
        return False


def generate_code(length: int = 10) -> str:
    """生成随机激活码"""
    alphabet = string.ascii_uppercase + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def generate_session_token() -> str:
    """生成会话令牌"""
    return str(uuid.uuid4())


def get_session_expiry(days: int = 7) -> datetime:
    """获取会话过期时间"""
    return datetime.utcnow() + timedelta(days=days)

