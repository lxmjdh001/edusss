"""
初始化管理员账号
创建 ddjia2022 管理员账号（如果不存在）
"""
from datetime import datetime
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app import models
from app.utils import hash_password

def init_admin():
    db = SessionLocal()

    try:
        print("检查管理员账号...")

        # 检查是否已存在
        existing = db.query(models.Member).filter(
            models.Member.account == "ddjia2022"
        ).first()

        if existing:
            print(f"✓ 管理员账号已存在")
            print(f"  用户名: {existing.account}")
            print(f"  VIP等级: {existing.vip_level}")
            print(f"  到期时间: {existing.expires_at}")
            return

        print("创建管理员账号...")

        # 创建管理员账号
        admin = models.Member(
            account="ddjia2022",
            phone="ddjia2022",  # 兼容性字段
            password=hash_password("ddjia2022"),
            vip_level=3,
            registered_at=datetime.now(),
            expires_at=datetime(2099, 12, 31, 23, 59, 59),  # 无限期
            is_active=True
        )

        db.add(admin)
        db.commit()
        db.refresh(admin)

        print("✓ 管理员账号创建成功！")
        print(f"  用户名: {admin.account}")
        print(f"  密码: ddjia2022")
        print(f"  VIP等级: {admin.vip_level}")
        print(f"  到期时间: {admin.expires_at}")

    except Exception as e:
        print(f"✗ 创建失败: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    init_admin()
