"""
数据库迁移脚本 - 为 students 表添加 gender 字段
"""
from sqlalchemy import create_engine, text
from app.database import DATABASE_URL

def migrate():
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})

    print("开始数据库迁移...")

    with engine.connect() as conn:
        # 检查字段是否已存在
        result = conn.execute(text(
            "PRAGMA table_info(students)"
        ))

        columns = [row[1] for row in result.fetchall()]

        if 'gender' in columns:
            print("✓ gender 字段已存在，跳过添加")
        else:
            print("添加 gender 字段到 students 表...")
            conn.execute(text("""
                ALTER TABLE students ADD COLUMN gender VARCHAR(10)
            """))
            conn.commit()
            print("✓ gender 字段添加成功")

    print("数据库迁移完成！")

if __name__ == "__main__":
    migrate()
