"""
创建管理员账号 ddjia2022
"""
from datetime import datetime, timedelta
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models import Base, Member
from app.utils import hash_password

# 数据库配置
DATABASE_URL = "sqlite:///./data/grade_manager.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def create_admin():
    """创建管理员账号"""
    db = SessionLocal()

    try:
        # 检查账号是否已存在
        existing = db.query(Member).filter(Member.account == "ddjia2022").first()
        if existing:
            print(f"管理员账号 'ddjia2022' 已存在 (ID: {existing.id})")

            # 更新为无限期
            existing.password_hash = hash_password("ddjia2022")
            existing.vip_level = 3
            existing.is_active = True
            existing.expires_at = datetime(2099, 12, 31, 23, 59, 59)  # 设置到2099年，无限期

            db.commit()
            print("已更新管理员账号为无限期登录")
            return

        # 创建管理员账号
        admin = Member(
            phone="ddjia2022",
            account="ddjia2022",
            password_hash=hash_password("ddjia2022"),
            student_name=None,
            vip_level=3,  # 管理员级别
            expires_at=datetime(2099, 12, 31, 23, 59, 59),  # 设置到2099年，无限期
            is_active=True,
        )

        db.add(admin)
        db.commit()
        db.refresh(admin)

        print(f"✓ 成功创建管理员账号:")
        print(f"  用户名: ddjia2022")
        print(f"  密码: ddjia2022")
        print(f"  VIP等级: 3 (管理员)")
        print(f"  到期时间: 2099-12-31 (无限期)")
        print(f"  账号ID: {admin.id}")

    except Exception as e:
        print(f"✗ 创建失败: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    create_admin()
