#!/usr/bin/env node
/**
 * 魔因漫创 WebUI 开发启动器
 * 
 * 按顺序启动：
 *   1. 本地存储服务 (local-storage-server.mjs, 端口 3002)
 *   2. Vite 开发服务器 (端口 5174)
 * 
 * 自动处理进程清理和数据保护。
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const STORAGE_PORT = 3002;
const VITE_PORT = 5174;

/** 检查端口是否空闲 */
function checkPort(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(port, '0.0.0.0', () => {
      server.close(() => resolve(true));
    });
    server.on('error', () => resolve(false));
  });
}

/** 等待端口变为监听状态（使用 HTTP health check，避免 macOS 0.0.0.0/127.0.0.1 分离 bug）*/
function waitForPort(port, timeoutMs = 15000, healthPath = '/healthz') {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      // 先用 socket 测 0.0.0.0（与服务器 bind 地址一致）
      const s = createServer();
      const done = (ok) => {
        s.removeAllListeners();
        if (s.listening) s.close();
        if (ok) return resolve();
        if (Date.now() - start > timeoutMs) {
          return reject(new Error(`端口 ${port} 在 ${timeoutMs}ms 内未变为监听状态`));
        }
        setTimeout(check, 500);
      };
      // macOS: 0.0.0.0 bind 和 127.0.0.1 bind 可能不互斥
      // 使用更可靠的检测方式：connect 请求到 127.0.0.1
      s.on('error', () => {
        // 0.0.0.0:port 被占用 → 服务可能已启动
        // 再发 HTTP 探测确认
        import('node:http').then(http => {
          const req = http.get(`http://127.0.0.1:${port}${healthPath}`, (res) => {
            if (res.statusCode >= 200 && res.statusCode < 400) {
              done(true);
            } else {
              // 端口被其他服务占用
              done(false);
            }
          });
          req.on('error', () => {
            // 端口被占用但不是 HTTP 服务 → 继续等待
            done(false);
          });
          req.setTimeout(2000, () => { req.destroy(); done(false); });
        }).catch(() => done(false));
      });
      s.listen(port, '0.0.0.0', () => {
        // 端口空闲 → 还没启动
        s.close();
        done(false);
      });
    };
    check();
  });
}

console.log('🚀 魔因漫创 WebUI 开发环境');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// 1. 检查存储服务
const storageFree = await checkPort(STORAGE_PORT);
if (!storageFree) {
  console.log(`📦 存储服务已在运行 (端口 ${STORAGE_PORT})`);
} else {
  console.log(`📦 启动存储服务 (端口 ${STORAGE_PORT})...`);
  const storage = spawn('node', ['local-storage-server.mjs'], {
    stdio: 'inherit',
    detached: false,
  });
  // 等待就绪
  await waitForPort(STORAGE_PORT);
  console.log(`✅ 存储服务已就绪\n`);
}

// 2. 启动 Vite
const viteFree = await checkPort(VITE_PORT);
if (!viteFree) {
  console.log(`⚠️  Vite 端口 ${VITE_PORT} 已被占用，可能已有实例在运行`);
  console.log('   请先关闭旧实例再试，或访问 http://localhost:5174');
  process.exit(1);
}

console.log(`⚡ 启动 Vite 开发服务器 (端口 ${VITE_PORT})...\n`);
const vite = spawn('npx', ['vite', '--config', 'vite.config.web.ts', '--host', '0.0.0.0'], {
  stdio: 'inherit',
  shell: true,
});

vite.on('exit', (code) => {
  console.log(`\n🛑 Vite 已退出 (code ${code})`);
  process.exit(code ?? 0);
});

process.on('SIGINT', () => {
  console.log('\n👋 正在关闭...');
  vite.kill('SIGINT');
  process.exit(0);
});
