"""
数据库迁移脚本：为 users 表添加 session_token 字段
"""
from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy import text

sys.path.insert(0, str(Path(__file__).parent))

from app.database import engine


def migrate():
    with engine.begin() as conn:
        print("开始迁移：users 表新增 session_token 列...")

        result = conn.execute(
            text(
                "SELECT name FROM pragma_table_info('users') "
                "WHERE name='session_token'"
            )
        )
        if result.fetchone():
            print("⚠️  列 session_token 已存在，跳过修改")
            return

        conn.execute(
            text("ALTER TABLE users ADD COLUMN session_token VARCHAR(256)")
        )

        print("✅ 已添加 session_token 列")


if __name__ == "__main__":
    migrate()
