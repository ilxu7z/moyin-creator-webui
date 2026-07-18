# 工作日志

## 2026-07-18 15:41 — 启动项目
- 锁定项目：`/Users/chee/Projects/moyin-creator-webui`
- 焦点：moyin-creator-webui 启动与开发
- 状态：从 07-16 的 WebUI 开发会话恢复

### 启动结果 ✅
- 存储服务 (port 3002): healthz OK, 数据在 ~/Documents/moyin-creator/data/
- Vite dev server (port 5173): HTTP 200, 442ms ready
- 两个服务均已启动
- 存储有 2 个空项目目录 warning（正常，历史遗留）

## 2026-07-18 15:56 — 老板要求启动项目
- `npm run dev` 执行 → dev.mjs 端口监听检测 15s 超时（脚本 bug），但存储子进程已成功启动
- 手动确认 storage (3002) 在监听
- 独立启动 `npx vite --config vite.config.web.ts --host 0.0.0.0`，403ms 就绪
- 双服务健康检查通过 ✅
- 浏览器访问 http://localhost:5174 正常

## 2026-07-18 17:05 — 启动项目（新会话）
- 端口 3002 被旧进程占用，清理后重跑
- `npm run dev` 的 waitForPort 检测有 bug（127.0.0.1 vs 0.0.0.0 绑定差异），storage 服务实际启动成功但脚本超时报错
- 手动启动 Vite → 348ms 就绪
- 双服务健康检查通过 ✅
- 访问地址 http://localhost:5174
