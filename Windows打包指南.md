# Windows 桌面应用打包指南

## 📋 背景说明

本项目已在 macOS 上成功使用 PyInstaller 打包为桌面应用。本文档说明如何在 Windows 上进行打包。

## 🎯 核心方法

使用**与 macOS 相同的 PyInstaller 方法**，只需：
1. 在 Windows 环境中执行打包
2. 使用 Windows 专用的 spec 配置文件
3. （可选）准备 Windows 图标（.ico 格式）

**重要：代码无需任何修改，`desktop_launcher.py` 已经是跨平台的！**

---

## 📝 打包步骤

### 步骤 1: Windows 环境准备

在 Windows 机器上执行：

```bash
# 1. 安装 Python 3.8+ (如果还没有)
# 下载地址: https://www.python.org/downloads/
# 安装时勾选 "Add Python to PATH"

# 2. 克隆或复制项目到 Windows
# 可以通过 git clone 或直接复制整个项目文件夹

# 3. 进入项目目录
cd C:\path\to\edu

# 4. 创建虚拟环境
python -m venv .venv

# 5. 激活虚拟环境
.venv\Scripts\activate

# 6. 安装依赖
pip install -r requirements_desktop.txt
```

### 步骤 2: 创建 Windows 专用 spec 配置

创建新文件 `build_desktop_windows.spec`，内容如下：

```python
# -*- mode: python ; coding: utf-8 -*-

block_cipher = None

a = Analysis(
    ['app/desktop_launcher.py'],
    pathex=[],
    binaries=[],
    datas=[
        ('app/static', 'app/static'),
        ('data', 'data'),
    ],
    hiddenimports=[
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
        'sqlalchemy.ext.baked',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='学校成绩管理系统',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,  # 不显示控制台窗口
    disable_windowed_traceback=False,
    icon='icon.ico',  # Windows 图标（可选）
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='学校成绩管理系统',
)

# 注意: Windows 不需要 BUNDLE 配置
```

**关键修改点：**
- 移除了 macOS 的 `BUNDLE` 配置
- `console=False` 确保不显示黑色命令行窗口
- `icon='icon.ico'` 指定 Windows 图标（可选，如不需要改为 `icon=None`）

### 步骤 3: 准备 Windows 图标（可选）

如果需要自定义图标：

```bash
# 方法 1: 在线转换（推荐）
# 访问: https://convertio.co/png-ico/
# 上传你的 PNG 图片（推荐 256x256 或 512x512）
# 下载生成的 icon.ico 文件，放到项目根目录

# 方法 2: 使用 ImageMagick (如果已安装)
magick convert icon.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico
```

如果不需要图标，在 spec 文件中将 `icon='icon.ico'` 改为 `icon=None`。

### 步骤 4: 执行打包

在 Windows 上执行：

```bash
# 1. 确保虚拟环境已激活
.venv\Scripts\activate

# 2. 清理旧的构建文件（如果存在）
rmdir /s /q build dist

# 3. 执行打包
pyinstaller build_desktop_windows.spec

# 4. 打包完成后，可执行文件位于:
# dist\学校成绩管理系统\学校成绩管理系统.exe
```

### 步骤 5: 测试应用

```bash
# 直接运行测试
dist\学校成绩管理系统\学校成绩管理系统.exe

# 或者双击 dist\学校成绩管理系统\学校成绩管理系统.exe
```

**测试检查项：**
- ✅ 应用能正常启动
- ✅ 窗口正常显示
- ✅ 能访问主页面（积分管理页面）
- ✅ 数据库正常创建（在 data 目录下）
- ✅ 所有功能正常使用

### 步骤 6: 分发给用户

**方式 1: 分发整个文件夹（推荐）**
```bash
# 压缩整个目录
# 右键 dist\学校成绩管理系统 文件夹 -> 发送到 -> 压缩文件夹
# 或使用 7-Zip/WinRAR 压缩

# 用户解压后，双击 学校成绩管理系统.exe 即可运行
```

**方式 2: 打包为单文件（可选）**

如果希望打包为单个 .exe 文件，修改 spec 配置中的 `EXE` 部分：

```python
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,      # 添加这行
    a.zipfiles,      # 添加这行
    a.datas,         # 添加这行
    [],
    name='学校成绩管理系统',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    icon='icon.ico',
)

# 移除 COLLECT 部分
```

然后重新打包，会生成单个 `学校成绩管理系统.exe` 文件。

---

## ⚠️ 常见问题与解决方案

### 问题 1: pywebview 在 Windows 上的依赖

**现象：** 打包后运行报错，提示缺少 Edge WebView2 或其他组件

**解决方案：**
- 安装 Edge WebView2 Runtime（推荐）
- 下载地址: https://developer.microsoft.com/microsoft-edge/webview2/
- 安装后 pywebview 会自动使用 EdgeChromium 引擎

### 问题 2: Windows Defender 误报

**现象：** 打包的 .exe 被 Windows Defender 标记为病毒

**解决方案：**
1. 这是 PyInstaller 打包程序的常见问题
2. 可以申请代码签名证书
3. 或者告知用户添加信任例外

### 问题 3: 端口 8765 被占用

**现象：** 应用启动失败，提示端口已被占用

**解决方案：**
```bash
# 查找占用端口的进程
netstat -ano | findstr :8765

# 结束进程（替换 PID 为实际进程 ID）
taskkill /PID <进程ID> /F
```

---

## 📊 macOS vs Windows 打包对比

| 对比项 | macOS | Windows |
|--------|-------|---------|
| **打包命令** | `pyinstaller build_desktop.spec` | `pyinstaller build_desktop_windows.spec` |
| **输出格式** | `.app` 应用包 | `.exe` + 依赖文件夹 |
| **图标格式** | `.icns` | `.ico` |
| **Spec 配置** | 包含 `BUNDLE` | 不包含 `BUNDLE` |
| **分发方式** | 压缩 .app 为 .zip | 压缩整个文件夹或单文件 |
| **用户安装** | 拖到应用程序文件夹 | 解压后直接运行 .exe |
| **首次运行** | 需要在安全设置中允许 | 可能被 Defender 拦截 |

### 核心相同点

✅ **代码完全不需要修改**
- `desktop_launcher.py` 在两个平台上完全相同
- `pywebview` 会自动适配平台（macOS 用 Cocoa，Windows 用 EdgeChromium）
- 所有 Python 依赖相同

✅ **打包流程相同**
- 都使用 PyInstaller
- 都使用 spec 配置文件
- 打包命令格式相同

---

## 🎯 快速操作清单

### 在 Windows 上打包的完整命令

```bash
# 1. 环境准备
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements_desktop.txt

# 2. 创建 Windows spec 文件（见步骤 2）

# 3. 执行打包
pyinstaller build_desktop_windows.spec

# 4. 测试
dist\学校成绩管理系统\学校成绩管理系统.exe

# 5. 分发
# 压缩 dist\学校成绩管理系统 文件夹
```

---

## 🔑 关键要点

1. **代码无需修改** - `desktop_launcher.py` 已经是跨平台的
2. **只需修改 spec 配置** - 移除 macOS 的 BUNDLE 部分
3. **必须在 Windows 上打包** - PyInstaller 不支持交叉编译
4. **pywebview 自动适配** - 会使用 Windows 的 EdgeChromium 引擎

