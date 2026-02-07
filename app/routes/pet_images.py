"""
宠物图片管理API - 统一文件夹读取，支持浏览器版和桌面版
"""
import re
import shutil
import sys
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel

router = APIRouter(prefix="/api/pet-images", tags=["pet-images"])

# 支持的图片扩展名
IMAGE_EXTS = ('.jpg', '.jpeg', '.png', '.gif', '.webp')


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


class CreateTypeRequest(BaseModel):
    id: str
    name: Optional[str] = None
    stageNames: Optional[List[str]] = None


@router.get("/types")
def list_pet_types():
    """扫描 images/pet/ 目录，返回所有宠物类型及其图片"""
    pet_dir = _get_pet_images_dir()
    if not pet_dir.exists():
        return {"types": []}

    result = []
    for folder in sorted(pet_dir.iterdir()):
        if not folder.is_dir():
            continue

        pet_id = folder.name
        # 收集图片 (1.jpg ~ 6.jpg)
        images = {}
        for level in range(1, 7):
            for ext in IMAGE_EXTS:
                img_path = folder / f"{level}{ext}"
                if img_path.exists():
                    images[f"level{level}"] = f"/static/images/pet/{pet_id}/{level}{ext}"
                    break

        # 读取等级名称文件
        stage_names = []
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
            break  # 只读第一个匹配的txt

        result.append({
            "id": pet_id,
            "images": images,
            "stageNames": stage_names[:6],
            "imageCount": len(images),
        })

    return {"types": result}


@router.post("/upload/{pet_type}/{level}")
async def upload_pet_image(pet_type: str, level: int, file: UploadFile = File(...)):
    """上传宠物图片到对应文件夹"""
    safe_type = _safe_name(pet_type)
    base_dir = _get_pet_images_dir()

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

    url = f"/static/images/pet/{safe_type}/{level}{ext}"
    return {"success": True, "url": url}


@router.delete("/delete/{pet_type}/{level}")
def delete_pet_image(pet_type: str, level: int):
    """删除指定宠物的指定等级图片"""
    safe_type = _safe_name(pet_type)
    base_dir = _get_pet_images_dir()

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

    return {"success": True, "deleted": deleted}


@router.post("/create-type")
async def create_pet_type(data: CreateTypeRequest):
    """创建新的宠物类型文件夹"""
    pet_id = _safe_name(data.id)
    base_dir = _get_pet_images_dir()
    pet_dir = base_dir / pet_id
    _verify_inside(pet_dir, base_dir)

    if pet_dir.exists():
        raise HTTPException(status_code=409, detail="该宠物类型已存在")

    pet_dir.mkdir(parents=True, exist_ok=True)

    # 如果提供了等级名称，写入txt文件
    if data.stageNames:
        txt_name = _safe_name(data.name or pet_id)
        txt_path = pet_dir / f"{txt_name}等级名称.txt"
        lines = [f"{i+1}. {name}" for i, name in enumerate(data.stageNames[:6])]
        txt_path.write_text('\n'.join(lines), encoding='utf-8')

    return {"success": True, "id": pet_id}


@router.delete("/delete-type/{pet_type}")
def delete_pet_type(pet_type: str):
    """删除整个宠物类型文件夹"""
    safe_type = _safe_name(pet_type)
    base_dir = _get_pet_images_dir()
    pet_dir = base_dir / safe_type
    _verify_inside(pet_dir, base_dir)

    if not pet_dir.exists():
        raise HTTPException(status_code=404, detail="宠物类型不存在")

    shutil.rmtree(pet_dir)
    return {"success": True}
