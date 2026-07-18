# 开发者指南 · Agent 启动规范

> **此文件面向任何接手本项目的 Agent（人工智能助手）**
> 
> 禁止凭经验猜测启动方式。必须按本文档执行。

## ⛔ 启动铁律（Agent 必须遵守）

### 1. 唯一启动命令

```bash
npm run dev
```

**不允许**以下任何方式启动：

| ❌ 禁止 | 原因 |
|---------|------|
| `npx vite` 或 `npx vite --host 0.0.0.0` | 不会启动存储服务，数据写入会静默失败 |
| `npm run storage` 然后 `npm run dev:web`（分两步） | 顺序错误时 Vite 先启、存储后启 → 前端连不上存储 |
| 手动 `node local-storage-server.mjs & npx vite` | 同上，无错误处理 |
| 用 OpenClaw Gateway 代理 Vite 但不代理 `/api/storage` | 之前已引起数据丢失事故 |

### 2. 启动前检查

```bash
lsof -i :3001  # 存储服务是否已在运行
lsof -i :5174  # Vite 是否已在运行
```

- 如果二者都在运行 → 直接访问 `http://localhost:5174`，无需重启
- 如果只有 3001 在运行 → `npm run dev:web` 启动 Vite
- 如果只有 5174 在运行 → 杀掉后 `npm run dev`
- 如果都不在 → `npm run dev`

### 3. 访问地址

| 场景 | 地址 | 打包成链接 |
|------|------|-----------|
| 本机浏览器 | `http://localhost:5174` | 可以用 `open http://localhost:5174` |
| 局域网其他设备 | `http://192.168.3.180:5174` | 发给用户时用这个 |
| 给用户发 WebChat 内嵌 | ⛔ **禁止！** Vite JS module / HMR / API 均不通，会报"应用初始化失败" | 用浏览器直连 |

### 4. 杀掉进程的正确方式

```bash
# 杀掉存储服务
kill $(lsof -ti :3001)

# 杀掉 Vite
kill $(lsof -ti :5174)
```

⚠️ `pkill node` 是危险的——会误杀 OpenClaw Gateway 等其他 node 进程。

### 5. 数据安全防护

| 规则 | 说明 |
|------|------|
| **绝不** `rm -rf ~/Documents/moyin-creator/` | 用户全部项目数据在此 |
| **绝不**在存储服务未就绪时操作数据 | `lsof -i :3001` 必须有 node 监听 |
| 删项目数据走脚本 | `npm run wipe-data`（三重确认） |
| 如需卸载重装 | `npm run uninstall` → `git clone` → `npm install` |
| 备份数据 | `npm run backup` |

### 6. 故障速查

见 [Agent 故障速查表](./Agent%E6%95%85%E9%9A%9C%E9%80%9F%E6%9F%A5%E8%A1%A8.md)

---

## 给人类用户的快速参考

| 操作 | 命令 |
|------|------|
| 启动 | `npm run dev` |
| 备份 | `npm run backup` |
| 卸载（保留数据） | `npm run uninstall` |
| 删数据 | `npm run wipe-data` |
| 重新安装 | `git clone ... && npm install && npm run dev` |
