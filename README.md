# 魔因漫创 WebUI

AI 驱动的动漫/短剧分镜创作工具 — 浏览器版

## 快速启动

```bash
npm run dev
```

一键启动本地存储服务 + Vite 开发服务器，浏览器打开 **http://localhost:5174**

## 全部脚本

| 命令 | 作用 | 删数据？ |
|------|------|---------|
| `npm run dev` | 一键启动：存储服务(3001) + Vite(5174) | ❌ |
| `npm run storage` | 仅启动存储服务 | ❌ |
| `npm run dev:web` | 仅启动 Vite | ❌ |
| `npm run build` | 生产构建 | ❌ |
| `npm run preview` | 预览生产构建 | ❌ |
| `npm run backup` | 备份数据 | ❌ |
| `npm run uninstall` | 卸载程序，保留数据 | ❌ |
| `npm run wipe-data` | ⛔ 删除所有数据（三重确认） | ⚠️ |

## 架构

| 服务 | 端口 | 说明 | 数据 |
|------|------|------|------|
| `local-storage-server.mjs` | 3001 | 数据持久化 | `~/Documents/moyin-creator/data/` |
| Vite 开发服务器 | 5174 | 前端热更新 + 反向代理 | 无 |

### 数据安全

- 数据与代码**物理隔离**：删代码不影响数据
- 三层写入保护：pid-null 拦截 / 大小安全门槛 / force-refresh
- 卸载重装：`npm run uninstall` → `git clone` → `npm install` → 数据无损

## 文档

| 文档 | 内容 |
|------|------|
| [开发指南](docs/开发指南.md) | 启动、卸载、重装、备份、删数据全生命周期 |
| [存储安全设计](docs/存储安全设计.md) | 数据目录结构、API 规范、三层防护、重装检查清单 |
| [工作流教程](docs/WORKFLOW_GUIDE.md) | AI 分镜创作流程 |
| [分镜格式说明](docs/SCRIPT_FORMAT_EXAMPLE.md) | 剧本/分镜数据格式 |
