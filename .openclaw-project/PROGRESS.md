# 进展追踪

## 问题与修复

### ✅ 剧本分析 404 — 已确认修复
Kuai API 正常，`callChatAPI` fallback 逻辑已完备。

### ✅ modelTags 同步 — 已完成
3 文件修改，非 MemeFast provider 同步后写入推断的 metadata。

### ✅ 视频生成 "Unsupported image data format" — 已修复（2026-07-21）
**根因**: WebUI 中图片持久化路径 `/api/images/...` 不被 `isHttpImageUrl` 识别，导致路径作为原始字符串传递给图床上传器（web-shim），触发 `Unsupported image data format` 错误。

**修复（3 文件）**:
1. `src/lib/image-storage.ts`: `readImageAsBase64` 增加 `/api/images/` 和 `local-image://`(WebUI fallback) 支持
2. `src/components/panels/director/split-scenes.tsx`: 内部 `convertToHttpUrl` 增加 `/api/images/` 处理
3. `src/components/panels/director/use-video-generation.ts`: 公共 `convertToHttpUrl` 增加 `/api/images/` 处理

### 待验证
- [ ] 浏览器中实际点击"生成视频"按钮，确认不再报错
- [ ] 确认图片成功上传到 Catbox 图床
- [ ] 确认视频生成 API 正常调用
