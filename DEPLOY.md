# 生产环境部署指南

## 快速部署

在服务器上执行以下命令：

```bash
# 1. 进入项目目录
cd /www/wwwroot/test.xxzlz.com/edusss

# 2. 拉取最新代码
git pull

# 3. 激活虚拟环境并安装依赖
source .venv/bin/activate
pip install -r requirements.txt

# 4. 运行数据库迁移
python migrate_sessions_table.py

# 5. 初始化管理员账号（如果还没有）
python init_admin_account.py

# 6. 重启服务
sudo systemctl restart edusss
sudo systemctl status edusss
```

## 或者使用一键部署脚本

```bash
bash deploy.sh
sudo systemctl restart edusss
```

## 新增依赖项

本次更新添加了以下依赖：

- `bcrypt>=4.0.1` - 密码加密
- `python-multipart>=0.0.6` - 文件上传支持
- `python-dateutil>=2.8.2` - 日期处理

## 数据库变更

新增 `sessions` 表用于管理用户登录会话。

## 管理员账号

- 用户名: `ddjia2022`
- 密码: `ddjia2022`
- VIP等级: 3 (管理员)
- 有效期: 永久

## 故障排查

### 服务启动失败

1. 检查依赖是否安装完整：
```bash
source .venv/bin/activate
pip list | grep bcrypt
```

2. 检查数据库表是否创建：
```bash
sqlite3 data/grade_manager.db "SELECT name FROM sqlite_master WHERE type='table' AND name='sessions';"
```

3. 查看详细错误日志：
```bash
sudo journalctl -u edusss -n 50 --no-pager
```

### Python 模块导入错误

确保在虚拟环境中安装依赖：
```bash
source .venv/bin/activate
pip install --upgrade -r requirements.txt
```
