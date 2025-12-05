"""
数据库迁移脚本：更新 students 表唯一约束为 (student_no, exam_name)
"""
from __future__ import annotations

import sqlite3
import os
from pathlib import Path
from urllib.parse import urlparse

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DEFAULT_DB_PATH = DATA_DIR / "grade_manager.db"
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DEFAULT_DB_PATH}")


def _resolve_sqlite_path(url: str) -> Path:
    parsed = urlparse(url)
    if parsed.scheme != "sqlite":
        raise RuntimeError("当前数据库不是 SQLite，暂不支持自动迁移")
    if parsed.path in ("", ":memory:"):
        raise RuntimeError("SQLite 内存数据库无法执行迁移，请指定实际文件路径")
    db_path = parsed.path
    if parsed.netloc and parsed.netloc != "":  # 兼容 Windows 路径
        db_path = f"{parsed.netloc}{parsed.path}"
    return Path(db_path).resolve()


def migrate():
    db_path = _resolve_sqlite_path(DATABASE_URL)
    print(f"开始迁移：更新 {db_path} 中 students 表唯一约束...")

    conn = sqlite3.connect(db_path)
    try:
        cur = conn.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='students'"
        )
        row = cur.fetchone()
        if not row or not row[0]:
            print("⚠️  未找到 students 表，跳过迁移")
            return

        normalized_sql = " ".join(row[0].split())
        if "student_no, exam_name" in normalized_sql:
            print("✓ students 表唯一约束已是 (student_no, exam_name)，无需变更")
            return

        conn.execute("PRAGMA foreign_keys=OFF;")

        conn.executescript(
            """
            CREATE TABLE students_new (
                id INTEGER NOT NULL,
                name VARCHAR(80) NOT NULL,
                student_no VARCHAR(50) NOT NULL,
                class_name VARCHAR(80),
                grade_name VARCHAR(80),
                exam_name VARCHAR(120),
                notes VARCHAR(255),
                scores JSON NOT NULL,
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL,
                class_rank INTEGER,
                grade_rank INTEGER,
                exam_date DATETIME,
                gender VARCHAR(10),
                PRIMARY KEY (id),
                CONSTRAINT uq_student_exam UNIQUE (student_no, exam_name)
            );
            INSERT INTO students_new (
                id, name, student_no, class_name, grade_name, exam_name,
                notes, scores, created_at, updated_at, class_rank,
                grade_rank, exam_date, gender
            )
            SELECT
                id, name, student_no, class_name, grade_name, exam_name,
                notes, scores, created_at, updated_at, class_rank,
                grade_rank, exam_date, gender
            FROM students;
            DROP TABLE students;
            ALTER TABLE students_new RENAME TO students;
            CREATE INDEX ix_students_id ON students (id);
            CREATE INDEX ix_students_student_no ON students (student_no);
            """
        )

        conn.execute("PRAGMA foreign_keys=ON;")
        conn.commit()
    finally:
        conn.close()

    print("✅ 迁移完成：students 表现在允许同一学号参加多场考试")


if __name__ == "__main__":
    migrate()
