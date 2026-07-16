// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// src/lib/web-shim.ts
// 浏览器运行时注入，mock Electron 特有 API，使前端代码可在纯浏览器中运行
// 
// WebUI 版数据持久化策略：
//   fileStorage → 通过 HTTP API 写入本地文件系统 (local-storage-server.mjs)
//   所有数据保存在 ~/Documents/moyin-creator/data/ 下
//   换电脑、换浏览器、清缓存均不受影响

// ==================== 本地存储 API 客户端 ====================

const STORAGE_API_BASE = 'http://192.168.3.180:3001';

async function apiGet(key: string): Promise<string | null> {
  const res = await fetch(`${STORAGE_API_BASE}/api/storage/${encodeURIComponent(key)}`);
  const data = await res.json();
  return data.value ?? null;
}

async function apiSet(key: string, value: string): Promise<boolean> {
  const res = await fetch(`${STORAGE_API_BASE}/api/storage/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
  const data = await res.json();
  return data.success === true;
}

async function apiRemove(key: string): Promise<boolean> {
  const res = await fetch(`${STORAGE_API_BASE}/api/storage/${encodeURIComponent(key)}`, {
    method: 'DELETE',
  });
  const data = await res.json();
  return data.success === true;
}

async function apiExists(key: string): Promise<boolean> {
  const res = await fetch(`${STORAGE_API_BASE}/api/storage/${encodeURIComponent(key)}/exists`);
  const data = await res.json();
  return data.exists === true;
}

async function apiListKeys(prefix: string): Promise<string[]> {
  const res = await fetch(`${STORAGE_API_BASE}/api/storage/keys/${encodeURIComponent(prefix)}`);
  const data = await res.json();
  return data.keys || [];
}

async function apiListDirs(prefix: string): Promise<string[]> {
  const allKeys = await apiListKeys(prefix);
  const dirs = new Set<string>();
  for (const k of allKeys) {
    const rest = k.slice(prefix.length);
    const slashIdx = rest.indexOf('/');
    if (slashIdx !== -1) {
      dirs.add(rest.slice(0, slashIdx));
    }
  }
  return Array.from(dirs);
}

async function apiRemoveDir(prefix: string): Promise<boolean> {
  const res = await fetch(`${STORAGE_API_BASE}/api/storage/dir/${encodeURIComponent(prefix)}`, {
    method: 'DELETE',
  });
  const data = await res.json();
  return data.success === true;
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

/** 初始化并注入所有 Web Shim */
export async function installWebShims(): Promise<void> {
  // 1. ipcRenderer — 移除
  (window as any).ipcRenderer = null;

  // 2. fileStorage — 本地 HTTP API（数据存到硬盘）
  const fs = createRemoteFileStorage();
  (window as any).fileStorage = fs;

  // 3. imageStorage
  (window as any).imageStorage = {
    saveImage: async (url: string, _category: string, _filename: string) => {
      return { success: true, localPath: url };
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
    getCurrentVersion: async () => '0.2.3-web',
    checkForUpdates: async () => ({ hasUpdate: false, message: 'Web版无需检查更新' }),
    openExternalLink: async (url: string) => {
      window.open(url, '_blank');
      return { success: true };
    },
  };

  // 6. imageHostUploader — 浏览器原生 fetch
  (window as any).imageHostUploader = {
    upload: async (payload: {
      provider: {
        baseUrl?: string;
        imageField?: string;
        apiKeyFormField?: string;
        apiKeyParam?: string;
        apiKeyHeader?: string;
        staticFormFields?: Record<string, string>;
        responseUrlField?: string;
      };
      apiKey: string;
      imageData: string;
    }) => {
      let blob: Blob;
      if (payload.imageData.startsWith('data:')) {
        const res = await fetch(payload.imageData);
        blob = await res.blob();
      } else if (payload.imageData.startsWith('http')) {
        const res = await fetch(payload.imageData);
        blob = await res.blob();
      } else {
        return { success: false, error: 'Unsupported image data format' };
      }

      const baseUrl = payload.provider.baseUrl || '';
      const formData = new FormData();
      const fieldName = payload.provider.imageField || 'image';
      formData.append(fieldName, blob, 'upload.png');
      if (payload.provider.apiKeyFormField && payload.apiKey) {
        formData.append(payload.provider.apiKeyFormField, payload.apiKey);
      }
      if (payload.provider.apiKeyParam && payload.apiKey) {
        formData.append(payload.provider.apiKeyParam, payload.apiKey);
      }
      if (payload.provider.staticFormFields) {
        for (const [k, v] of Object.entries(payload.provider.staticFormFields)) {
          formData.append(k, v);
        }
      }

      const headers: Record<string, string> = {};
      if (payload.provider.apiKeyHeader && payload.apiKey) {
        headers[payload.provider.apiKeyHeader] = payload.apiKey;
      }

      const res = await fetch(baseUrl, { method: 'POST', headers, body: formData });
      const data = await res.json();
      const urlField = payload.provider.responseUrlField || 'url';
      return { success: true, url: data[urlField] || data.data?.link || data.url || '' };
    },
  };

  console.log('[Web Shim] All browser shims installed (remote file storage mode)');
}
