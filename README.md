# HuTu

Hu = 胡，Tu = Tool。本地运行的个人工具箱，无需访问国外网站。

## 功能

- **工具首页**：分类导航 + 工具卡片
- **Dict to JSON**：Python 字典转 JSON
- **Request Local**：线上 curl 转本地请求，支持端口映射、发送历史
- **IP 查询**：跳转第三方 IP 查询站点
- **管理后台**：配置工具卡片（Logo、标题、简介、跳转地址、分类）

## 环境要求

- Python 3.10+

## 快速开始

```bash
cd HuTu

# 首次运行：复制并修改管理员配置
cp admin_config.example.json admin_config.json

# 启动服务
python3 server.py
```

浏览器访问：

- 首页：http://127.0.0.1:8765
- 管理后台：http://127.0.0.1:8765/admin/

默认管理员账号见 `admin_config.example.json`，请务必修改密码和 `secret`。

## 项目结构

```
HuTu/
├── server.py              # HTTP 服务入口
├── curl_utils.py          # curl 解析与请求转发
├── tools.json             # 工具与分类配置
├── admin_config.json      # 管理员凭据（本地，不入库）
├── index.html             # 首页
├── admin/                 # 管理后台页面
├── static/                # CSS / JS
└── tools/                 # 各工具页面
    ├── dict-to-json/
    └── request-local/
```

## 添加新工具

1. 在 `tools.json` 中注册工具
2. 本地工具：在 `tools/` 下创建页面
3. 外链工具：`jump_to` 填写完整 URL
4. 需后端 API：在 `server.py` 中添加路由

也可通过管理后台可视化配置外链类工具。

## License

Private / personal use.
