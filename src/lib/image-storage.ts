// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * Image Storage Utility
 * Handles saving and loading images via Electron IPC
 */

// Type declarations for the imageStorage API exposed by preload
declare global {
  interface Window {
    imageStorage?: {
      saveImage: (url: string, category: string, filename: string) => Promise<{ success: boolean; localPath?: string; error?: string }>;
      getImagePath: (localPath: string) => Promise<string | null>;
      deleteImage: (localPath: string) => Promise<boolean>;
      readAsBase64: (localPath: string) => Promise<{ success: boolean; base64?: string; mimeType?: string; size?: number; error?: string }>;
      getAbsolutePath: (localPath: string) => Promise<string | null>;
    };
  }
}

export type ImageCategory = 'characters' | 'scenes' | 'shots' | 'wardrobe' | 'videos' | 'styles' | 'props';

/**
 * Check if running in Electron environment
 */
export const isElectron = (): boolean => {
  return typeof window !== 'undefined' && !!window.imageStorage;
};

/**
 * Save an image from URL to local storage
 * @param url - The URL of the image to save
 * @param category - Category folder (characters, scenes, shots, wardrobe)
 * @param filename - Optional filename hint
 * @returns Local path (local-image://...) or original URL if not in Electron
 */
export async function saveImageToLocal(
  url: string, 
  category: ImageCategory, 
  filename: string = 'image.png'
): Promise<string> {
  // Electron 模式
  if (isElectron()) {
    try {
      const result = await window.imageStorage!.saveImage(url, category, filename);
      if (result.success && result.localPath) {
        console.log(`Image saved locally (Electron): ${result.localPath}`);
        return result.localPath;
      }
      console.error('Failed to save image:', result.error);
      return url;
    } catch (error) {
      console.error('Error saving image:', error);
      return url;
    }
  }

  // 浏览器 Web UI 模式 — 通过 HTTP storage server 保存
  try {
    // 获取图片数据：支持 data: URL 和 HTTP URL
    let imageData = url;
    if (url.startsWith('http://') || url.startsWith('https://')) {
      const resp = await fetch(url.startsWith('/') ? url : `/__api_proxy?url=${encodeURIComponent(url)}`);
      if (resp.ok) {
        const blob = await resp.blob();
        imageData = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      }
    }

    const resp = await fetch(`/api/images/${encodeURIComponent(category)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: imageData, filename }),
    });
    const result = await resp.json();
    if (result.success && result.localPath) {
      console.log(`Image saved locally (WebUI): ${result.localPath}`);
      return result.localPath;
    }
    console.error('Failed to save image via HTTP:', result.error);
    return url;
  } catch (error) {
    console.error('Error saving image via HTTP:', error);
    return url;
  }
}

/**
 * Resolve a local-image:// path to an actual file:// URL
 * Falls back to the original path if not a local-image path or not in Electron
 */
export async function resolveImagePath(pathStr: string): Promise<string> {
  // WebUI 模式：/api/images/... 路径已经是可直接访问的
  if (pathStr.startsWith('/api/images/')) {
    return pathStr;
  }

  // If not a local-image path, return as-is
  if (!pathStr.startsWith('local-image://')) {
    return pathStr;
  }

  // If not in Electron, can't resolve local paths
  if (!isElectron()) {
    console.warn('Not running in Electron, cannot resolve local image path');
    return pathStr;
  }

  try {
    const resolvedPath = await window.imageStorage!.getImagePath(pathStr);
    return resolvedPath || pathStr;
  } catch (error) {
    console.error('Error resolving image path:', error);
    return pathStr;
  }
}

/**
 * Delete a locally stored image
 */
export async function deleteLocalImage(localPath: string): Promise<boolean> {
  if (!localPath.startsWith('local-image://')) {
    return false;
  }

  if (!isElectron()) {
    return false;
  }

  try {
    return await window.imageStorage!.deleteImage(localPath);
  } catch (error) {
    console.error('Error deleting image:', error);
    return false;
  }
}

/**
 * Read a local image as base64 (for AI API calls like video generation)
 * Works with local-image://, file://, or absolute paths
 * @returns base64 data URL (e.g., "data:image/png;base64,...")
 */
export async function readImageAsBase64(imagePath: string): Promise<string | null> {
  // If already a data URL, return as-is
  if (imagePath.startsWith('data:')) {
    return imagePath;
  }

  // If it's a remote URL, fetch and convert
  if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
    try {
      const response = await fetch(imagePath);
      const blob = await response.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch (error) {
      console.error('Error fetching remote image:', error);
      return null;
    }
  }

  // For local images, use Electron IPC
  if (!isElectron()) {
    console.warn('Not running in Electron, cannot read local image');
    return null;
  }

  try {
    const result = await window.imageStorage!.readAsBase64(imagePath);
    if (result.success && result.base64) {
      return result.base64;
    }
    console.error('Failed to read image:', result.error);
    return null;
  } catch (error) {
    console.error('Error reading image as base64:', error);
    return null;
  }
}

/**
 * Get the absolute file path for a local-image:// URL
 * Useful for local video generation tools like FFmpeg
 */
export async function getAbsoluteImagePath(localPath: string): Promise<string | null> {
  if (!localPath.startsWith('local-image://')) {
    // Already an absolute path or other format
    return localPath;
  }

  if (!isElectron()) {
    console.warn('Not running in Electron, cannot get absolute path');
    return null;
  }

  try {
    return await window.imageStorage!.getAbsolutePath(localPath);
  } catch (error) {
    console.error('Error getting absolute path:', error);
    return null;
  }
}

/**
 * Save a video from URL to local storage
 * @param url - The URL of the video to save
 * @param filename - Optional filename hint
 * @returns Local path (local-image://videos/...) or original URL if not in Electron
 */
export async function saveVideoToLocal(
  url: string, 
  filename: string = 'video.mp4'
): Promise<string> {
  // If not in Electron or already local, return as-is
  if (!isElectron() || url.startsWith('local-image://') || url.startsWith('data:')) {
    return url;
  }

  try {
    const result = await window.imageStorage!.saveImage(url, 'videos', filename);
    
    if (result.success && result.localPath) {
      console.log(`Video saved locally: ${result.localPath}`);
      return result.localPath;
    } else {
      console.error('Failed to save video:', result.error);
      return url;
    }
  } catch (error) {
    console.error('Error saving video:', error);
    return url;
  }
}
