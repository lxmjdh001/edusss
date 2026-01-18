from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .database import init_db
from .routes import invite_codes, members, query_codes, students, points, auth, activation_codes

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

app.include_router(auth.router)
app.include_router(members.router)
app.include_router(invite_codes.router)
app.include_router(activation_codes.router)
app.include_router(query_codes.router)
app.include_router(students.router)
app.include_router(points.router)

STATIC_DIR = Path(__file__).parent / "static"
INDEX_FILE = STATIC_DIR / "grades.html"

if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.on_event("startup")
def startup_event():
    init_db()


@app.get("/", include_in_schema=False)
def serve_frontend():
    # 直接返回登录页面，让前端JS处理认证检查和跳转
    login_file = STATIC_DIR / "login.html"
    if login_file.exists():
        return FileResponse(login_file)
    raise HTTPException(status_code=404, detail="登录页面未找到")


@app.get("/points.html", include_in_schema=False)
def serve_points():
    points_file = STATIC_DIR / "points.html"
    if points_file.exists():
        return FileResponse(points_file)
    raise HTTPException(status_code=404, detail="积分系统页面未找到")


@app.get("/healthz", response_class=JSONResponse, tags=["system"])
def health_check():
    return {"status": "ok"}


@app.get("/api/desktop-mode", response_class=JSONResponse, tags=["system"])
def check_desktop_mode():
    """检查是否为桌面模式"""
    desktop_mode = os.getenv('DESKTOP_MODE', 'false').lower() == 'true'
    return {"desktop_mode": desktop_mode}
