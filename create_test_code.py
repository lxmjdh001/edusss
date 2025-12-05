#!/usr/bin/env python3
"""
创建测试激活码
"""
from app.database import engine, SessionLocal
from app.models import InviteCode
from app.utils import generate_code
from datetime import datetime

def create_test_codes():
    db = SessionLocal()

    try:
        # 创建一个VIP 1级别的激活码（普通用户，有效期30天）
        code1 = InviteCode(
            code=generate_code(),
            vip_level=1,
            valid_days=30,
            generated_at=datetime.utcnow(),
            is_used=False,
        )
        db.add(code1)

        # 创建一个VIP 2级别的激活码（高级用户，有效期90天）
        code2 = InviteCode(
            code=generate_code(),
            vip_level=2,
            valid_days=90,
            generated_at=datetime.utcnow(),
            is_used=False,
        )
        db.add(code2)

        # 创建一个VIP 3级别的激活码（管理员，有效期365天）
        code3 = InviteCode(
            code=generate_code(),
            vip_level=3,
            valid_days=365,
            generated_at=datetime.utcnow(),
            is_used=False,
        )
        db.add(code3)

        db.commit()
        db.refresh(code1)
        db.refresh(code2)
        db.refresh(code3)

        print("✅ 测试激活码创建成功！\n")
        print(f"VIP 1 激活码（30天）: {code1.code}")
        print(f"VIP 2 激活码（90天）: {code2.code}")
        print(f"VIP 3 激活码（365天，管理员）: {code3.code}")
        print("\n请使用这些激活码进行注册测试。")

    except Exception as e:
        print(f"❌ 创建激活码失败: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    create_test_codes()
