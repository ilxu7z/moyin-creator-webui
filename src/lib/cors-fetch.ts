// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * CORS-safe fetch wrapper
 *
 * 自动检测运行环境：
 * - Electron 桌面模式 → 直接使用原生 fetch()（无 CORS 限制）
 * - 浏览器开发模式   → 通过 Vite 开发服务器 /__api_proxy?url=... 代理转发
 * - 浏览器生产模式   → 直接 fetch()（需后端/Nginx 提供反向代理）
 */

/** 检测是否在 Electron 环境中运行 */
function isElectron(): boolean {
  return !!(
    typeof window !== 'undefined' &&
    (window as any).electron
  );
}

/** 检测是否在 Vite 开发服务器中运行 */
function isViteDev(): boolean {
  return import.meta.env?.DEV === true;
}

/**
 * CORS 安全的 fetch 封装
 *
 * 在浏览器开发模式下，将请求通过 /__api_proxy 代理转发。
 * targetUrl 和 headers 通过自定义头传递，body 直接转发。
 *
 * @param url    目标 URL
 * @param init   请求选项
 * @returns      Response
 */
export async function corsFetch(
  url: string | URL,
  init?: RequestInit,
): Promise<Response> {
  const targetUrl = url.toString();

  // Electron 或非开发环境：直连
  if (isElectron() || !isViteDev()) {
    return fetch(targetUrl, init);
  }

  // 浏览器开发模式：走 Vite 代理
  const proxyUrl = `/__api_proxy?url=${encodeURIComponent(targetUrl)}`;

  const headers: Record<string, string> = {};
  if (init?.headers) {
    const h = new Headers(init.headers);
    h.forEach((v, k) => { headers[k] = v; });
  }

  const proxyInit: RequestInit = {
    method: 'POST',
    headers: {
      'x-target-method': init?.method || 'GET',
      'x-target-url': targetUrl,
      'x-target-headers': JSON.stringify(headers),
    },
    body: init?.body,
  };

  return fetch(proxyUrl, proxyInit);
}
