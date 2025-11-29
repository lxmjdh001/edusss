from __future__ import annotations

import os
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DEFAULT_DB_PATH = DATA_DIR / "grade_manager.db"

DATA_DIR.mkdir(parents=True, exist_ok=True)

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
