# 魔因漫创 (moyin-creator-webui) — 项目上下文

## 项目概述
AI 驱动的动漫/短剧分镜创作工具，从 Electron 桌面版迁移到 Web UI 版 (Vite + React + TypeScript)。

## 核心能力
- 剧本分析（通过 Kuai API 调用 LLM 分析分镜）
- 生图（通过 MLL API / Kuai API 调用图片生成模型）
- 工作流编辑（分镜/提示词/参数编排）
- 存储管理（local-storage-server + 导出/导入）

## 架构
- **前端**: Vite + React 18 + TypeScript + Tailwind CSS 4 + shadcn/ui (Radix)
- **存储**: local-storage-server.mjs（HTTP 存储服务，数据存 ~/Documents/moyin-creator/data）
- **API**: Kuai API (MLL) 代理通过 Vite dev server 中间件 `/__api_proxy`
- **版本**: v0.2.3

## 近期完成工作（07-16）
- 模型选择优化：EditProviderDialog + 同步模型 + 多选列表
- 存储页面 WebUI 适配：storageManager 对接 HTTP 存储
- API 代理修复：`/__api_proxy` 中间件 + corsFetch 重写

## 已知问题
- 剧本分析 404 错误（Kuai API endpoint 格式问题，尚未完全解决）
- Kuai provider modelTags 为空（需后续修复同步 tag 数据）
- Electron 特有功能隐藏（选择目录/数据恢复/应用更新）

## 相关文件
- `Y:\OpenClaw\任务\20260714-魔因漫创WebUI化` — 项目文档/资料路径
- Cherry Studio 分发：`Y:\OpenClaw\CherryStudio\方案A-NAS远程管理`
