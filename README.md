# 魔因漫创 WebUI

AI 驱动的动漫/短剧分镜创作工具 — 浏览器版

## 快速启动

```bash
npm run dev
```

一键启动本地存储服务 + Vite 开发服务器，浏览器打开 **http://localhost:5174**

## 开发脚本

| 命令 | 作用 |
|------|------|
| `npm run dev` | 一键启动：存储服务(3001) + Vite(5174) |
| `npm run storage` | 仅启动存储服务 |
| `npm run dev:web` | 仅启动 Vite |
| `npm run build` | 生产构建 |
| `npm run preview` | 预览生产构建 |

## 架构

| 服务 | 端口 | 说明 |
|------|------|------|
| `local-storage-server.mjs` | 3001 | 数据持久化到 `~/Documents/moyin-creator/data/` |
| Vite 开发服务器 | 5174 | 前端热更新 + 反向代理 |

### 数据安全规则

- **必须先启动存储服务再操作数据**（`npm run dev` 自动保证顺序）
- 数据备份：`~/Documents/moyin-creator/data/`
- 三层写入保护：pid-null 拦截 / 大小安全门槛 / force-refresh 替代 null 切换

## 详细文档

- [工作流教程](docs/WORKFLOW_GUIDE.md)
- [开发指南（含故障排查）](docs/开发指南.md)
- [分镜格式说明](docs/SCRIPT_FORMAT_EXAMPLE.md)
