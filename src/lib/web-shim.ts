// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// src/lib/web-shim.ts
// 浏览器运行时注入，mock Electron 特有 API，使前端代码可在纯浏览器中运行

type IDBFileStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<boolean>;
  removeItem: (key: string) => Promise<boolean>;
  exists: (key: string) => Promise<boolean>;
  listKeys: (prefix: string) => Promise<string[]>;
  listDirs: (prefix: string) => Promise<string[]>;
  removeDir: (prefix: string) => Promise<boolean>;
};

/** 打开/创建 IndexedDB 数据库 */
function openDB(dbName: string, version: number, storeNames: string[]): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, version);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of storeNames) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name);
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** IndexedDB 实现的 fileStorage（替代 Electron 文件系统） */
async function createIndexedDBFileStorage(): Promise<IDBFileStorage> {
  const db = await openDB('moyin-creator-web', 1, ['kv']);

  function getStore(mode: IDBTransactionMode = 'readonly'): IDBObjectStore {
    const tx = db.transaction('kv', mode);
    return tx.objectStore('kv');
  }

  return {
    getItem: async (key: string): Promise<string | null> => {
      return new Promise((resolve, reject) => {
        const request = getStore().get(key);
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
      });
    },

    setItem: async (key: string, value: string): Promise<boolean> => {
      return new Promise((resolve, reject) => {
        const request = getStore('readwrite').put(value, key);
        request.onsuccess = () => resolve(true);
        request.onerror = () => reject(request.error);
      });
    },

    removeItem: async (key: string): Promise<boolean> => {
      return new Promise((resolve, reject) => {
        const request = getStore('readwrite').delete(key);
        request.onsuccess = () => resolve(true);
        request.onerror = () => reject(request.error);
      });
    },

    exists: async (key: string): Promise<boolean> => {
      const val = await this.getItem(key);
      return val !== null;
    },

    listKeys: async (prefix: string): Promise<string[]> => {
      return new Promise((resolve, reject) => {
        const keys: string[] = [];
        const req = getStore().openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) {
            if (typeof cursor.key === 'string' && cursor.key.startsWith(prefix)) {
              keys.push(cursor.key);
            }
            cursor.continue();
          } else {
            resolve(keys);
          }
        };
        req.onerror = () => reject(req.error);
      });
    },

    listDirs: async (prefix: string): Promise<string[]> => {
      const allKeys = await this.listKeys(prefix);
      const dirs = new Set<string>();
      for (const k of allKeys) {
        const rest = k.slice(prefix.length);
        const slashIdx = rest.indexOf('/');
        if (slashIdx !== -1) {
          dirs.add(rest.slice(0, slashIdx));
        }
      }
      return Array.from(dirs);
    },

    removeDir: async (prefix: string): Promise<boolean> => {
      const keys = await this.listKeys(prefix);
      return new Promise((resolve, reject) => {
        const store = getStore('readwrite');
        if (keys.length === 0) return resolve(true);
        let completed = 0;
        for (const k of keys) {
          const req = store.delete(k);
          req.onsuccess = () => {
            completed++;
            if (completed >= keys.length) resolve(true);
          };
          req.onerror = () => reject(req.error);
        }
      });
    },
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
  // local-image:// 或 file:// 无法在浏览器中解析，返回 null
  return null;
}

/** 初始化并注入所有 Web Shim */
export async function installWebShims(): Promise<void> {
  // 1. ipcRenderer — 移除
  (window as any).ipcRenderer = null;

  // 2. fileStorage — IndexedDB 实现
  const fs = await createIndexedDBFileStorage();
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

  // 4. storageManager — mock（SettingsPanel 配置用）
  (window as any).storageManager = {
    getPaths: async () => ({ dataPath: '/browser/storage', cachePath: '/browser/cache' }),
    selectDirectory: async () => null,
    getCacheSize: async () => 0,
    clearCache: async () => true,
    updateConfig: async () => true,
    validateDataDir: async () => ({ valid: true }),
    moveData: async () => true,
    linkData: async () => true,
    exportData: async () => true,
    importData: async () => true,
  };

  // 5. appUpdater — mock
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

  console.log('[Web Shim] All browser shims installed');
}

// Auto-install 由 main.tsx 中的 initApp() 主动调用，不再在此处自动执行
// 避免在 zustand store 初始化前 window.fileStorage 尚未就绪
