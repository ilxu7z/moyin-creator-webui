#!/usr/bin/env node
/**
 * 魔因漫创 WebUI 本地持久化服务
 * 
 * 提供 HTTP API，将所有数据保存到本地文件系统。
 * 前端通过此 API 读写数据，而不是 IndexedDB/localStorage。
 * 
 * 启动: node local-storage-server.mjs [--port PORT] [--data-dir DIR]
 * 默认端口: 3001
 * 默认数据目录: ~/Documents/moyin-creator/data
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

// ==================== 配置 ====================

const args = process.argv.slice(2);
const getArg = (flag, def) => {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : def;
};

const PORT = parseInt(getArg('--port', '3001'), 10);
const DATA_DIR = getArg('--data-dir', path.join(homedir(), 'Documents', 'moyin-creator', 'data'));

// ==================== 初始化 ====================

// 确保数据目录存在
fs.mkdirSync(DATA_DIR, { recursive: true });
console.log(`[StorageServer] Data directory: ${DATA_DIR}`);

// ==================== 工具函数 ====================

function safeKey(key) {
  // 防止路径遍历攻击，只允许字母数字、连字符、下划线、点号
  return key.replace(/[^a-zA-Z0-9\-_./]/g, '_');
}

function filePath(key) {
  return path.join(DATA_DIR, safeKey(key) + '.json');
}

// 确保文件所在目录存在
function ensureDir(key) {
  const fp = filePath(key);
  const dir = path.dirname(fp);
  fs.mkdirSync(dir, { recursive: true });
  return fp;
}

// ==================== API 端点 ====================

/**
 * GET /api/storage/:key — 读取数据
 * POST /api/storage/:key — 写入数据 (body: { value: "..." })
 * DELETE /api/storage/:key — 删除数据
 * GET /api/storage/:key/exists — 检查是否存在
 * GET /api/storage/keys/:prefix — 列出匹配 prefix 的 keys
 * DELETE /api/storage/dir/:prefix — 删除匹配 prefix 下所有数据
 */

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJSON(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

function sendError(res, status, error) {
  sendJSON(res, status, { success: false, error });
}

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const parts = url.pathname.split('/').filter(Boolean); // ['api', 'storage', ...]
  
  // 健康检查
  if (url.pathname === '/healthz') {
    sendJSON(res, 200, { status: 'ok', dataDir: DATA_DIR });
    return;
  }

  // API 路由
  if (parts[0] !== 'api' || parts[1] !== 'storage') {
    sendError(res, 404, 'Not found');
    return;
  }

  const subResource = parts[2]; // key / keys / dir

  try {
    // === PLAIN KEY OPERATIONS ===
    if (subResource !== 'keys' && subResource !== 'dir') {
      const key = decodeURIComponent(subResource || '');
      if (!key) {
        sendError(res, 400, 'Missing key');
        return;
      }

      const fp = ensureDir(key);

      switch (req.method) {
        case 'GET': {
          // GET /api/storage/:key
          // GET /api/storage/:key/exists
          if (parts[3] === 'exists') {
            sendJSON(res, 200, { exists: fs.existsSync(fp) });
            return;
          }
          if (fs.existsSync(fp)) {
            const data = fs.readFileSync(fp, 'utf-8');
            sendJSON(res, 200, { key, value: data, success: true });
          } else {
            sendJSON(res, 200, { key, value: null, success: true });
          }
          return;
        }

        case 'POST': {
          // POST /api/storage/:key
          const body = await parseBody(req);
          const value = body.value;
          if (value === undefined) {
            sendError(res, 400, 'Missing value');
            return;
          }
          fs.writeFileSync(fp, value, 'utf-8');
          sendJSON(res, 200, { success: true, key });
          return;
        }

        case 'DELETE': {
          // DELETE /api/storage/:key
          if (fs.existsSync(fp)) {
            fs.unlinkSync(fp);
            sendJSON(res, 200, { success: true, deleted: true });
          } else {
            sendJSON(res, 200, { success: true, deleted: false });
          }
          return;
        }

        default:
          sendError(res, 405, 'Method not allowed');
          return;
      }
    }

    // === KEYS OPERATION ===
    if (subResource === 'keys') {
      if (req.method !== 'GET') {
        sendError(res, 405, 'Method not allowed');
        return;
      }
      const prefix = decodeURIComponent(parts[3] || '');
      const result = listKeys(DATA_DIR, prefix);
      sendJSON(res, 200, { success: true, keys: result });
      return;
    }

    // === DIR OPERATION ===
    if (subResource === 'dir') {
      if (req.method !== 'DELETE') {
        sendError(res, 405, 'Method not allowed');
        return;
      }
      const prefix = decodeURIComponent(parts[3] || '');
      const count = removeDir(DATA_DIR, prefix);
      sendJSON(res, 200, { success: true, deleted: count });
      return;
    }

  } catch (error) {
    console.error(`[StorageServer] Error processing ${req.method} ${url.pathname}:`, error.message);
    sendError(res, 500, error.message);
  }
});

// ==================== 文件系统操作 ====================

function listKeys(baseDir, prefix) {
  const result = [];
  const safePrefix = safeKey(prefix);
  const targetDir = prefix ? path.join(baseDir, safePrefix) : baseDir;
  
  if (!fs.existsSync(targetDir)) return result;

  function walk(dir, relativePath) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(fullPath, relPath);
      } else if (entry.name.endsWith('.json')) {
        result.push(relPath.replace(/\.json$/, ''));
      }
    }
  }
  walk(targetDir, safePrefix);
  return result;
}

function removeDir(baseDir, prefix) {
  const safePrefix = safeKey(prefix);
  const targetDir = prefix ? path.join(baseDir, safePrefix) : baseDir;
  
  if (!fs.existsSync(targetDir)) return 0;

  let count = 0;
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith('.json')) {
        fs.unlinkSync(fullPath);
        count++;
      }
    }
  }
  walk(targetDir);
  return count;
}

// ==================== 启动 ====================

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[StorageServer] Listening on http://127.0.0.1:${PORT}`);
  console.log(`[StorageServer] Health: http://127.0.0.1:${PORT}/healthz`);
});

process.on('SIGINT', () => {
  console.log('\n[StorageServer] Shutting down...');
  server.close(() => process.exit(0));
});
process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
