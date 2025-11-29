from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .database import init_db
from .routes import invite_codes, members, query_codes, students

app = FastAPI(
    title="学校成绩管理系统",
    description="FastAPI + SQLite 的在线 / 离线成绩管理后端。",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(members.router)
app.include_router(invite_codes.router)
app.include_router(query_codes.router)
app.include_router(students.router)

STATIC_DIR = Path(__file__).parent / "static"
INDEX_FILE = STATIC_DIR / "成绩管理.html"

if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.on_event("startup")
def startup_event():
    init_db()


@app.get("/", include_in_schema=False)
def serve_frontend():
    if INDEX_FILE.exists():
        return FileResponse(INDEX_FILE)
    raise HTTPException(status_code=404, detail="前端文件未找到，请检查部署。")


@app.get("/healthz", response_class=JSONResponse, tags=["system"])
def health_check():
    return {"status": "ok"}
