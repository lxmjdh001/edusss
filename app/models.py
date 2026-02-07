from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, UniqueConstraint, JSON, Text
from sqlalchemy.orm import relationship

from .database import Base


class TimestampMixin:
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )


class Member(Base, TimestampMixin):
    __tablename__ = "members"

    id = Column(Integer, primary_key=True, index=True)
    phone = Column(String(20), unique=True, nullable=False, index=True)
    vip_level = Column(Integer, nullable=False, default=1, index=True)
    account = Column(String(64), unique=True, nullable=False, index=True)
    password_hash = Column(String(128), nullable=False)
    student_name = Column(String(100))
    registered_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    expires_at = Column(DateTime, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)

    invite_codes = relationship("InviteCode", back_populates="used_by_member")
    query_codes = relationship("QueryCode", back_populates="member")


class InviteCode(Base, TimestampMixin):
    __tablename__ = "invite_codes"
    __table_args__ = (UniqueConstraint("code", name="uq_invite_code"),)

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(32), nullable=False)
    vip_level = Column(Integer, nullable=False, default=1)
    valid_days = Column(Integer, nullable=False, default=365)
    generated_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    is_used = Column(Boolean, default=False, nullable=False)
    used_at = Column(DateTime, nullable=True)
    used_by_member_id = Column(Integer, ForeignKey("members.id"), nullable=True)

    used_by_member = relationship("Member", back_populates="invite_codes")


class QueryCode(Base, TimestampMixin):
    __tablename__ = "query_codes"
    __table_args__ = (UniqueConstraint("code", name="uq_query_code"),)

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(32), nullable=False)
    expires_at = Column(DateTime, nullable=False)
    student_name = Column(String(100), nullable=True)
    description = Column(String(255), nullable=True)
    last_used_at = Column(DateTime, nullable=True)
    member_id = Column(Integer, ForeignKey("members.id"), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)

    member = relationship("Member", back_populates="query_codes")


class Student(Base, TimestampMixin):
    __tablename__ = "students"
    __table_args__ = (UniqueConstraint("student_no", "exam_name", name="uq_student_exam"),)

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(80), nullable=False)
    student_no = Column(String(50), nullable=False, index=True)
    class_name = Column(String(80), nullable=True)
    grade_name = Column(String(80), nullable=True)
    exam_name = Column(String(120), nullable=True)
    exam_date = Column(DateTime, nullable=True)
    gender = Column(String(10), nullable=True)
    notes = Column(String(255), nullable=True)
    scores = Column(JSON, nullable=False, default=list)
    class_rank = Column(Integer, nullable=True)
    grade_rank = Column(Integer, nullable=True)


class SubjectRange(Base, TimestampMixin):
    __tablename__ = "subject_ranges"

    id = Column(Integer, primary_key=True)
    subject = Column(String(64), unique=True, nullable=False, index=True)
    config = Column(JSON, nullable=False, default=list)


class PointsClass(Base, TimestampMixin):
    """积分系统班级表"""
    __tablename__ = "points_classes"

    id = Column(Integer, primary_key=True, index=True)
    class_name = Column(String(80), unique=True, nullable=False, index=True)
    grade_name = Column(String(80), nullable=True)
    teacher_name = Column(String(80), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)

    students = relationship("PointsStudent", back_populates="points_class")
    groups = relationship("PointsGroup", back_populates="points_class")


class PointsStudent(Base, TimestampMixin):
    """积分系统学生表"""
    __tablename__ = "points_students"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("students.id"), nullable=True)  # 关联成绩系统学生
    class_id = Column(Integer, ForeignKey("points_classes.id"), nullable=False)
    name = Column(String(80), nullable=False)
    student_no = Column(String(50), nullable=True)
    points = Column(Integer, default=0, nullable=False)
    pet_type = Column(String(50), nullable=True)
    pet_level = Column(Integer, default=0, nullable=False)
    group_id = Column(Integer, ForeignKey("points_groups.id"), nullable=True)

    points_class = relationship("PointsClass", back_populates="students")
    group = relationship("PointsGroup", back_populates="members")
    point_records = relationship("PointRecord", back_populates="student")
    purchases = relationship("Purchase", back_populates="student")


class PointsGroup(Base, TimestampMixin):
    """积分系统小组表"""
    __tablename__ = "points_groups"

    id = Column(Integer, primary_key=True, index=True)
    class_id = Column(Integer, ForeignKey("points_classes.id"), nullable=False)
    name = Column(String(80), nullable=False)
    points = Column(Integer, default=0, nullable=False)
    pet_type = Column(String(50), nullable=True)
    pet_level = Column(Integer, default=0, nullable=False)

    points_class = relationship("PointsClass", back_populates="groups")
    members = relationship("PointsStudent", back_populates="group")
    point_records = relationship("GroupPointRecord", back_populates="group")


class PointRecord(Base, TimestampMixin):
    """学生积分记录表"""
    __tablename__ = "point_records"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("points_students.id"), nullable=False)
    points = Column(Integer, nullable=False)
    reason = Column(String(255), nullable=False)
    operator = Column(String(80), nullable=True)

    student = relationship("PointsStudent", back_populates="point_records")


class GroupPointRecord(Base, TimestampMixin):
    """小组积分记录表"""
    __tablename__ = "group_point_records"

    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey("points_groups.id"), nullable=False)
    points = Column(Integer, nullable=False)
    reason = Column(String(255), nullable=False)
    operator = Column(String(80), nullable=True)

    group = relationship("PointsGroup", back_populates="point_records")


class ShopItem(Base, TimestampMixin):
    """积分商店商品表"""
    __tablename__ = "shop_items"

    id = Column(Integer, primary_key=True, index=True)
    class_id = Column(Integer, ForeignKey("points_classes.id"), nullable=False)
    name = Column(String(120), nullable=False)
    cost = Column(Integer, nullable=False)
    stock = Column(Integer, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)


class Purchase(Base, TimestampMixin):
    """购买记录表"""
    __tablename__ = "purchases"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("points_students.id"), nullable=False)
    item_name = Column(String(120), nullable=False)
    cost = Column(Integer, nullable=False)

    student = relationship("PointsStudent", back_populates="purchases")


class PointRule(Base, TimestampMixin):
    """积分规则表"""
    __tablename__ = "point_rules"

    id = Column(Integer, primary_key=True, index=True)
    class_id = Column(Integer, ForeignKey("points_classes.id"), nullable=False)
    name = Column(String(120), nullable=False)
    points = Column(Integer, nullable=False)
    rule_type = Column(String(20), nullable=False)  # 'student' or 'group'
    is_active = Column(Boolean, default=True, nullable=False)


class PointsKV(Base, TimestampMixin):
    """积分系统键值存储（用于前端数据持久化）"""
    __tablename__ = "points_kv"
    __table_args__ = (
        UniqueConstraint("owner_type", "owner_id", "key", name="uq_points_kv_owner_key"),
    )

    id = Column(Integer, primary_key=True, index=True)
    owner_type = Column(String(20), nullable=False)
    owner_id = Column(Integer, nullable=True)
    key = Column(String(200), nullable=False, index=True)
    value = Column(Text, nullable=False)


class Session(Base, TimestampMixin):
    """用户登录会话表"""
    __tablename__ = "sessions"

    id = Column(Integer, primary_key=True, index=True)
    session_token = Column(String(64), unique=True, nullable=False, index=True)
    member_id = Column(Integer, ForeignKey("members.id"), nullable=False)
    expires_at = Column(DateTime, nullable=False)
    ip_address = Column(String(45), nullable=True)
    user_agent = Column(String(255), nullable=True)

    member = relationship("Member", backref="sessions")
