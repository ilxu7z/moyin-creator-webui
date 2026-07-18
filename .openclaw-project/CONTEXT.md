# 魔因漫创 (moyin-creator-webui) — 项目上下文

## ⛔ 启动规范（Agent 必读，启动前必须看）

```
唯一启动命令: npm run dev
不在本项目目录内: cd ~/Projects/moyin-creator-webui && npm run dev

npm run dev 自动：
  1. 先启动存储服务 → 端口 3001
  2. 等待就绪后启动 Vite → 端口 5174

访问地址: http://localhost:5174

⚠️ 绝对禁止：
  - npx vite 或 npx vite --host 0.0.0.0（不启动存储服务）
  - node local-storage-server.mjs & （不包 Vite 启动）
  - 不要用后台进程 & 然后 return（exec 必须阻塞等待）
  - 不要用 lsof -i :5173 检查（5173 是其他项目）
  - 不能通过 https://192.168.3.180/chat?session=*** 访问
```

### 启动后验证

```bash
curl -s http://localhost:3001/healthz  # 存储服务 → {"status":"ok"}
curl -s -o /dev/null -w "%{http_code}" http://localhost:5174  # Vite → 200
```

### Agent 启动模板（复制粘贴执行）

```bash
cd ~/Projects/moyin-creator-webui && npm run dev
```

一个命令就够了。不要拆开，不要另起后台进程，不要先检查端口再决定做什么。

## 项目概述

AI 驱动的动漫/短剧分镜创作工具，从 Electron 桌面版迁移到 Web UI 版 (Vite + React + TypeScript)。

## 核心能力

- 剧本分析（通过 Kuai API 调用 LLM 分析分镜）
- 生图（通过 MLL API / Kuai API 调用图片生成模型）
- 工作流编辑（分镜/提示词/参数编排）
- 存储管理（local-storage-server + 导出/导入）

## 架构

- **前端**: Vite 5174 + React 18 + TypeScript + Tailwind CSS 4 + shadcn/ui (Radix)
- **存储**: local-storage-server.mjs（HTTP 存储服务，端口 3001，数据存 ~/Documents/moyin-creator/data）
- **API**: Kuai API (MLL) 代理通过 Vite dev server 中间件 `/__api_proxy`
- **版本**: v0.2.3

## 端口占用

| 端口 | 服务 | 命令 |
|------|------|------|
| **3001** | 存储服务 (local-storage-server.mjs) | node local-storage-server.mjs |
| **5174** | Vite 开发服务器 | npx vite --config vite.config.web.ts --host 0.0.0.0 |

🔴 **不要和以下端口混淆：**
| 端口 | 实际运行 | 不要碰 |
|------|---------|--------|
| 5173 | AI Marketing System（另一项目） | ❌ |
| 3000 | OpenClaw Gateway | ❌ |

## 近期完成工作（07-18）

- **存储安全加固**：5项P0修复（路径冲突检测/exists不创建目录/绝对URL改相对路径/Vite代理API/迁移flag移出_p/）
- **生命周期脚本**：npm run backup / uninstall / wipe-data
- **Agent 规范文档**：docs/Agent启动规范.md + docs/Agent故障速查表.md

## 已知问题

- 剧本分析 404 错误（Kuai API endpoint 格式问题，尚未完全解决）
- Kuai provider modelTags 为空（需后续修复同步 tag 数据）
- Electron 特有功能隐藏（选择目录/数据恢复/应用更新）
- `_p/76bacc93` 和 `_p/a4bbe260` 两个空项目目录（数据已丢失，healthz 会报告）

## 文档索引

| 文档 | 内容 |
|------|------|
| `docs/Agent启动规范.md` | ⛔ Agent 强制启动规范 |
| `docs/Agent故障速查表.md` | 症状→验证→修复 |
| `docs/存储安全设计.md` | 架构参考 |
| `docs/开发指南.md` | 全生命周期操作 |

## 相关文件

- `Y:\OpenClaw\任务\20260714-魔因漫创WebUI化` — 项目文档/资料路径
- Cherry Studio 分发：`Y:\OpenClaw\CherryStudio\方案A-NAS远程管理`
