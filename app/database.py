from __future__ import annotations

import os
import sys
import shutil
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

# 获取数据存储目录
def get_legacy_data_dir() -> Path:
    if sys.platform == 'darwin':  # macOS
        return Path.home() / 'Library' / 'Application Support' / '学校成绩管理系统'
    if sys.platform == 'win32':  # Windows
        return Path.home() / 'AppData' / 'Local' / '学校成绩管理系统'
    return Path.home() / '.学校成绩管理系统'


def migrate_legacy_db(target_dir: Path) -> None:
    legacy_db = get_legacy_data_dir() / "grade_manager.db"
    target_db = target_dir / "grade_manager.db"
    if target_db.exists() or not legacy_db.exists():
        return
    try:
        target_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(legacy_db, target_db)
    except OSError:
        pass


def migrate_exe_db(target_dir: Path) -> None:
    exe_dir = Path(sys.executable).resolve().parent
    exe_db = exe_dir / "grade_manager.db"
    target_db = target_dir / "grade_manager.db"
    if target_db.exists() or not exe_db.exists():
        return
    try:
        target_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(exe_db, target_db)
    except OSError:
        pass


def get_data_dir() -> Path:
    """获取数据存储目录（支持打包后的应用）"""
    if getattr(sys, 'frozen', False):
        base_dir = Path(sys.executable).resolve().parent
        data_dir = base_dir / "data"
        data_dir.mkdir(parents=True, exist_ok=True)
        migrate_exe_db(data_dir)
        migrate_legacy_db(data_dir)
        return data_dir

    # 开发环境：使用项目目录
    BASE_DIR = Path(__file__).resolve().parent.parent
    data_dir = BASE_DIR / "data"

    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir

DATA_DIR = get_data_dir()
DEFAULT_DB_PATH = DATA_DIR / "grade_manager.db"

DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DEFAULT_DB_PATH}")

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)

Base = declarative_base()


def get_db():
    """FastAPI dependency that yields a database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """Create all database tables."""
    from . import models  # noqa: F401  # Import ensures models are registered with metadata

    Base.metadata.create_all(bind=engine)
    seed_subject_ranges()


def seed_subject_ranges():
    from sqlalchemy.orm import Session
    from .routes.students import ALL_SUBJECTS, DEFAULT_RANGE_CONFIG
    from . import models

    with Session(engine) as session:
        for subject in ALL_SUBJECTS:
            exists = (
                session.query(models.SubjectRange)
                .filter(models.SubjectRange.subject == subject)
                .first()
            )
            if not exists:
                record = models.SubjectRange(subject=subject, config=[dict(item) for item in DEFAULT_RANGE_CONFIG])
                session.add(record)
        session.commit()

