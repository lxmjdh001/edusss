#!/usr/bin/env python3
"""
数据库迁移脚本：添加积分系统相关表
"""
from app.database import engine, Base
from app.models import (
    PointsClass, PointsStudent, PointsGroup,
    PointRecord, GroupPointRecord, ShopItem,
    Purchase, PointRule
)

def migrate():
    print("开始创建积分系统数据表...")

    # 创建所有表
    Base.metadata.create_all(bind=engine)

    print("✅ 积分系统数据表创建完成！")
    print("已创建的表：")
    print("  - points_classes (班级表)")
    print("  - points_students (学生表)")
    print("  - points_groups (小组表)")
    print("  - point_records (学生积分记录)")
    print("  - group_point_records (小组积分记录)")
    print("  - shop_items (商店商品)")
    print("  - purchases (购买记录)")
    print("  - point_rules (积分规则)")

if __name__ == "__main__":
    migrate()
