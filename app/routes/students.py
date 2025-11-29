from __future__ import annotations

from typing import List, Optional, Dict, Any
from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import or_
from openpyxl import Workbook, load_workbook

from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/api/students", tags=["students"])
DEFAULT_SUBJECTS = ["语文", "数学", "英语", "物理", "化学", "生物", "历史", "政治", "地理"]
ALL_SUBJECTS = ["总分"] + DEFAULT_SUBJECTS
DEFAULT_RANGE_CONFIG = [
    {"key": "fail", "name": "不及格", "min": 0, "max": 60},
    {"key": "pass", "name": "及格", "min": 60, "max": 80},
    {"key": "good", "name": "良好", "min": 80, "max": 90},
    {"key": "excellent", "name": "优秀", "min": 90, "max": 100},
]



def _serialize_student(student: models.Student) -> schemas.Student:
    scores = student.scores or []
    total = sum(item.get("score", 0) for item in scores)
    average = total / len(scores) if scores else 0.0
    return schemas.Student(
        id=student.id,
        name=student.name,
        student_no=student.student_no,
        class_name=student.class_name,
        grade_name=student.grade_name,
        exam_name=student.exam_name,
        notes=student.notes,
        scores=[schemas.ScoreItem(**item) for item in scores],
        class_rank=student.class_rank,
        grade_rank=student.grade_rank,
        total_score=round(total, 2),
        average_score=round(average, 2),
        created_at=student.created_at,
        updated_at=student.updated_at,
    )


@router.get("/", response_model=List[schemas.Student])
def list_students(
    keyword: Optional[str] = Query(None, description="按姓名/学号模糊搜索"),
    class_name: Optional[str] = None,
    exam_name: Optional[str] = None,
    db: Session = Depends(get_db),
):
    query = db.query(models.Student)
    if keyword:
        like = f"%{keyword}%"
        query = query.filter(
            or_(
                models.Student.name.ilike(like),
                models.Student.student_no.ilike(like),
            )
        )
    if class_name:
        query = query.filter(models.Student.class_name == class_name)
    if exam_name:
        query = query.filter(models.Student.exam_name == exam_name)
    students = query.order_by(models.Student.updated_at.desc()).all()
    return [_serialize_student(s) for s in students]


@router.get("/summary", response_model=schemas.StudentSummary)
def summary(db: Session = Depends(get_db)):
    students = db.query(models.Student).all()
    if not students:
        return schemas.StudentSummary(
            total_students=0,
            average_total=0.0,
            highest_total=None,
            highest_student=None,
            pass_rate=0.0,
            good_rate=0.0,
            excellent_rate=0.0,
        )
    totals = []
    highest_total = None
    highest_name = None
    pass_count = 0
    good_count = 0
    excellent_count = 0
    for student in students:
        scores = student.scores or []
        total = sum(item.get("score", 0) for item in scores)
        totals.append(total)
        if highest_total is None or total > highest_total:
            highest_total = total
            highest_name = student.name
        avg = total / len(scores) if scores else 0
        if avg >= 90:
            excellent_count += 1
        if avg >= 80:
            good_count += 1
        if avg >= 60:
            pass_count += 1
    total_students = len(students)
    average_total = sum(totals) / total_students if totals else 0
    return schemas.StudentSummary(
        total_students=total_students,
        average_total=round(average_total, 2),
        highest_total=round(highest_total, 2) if highest_total is not None else None,
        highest_student=highest_name,
        pass_rate=round(pass_count / total_students * 100, 2),
        good_rate=round(good_count / total_students * 100, 2),
        excellent_rate=round(excellent_count / total_students * 100, 2),
    )


@router.get("/ranges", response_model=Dict[str, List[schemas.RangeSegment]])
def get_all_ranges(db: Session = Depends(get_db)):
    configs: Dict[str, List[schemas.RangeSegment]] = {}
    for subject in ALL_SUBJECTS:
        record = _ensure_subject_range(db, subject)
        configs[subject] = [schemas.RangeSegment(**segment) for segment in record.config]
    return configs


@router.put("/ranges/{subject}", response_model=List[schemas.RangeSegment])
def update_range(subject: str, payload: List[schemas.RangeSegment], db: Session = Depends(get_db)):
    if subject not in ALL_SUBJECTS:
        raise HTTPException(status_code=400, detail="科目不在允许范围内")
    if not payload:
        raise HTTPException(status_code=400, detail="请选择至少一个区间")
    validated = []
    for segment in payload:
        if segment.max is not None and segment.max <= segment.min:
            raise HTTPException(status_code=400, detail=f"{segment.name} 的最大值需大于最小值")
        validated.append(segment.model_dump())
    record = _ensure_subject_range(db, subject)
    record.config = validated
    db.add(record)
    db.commit()
    db.refresh(record)
    return [schemas.RangeSegment(**segment) for segment in record.config]


@router.get("/{student_id}", response_model=schemas.Student)
def get_student(student_id: int, db: Session = Depends(get_db)):
    student = db.get(models.Student, student_id)
    if not student:
        raise HTTPException(status_code=404, detail="学生不存在")
    return _serialize_student(student)


@router.post("/", response_model=schemas.Student, status_code=201)
def create_student(payload: schemas.StudentCreate, db: Session = Depends(get_db)):
    if db.query(models.Student).filter_by(student_no=payload.student_no).first():
        raise HTTPException(status_code=400, detail="学号已存在")
    student = models.Student(
        name=payload.name,
        student_no=payload.student_no,
        class_name=payload.class_name,
        grade_name=payload.grade_name,
        exam_name=payload.exam_name,
        notes=payload.notes,
        scores=[score.model_dump() for score in payload.scores],
        class_rank=payload.class_rank,
        grade_rank=payload.grade_rank,
    )
    db.add(student)
    db.commit()
    db.refresh(student)
    return _serialize_student(student)


@router.put("/{student_id}", response_model=schemas.Student)
def update_student(
    student_id: int,
    payload: schemas.StudentUpdate,
    db: Session = Depends(get_db),
):
    student = db.get(models.Student, student_id)
    if not student:
        raise HTTPException(status_code=404, detail="学生不存在")
    if payload.student_no and payload.student_no != student.student_no:
        if db.query(models.Student).filter_by(student_no=payload.student_no).first():
            raise HTTPException(status_code=400, detail="学号已存在")
        student.student_no = payload.student_no
    for field in ["name", "class_name", "grade_name", "exam_name", "notes"]:
        value = getattr(payload, field)
        if value is not None:
            setattr(student, field, value)
    if payload.scores is not None:
        student.scores = [score.model_dump() for score in payload.scores]
    if payload.class_rank is not None:
        student.class_rank = payload.class_rank
    if payload.grade_rank is not None:
        student.grade_rank = payload.grade_rank
    db.add(student)
    db.commit()
    db.refresh(student)
    return _serialize_student(student)


@router.delete("/{student_id}", status_code=204)
def delete_student(student_id: int, db: Session = Depends(get_db)):
    student = db.get(models.Student, student_id)
    if not student:
        raise HTTPException(status_code=404, detail="学生不存在")
    db.delete(student)
    db.commit()
    return None


def _workbook_response(wb: Workbook, filename: str) -> StreamingResponse:
    buffer = BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/template")
def download_template():
    wb = Workbook()
    ws = wb.active
    headers = ["姓名", "学号", "班级", "年级", "考试名称", "备注"] + DEFAULT_SUBJECTS
    ws.append(headers)
    ws.append(["张三", "2024001", "高一(1)班", "高一", "期中考试", "可填写备注"] + ["" for _ in DEFAULT_SUBJECTS])
    return _workbook_response(wb, "grade_template.xlsx")


@router.post("/import")
async def import_students(
    file: UploadFile = File(...),
    class_name: Optional[str] = Form(None),
    grade_name: Optional[str] = Form(None),
    exam_name: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    contents = await file.read()
    try:
        wb = load_workbook(BytesIO(contents))
    except Exception as exc:  # pragma: no cover - openpyxl internal
        raise HTTPException(status_code=400, detail="无法读取 Excel 文件") from exc

    ws = wb.active
    header_row = next(ws.iter_rows(min_row=1, max_row=1, values_only=True), None)
    if not header_row:
        raise HTTPException(status_code=400, detail="表格为空")
    header_map: Dict[str, int] = {str(value).strip(): idx for idx, value in enumerate(header_row) if value}
    for required in ["姓名", "学号"]:
        if required not in header_map:
            raise HTTPException(status_code=400, detail=f"缺少必要列：{required}")

    imported = 0
    updated = 0
    for row in ws.iter_rows(min_row=2, values_only=True):
        if row is None:
            continue
        name = _get_cell_value(row, header_map, "姓名")
        student_no = _get_cell_value(row, header_map, "学号")
        if not name or not student_no:
            continue
        row_class = _get_cell_value(row, header_map, "班级") or class_name
        row_grade = _get_cell_value(row, header_map, "年级") or grade_name
        row_exam = _get_cell_value(row, header_map, "考试名称") or exam_name
        row_notes = _get_cell_value(row, header_map, "备注")
        scores = []
        for subject in DEFAULT_SUBJECTS:
            value = _get_cell_value(row, header_map, subject)
            if value is None or value == "":
                continue
            try:
                score_value = float(value)
            except (TypeError, ValueError):
                continue
            scores.append({"subject": subject, "score": score_value})

        existing = (
            db.query(models.Student)
                .filter(
                    models.Student.student_no == student_no,
                    models.Student.exam_name == row_exam,
                )
                .first()
        )
        if existing:
            existing.name = name
            existing.class_name = row_class
            existing.grade_name = row_grade
            existing.exam_name = row_exam
            existing.notes = row_notes
            existing.scores = scores
            db.add(existing)
            updated += 1
        else:
            student = models.Student(
                name=name,
                student_no=student_no,
                class_name=row_class,
                grade_name=row_grade,
                exam_name=row_exam,
                notes=row_notes,
                scores=scores,
            )
            db.add(student)
            imported += 1
    db.commit()
    return {"imported": imported, "updated": updated}


@router.get("/export")
def export_students(
    class_name: Optional[str] = Query(None),
    exam_name: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    query = db.query(models.Student)
    if class_name:
        query = query.filter(models.Student.class_name == class_name)
    if exam_name:
        query = query.filter(models.Student.exam_name == exam_name)
    students = query.order_by(models.Student.name).all()
    wb = Workbook()
    ws = wb.active
    headers = ["姓名", "学号", "班级", "年级", "考试名称", "备注", "总分", "均分"] + DEFAULT_SUBJECTS
    ws.append(headers)
    for student in students:
        score_map = {item.get("subject"): item.get("score") for item in (student.scores or [])}
        scores = [score_map.get(subject, "") for subject in DEFAULT_SUBJECTS]
        score_values = [score for score in score_map.values() if isinstance(score, (int, float))]
        total = sum(score_values)
        avg = total / len(score_values) if score_values else 0
        ws.append(
            [
                student.name,
                student.student_no,
                student.class_name,
                student.grade_name,
                student.exam_name,
                student.notes,
                round(total, 2),
                round(avg, 2),
            ]
            + scores
        )
    filename = "grade_export.xlsx" if not exam_name else f"grades_{exam_name}.xlsx"
    return _workbook_response(wb, filename)


def _get_cell_value(row: Any, header_map: Dict[str, int], title: str):
    idx = header_map.get(title)
    if idx is None:
        return None
    return row[idx]


def _ensure_subject_range(db: Session, subject: str) -> models.SubjectRange:
    record = db.query(models.SubjectRange).filter(models.SubjectRange.subject == subject).first()
    if not record:
        record = models.SubjectRange(subject=subject, config=[dict(item) for item in DEFAULT_RANGE_CONFIG])
        db.add(record)
        db.commit()
        db.refresh(record)
    return record


@router.get("/ranges", response_model=Dict[str, List[schemas.RangeSegment]])
def get_all_ranges(db: Session = Depends(get_db)):
    configs: Dict[str, List[schemas.RangeSegment]] = {}
    for subject in ALL_SUBJECTS:
        record = _ensure_subject_range(db, subject)
        configs[subject] = [schemas.RangeSegment(**segment) for segment in record.config]
    return configs


@router.put("/ranges/{subject}", response_model=List[schemas.RangeSegment])
def update_range(subject: str, payload: List[schemas.RangeSegment], db: Session = Depends(get_db)):
    if subject not in ALL_SUBJECTS:
        raise HTTPException(status_code=400, detail="科目不在允许范围内")
    if not payload:
        raise HTTPException(status_code=400, detail="请选择至少一个区间")
    validated = []
    for segment in payload:
        if segment.max is not None and segment.max <= segment.min:
            raise HTTPException(status_code=400, detail=f"{segment.name} 的最大值需大于最小值")
        validated.append(segment.model_dump())
    record = _ensure_subject_range(db, subject)
    record.config = validated
    db.add(record)
    db.commit()
    db.refresh(record)
    return [schemas.RangeSegment(**segment) for segment in record.config]
