#!/usr/bin/env python3
"""
添加sessions表的数据库迁移脚本
"""
from app.database import engine
from app.models import Base, Session

def migrate():
    print("开始迁移：添加sessions表...")

    # 只创建Session表，不影响其他表
    Session.__table__.create(engine, checkfirst=True)

    print("✓ sessions表创建成功")
    print("\n迁移完成！")

if __name__ == "__main__":
    migrate()
