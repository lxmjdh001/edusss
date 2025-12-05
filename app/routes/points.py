"""
积分系统API路由
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Body
from sqlalchemy.orm import Session
from sqlalchemy import func, desc

from ..database import get_db
from ..dependencies import get_active_member
from ..models import (
    PointsClass, PointsStudent, PointsGroup,
    PointRecord, GroupPointRecord, ShopItem,
    Purchase, PointRule, Student, Member
)

router = APIRouter(prefix="/api/points", tags=["points"])


# ==================== 班级管理 ====================

@router.get("/classes")
def get_classes(
    db: Session = Depends(get_db),
    current_user: Member = Depends(get_active_member),
):
    """获取所有班级列表（包含成绩系统的班级）"""
    # 从成绩系统获取所有班级
    grade_classes = db.query(Student.class_name, Student.grade_name).filter(
        Student.class_name.isnot(None)
    ).distinct().all()

    # 确保这些班级在积分系统中存在
    for class_name, grade_name in grade_classes:
        if not class_name:
            continue

        existing = db.query(PointsClass).filter(
            PointsClass.class_name == class_name
        ).first()

        if not existing:
            new_class = PointsClass(
                class_name=class_name,
                grade_name=grade_name,
                is_active=True
            )
            db.add(new_class)

    db.commit()

    # 返回所有积分系统班级
    classes = db.query(PointsClass).filter(PointsClass.is_active == True).all()
    return [
        {
            "id": c.id,
            "class_name": c.class_name,
            "grade_name": c.grade_name,
            "teacher_name": c.teacher_name,
            "student_count": len(c.students),
            "group_count": len(c.groups),
        }
        for c in classes
    ]


@router.post("/classes")
def create_class(
    class_name: str,
    grade_name: Optional[str] = None,
    teacher_name: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """创建新班级"""
    # 检查班级名是否已存在
    existing = db.query(PointsClass).filter(PointsClass.class_name == class_name).first()
    if existing:
        raise HTTPException(status_code=400, detail="班级名称已存在")

    new_class = PointsClass(
        class_name=class_name,
        grade_name=grade_name,
        teacher_name=teacher_name
    )
    db.add(new_class)
    db.commit()
    db.refresh(new_class)

    return {"id": new_class.id, "class_name": new_class.class_name}


@router.delete("/classes/{class_id}")
def delete_class(class_id: int, db: Session = Depends(get_db)):
    """删除班级"""
    points_class = db.query(PointsClass).filter(PointsClass.id == class_id).first()
    if not points_class:
        raise HTTPException(status_code=404, detail="班级不存在")

    points_class.is_active = False
    db.commit()

    return {"message": "班级已删除"}


# ==================== 学生管理 ====================

@router.get("/classes/{class_id}/students")
def get_students(class_id: int, db: Session = Depends(get_db)):
    """获取班级学生列表"""
    students = db.query(PointsStudent).filter(
        PointsStudent.class_id == class_id
    ).all()

    return [
        {
            "id": s.id,
            "name": s.name,
            "student_no": s.student_no,
            "points": s.points,
            "pet_type": s.pet_type,
            "pet_level": s.pet_level,
            "group_id": s.group_id,
            "group_name": s.group.name if s.group else None,
        }
        for s in students
    ]


@router.post("/classes/{class_id}/students")
def add_student(
    class_id: int,
    name: str,
    student_no: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """添加学生到班级"""
    # 检查班级是否存在
    points_class = db.query(PointsClass).filter(PointsClass.id == class_id).first()
    if not points_class:
        raise HTTPException(status_code=404, detail="班级不存在")

    # 尝试关联成绩系统的学生
    student_id = None
    if student_no:
        grade_student = (
            db.query(Student)
            .filter(Student.student_no == student_no)
            .order_by(Student.updated_at.desc())
            .first()
        )
        if grade_student:
            student_id = grade_student.id

    new_student = PointsStudent(
        class_id=class_id,
        student_id=student_id,
        name=name,
        student_no=student_no,
        points=0
    )
    db.add(new_student)
    db.commit()
    db.refresh(new_student)

    return {"id": new_student.id, "name": new_student.name}


@router.post("/classes/{class_id}/students/batch")
def batch_add_students(
    class_id: int,
    students: List[dict],
    db: Session = Depends(get_db)
):
    """批量添加学生"""
    points_class = db.query(PointsClass).filter(PointsClass.id == class_id).first()
    if not points_class:
        raise HTTPException(status_code=404, detail="班级不存在")

    added_count = 0
    for student_data in students:
        name = student_data.get("name") or student_data.get("姓名")
        student_no = student_data.get("student_no") or student_data.get("学号")

        if not name:
            continue

        # 检查是否已存在
        existing = db.query(PointsStudent).filter(
            PointsStudent.class_id == class_id,
            PointsStudent.name == name
        ).first()

        if existing:
            continue

        # 尝试关联成绩系统学生
        student_id = None
        if student_no:
            grade_student = (
                db.query(Student)
                .filter(Student.student_no == student_no)
                .order_by(Student.updated_at.desc())
                .first()
            )
            if grade_student:
                student_id = grade_student.id

        new_student = PointsStudent(
            class_id=class_id,
            student_id=student_id,
            name=name,
            student_no=student_no,
            points=0
        )
        db.add(new_student)
        added_count += 1

    db.commit()

    return {"message": f"成功添加 {added_count} 名学生"}


@router.post("/classes/{class_id}/sync-from-grades")
def sync_students_from_grades(class_id: int, db: Session = Depends(get_db)):
    """从成绩系统同步学生到积分系统"""
    points_class = db.query(PointsClass).filter(PointsClass.id == class_id).first()
    if not points_class:
        raise HTTPException(status_code=404, detail="班级不存在")

    # 从成绩系统获取该班级的学生
    grade_students = (
        db.query(Student)
        .filter(Student.class_name == points_class.class_name)
        .order_by(Student.updated_at.desc())
        .all()
    )

    latest_students = {}
    for record in grade_students:
        if not record.student_no:
            continue
        if record.student_no not in latest_students:
            latest_students[record.student_no] = record

    added_count = 0
    for grade_student in latest_students.values():
        # 检查是否已存在（按学号去重，并更新关联的学生ID）
        existing = (
            db.query(PointsStudent)
            .filter(
                PointsStudent.class_id == class_id,
                PointsStudent.student_no == grade_student.student_no,
            )
            .first()
        )

        if existing:
            if existing.student_id != grade_student.id:
                existing.student_id = grade_student.id
                db.add(existing)
            continue

        new_student = PointsStudent(
            class_id=class_id,
            student_id=grade_student.id,
            name=grade_student.name,
            student_no=grade_student.student_no,
            points=0
        )
        db.add(new_student)
        added_count += 1

    db.commit()

    return {"message": f"成功同步 {added_count} 名学生"}


@router.put("/students/{student_id}/points")
def update_student_points(
    student_id: int,
    points: int = Body(...),
    reason: str = Body(...),
    operator: Optional[str] = Body(None),
    db: Session = Depends(get_db)
):
    """更新学生积分"""
    student = db.query(PointsStudent).filter(PointsStudent.id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="学生不存在")

    # 更新积分
    student.points += points

    # 记录积分变化
    record = PointRecord(
        student_id=student_id,
        points=points,
        reason=reason,
        operator=operator
    )
    db.add(record)
    db.commit()
    db.refresh(student)

    return {
        "id": student.id,
        "name": student.name,
        "points": student.points
    }


@router.get("/students/{student_id}/records")
def get_student_records(
    student_id: int,
    limit: int = Query(100, le=500),
    db: Session = Depends(get_db)
):
    """获取学生积分记录"""
    records = db.query(PointRecord).filter(
        PointRecord.student_id == student_id
    ).order_by(desc(PointRecord.created_at)).limit(limit).all()

    return [
        {
            "id": r.id,
            "points": r.points,
            "reason": r.reason,
            "operator": r.operator,
            "created_at": r.created_at.isoformat()
        }
        for r in records
    ]


# ==================== 小组管理 ====================

@router.get("/classes/{class_id}/groups")
def get_groups(class_id: int, db: Session = Depends(get_db)):
    """获取班级小组列表"""
    groups = db.query(PointsGroup).filter(
        PointsGroup.class_id == class_id
    ).all()

    return [
        {
            "id": g.id,
            "name": g.name,
            "points": g.points,
            "pet_type": g.pet_type,
            "pet_level": g.pet_level,
            "member_count": len(g.members),
            "members": [{"id": m.id, "name": m.name} for m in g.members]
        }
        for g in groups
    ]


@router.post("/classes/{class_id}/groups")
def create_group(
    class_id: int,
    name: str,
    member_ids: List[int] = [],
    db: Session = Depends(get_db)
):
    """创建小组"""
    points_class = db.query(PointsClass).filter(PointsClass.id == class_id).first()
    if not points_class:
        raise HTTPException(status_code=404, detail="班级不存在")

    new_group = PointsGroup(
        class_id=class_id,
        name=name,
        points=0
    )
    db.add(new_group)
    db.flush()

    # 添加成员
    for member_id in member_ids:
        student = db.query(PointsStudent).filter(PointsStudent.id == member_id).first()
        if student:
            student.group_id = new_group.id

    db.commit()
    db.refresh(new_group)

    return {"id": new_group.id, "name": new_group.name}


@router.put("/groups/{group_id}/points")
def update_group_points(
    group_id: int,
    points: int,
    reason: str,
    operator: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """更新小组积分"""
    group = db.query(PointsGroup).filter(PointsGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="小组不存在")

    # 更新积分
    group.points += points

    # 记录积分变化
    record = GroupPointRecord(
        group_id=group_id,
        points=points,
        reason=reason,
        operator=operator
    )
    db.add(record)
    db.commit()
    db.refresh(group)

    return {
        "id": group.id,
        "name": group.name,
        "points": group.points
    }


# ==================== 积分规则 ====================

@router.get("/classes/{class_id}/rules")
def get_rules(
    class_id: int,
    rule_type: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """获取积分规则"""
    query = db.query(PointRule).filter(
        PointRule.class_id == class_id,
        PointRule.is_active == True
    )

    if rule_type:
        query = query.filter(PointRule.rule_type == rule_type)

    rules = query.all()

    return [
        {
            "id": r.id,
            "name": r.name,
            "points": r.points,
            "rule_type": r.rule_type
        }
        for r in rules
    ]


@router.post("/classes/{class_id}/rules")
def create_rule(
    class_id: int,
    name: str = Body(...),
    points: int = Body(...),
    rule_type: str = Body(...),
    db: Session = Depends(get_db)
):
    """创建积分规则"""
    new_rule = PointRule(
        class_id=class_id,
        name=name,
        points=points,
        rule_type=rule_type
    )
    db.add(new_rule)
    db.commit()
    db.refresh(new_rule)

    return {"id": new_rule.id, "name": new_rule.name}


# ==================== 积分商店 ====================

@router.get("/classes/{class_id}/shop")
def get_shop_items(class_id: int, db: Session = Depends(get_db)):
    """获取商店商品"""
    items = db.query(ShopItem).filter(
        ShopItem.class_id == class_id,
        ShopItem.is_active == True
    ).all()

    return [
        {
            "id": i.id,
            "name": i.name,
            "cost": i.cost,
            "stock": i.stock
        }
        for i in items
    ]


@router.post("/students/{student_id}/purchase")
def purchase_item(
    student_id: int,
    item_name: str,
    cost: int,
    db: Session = Depends(get_db)
):
    """学生购买商品"""
    student = db.query(PointsStudent).filter(PointsStudent.id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="学生不存在")

    if student.points < cost:
        raise HTTPException(status_code=400, detail="积分不足")

    # 扣除积分
    student.points -= cost

    # 记录购买
    purchase = Purchase(
        student_id=student_id,
        item_name=item_name,
        cost=cost
    )
    db.add(purchase)

    # 记录积分变化
    record = PointRecord(
        student_id=student_id,
        points=-cost,
        reason=f"购买商品：{item_name}",
        operator="system"
    )
    db.add(record)

    db.commit()

    return {"message": "购买成功", "remaining_points": student.points}


# ==================== 排行榜 ====================

@router.get("/classes/{class_id}/rankings/students")
def get_student_rankings(
    class_id: int,
    limit: int = Query(10, le=100),
    db: Session = Depends(get_db)
):
    """获取学生积分排行榜"""
    students = db.query(PointsStudent).filter(
        PointsStudent.class_id == class_id
    ).order_by(desc(PointsStudent.points)).limit(limit).all()

    return [
        {
            "rank": idx + 1,
            "id": s.id,
            "name": s.name,
            "points": s.points,
            "pet_type": s.pet_type,
            "pet_level": s.pet_level
        }
        for idx, s in enumerate(students)
    ]


@router.get("/classes/{class_id}/rankings/groups")
def get_group_rankings(
    class_id: int,
    limit: int = Query(10, le=100),
    db: Session = Depends(get_db)
):
    """获取小组积分排行榜"""
    groups = db.query(PointsGroup).filter(
        PointsGroup.class_id == class_id
    ).order_by(desc(PointsGroup.points)).limit(limit).all()

    return [
        {
            "rank": idx + 1,
            "id": g.id,
            "name": g.name,
            "points": g.points,
            "member_count": len(g.members)
        }
        for idx, g in enumerate(groups)
    ]
