"""
数据库迁移脚本：为 students 表添加 exam_date 字段
"""
import sqlite3
from pathlib import Path

def migrate():
    db_path = Path(__file__).parent / "data" / "grade_manager.db"

    if not db_path.exists():
        print(f"数据库文件不存在: {db_path}")
        return

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    try:
        # 检查字段是否已存在
        cursor.execute("PRAGMA table_info(students)")
        columns = [row[1] for row in cursor.fetchall()]

        if 'exam_date' in columns:
            print("exam_date 字段已存在，无需迁移")
            return

        # 添加 exam_date 字段
        print("正在添加 exam_date 字段...")
        cursor.execute("ALTER TABLE students ADD COLUMN exam_date DATETIME")
        conn.commit()
        print("✓ 成功添加 exam_date 字段")

    except Exception as e:
        print(f"✗ 迁移失败: {e}")
        conn.rollback()
    finally:
        conn.close()

if __name__ == "__main__":
    migrate()
