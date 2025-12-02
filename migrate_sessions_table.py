"""
数据库迁移脚本 - 添加 sessions 表
执行此脚本来创建认证系统所需的 sessions 表
"""
from sqlalchemy import create_engine, text
from app.database import DATABASE_URL

def migrate():
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})

    print("开始数据库迁移...")

    with engine.connect() as conn:
        # 检查表是否已存在
        result = conn.execute(text(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'"
        ))

        if result.fetchone():
            print("✓ sessions 表已存在，跳过创建")
        else:
            print("创建 sessions 表...")
            conn.execute(text("""
                CREATE TABLE sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_token VARCHAR(64) UNIQUE NOT NULL,
                    member_id INTEGER NOT NULL,
                    expires_at DATETIME NOT NULL,
                    ip_address VARCHAR(45),
                    user_agent VARCHAR(255),
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (member_id) REFERENCES members(id)
                )
            """))

            # 创建索引
            conn.execute(text(
                "CREATE INDEX ix_sessions_session_token ON sessions(session_token)"
            ))
            conn.execute(text(
                "CREATE INDEX ix_sessions_member_id ON sessions(member_id)"
            ))

            conn.commit()
            print("✓ sessions 表创建成功")

    print("数据库迁移完成！")

if __name__ == "__main__":
    migrate()
