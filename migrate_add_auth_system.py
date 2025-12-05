"""
数据库迁移脚本：添加用户认证系统表
创建时间：2025-12-02
"""
from __future__ import annotations

import sys
from pathlib import Path

# 确保可以导入 app 模块
sys.path.insert(0, str(Path(__file__).parent))

from sqlalchemy import text
from app.database import engine


def migrate():
    """添加用户认证系统的数据库表"""

    with engine.begin() as conn:
        print("开始迁移：添加用户认证系统表...")

        # 检查表是否已存在
        result = conn.execute(
            text("SELECT name FROM sqlite_master WHERE type='table' AND name='activation_codes'")
        )
        if result.fetchone():
            print("⚠️  表 'activation_codes' 已存在，跳过创建")
        else:
            # 创建激活码表
            conn.execute(text("""
                CREATE TABLE activation_codes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    code VARCHAR(32) NOT NULL,
                    valid_days INTEGER NOT NULL,
                    is_used BOOLEAN NOT NULL DEFAULT 0,
                    used_at DATETIME,
                    generated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT uq_activation_code UNIQUE (code)
                )
            """))

            # 创建索引
            conn.execute(text("""
                CREATE INDEX ix_activation_codes_id ON activation_codes (id)
            """))

            print("✅ 创建表 'activation_codes'")

        # 检查用户表是否已存在
        result = conn.execute(
            text("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
        )
        if result.fetchone():
            print("⚠️  表 'users' 已存在，跳过创建")
        else:
            # 创建用户表
            conn.execute(text("""
                CREATE TABLE users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username VARCHAR(64) NOT NULL,
                    password_hash VARCHAR(128) NOT NULL,
                    expires_at DATETIME,
                    is_active BOOLEAN NOT NULL DEFAULT 1,
                    last_login_at DATETIME,
                    activation_code_id INTEGER,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT uq_username UNIQUE (username),
                    FOREIGN KEY (activation_code_id) REFERENCES activation_codes (id)
                )
            """))

            # 创建索引
            conn.execute(text("""
                CREATE INDEX ix_users_id ON users (id)
            """))
            conn.execute(text("""
                CREATE INDEX ix_users_username ON users (username)
            """))

            print("✅ 创建表 'users'")

        print("✅ 迁移完成！")


if __name__ == "__main__":
    migrate()
