# 魔因漫创 WebUI

AI 驱动的动漫/短剧分镜创作工具 — 浏览器版

## ⛔ 启动（Agent 不可绕过）

```bash
cd ~/Projects/moyin-creator-webui && npm run dev
```

> **不要**用任何其他方式启动。
> 不要执行 start-web.sh（**旧版，端口写死 5173，已删除**）。
> 不要分步启动（先 storage 再 dev:web）。
> 不要用 nohup 或 & 后台。

浏览器打开 **http://localhost:5174**

验证：
```bash
curl -s http://localhost:3001/healthz  # → {"status":"ok"}
curl -s -o /dev/null -w "%{http_code}" http://localhost:5174  # → 200
```

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
- 存储 API 客户端有错误检测：网络不通/404 时控制台会输出 `[Storage]` 日志

#### 访问方式与存储服务连接

| 浏览器地址 | 存储连接 | 是否正常 |
|-----------|---------|---------|
| `http://localhost:5174` | `http://localhost:3001` | ✅ Vite dev 直连 |
| `http://192.168.3.180:5174` | `http://192.168.3.180:3001` | ✅ 局域网访问 |
| `https://192.168.3.180/chat?session=...` | `https://192.168.3.180`（同源） | ⚠️ 需反向代理转发 `/api/storage` → `localhost:3001` |

> ⚠️ 通过反向代理（如 OpenClaw Gateway）访问时，若代理未转发 `/api/storage` 路由到 `localhost:3001`，数据写入会**静默失败**。检查 F12 控制台是否有 `[Storage]` 错误日志。

## 文档

| 文档 | 内容 | 读者 |
|------|------|------|
| [Agent 启动规范](docs/Agent启动规范.md) | ⛔ 启动铁律、访问方式、数据安全 | **Agent 必读** |
| [Agent 故障速查表](docs/Agent故障速查表.md) | 数据丢失/服务异常/API异常/网络场景 | **Agent 排查** |
| [开发指南](docs/开发指南.md) | 启动、卸载、重装、备份、删数据 | 开发者 |
| [存储安全设计](docs/存储安全设计.md) | 数据目录结构、API 规范、三层防护 | 架构参考 |
| [工作流教程](docs/WORKFLOW_GUIDE.md) | AI 分镜创作流程 | 用户 |
| [分镜格式说明](docs/SCRIPT_FORMAT_EXAMPLE.md) | 剧本/分镜数据格式 | 开发者 |
