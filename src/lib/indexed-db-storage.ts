// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * File Storage Adapter for Zustand
 * 
 * WebUI 版：所有数据通过 window.fileStorage（web-shim 提供）写入本地文件系统
 * Electron 版：通过 Electron preload 的 fileStorage API 写入文件系统
 * 
 * 数据最终都落在本地硬盘上，不依赖浏览器存储。
 */

import type { StateStorage } from 'zustand/middleware';

declare global {
  interface Window {
    fileStorage?: {
      getItem: (key: string) => Promise<string | null>;
      setItem: (key: string, value: string) => Promise<boolean>;
      removeItem: (key: string) => Promise<boolean>;
      exists: (key: string) => Promise<boolean>;
      listKeys: (prefix: string) => Promise<string[]>;
      listDirs: (prefix: string) => Promise<string[]>;
      removeDir: (prefix: string) => Promise<boolean>;
    };
  }
}

/**
 * 等待 window.fileStorage 就绪。
 * 
 * 关键问题：Zustand persist store 在模块 import 时就会被创建并自动 rehydrate，
 * 但此时 initApp() 还没运行 → window.fileStorage 不存在 → 回退 localStorage → 丢数据。
 * 
 * 这个函数让 getItem 等待最多 30 秒直到 window.fileStorage 出现。
 */
const waitForFileStorage = async (timeoutMs: number = 30000): Promise<boolean> => {
  if (typeof window === 'undefined') return false;
  const start = Date.now();
  while (!window.fileStorage) {
    if (Date.now() - start > timeoutMs) {
      console.warn('[Storage] Timed out waiting for window.fileStorage');
      return false;
    }
    await new Promise(r => setTimeout(r, 50));
  }
  return true;
};

export const fileStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    // 等待 window.fileStorage 注入后再尝试读取
    // Electron 环境 window.ipcRenderer 已存在，无需等待
    if (!window.ipcRenderer) {
      await waitForFileStorage();
    }
    if (window.fileStorage) {
      try {
        const value = await window.fileStorage.getItem(name);
        if (value !== null && value !== undefined) return value;
      } catch (error) {
        console.error('[Storage] getItem error:', error);
      }
    }
    // 回退 localStorage
    return localStorage.getItem(name);
  },

  setItem: async (name: string, value: string): Promise<void> => {
    if (window.fileStorage) {
      try {
        await window.fileStorage.setItem(name, value);
        return;
      } catch (error) {
        console.error('[Storage] setItem error:', error);
      }
    }
    try {
      localStorage.setItem(name, value);
    } catch (error) {
      console.error('[Storage] localStorage setItem error:', error);
    }
  },

  removeItem: async (name: string): Promise<void> => {
    if (window.fileStorage) {
      try {
        await window.fileStorage.removeItem(name);
        return;
      } catch (error) {
        console.error('[Storage] removeItem error:', error);
      }
    }
    localStorage.removeItem(name);
  },
};

// 向后兼容导出
/** @deprecated 迁移需手动触发，不再自动执行 */
export const migrateFromLocalStorage = async (_key: string): Promise<void> => {};
/** @deprecated 统一使用 fileStorage */
export const indexedDBStorage = fileStorage;
