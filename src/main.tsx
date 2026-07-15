// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

// 浏览器环境：加载 web-shim 注入 Electron API 兼容层
// (Electron 环境 window.ipcRenderer 存在时 web-shim 自动跳过)
const initApp = async () => {
  // 非 Electron 环境：等待 shim 完成后再渲染
  if (!window.ipcRenderer) {
    const { installWebShims } = await import('./lib/web-shim');
    await installWebShims();
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}

initApp().catch((err) => {
  console.error('[main] Failed to initialize app:', err);
  // 降级渲染
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML = '<p style="padding:2em;font-size:1.2em;color:red;">应用初始化失败，请查看控制台错误信息</p>';
  }
});

// Use contextBridge (only available in Electron)
if (window.ipcRenderer) {
  window.ipcRenderer.on('main-process-message', (_event, message) => {
    console.log(message)
  })
}
