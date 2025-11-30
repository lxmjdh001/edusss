#!/bin/bash

# 成绩管理系统服务器重启脚本

echo "🔍 检查8010端口..."
PID=$(lsof -ti:8010)

if [ ! -z "$PID" ]; then
    echo "⚠️  发现进程 $PID 占用8010端口，正在关闭..."
    kill -9 $PID
    sleep 1
    echo "✅ 旧进程已关闭"
else
    echo "✅ 8010端口未被占用"
fi

echo "🚀 启动服务器..."
cd /Users/chaoteng/Desktop/7c/edu
source .venv/bin/activate
nohup python -m uvicorn app.main:app --host 127.0.0.1 --port 8010 > uvicorn.log 2>&1 &

sleep 2

# 检查服务器是否启动成功
if curl -s http://localhost:8010/healthz > /dev/null 2>&1; then
    echo "✅ 服务器启动成功！"
    echo "📊 成绩管理系统: http://localhost:8010/static/grades.html"
    echo "🎮 积分系统: http://localhost:8010/static/points.html"
else
    echo "❌ 服务器启动失败，请检查日志: tail -20 uvicorn.log"
fi
