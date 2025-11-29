from __future__ import annotations

from datetime import datetime
from typing import List, Optional, Dict

from pydantic import BaseModel, Field


class ORMModel(BaseModel):
    model_config = {"from_attributes": True}


class MemberBase(ORMModel):
    phone: str = Field(..., max_length=20, description="手机号")
    vip_level: int = Field(1, ge=1, le=3, description="VIP 等级")
    account: str = Field(..., max_length=64, description="登录账号")
    student_name: Optional[str] = Field(None, max_length=100, description="学生姓名")
    expires_at: Optional[datetime] = Field(None, description="会员到期时间")
    is_active: bool = True


class MemberCreate(MemberBase):
    password: str = Field(..., min_length=6, max_length=128)


class MemberUpdate(ORMModel):
    phone: Optional[str] = Field(None, max_length=20)
    vip_level: Optional[int] = Field(None, ge=1, le=3)
    account: Optional[str] = Field(None, max_length=64)
    password: Optional[str] = Field(None, min_length=6, max_length=128)
    student_name: Optional[str] = Field(None, max_length=100)
    expires_at: Optional[datetime] = None
    is_active: Optional[bool] = None


class Member(MemberBase):
    id: int
    registered_at: datetime
    created_at: datetime
    updated_at: datetime


class InviteCodeBase(ORMModel):
    vip_level: int = Field(1, ge=1, le=3, description="激活后会员等级")
    valid_days: int = Field(365, ge=1, le=3650, description="有效天数")
    code: Optional[str] = Field(None, max_length=32, description="邀请码")


class InviteCodeCreate(InviteCodeBase):
    pass


class InviteCodeUpdate(ORMModel):
    vip_level: Optional[int] = Field(None, ge=1, le=3)
    valid_days: Optional[int] = Field(None, ge=1, le=3650)
    is_used: Optional[bool] = None


class InviteCode(ORMModel):
    id: int
    code: str
    vip_level: int
    valid_days: int
    generated_at: datetime
    is_used: bool
    used_at: Optional[datetime]
    used_by_member_id: Optional[int]
    created_at: datetime
    updated_at: datetime


class QueryCodeBase(ORMModel):
    code: Optional[str] = Field(None, max_length=32)
    expires_at: datetime
    student_name: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = Field(None, max_length=255)
    member_id: Optional[int] = None


class QueryCodeCreate(QueryCodeBase):
    pass


class QueryCodeUpdate(ORMModel):
    expires_at: Optional[datetime] = None
    student_name: Optional[str] = None
    description: Optional[str] = None
    member_id: Optional[int] = None
    is_active: Optional[bool] = None


class QueryCode(ORMModel):
    id: int
    code: str
    expires_at: datetime
    student_name: Optional[str]
    description: Optional[str]
    member_id: Optional[int]
    is_active: bool
    last_used_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime


class ScoreItem(BaseModel):
    subject: str
    score: float


class StudentBase(ORMModel):
    name: str
    student_no: str
    class_name: Optional[str] = None
    grade_name: Optional[str] = None
    exam_name: Optional[str] = None
    notes: Optional[str] = None
    scores: List[ScoreItem]
    class_rank: Optional[int] = None
    grade_rank: Optional[int] = None


class StudentCreate(StudentBase):
    pass


class StudentUpdate(ORMModel):
    name: Optional[str] = None
    student_no: Optional[str] = None
    class_name: Optional[str] = None
    grade_name: Optional[str] = None
    exam_name: Optional[str] = None
    notes: Optional[str] = None
    scores: Optional[List[ScoreItem]] = None
    class_rank: Optional[int] = None
    grade_rank: Optional[int] = None


class Student(StudentBase):
    id: int
    total_score: float
    average_score: float
    created_at: datetime
    updated_at: datetime


class StudentSummary(BaseModel):
    total_students: int
    average_total: float
    highest_total: Optional[float]
    highest_student: Optional[str]
    pass_rate: float
    good_rate: float = 0.0
    excellent_rate: float


class RangeSegment(BaseModel):
    key: str
    name: str
    min: float
    max: Optional[float] = None


class SubjectRangeConfig(BaseModel):
    subject: str
    config: List[RangeSegment]
