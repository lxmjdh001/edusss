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

def start_server():
    """后台启动FastAPI服务器"""
    try:
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
            port=8765,
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

        # 确保数据目录存在
        data_dir = Path(base_path) / "data"
        data_dir.mkdir(exist_ok=True)

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
        webview.create_window(
            "学校成绩管理系统",
            "http://127.0.0.1:8765/static/points.html",  # 直接打开主页，跳过登录
            width=1400,
            height=900,
            resizable=True,
            fullscreen=False
        )
        webview.start()
    except Exception as e:
        print(f"应用启动失败: {e}")
        import traceback
        traceback.print_exc()
        input("按回车键退出...")

if __name__ == "__main__":
    main()
