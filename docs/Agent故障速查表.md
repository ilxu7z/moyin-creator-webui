# Agent 故障速查表

> 面向 Agent 的快速诊断手册。每项按症状→原因→修复的顺序。

## 1. 数据丢失

### 症状：用户项目数据消失，刷新后不恢复

| 可能原因 | 验证方法 | 修复 |
|---------|---------|------|
| 存储服务未启动或已死 | `lsof -i :3001` 无输出 | `npm run dev` 重启 |
| Vite proxy 未配置 `/api/storage` | `curl http://localhost:5174/api/storage/_migrated/exists` | 检查 `vite.config.web.ts` 的 `server.proxy` |
| 数据目录被删 | `ls ~/Documents/moyin-creator/data/_p/` | 从备份恢复或重建 |
| 反向代理未转发存储请求 | F12 控制台有 `[Storage] SET` 错误 | 用 `localhost:5174` 直连 |
| 空壳覆盖（已修复） | `ls -la _p/{pid}/` 下文件 <50B | 不可恢复 |

### 症状：两个空项目目录（76bacc93, a4bbe260）

- 原因：E2 bug 在存储安全加固前已将数据覆盖为空壳
- 状态：不可恢复。Healthz 会持续报告作为提醒
- 处理：可以删除这两个空目录，不影响其他项目

## 2. 服务异常

### 症状：端口冲突

```bash
lsof -i :3001  # 看 PID 和命令名
lsof -i :5174
```

- 如果 PID 是 node → `kill <PID>`
- 如果 `npm run dev` 报 `EADDRINUSE` → 同上
- 杀掉后等 1 秒，`npm run dev`

### 症状：Vite 报 502/504

- 存储服务可能刚被 kill 或挂了
- `lsof -i :3001` 确认存储服务状态
- 如果存储服务跑了但 502 → 看终端日志，可能是路径冲突

### 症状：Vite hot reload 不工作

- 确认通过 `localhost:5174` 访问，不是通过反向代理
- 反向代理可能不转发 WebSocket（HMR 需要 WS）

## 3. API 异常

### 症状：存储 API 返回 Not Found

```bash
# 直接测试存储服务
curl http://localhost:3001/healthz
# 预期：{"status":"ok","dataDir":"...","dataWritable":true}

# 通过 Vite proxy 测试
curl http://localhost:5174/api/storage/_migrated/exists
# 预期：{"exists":true}
```

- 如果 3001 正常但 5174 返回 Not Found → Vite proxy 没配 `/api/storage`
- 如果 3001 就不通 → 存储服务没启动

### 症状：Healthz 报告 warnings

```json
{
  "warnings": [
    "Empty per-project directories",
    "_p/_migrated directory conflict"
  ]
}
```

- 空项目目录 → 数据已丢失，可删除空目录
- `_p/_migrated` 冲突 → `rm -rf ~/Documents/moyin-creator/data/_p/_migrated/`

## 4. 网络场景

### 场景：用户通过 `https://192.168.3.180/chat?session=***` 访问

- OpenClaw Gateway 代理了 Vite
- 存储请求走相对路径 `/api/storage` → 经过 Gateway 时，Gateway 需要转发到 Vite
- 如果 F12 控制台有 CORS 错误或 `[Storage] SET failed: 404`：
  - 原因：Gateway 未转发 `/api/storage` 
  - 解决：让用户用 `http://localhost:5174` 或给 Gateway 配反代规则
