## 学校成绩管理系统（Python + FastAPI + SQLite）

该目录新增了一个可直接运行的 FastAPI 应用，负责会员管理、邀请码管理和查询码管理，并可离线部署。前端暂时引用现有的 `成绩管理.html`，后续可根据需要改造为调用后端 API 的版本。

### 目录结构

```
app/
  main.py               # FastAPI 入口
  database.py           # 数据库引擎与 Session
  models.py             # SQLAlchemy 模型
  schemas.py            # Pydantic 数据结构
  utils.py              # 通用工具（加密、码生成）
  routes/               # API Router（会员 / 邀请码 / 查询码）
  static/成绩管理.html   # 现有前端页面
data/                   # SQLite 数据目录（首次运行自动创建）
requirements.txt        # 依赖列表
```

### 本地运行

1. 创建虚拟环境并安装依赖：
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   ```
2. 运行开发服务器：
   ```bash
   uvicorn app.main:app --reload
   ```
3. 浏览器访问 `http://127.0.0.1:8000/` 查看现有的成绩管理界面，API 文档位于 `http://127.0.0.1:8000/docs`。

> 首次启动会在 `data/grade_manager.db` 下创建 SQLite 数据库，可拷贝到离线环境直接使用。

### 核心 API

- `GET /api/members`：会员列表，支持 VIP 等级和关键字筛选。
- `POST /api/members`：创建会员（包含账号、手机号、密码、学生姓名、会员到期时间）。
- `GET /api/invite-codes` / `POST /api/invite-codes`：管理员生成和查询邀请码，控制激活后的 VIP 等级和有效天数。
- `GET /api/query-codes` / `POST /api/query-codes`：为家长生成成绩查询码，可设置过期时间，支持 `/api/query-codes/verify` 校验并记录使用时间。
- `GET /api/students/template`：下载 Excel 导入模板。
- `POST /api/students/import`：上传模板后的 Excel 进行批量导入。
- `GET /api/students/export`：按班级/考试导出 Excel（均可为空）。
- `GET /api/students/ranges` / `PUT /api/students/ranges/{subject}`：获取或更新“总分/各科”的及格/良好/优秀区间配置（保存在 SQLite 中）。

具体字段与返回结构可在 `schemas.py` 中查看或直接使用 Swagger UI。

### 离线部署/打包建议

- 运行 `uvicorn` 即可在本机提供 API 服务，配合浏览器打开 `http://127.0.0.1:8000`。
- 若客户需要真正的离线可执行文件，可使用 PyInstaller、Nuitka 等工具把 `app/main.py` 打包成 `exe`（Windows）或 `.app`（macOS），并在启动脚本中附带 `uvicorn` / `hypercorn`，或改用内嵌浏览器（如 pywebview/Tauri）封装。
- 静态前端文件位于 `app/static`，可根据项目进度将其改造成 PWA 或完全离线的本地页面，与本后端通信。
