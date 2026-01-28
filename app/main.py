from __future__ import annotations

import os
import base64
import re
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .database import init_db, get_data_dir
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


def _sanitize_filename(name: str) -> str:
    if not name:
        return "export"
    cleaned = re.sub(r'[\\/:*?"<>|]', "_", name)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned or "export"


def _unique_export_path(directory: Path, filename: str) -> Path:
    target = directory / filename
    if not target.exists():
        return target
    stem = target.stem
    suffix = target.suffix
    for i in range(1, 1000):
        candidate = directory / f"{stem}_{i}{suffix}"
        if not candidate.exists():
            return candidate
    return directory / f"{stem}_{int(__import__('time').time())}{suffix}"


class DesktopExportPayload(BaseModel):
    filename: str
    content: str | None = None
    data_base64: str | None = None
    encoding: str | None = "utf-8"


@app.post("/api/desktop/export", response_class=JSONResponse, tags=["system"])
def desktop_export(payload: DesktopExportPayload):
    """桌面版：直接保存导出文件到本地导出目录"""
    desktop_mode = os.getenv('DESKTOP_MODE', 'false').lower() == 'true'
    if not desktop_mode:
        raise HTTPException(status_code=403, detail="仅桌面模式可用")

    data_dir = get_data_dir()
    exports_dir = data_dir / "exports"
    exports_dir.mkdir(parents=True, exist_ok=True)

    safe_name = _sanitize_filename(payload.filename)
    target_path = _unique_export_path(exports_dir, safe_name)

    try:
        if payload.data_base64:
            raw = base64.b64decode(payload.data_base64)
            target_path.write_bytes(raw)
        elif payload.content is not None:
            encoding = payload.encoding or "utf-8"
            target_path.write_text(payload.content, encoding=encoding)
        else:
            raise HTTPException(status_code=400, detail="缺少导出内容")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"写入失败: {exc}") from exc

    return {"saved": True, "path": str(target_path)}
