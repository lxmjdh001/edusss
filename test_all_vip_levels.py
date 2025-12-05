"""
测试所有VIP等级的注册
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

BASE_URL = "http://localhost:8010"

def test_all_vip_levels():
    """测试所有VIP等级"""
    db = SessionLocal()

    try:
        # 获取所有未使用的激活码
        unused_codes = db.query(InviteCode).filter(
            InviteCode.is_used == False
        ).order_by(InviteCode.vip_level).all()

        if len(unused_codes) < 2:
            print("✗ 至少需要2个未使用的激活码")
            return

        print("="*70)
        print("测试所有VIP等级的注册功能")
        print("="*70)

        # 测试VIP1和VIP2
        test_cases = [
            (unused_codes[0], f"teacher_vip{unused_codes[0].vip_level}_30days"),
            (unused_codes[1], f"teacher_vip{unused_codes[1].vip_level}_90days"),
        ]

        results = []

        for code_obj, username in test_cases:
            print(f"\n{'─'*70}")
            print(f"测试 VIP{code_obj.vip_level} - {code_obj.valid_days}天有效期")
            print(f"激活码: {code_obj.code}")
            print(f"用户名: {username}")
            print('─'*70)

            # 注册
            response = requests.post(
                f"{BASE_URL}/api/auth/register",
                json={
                    "invite_code": code_obj.code,
                    "username": username,
                    "password": "test123456",
                },
                timeout=5
            )

            if response.status_code == 201:
                data = response.json()
                member_data = data['member']

                print(f"✓ 注册成功")
                print(f"  账号: {member_data['account']}")
                print(f"  VIP等级: {member_data['vip_level']}")

                # 解析时间
                expires_at = datetime.fromisoformat(member_data['expires_at'].replace('Z', '+00:00'))
                registered_at = datetime.fromisoformat(member_data['registered_at'].replace('Z', '+00:00'))

                actual_days = (expires_at - registered_at).days

                print(f"  注册时间: {registered_at.strftime('%Y-%m-%d %H:%M:%S')}")
                print(f"  到期时间: {expires_at.strftime('%Y-%m-%d %H:%M:%S')}")
                print(f"  实际有效天数: {actual_days}")
                print(f"  预期有效天数: {code_obj.valid_days}")

                # 验证
                days_match = abs(actual_days - code_obj.valid_days) <= 1
                vip_match = member_data['vip_level'] == code_obj.vip_level

                if days_match and vip_match:
                    print(f"  ✓ 验证通过: 有效期和VIP等级设置正确!")
                    results.append(True)
                else:
                    print(f"  ✗ 验证失败:")
                    if not days_match:
                        print(f"    - 有效期不匹配")
                    if not vip_match:
                        print(f"    - VIP等级不匹配")
                    results.append(False)

            else:
                print(f"✗ 注册失败: {response.json().get('detail', '未知错误')}")
                results.append(False)

        # 总结
        print(f"\n{'='*70}")
        print("测试总结")
        print('='*70)
        print(f"总测试数: {len(results)}")
        print(f"通过: {sum(results)}")
        print(f"失败: {len(results) - sum(results)}")

        if all(results):
            print("\n✓ 所有测试通过！激活码系统工作正常！")
        else:
            print("\n✗ 部分测试失败，请检查")

    finally:
        db.close()

if __name__ == "__main__":
    test_all_vip_levels()
