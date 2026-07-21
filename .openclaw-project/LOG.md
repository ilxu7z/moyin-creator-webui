# 工作日志

## 2026-07-21

### 13:40 视频生成 "Unsupported image data format" 修复

**问题**: AI 导演面板"生成视频"按钮报错 `分镜 1 生成失败: Unsupported image data format`

**根因**: WebUI 中 `image-storage.ts` 的 `saveImageToLocal` 将图片保存到 HTTP 存储服务器，返回路径格式为 `/api/images/scenes/xxx.png`。这个路径既不是 `http(s)://` 开头（不被 `isHttpImageUrl` 识别），也不是 `local-image://` 格式（只在 Electron 中可用）。当 `convertToHttpUrl` 尝试将此路径上传到 Catbox 图床时，`web-shim.ts` 的 `upload` 函数中 `payloadType === 'file'` 分支无法识别 `/` 开头的路径，返回 `Unsupported image data format` 错误。

**修复（3 文件）**:
1. `src/lib/image-storage.ts` — `readImageAsBase64`:
   - 增加 `/api/images/` 路径的 fetch+转换支持
   - 增加 `local-image://` 在 WebUI 中的 fallback（尝试通过 `/api/images/file/` 读取）
2. `src/components/panels/director/split-scenes.tsx` — 内部 `convertToHttpUrl`:
   - 增加 `/api/images/` 前缀的处理，在上传前先转为 base64
3. `src/components/panels/director/use-video-generation.ts` — 公共 `convertToHttpUrl`:
   - 同上，确保 S 级面板也受益于修复

**TypeScript 检查**: 修改文件无新增类型错误。

### 13:00 modelTags 同步 + 剧本分析 404 排查

**modelTags 同步**（3 文件修改）:
- `src/lib/api-key-manager.ts`: 新增 `inferModelMetadataFromCaps` 函数
- `src/stores/api-config-store.ts`: `syncProviderModels` 对非 MemeFast provider 写入推断元数据
- `src/components/api-manager/EditProviderDialog.tsx`: 评分逻辑 fallback

**剧本分析 404**: 排查后确认已修复，Kuai API 正常。
