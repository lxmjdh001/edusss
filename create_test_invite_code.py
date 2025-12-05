"""
创建测试激活码用于注册测试
"""
from datetime import datetime
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import secrets
import string

from app.models import Base, InviteCode

# 数据库配置
DATABASE_URL = "sqlite:///./data/grade_manager.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def generate_code(length=10):
    """生成随机激活码"""
    chars = string.ascii_uppercase + string.digits
    return ''.join(secrets.choice(chars) for _ in range(length))

def create_test_codes():
    """创建测试激活码"""
    db = SessionLocal()

    try:
        # 创建3个不同有效期的激活码
        test_codes = [
            {"vip_level": 1, "valid_days": 30, "desc": "VIP1 - 30天"},
            {"vip_level": 2, "valid_days": 90, "desc": "VIP2 - 90天"},
            {"vip_level": 3, "valid_days": 365, "desc": "VIP3管理员 - 365天"},
        ]

        print("正在创建测试激活码...\n")
        created_codes = []

        for config in test_codes:
            code = generate_code()
            invite_code = InviteCode(
                code=code,
                vip_level=config["vip_level"],
                valid_days=config["valid_days"],
                generated_at=datetime.utcnow(),
                is_used=False,
            )
            db.add(invite_code)
            created_codes.append({
                "code": code,
                "desc": config["desc"],
                "vip_level": config["vip_level"],
                "valid_days": config["valid_days"]
            })

        db.commit()

        print("✓ 成功创建测试激活码:\n")
        for item in created_codes:
            print(f"  激活码: {item['code']}")
            print(f"  说明: {item['desc']}")
            print(f"  VIP等级: {item['vip_level']}")
            print(f"  有效天数: {item['valid_days']}")
            print()

        return created_codes

    except Exception as e:
        print(f"✗ 创建失败: {e}")
        db.rollback()
        return []
    finally:
        db.close()

if __name__ == "__main__":
    create_test_codes()
