from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, UniqueConstraint, JSON
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
    __table_args__ = (UniqueConstraint("student_no", name="uq_student_no"),)

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
