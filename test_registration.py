"""
测试教师注册功能，验证激活码有效期
"""
import requests
from datetime import datetime, timedelta
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models import Member, InviteCode

# 数据库配置
DATABASE_URL = "sqlite:///./data/grade_manager.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# API 配置
BASE_URL = "http://localhost:8010"

def test_registration(invite_code: str, username: str, password: str):
    """测试注册功能"""
    print(f"\n{'='*60}")
    print(f"测试注册: 用户名={username}, 激活码={invite_code}")
    print('='*60)

    # 1. 获取激活码信息
    db = SessionLocal()
    try:
        code_info = db.query(InviteCode).filter(InviteCode.code == invite_code).first()
        if not code_info:
            print("✗ 激活码不存在")
            return False

        print(f"\n激活码信息:")
        print(f"  VIP等级: {code_info.vip_level}")
        print(f"  有效天数: {code_info.valid_days}")
        print(f"  是否已使用: {code_info.is_used}")

        expected_expiry = datetime.utcnow() + timedelta(days=code_info.valid_days)

    finally:
        db.close()

    # 2. 调用注册API
    print(f"\n发送注册请求...")
    try:
        response = requests.post(
            f"{BASE_URL}/api/auth/register",
            json={
                "invite_code": invite_code,
                "username": username,
                "password": password,
            },
            timeout=5
        )

        if response.status_code == 201:
            data = response.json()
            print(f"✓ 注册成功!")
            print(f"  用户名: {data['member']['account']}")
            print(f"  VIP等级: {data['member']['vip_level']}")
            print(f"  到期时间: {data['member']['expires_at']}")
            print(f"  Token: {data['token'][:20]}...")

            # 3. 验证数据库中的会员信息
            db = SessionLocal()
            try:
                member = db.query(Member).filter(Member.account == username).first()
                if member:
                    print(f"\n数据库验证:")
                    print(f"  用户ID: {member.id}")
                    print(f"  账号: {member.account}")
                    print(f"  VIP等级: {member.vip_level}")
                    print(f"  是否激活: {member.is_active}")
                    print(f"  到期时间: {member.expires_at}")

                    # 验证有效期
                    if member.expires_at:
                        actual_days = (member.expires_at - member.registered_at).days
                        print(f"  实际有效天数: {actual_days}")
                        print(f"  预期有效天数: {code_info.valid_days}")

                        if abs(actual_days - code_info.valid_days) <= 1:  # 允许1天误差
                            print(f"  ✓ 有效期设置正确!")
                        else:
                            print(f"  ✗ 有效期设置错误!")

                    # 验证激活码是否被标记为已使用
                    code_check = db.query(InviteCode).filter(InviteCode.code == invite_code).first()
                    if code_check and code_check.is_used:
                        print(f"  ✓ 激活码已正确标记为已使用")
                        print(f"  使用时间: {code_check.used_at}")
                        print(f"  使用者ID: {code_check.used_by_member_id}")
                    else:
                        print(f"  ✗ 激活码未被标记为已使用")

            finally:
                db.close()

            return True
        else:
            print(f"✗ 注册失败: {response.status_code}")
            print(f"  错误信息: {response.json().get('detail', '未知错误')}")
            return False

    except requests.exceptions.RequestException as e:
        print(f"✗ 请求失败: {e}")
        return False

def main():
    """主测试函数"""
    print("开始测试教师注册功能\n")

    # 获取最新的未使用激活码
    db = SessionLocal()
    try:
        unused_codes = db.query(InviteCode).filter(
            InviteCode.is_used == False
        ).order_by(InviteCode.created_at.desc()).limit(3).all()

        if not unused_codes:
            print("✗ 没有可用的激活码，请先运行 create_test_invite_code.py")
            return

        print(f"找到 {len(unused_codes)} 个未使用的激活码\n")

        # 测试每个激活码
        test_cases = [
            (unused_codes[0].code, f"teacher_vip{unused_codes[0].vip_level}_test", "test123456"),
        ]

        for invite_code, username, password in test_cases:
            success = test_registration(invite_code, username, password)
            if success:
                print(f"\n{'='*60}")
                print(f"✓ 测试通过!")
                print('='*60)
            else:
                print(f"\n{'='*60}")
                print(f"✗ 测试失败!")
                print('='*60)

    finally:
        db.close()

if __name__ == "__main__":
    main()
