from __future__ import annotations

import hashlib
import secrets
import string


def hash_password(password: str) -> str:
    """Return a SHA256 hash for storing passwords."""
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def verify_password(password: str, password_hash: str) -> bool:
    return hash_password(password) == password_hash


def generate_code(length: int = 10) -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))

