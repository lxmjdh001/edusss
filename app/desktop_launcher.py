import base64
from typing import Optional
import webview
import threading
import uvicorn
import time
import sys
import os
from pathlib import Path

def get_resource_path():
    """获取资源路径（支持打包后的应用）"""
    if getattr(sys, 'frozen', False):
        # 打包后的应用
        return sys._MEIPASS
    else:
        # 开发环境
        return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))



def _build_file_types(filename: str):
    ext = Path(filename).suffix
    if not ext:
        return [('All Files', '*.*')]
    label = f'{ext[1:].upper()} files'
    return [(label, f'*{ext}'), ('All Files', '*.*')]


class DesktopApi:
    def __init__(self, data_dir: Optional[Path] = None):
        self._window = None
        self._data_dir = data_dir

    def _task_checkin_path(self) -> Optional[Path]:
        if not self._data_dir:
            return None
        return self._data_dir / "task_checkin.json"

    def set_window(self, window):
        self._window = window

    def save_file(self, filename: str, data_url: str) -> bool:
        if not self._window or not data_url:
            return False
        try:
            _header, _sep, b64 = data_url.partition(',')
            if not b64:
                return False
            save_path = self._window.create_file_dialog(
                webview.SAVE_DIALOG,
                save_filename=filename,
                file_types=_build_file_types(filename),
            )
            if not save_path:
                return False
            if isinstance(save_path, list):
                save_path = save_path[0]
            data = base64.b64decode(b64)
            with open(save_path, 'wb') as f:
                f.write(data)
            return True
        except Exception as exc:
            print(f"Save file failed: {exc}")
            return False

    def save_text_file(self, filename: str, content: str) -> bool:
        if not self._window:
            return False
        try:
            save_path = self._window.create_file_dialog(
                webview.SAVE_DIALOG,
                save_filename=filename,
                file_types=_build_file_types(filename),
            )
            if not save_path:
                return False
            if isinstance(save_path, list):
                save_path = save_path[0]
            with open(save_path, 'w', encoding='utf-8') as f:
                f.write(content or "")
            return True
        except Exception as exc:
            print(f"Save text file failed: {exc}")
            return False

    def get_task_checkin_data(self):
        path = self._task_checkin_path()
        if not path or not path.exists():
            return None
        try:
            return path.read_text(encoding="utf-8")
        except OSError as exc:
            print(f"Read task checkin data failed: {exc}")
            return None

    def save_task_checkin_data(self, payload: str) -> bool:
        path = self._task_checkin_path()
        if not path:
            return False
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(payload or "", encoding="utf-8")
            return True
        except OSError as exc:
            print(f"Save task checkin data failed: {exc}")
            return False

    def clear_task_checkin_data(self) -> bool:
        path = self._task_checkin_path()
        if not path:
            return False
        try:
            if path.exists():
                path.unlink()
            return True
        except OSError as exc:
            print(f"Clear task checkin data failed: {exc}")
            return False


def start_server():
    """后台启动FastAPI服务器"""
    try:
        # 设置桌面模式环境变量（跳过登录验证）
        os.environ['DESKTOP_MODE'] = 'true'

        # 设置工作目录
        base_path = get_resource_path()
        os.chdir(base_path)

        # 添加到Python路径
        if base_path not in sys.path:
            sys.path.insert(0, base_path)

        from app.main import app
        uvicorn.run(
            app,
            host="127.0.0.1",
            port=18765,
            log_level="warning"
        )
    except Exception as e:
        print(f"服务器启动失败: {e}")
        import traceback
        traceback.print_exc()

def main():
    try:
        # 获取资源路径
        base_path = get_resource_path()

        if base_path not in sys.path:
            sys.path.insert(0, base_path)

        from app.database import get_data_dir
        data_dir = get_data_dir()
        storage_dir = data_dir / "webview_storage"
        storage_dir.mkdir(parents=True, exist_ok=True)

        print(f"应用路径: {base_path}")
        print(f"数据目录: {data_dir}")

        # 后台启动FastAPI服务器
        server_thread = threading.Thread(target=start_server, daemon=True)
        server_thread.start()

        # 等待服务器启动
        print("等待服务器启动...")
        time.sleep(3)

        # 创建桌面窗口
        print("创建桌面窗口...")
        api = DesktopApi(data_dir)
        window = webview.create_window(
            "班级积分宠物成长系统",
            "http://127.0.0.1:18765/static/points.html",
            width=1400,
            height=900,
            resizable=True,
            fullscreen=False,
            js_api=api,
        )
        api.set_window(window)
        webview.start(private_mode=False, storage_path=str(storage_dir))
    except Exception as e:
        print(f"应用启动失败: {e}")
        import traceback
        traceback.print_exc()
        input("按回车键退出...")

if __name__ == "__main__":
    main()
