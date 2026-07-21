// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// src/lib/web-shim.ts
// 浏览器运行时注入，mock Electron 特有 API，使前端代码可在纯浏览器中运行

// 版本号：由 Vite define 注入，或在构建时替换
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.2.3';
// 
// WebUI 版数据持久化策略：
//   fileStorage → 通过 HTTP API 写入本地文件系统 (local-storage-server.mjs)
//   所有数据保存在 ~/Documents/moyin-creator/data/ 下
//   换电脑、换浏览器、清缓存均不受影响

// ==================== 本地存储 API 客户端 ====================

// 存储服务基地址：统一走 Vite 同源代理，无论从何处访问都安全
//
// 核心原则：不使用绝对 URL，改用相对路径 /api/storage
// Vite 的 server.proxy 已将 /api/storage → localhost:3002
// 所以不管浏览器从哪入口，请求都会经过 Vite → 存储服务，不丢数据。
//
// - localhost:5174       → fetch('/api/storage/...') → Vite proxy → :3002
// - 192.168.3.180:5174   → 同上
// - https://IP/chat?...   → 同上（请求到 Vite 后转 proxy）
// - 生产环境 Nginx       → Nginx 需配 /api/storage 转 :3002
function resolveStorageBase(): string {
  // 默认：相对路径，走 Vite proxy → localhost:3002
  // 所有入口（localhost/lan/Gateway）统一走 Vite server.proxy
  return '';
}

const STORAGE_API_BASE = resolveStorageBase();

console.log('[Web Shim] Storage API base:', STORAGE_API_BASE || '(relative — Vite proxy)', '| from:', typeof window !== 'undefined' ? window.location.href : 'SSR');

async function apiGet(key: string): Promise<string | null> {
  try {
    const res = await fetch(`${STORAGE_API_BASE}/api/storage/${encodeURIComponent(key)}`);
    if (!res.ok) {
      console.error(`[Storage] GET ${key} failed: ${res.status} ${res.statusText}`);
      return null;
    }
    const data = await res.json();
    if (!data.success) {
      console.error(`[Storage] GET ${key} error:`, data.error);
      return null;
    }
    return data.value ?? null;
  } catch (err) {
    console.error(`[Storage] GET ${key} network error:`, err);
    return null;
  }
}

async function apiSet(key: string, value: string): Promise<boolean> {
  try {
    const res = await fetch(`${STORAGE_API_BASE}/api/storage/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
    if (!res.ok) {
      console.error(`[Storage] SET ${key} failed: ${res.status} ${res.statusText}`);
      return false;
    }
    const data = await res.json();
    if (!data.success) {
      console.error(`[Storage] SET ${key} error:`, data.error);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[Storage] SET ${key} network error:`, err);
    return false;
  }
}

async function apiRemove(key: string): Promise<boolean> {
  try {
    const res = await fetch(`${STORAGE_API_BASE}/api/storage/${encodeURIComponent(key)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      console.error(`[Storage] DELETE ${key} failed: ${res.status} ${res.statusText}`);
      return false;
    }
    const data = await res.json();
    return data.success === true;
  } catch (err) {
    console.error(`[Storage] DELETE ${key} network error:`, err);
    return false;
  }
}

async function apiExists(key: string): Promise<boolean> {
  try {
    const res = await fetch(`${STORAGE_API_BASE}/api/storage/${encodeURIComponent(key)}/exists`);
    if (!res.ok) {
      console.error(`[Storage] EXISTS ${key} failed: ${res.status} ${res.statusText}`);
      return false;
    }
    const data = await res.json();
    return data.exists === true;
  } catch (err) {
    console.error(`[Storage] EXISTS ${key} network error:`, err);
    return false;
  }
}

async function apiListKeys(prefix: string): Promise<string[]> {
  try {
    const res = await fetch(`${STORAGE_API_BASE}/api/storage/keys/${encodeURIComponent(prefix)}`);
    if (!res.ok) {
      console.error(`[Storage] KEYS ${prefix} failed: ${res.status} ${res.statusText}`);
      return [];
    }
    const data = await res.json();
    return data.keys || [];
  } catch (err) {
    console.error(`[Storage] KEYS ${prefix} network error:`, err);
    return [];
  }
}

async function apiListDirs(prefix: string): Promise<string[]> {
  try {
    const allKeys = await apiListKeys(prefix);
    const dirs = new Set<string>();
    for (const k of allKeys) {
      let rest = k.slice(prefix.length);
      // 去掉开头可能有的 /
      if (rest.startsWith('/')) rest = rest.slice(1);
      const slashIdx = rest.indexOf('/');
      if (slashIdx !== -1) {
        dirs.add(rest.slice(0, slashIdx));
      }
    }
    return Array.from(dirs);
  } catch (err) {
    console.error(`[Storage] LISTDIRS ${prefix} error:`, err);
    return [];
  }
}

async function apiRemoveDir(prefix: string): Promise<boolean> {
  try {
    const res = await fetch(`${STORAGE_API_BASE}/api/storage/dir/${encodeURIComponent(prefix)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      console.error(`[Storage] REMOVEDIR ${prefix} failed: ${res.status} ${res.statusText}`);
      return false;
    }
    const data = await res.json();
    return data.success === true;
  } catch (err) {
    console.error(`[Storage] REMOVEDIR ${prefix} network error:`, err);
    return false;
  }
}

// ==================== fileStorage 实现 ====================

type IDBFileStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<boolean>;
  removeItem: (key: string) => Promise<boolean>;
  exists: (key: string) => Promise<boolean>;
  listKeys: (prefix: string) => Promise<string[]>;
  listDirs: (prefix: string) => Promise<string[]>;
  removeDir: (prefix: string) => Promise<boolean>;
};

/** 创建基于本地 HTTP API 的 fileStorage */
function createRemoteFileStorage(): IDBFileStorage {
  return {
    getItem: apiGet,
    setItem: apiSet,
    removeItem: apiRemove,
    exists: apiExists,
    listKeys: apiListKeys,
    listDirs: apiListDirs,
    removeDir: apiRemoveDir,
  };
}

/** 将图片路径转为 data URL（替代 Electron 的本地文件读取） */
async function resolveImageToDataURL(imagePath: string): Promise<string | null> {
  if (imagePath.startsWith('data:')) return imagePath;
  if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
    try {
      const res = await fetch(imagePath);
      const blob = await res.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  }
  return null;
}

/** 下载图片为 Blob */
async function resolveImageToBlob(imagePath: string): Promise<Blob | null> {
  if (imagePath.startsWith('data:')) {
    const res = await fetch(imagePath);
    return res.blob();
  }
  if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
    try {
      const res = await fetch(imagePath);
      if (!res.ok) return null;
      return res.blob();
    } catch {
      return null;
    }
  }
  return null;
}

/** Blob 转 base64 */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/** 生成随机图片文件名 */
function generateImageFilename(): string {
  return `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
}

/** 初始化并注入所有 Web Shim */
export async function installWebShims(): Promise<void> {
  // 1. ipcRenderer — 移除
  (window as any).ipcRenderer = null;

  // 2. fileStorage — 本地 HTTP API（数据存到硬盘）
  const fs = createRemoteFileStorage();
  (window as any).fileStorage = fs;

  // 3. imageStorage — 图片保存到本地存储服务器，跨浏览器可见
  (window as any).imageStorage = {
    saveImage: async (url: string, category: string, filename: string) => {
      try {
        // 下载图片到本地存储服务器
        const imageBlob = await resolveImageToBlob(url);
        if (!imageBlob) {
          // 无法下载（可能是 data URL 或本地路径），直接返回原始 URL
          console.warn('[Web Shim] Cannot download image, storing URL as-is:', url.substring(0, 80));
          return { success: true, localPath: url };
        }
        const base64 = await blobToBase64(imageBlob);
        const mime = imageBlob.type || 'image/png';
        const key = `images/${category}/${filename || generateImageFilename()}`;
        const storageValue = JSON.stringify({ data: base64, mime, savedAt: Date.now() });
        await apiSet(key, storageValue);
        // 返回可访问的本地 URL（通过本地存储服务器提供）
        const localUrl = `${STORAGE_API_BASE}/api/storage/${encodeURIComponent(key)}/raw`;
        console.log('[Web Shim] Image saved:', key, '→', localUrl.substring(0, 60));
        return { success: true, localPath: localUrl };
      } catch (err) {
        console.error('[Web Shim] saveImage error:', err);
        return { success: true, localPath: url }; // fallback to original URL
      }
    },
    getImagePath: async (localPath: string) => {
      if (localPath.startsWith('local-image://') || localPath.startsWith('file://')) {
        return null;
      }
      return localPath;
    },
    deleteImage: async () => true,
    readAsBase64: async (imagePath: string) => {
      const dataUrl = await resolveImageToDataURL(imagePath);
      if (dataUrl) {
        const mime = dataUrl.split(';')[0].split(':')[1] || 'image/png';
        return { success: true, base64: dataUrl, mimeType: mime };
      }
      return { success: false, error: 'Cannot resolve image path in browser' };
    },
    getAbsolutePath: async () => null,
  };

  // 4. storageManager — WebUI 真实实现，对接 HTTP 存储服务
  (window as any).storageManager = {
    getPaths: async () => ({
      basePath: '~/Documents/moyin-creator/data',
      dataPath: '/Users/chee/Documents/moyin-creator/data',
      cachePath: '/Users/chee/Documents/moyin-creator/data/cache',
    }),
    selectDirectory: async () => null,
    getCacheSize: async () => {
      try {
        const keys = await apiListKeys('cache/');
        let total = 0;
        for (const k of keys.slice(0, 50)) {
          const val = await apiGet(k);
          if (val) total += new Blob([val]).size;
        }
        return total;
      } catch { return 0; }
    },
    clearCache: async () => {
      try {
        // 清除 IndexedDB（zustand persist 缓存）
        try {
          const dbs = await indexedDB.databases();
          for (const db of dbs) {
            if (db.name) indexedDB.deleteDatabase(db.name);
          }
        } catch { /* empty */ }
        // 清除 localStorage
        const keysToRemove = Object.keys(localStorage).filter(k =>
          k.startsWith('moyin-') || k.includes('store')
        );
        keysToRemove.forEach(k => localStorage.removeItem(k));
        return true;
      } catch { return false; }
    },
    updateConfig: async (_config: unknown) => true,
    validateDataDir: async () => ({ valid: true }),
    moveData: async () => true,
    linkData: async () => true,
    exportData: async (_dir: string | null) => {
      try {
        const allKeys = await apiListKeys('');
        const exportData: Record<string, string> = {};
        for (const k of allKeys.slice(0, 200)) {
          const val = await apiGet(k);
          if (val) exportData[k] = val;
        }
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'moyin-export-' + new Date().toISOString().slice(0, 10) + '.json';
        a.click();
        URL.revokeObjectURL(url);
        return { success: true };
      } catch { return { success: false, error: '导出失败' }; }
    },
    importData: async () => {
      return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async () => {
          const file = input.files?.[0];
          if (!file) { resolve({ success: false, error: 'No file' }); return; }
          try {
            const text = await file.text();
            const data = JSON.parse(text);
            let count = 0;
            for (const [k, v] of Object.entries(data)) {
              if (typeof v === 'string') {
                await apiSet(k, v);
                count++;
              }
            }
            const keysToRemove = Object.keys(localStorage).filter(k =>
              k.startsWith('moyin-') || k.includes('store')
            );
            keysToRemove.forEach(k => localStorage.removeItem(k));
            try {
              const dbs = await indexedDB.databases();
              for (const db of dbs) {
                if (db.name) indexedDB.deleteDatabase(db.name);
              }
            } catch { /* empty */ }
            resolve({ success: true, path: `已导入 ${count} 条数据` });
          } catch (e) {
            resolve({ success: false, error: `导入失败: ${e}` });
          }
        };
        input.click();
      });
    },
  };

  // 5. appUpdater — mock（WebUI 不需要自动更新）
  (window as any).appUpdater = {
    getCurrentVersion: async () => APP_VERSION,
    checkForUpdates: async () => ({ hasUpdate: false, message: 'Web版无需检查更新' }),
    openExternalLink: async (url: string) => {
      window.open(url, '_blank');
      return { success: true };
    },
  };

  // 6. imageHostUploader — 通过 Vite 代理转发（绕过 CORS 限制）
  (window as any).imageHostUploader = {
    upload: async (payload: {
      provider: {
        baseUrl?: string;
        uploadPath?: string;
        imageField?: string;
        apiKeyFormField?: string;
        apiKeyParam?: string;
        apiKeyHeader?: string;
        staticFormFields?: Record<string, string>;
        responseUrlField?: string;
        imagePayloadType?: string;
        expirationParam?: string;
        nameField?: string;
      };
      apiKey: string;
      imageData: string;
      options?: { name?: string; expiration?: number };
    }) => {
      // Build the upload URL from baseUrl + uploadPath
      const baseUrl = (payload.provider.baseUrl || '').trim().replace(/\/*$/, '');
      const uploadPath = (payload.provider.uploadPath || '').trim();
      let uploadUrl: string;
      if (uploadPath.startsWith('http')) {
        uploadUrl = uploadPath;
      } else {
        uploadUrl = baseUrl + (uploadPath.startsWith('/') ? uploadPath : '/' + uploadPath);
      }

      if (!uploadUrl) {
        return { success: false, error: '图床上传地址未配置' };
      }

      // Prepare image data
      let blob: Blob;
      const payloadType = payload.provider.imagePayloadType || 'file';
      if (payloadType === 'file') {
        // Try to convert to a fetchable URL first
        let fetchableUrl: string | null = null;
        if (payload.imageData.startsWith('data:') || payload.imageData.startsWith('http')) {
          fetchableUrl = payload.imageData;
        } else if (payload.imageData.startsWith('/api/images/') || payload.imageData.startsWith('/')) {
          // Same-origin relative path - fetch directly
          fetchableUrl = payload.imageData;
        } else if (payload.imageData.startsWith('local-image://')) {
          // Try to resolve via /api/images/file/
          const localPath = payload.imageData.replace('local-image://', '');
          fetchableUrl = `/api/images/file/${encodeURIComponent(localPath)}`;
        }

        if (fetchableUrl) {
          try {
            const res = await fetch(fetchableUrl);
            if (res.ok) {
              blob = await res.blob();
            } else {
              return { success: false, error: `无法获取图片: HTTP ${res.status}` };
            }
          } catch {
            return { success: false, error: '无法获取图片: 网络请求失败' };
          }
        } else {
          return { success: false, error: 'Unsupported image data format' };
        }
      } else {
        // base64 payload
        blob = new Blob([payload.imageData], { type: 'image/png' });
      }

      // Build upload params
      const url = new URL(uploadUrl);
      if (payload.provider.apiKeyParam && payload.apiKey) {
        url.searchParams.set(payload.provider.apiKeyParam, payload.apiKey);
      }
      if (payload.provider.expirationParam && payload.options?.expiration) {
        url.searchParams.set(payload.provider.expirationParam, String(payload.options.expiration));
      }

      const formData = new FormData();
      const fieldName = payload.provider.imageField || 'image';
      formData.append(fieldName, blob, (payload.options?.name || 'upload') + '.png');

      if (payload.provider.apiKeyFormField && payload.apiKey) {
        formData.append(payload.provider.apiKeyFormField, payload.apiKey);
      }
      if (payload.provider.staticFormFields) {
        for (const [k, v] of Object.entries(payload.provider.staticFormFields)) {
          formData.append(k, v);
        }
      }
      if (payload.options?.name && payload.provider.nameField) {
        formData.append(payload.provider.nameField, payload.options.name);
      }

      const headers: Record<string, string> = {
        Accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
      };
      if (payload.provider.apiKeyHeader && payload.apiKey) {
        headers[payload.provider.apiKeyHeader] = payload.apiKey;
      }

      // Use CORS proxy (__api_proxy) in dev mode, direct in production
      const { corsFetch } = await import('./cors-fetch');
      const res = await corsFetch(url.toString(), { method: 'POST', headers, body: formData });

      const text = await res.text();
      let data: any = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = null; }

      if (!res.ok) {
        const errMsg = data?.error || data?.message || text || `HTTP ${res.status}`;
        return { success: false, error: `图床上传失败：${errMsg}` };
      }

      const urlField = payload.provider.responseUrlField || 'url';
      const resultUrl = data?.[urlField] || data?.data?.link || data?.url || data?.image?.url;

      // Catbox returns plain text URL directly
      const trimmedText = text.trim();
      if (!resultUrl && trimmedText.startsWith('http')) {
        return { success: true, url: trimmedText };
      }

      if (resultUrl) {
        return { success: true, url: typeof resultUrl === 'string' ? resultUrl : String(resultUrl) };
      }

      return { success: false, error: '上传成功但未返回 URL' };
    },
  };

  console.log('[Web Shim] All browser shims installed (remote file storage mode)');
}
