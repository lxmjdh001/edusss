#!/usr/bin/env python3
"""
数据库迁移脚本：为students表添加gender字段
"""
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "data" / "grade_manager.db"

def migrate():
    if not DB_PATH.exists():
        print(f"数据库文件不存在: {DB_PATH}")
        return

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    try:
        # 检查gender列是否已存在
        cursor.execute("PRAGMA table_info(students)")
        columns = [row[1] for row in cursor.fetchall()]

        if 'gender' in columns:
            print("✓ gender字段已存在，无需迁移")
        else:
            # 添加gender列
            cursor.execute("ALTER TABLE students ADD COLUMN gender VARCHAR(10)")
            conn.commit()
            print("✓ 成功添加gender字段到students表")

    except Exception as e:
        print(f"✗ 迁移失败: {e}")
        conn.rollback()
    finally:
        conn.close()

if __name__ == "__main__":
    migrate()
