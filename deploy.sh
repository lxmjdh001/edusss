#!/bin/bash

# 部署脚本 - 用于生产环境部署
# 执行方式: bash deploy.sh

set -e  # 遇到错误立即退出

echo "========================================"
echo "开始部署教育管理系统"
echo "========================================"

# 检查虚拟环境
if [ ! -d ".venv" ]; then
    echo "✗ 虚拟环境不存在，请先创建虚拟环境"
    echo "  python3 -m venv .venv"
    exit 1
fi

echo ""
echo "步骤 1/4: 激活虚拟环境并安装依赖..."
echo "----------------------------------------"
source .venv/bin/activate
pip install -r requirements.txt

echo ""
echo "步骤 2/4: 运行数据库迁移..."
echo "----------------------------------------"
python migrate_sessions_table.py

echo ""
echo "步骤 3/4: 初始化管理员账号..."
echo "----------------------------------------"
python init_admin_account.py

echo ""
echo "步骤 4/4: 检查数据库..."
echo "----------------------------------------"
if [ -f "data/grade_manager.db" ]; then
    echo "✓ 数据库文件存在"
else
    echo "✗ 数据库文件不存在"
fi

echo ""
echo "========================================"
echo "部署完成！"
echo "========================================"
echo ""
echo "启动服务："
echo "  .venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8010"
echo ""
echo "使用 systemd 重启服务："
echo "  sudo systemctl restart edusss"
echo "  sudo systemctl status edusss"
echo ""
