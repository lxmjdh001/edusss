"""
宠物图片管理API - 统一文件夹读取，支持浏览器版和桌面版
"""
import os
import re
import shutil
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from pydantic import BaseModel

from .. import models
from ..dependencies import get_optional_user

router = APIRouter(prefix="/api/pet-images", tags=["pet-images"])

# 支持的图片扩展名
IMAGE_EXTS = ('.jpg', '.jpeg', '.png', '.gif', '.webp')

# 宠物类型列表缓存 {owner_bucket: (timestamp, result)}
_pet_types_cache: dict[str, tuple[float, dict]] = {}
_PET_TYPES_CACHE_TTL = 30  # 缓存30秒


def _invalidate_pet_cache(owner_bucket: str):
    """清除指定用户的宠物类型缓存"""
    _pet_types_cache.pop(owner_bucket, None)


def _get_pet_images_dir() -> Path:
    """获取宠物图片根目录，兼容开发环境和打包后的桌面版"""
    if getattr(sys, 'frozen', False):
        # 桌面版打包后，静态资源在 exe 同级目录
        base = Path(sys.executable).resolve().parent
        return base / "app" / "static" / "images" / "pet"
    return Path(__file__).resolve().parent.parent / "static" / "images" / "pet"


def _safe_name(name: str) -> str:
    """清理文件夹名，防止路径穿越"""
    if not name or '..' in name or '/' in name or '\\' in name:
        raise HTTPException(status_code=400, detail="无效的名称")
    # 只保留字母、数字、下划线、连字符、中文
    cleaned = re.sub(r'[^a-zA-Z0-9_\-\u4e00-\u9fff\u3400-\u4dbf]', '', name)
    if not cleaned:
        raise HTTPException(status_code=400, detail="无效的名称")
    return cleaned


def _verify_inside(child: Path, parent: Path) -> None:
    """确保 child 路径在 parent 目录内，防止穿越"""
    try:
        child.resolve().relative_to(parent.resolve())
    except ValueError:
        raise HTTPException(status_code=400, detail="非法路径")

def _build_image_url(base_dir: Path, pet_id: str, filename: str) -> str:
    base_root = _get_pet_images_dir()
    try:
        rel = base_dir.resolve().relative_to(base_root.resolve())
    except ValueError:
        rel = Path()
    rel_part = rel.as_posix()
    if rel_part and rel_part != ".":
        return f"/static/images/pet/{rel_part}/{pet_id}/{filename}"
    return f"/static/images/pet/{pet_id}/{filename}"


def _read_stage_names(folder: Path) -> List[str]:
    stage_names: List[str] = []
    for txt_file in folder.glob("*等级名称*.txt"):
        try:
            content = txt_file.read_text(encoding='utf-8').strip()
            for line in content.splitlines():
                line = line.strip()
                if not line:
                    continue
                name = re.sub(r'^\d+[\.\、\s]+', '', line).strip()
                if name:
                    stage_names.append(name)
        except Exception:
            pass
        break
    return stage_names[:6]

def _is_type_hidden(user_dir: Path, pet_id: str) -> bool:
    hidden_flag = user_dir / pet_id / ".hidden"
    return hidden_flag.exists()


def _get_deleted_levels(user_dir: Path, pet_id: str) -> set[int]:
    deleted: set[int] = set()
    pet_dir = user_dir / pet_id
    if not pet_dir.exists():
        return deleted
    for level in range(1, 7):
        if (pet_dir / f".level{level}.deleted").exists():
            deleted.add(level)
    return deleted


def _collect_pet_types(pet_root: Path, skip_dirs: Optional[set[str]] = None) -> dict:
    result: dict[str, dict] = {}
    if not pet_root.exists():
        return result
    for folder in sorted(pet_root.iterdir()):
        if not folder.is_dir():
            continue
        if skip_dirs and folder.name in skip_dirs:
            continue
        pet_id = folder.name
        images: dict[str, str] = {}
        for level in range(1, 7):
            for ext in IMAGE_EXTS:
                img_path = folder / f"{level}{ext}"
                if img_path.exists():
                    images[f"level{level}"] = _build_image_url(pet_root, pet_id, f"{level}{ext}")
                    break
        result[pet_id] = {
            "name": pet_id,
            "images": images,
            "stageNames": _read_stage_names(folder),
        }
    return result


def _is_desktop_mode() -> bool:
    return os.getenv('DESKTOP_MODE', 'false').lower() == 'true'


def _get_owner_bucket(owner: Optional[models.Member]) -> str:
    if _is_desktop_mode():
        return "offline"
    if not owner:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="未登录或登录已过期",
        )
    if not owner.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="账号已被禁用",
        )
    if owner.expires_at and owner.expires_at < datetime.utcnow():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="账号已过期，点击【联系客服】续费",
        )
    return _safe_name(f"user_{owner.id}")


def _get_owner_dir(owner: Optional[models.Member]) -> Path:
    base_dir = _get_pet_images_dir()
    bucket = _get_owner_bucket(owner)
    owner_dir = base_dir / "__users__" / bucket
    _verify_inside(owner_dir, base_dir)
    return owner_dir


class CreateTypeRequest(BaseModel):
    id: str
    name: Optional[str] = None
    stageNames: Optional[List[str]] = None


@router.get("/types")
def list_pet_types(
    current_user: Optional[models.Member] = Depends(get_optional_user),
):
    """扫描用户目录，返回所有宠物类型及其图片（带缓存）"""
    user_dir = _get_owner_dir(current_user)
    owner_bucket = user_dir.name

    # 检查缓存
    cached = _pet_types_cache.get(owner_bucket)
    if cached and (time.time() - cached[0]) < _PET_TYPES_CACHE_TTL:
        return cached[1]

    global_dir = _get_pet_images_dir()
    legacy_user_dir = global_dir / owner_bucket

    global_types = _collect_pet_types(global_dir, skip_dirs={"__users__", owner_bucket})

    user_types: dict[str, dict] = {}
    for source_dir in (legacy_user_dir, user_dir):
        if not source_dir.exists():
            continue
        source_map = _collect_pet_types(source_dir)
        for pet_id, info in source_map.items():
            existing = user_types.get(pet_id, {"images": {}, "stageNames": [], "name": None})
            images = {**existing.get("images", {}), **info.get("images", {})}
            stage_names = info.get("stageNames") or existing.get("stageNames") or []
            name = info.get("name") or existing.get("name")
            user_types[pet_id] = {
                "name": name,
                "images": images,
                "stageNames": stage_names,
            }

    result = []
    all_ids = sorted(set(global_types.keys()) | set(user_types.keys()))
    for pet_id in all_ids:
        if _is_type_hidden(user_dir, pet_id):
            continue
        global_info = global_types.get(pet_id, {"images": {}, "stageNames": [], "name": None})
        user_info = user_types.get(pet_id, {"images": {}, "stageNames": [], "name": None})
        images = {**global_info.get("images", {}), **user_info.get("images", {})}
        deleted_levels = _get_deleted_levels(user_dir, pet_id)
        for level in deleted_levels:
            images.pop(f"level{level}", None)
        stage_names = user_info.get("stageNames") or global_info.get("stageNames") or []
        name = user_info.get("name") or global_info.get("name") or pet_id
        result.append({
            "id": pet_id,
            "name": name,
            "images": images,
            "stageNames": stage_names[:6],
            "imageCount": len(images),
        })

    response = {"types": result}
    _pet_types_cache[owner_bucket] = (time.time(), response)
    return response


@router.post("/upload/{pet_type}/{level}")
async def upload_pet_image(
    pet_type: str,
    level: int,
    file: UploadFile = File(...),
    current_user: Optional[models.Member] = Depends(get_optional_user),
):
    """上传宠物图片到对应文件夹"""
    safe_type = _safe_name(pet_type)
    base_dir = _get_owner_dir(current_user)

    if level < 1 or level > 6:
        raise HTTPException(status_code=400, detail="等级必须在1-6之间")

    if not file.content_type or not file.content_type.startswith('image/'):
        raise HTTPException(status_code=400, detail="请上传图片文件")

    content = await file.read()
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="图片大小不能超过5MB")

    pet_dir = base_dir / safe_type
    _verify_inside(pet_dir, base_dir)
    pet_dir.mkdir(parents=True, exist_ok=True)
    hidden_flag = pet_dir / ".hidden"
    if hidden_flag.exists():
        hidden_flag.unlink()
    deleted_flag = pet_dir / f".level{level}.deleted"
    if deleted_flag.exists():
        deleted_flag.unlink()

    # 删除该等级的旧图片
    for ext in IMAGE_EXTS:
        old_file = pet_dir / f"{level}{ext}"
        if old_file.exists():
            old_file.unlink()

    # 确定扩展名
    ext_map = {
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/gif': '.gif',
        'image/webp': '.webp',
    }
    ext = ext_map.get(file.content_type, '.jpg')
    target_path = pet_dir / f"{level}{ext}"

    target_path.write_bytes(content)

    _invalidate_pet_cache(base_dir.name)
    url = _build_image_url(base_dir, safe_type, f"{level}{ext}")
    return {"success": True, "url": url}


@router.delete("/delete/{pet_type}/{level}")
def delete_pet_image(
    pet_type: str,
    level: int,
    current_user: Optional[models.Member] = Depends(get_optional_user),
):
    """删除指定宠物的指定等级图片"""
    safe_type = _safe_name(pet_type)
    base_dir = _get_owner_dir(current_user)

    if level < 1 or level > 6:
        raise HTTPException(status_code=400, detail="等级必须在1-6之间")

    pet_dir = base_dir / safe_type
    _verify_inside(pet_dir, base_dir)

    deleted = False
    for ext in IMAGE_EXTS:
        img_path = pet_dir / f"{level}{ext}"
        if img_path.exists():
            img_path.unlink()
            deleted = True
    global_dir = _get_pet_images_dir()
    global_pet_dir = global_dir / safe_type
    _verify_inside(global_pet_dir, global_dir)
    global_has_level = False
    for ext in IMAGE_EXTS:
        if (global_pet_dir / f"{level}{ext}").exists():
            global_has_level = True
            break

    if global_has_level:
        pet_dir.mkdir(parents=True, exist_ok=True)
        hidden_flag = pet_dir / f".level{level}.deleted"
        hidden_flag.write_text("deleted", encoding="utf-8")

    _invalidate_pet_cache(base_dir.name)
    return {"success": True, "deleted": deleted}


@router.post("/create-type")
async def create_pet_type(
    data: CreateTypeRequest,
    current_user: Optional[models.Member] = Depends(get_optional_user),
):
    """创建新的宠物类型文件夹"""
    pet_id = _safe_name(data.id)
    base_dir = _get_owner_dir(current_user)
    pet_dir = base_dir / pet_id
    _verify_inside(pet_dir, base_dir)

    if pet_dir.exists():
        hidden_flag = pet_dir / ".hidden"
        if hidden_flag.exists():
            hidden_flag.unlink()
        else:
            raise HTTPException(status_code=409, detail="该宠物类型已存在")
    else:
        pet_dir.mkdir(parents=True, exist_ok=True)

    # 如果提供了等级名称，写入txt文件
    if data.stageNames:
        txt_path = pet_dir / "等级名称.txt"
        lines = [f"{i+1}. {name}" for i, name in enumerate(data.stageNames[:6])]
        txt_path.write_text('\n'.join(lines), encoding='utf-8')

    _invalidate_pet_cache(base_dir.name)
    return {"success": True, "id": pet_id}


@router.delete("/delete-type/{pet_type}")
def delete_pet_type(
    pet_type: str,
    current_user: Optional[models.Member] = Depends(get_optional_user),
):
    """删除整个宠物类型文件夹"""
    safe_type = _safe_name(pet_type)
    base_dir = _get_owner_dir(current_user)
    pet_dir = base_dir / safe_type
    _verify_inside(pet_dir, base_dir)

    global_dir = _get_pet_images_dir()
    global_pet_dir = global_dir / safe_type
    _verify_inside(global_pet_dir, global_dir)
    has_global = global_pet_dir.exists()

    if pet_dir.exists():
        shutil.rmtree(pet_dir)
    elif not has_global:
        raise HTTPException(status_code=404, detail="宠物类型不存在")

    if has_global:
        pet_dir.mkdir(parents=True, exist_ok=True)
        (pet_dir / ".hidden").write_text("hidden", encoding="utf-8")

    _invalidate_pet_cache(base_dir.name)
    return {"success": True}
