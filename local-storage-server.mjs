#!/usr/bin/env node
/**
 * 魔因漫创 WebUI 本地持久化服务
 * 
 * 提供 HTTP API，将所有数据保存到本地文件系统。
 * 前端通过此 API 读写数据，而不是 IndexedDB/localStorage。
 * 
 * 启动: node local-storage-server.mjs [--port PORT] [--data-dir DIR]
 * 默认端口: 3002
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

const PORT = parseInt(getArg('--port', '3002'), 10);
const DATA_DIR = getArg('--data-dir', path.join(homedir(), 'Documents', 'moyin-creator', 'data'));

// ==================== 初始化 ====================

// 确保数据目录存在
fs.mkdirSync(DATA_DIR, { recursive: true });
console.log(`[StorageServer] Data directory: ${DATA_DIR}`);

// ==================== 工具函数 ====================

function safeKey(key) {
  // 防止路径遍历攻击：替换路径遍历字符（连续点、反斜杠、空字节等）
  // 保留 * 号（UUID 格式中可能出现）和中文等 Unicode 字符
  let safe = key.replace(/\.\./g, '_'); // 防止父目录遍历
  safe = safe.replace(/[\\\x00]/g, '_'); // 反斜杠和空字节
  return safe;
}

function filePath(key) {
  return path.join(DATA_DIR, safeKey(key) + '.json');
}

// 确保文件所在目录存在
// 返回完整文件路径，如写入失败（目录名和文件名冲突）则抛出异常
function ensureDir(key) {
  const fp = filePath(key);
  const dir = path.dirname(fp);

  // ⚠️ 安全检查：如果目标路径上存在同名目录（而非文件），说明有冲突
  // 例如：_p/_migrated 同时作为目录和 JSON 文件名存在
  // 这种情况下 fs.writeFileSync 会静默失败（ENOENT 或 EISDIR）
  const segments = safeKey(key).split('/');
  let currentPath = DATA_DIR;
  for (let i = 0; i < segments.length; i++) {
    currentPath = path.join(currentPath, segments[i]);
    // 检查路径上每个组件：不能是 JSON 文件（非最终段）
    if (i < segments.length - 1) {
      const jsonPath = currentPath + '.json';
      if (fs.existsSync(jsonPath) && fs.statSync(jsonPath).isFile()) {
        throw new Error(
          `Path conflict: "${key}" cannot be created because ` +
          `"${path.relative(DATA_DIR, jsonPath)}" exists as a file. ` +
          `This prevents directory/file name collision (e.g., _p/_migrated vs _p/_migrated.json).`
        );
      }
    }
  }
  // 同样检查：最终路径不能已作为目录存在
  if (fs.existsSync(dir + '/' + segments[segments.length - 1])) {
    const conflictDir = dir + '/' + segments[segments.length - 1];
    if (fs.statSync(conflictDir).isDirectory()) {
      throw new Error(
        `Path conflict: cannot create file "${path.relative(DATA_DIR, fp)}" ` +
        `because directory "${path.relative(DATA_DIR, conflictDir)}" already exists.`
      );
    }
  }

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
  
  // 健康检查（增强：返回数据目录状态和冲突检测）
  if (url.pathname === '/healthz') {
    const status = { status: 'ok', dataDir: DATA_DIR };
    try {
      // 检查数据目录可读写性
      const testFile = path.join(DATA_DIR, '.healthz-test');
      fs.writeFileSync(testFile, 'ok', 'utf-8');
      fs.unlinkSync(testFile);
      status.dataWritable = true;
    } catch {
      status.dataWritable = false;
    }
    try {
      // 检测 _p/_migrated/ 目录冲突（常见 bugs）
      const conflictDir = path.join(DATA_DIR, '_p', '_migrated');
      if (fs.existsSync(conflictDir) && fs.statSync(conflictDir).isDirectory()) {
        status.warnings = status.warnings || [];
        status.warnings.push('_p/_migrated directory conflict: directory exists alongside _p/_migrated.json file');
      }
      // 检测空的 per-project 目录
      const pDir = path.join(DATA_DIR, '_p');
      if (fs.existsSync(pDir)) {
        const entries = fs.readdirSync(pDir, { withFileTypes: true });
        const emptyDirs = [];
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith('_migrated')) {
            const subEntries = fs.readdirSync(path.join(pDir, entry.name));
            const hasJson = subEntries.some(f => f.endsWith('.json'));
            if (!hasJson) emptyDirs.push(entry.name.substring(0, 8));
          }
        }
        if (emptyDirs.length > 0) {
          status.warnings = status.warnings || [];
          status.warnings.push(`Empty per-project directories (data may be lost): ${emptyDirs.join(', ')}`);
        }
      }
    } catch {}
    sendJSON(res, 200, status);
    return;
  }

  // ==================== IMAGE API ====================
  if (parts[0] === 'api' && parts[1] === 'images') {
    const IMAGE_DIR = path.join(DATA_DIR, 'images');
    fs.mkdirSync(IMAGE_DIR, { recursive: true });

    const imageCat = parts[2]; // category (characters/scenes/shots/wardrobe/videos/styles/props)
    if (!imageCat) {
      sendError(res, 400, 'Missing image category');
      return;
    }
    const catDir = path.join(IMAGE_DIR, safeKey(imageCat));
    fs.mkdirSync(catDir, { recursive: true });

    // GET /api/images/:category/:filename — 返回原始图片
    if (req.method === 'GET' && parts[3]) {
      const fname = path.basename(decodeURIComponent(parts.slice(3).join('/')));
      const imgPath = path.join(catDir, fname);
      if (!fs.existsSync(imgPath)) {
        sendError(res, 404, 'Image not found');
        return;
      }
      const ext = path.extname(fname).toLowerCase();
      const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4' };
      res.setHeader('Content-Type', mimeMap[ext] || 'application/octet-stream');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.writeHead(200);
      fs.createReadStream(imgPath).pipe(res);
      return;
    }

    // POST /api/images/:category — 上传图片 (body: { data: "base64...", filename: "..." })
    if (req.method === 'POST') {
      const body = await parseBody(req);
      const { data, filename } = body;
      if (!data) {
        sendError(res, 400, 'Missing image data');
        return;
      }
      const fname = safeKey(filename || `${Date.now()}.png`);
      const imgPath = path.join(catDir, fname);
      let buf;
      if (data.startsWith('data:')) {
        const b64 = data.split(',')[1] || data;
        buf = Buffer.from(b64, 'base64');
      } else if (data.startsWith('http://') || data.startsWith('https://')) {
        try {
          const fetchResp = await fetch(data);
          buf = Buffer.from(await fetchResp.arrayBuffer());
        } catch (e) {
          sendError(res, 502, `Failed to fetch image: ${e.message}`);
          return;
        }
      } else {
        buf = Buffer.from(data, 'base64');
      }
      fs.writeFileSync(imgPath, buf);
      // 返回本地访问 URL
      const localUrl = `/api/images/${imageCat}/${encodeURIComponent(fname)}`;
      sendJSON(res, 200, { success: true, localPath: localUrl, filename: fname });
      console.log(`[StorageServer] Image saved: ${localUrl} (${buf.length}B)`);
      return;
    }

    // DELETE /api/images/:category/:filename
    if (req.method === 'DELETE' && parts[3]) {
      const fname = path.basename(decodeURIComponent(parts.slice(3).join('/')));
      const imgPath = path.join(catDir, fname);
      if (fs.existsSync(imgPath)) {
        fs.unlinkSync(imgPath);
        sendJSON(res, 200, { success: true, deleted: true });
      } else {
        sendJSON(res, 200, { success: true, deleted: false });
      }
      return;
    }

    sendError(res, 405, 'Method not allowed');
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
      // 支持多段嵌套 key：_p/project-uuid/scenes
      // 特殊后缀：/exists, /raw 从路径中剥离，不作为 key 的一部分
      let rawKey = decodeURIComponent(parts.slice(2).join('/') || '');
      if (!rawKey) {
        sendError(res, 400, 'Missing key');
        return;
      }

      let subAction = null; // 'raw' | 'exists' | null
      if (rawKey.endsWith('/exists')) {
        subAction = 'exists';
        rawKey = rawKey.slice(0, -7);
      } else if (rawKey.endsWith('/raw')) {
        subAction = 'raw';
        rawKey = rawKey.slice(0, -4);
      }
      const key = rawKey;

      const fp = ensureDir(key);

      switch (req.method) {
        case 'GET': {
          // GET /api/storage/:key
          // GET /api/storage/:key/exists
          // GET /api/storage/:key/raw  — 返回原始图片数据（用于 img src）
          if (subAction === 'raw') {
            if (fs.existsSync(fp)) {
              const raw = fs.readFileSync(fp, 'utf-8');
              try {
                const parsed = JSON.parse(raw);
                if (parsed.data && parsed.data.startsWith('data:')) {
                  const mime = parsed.mime || 'image/png';
                  const b64 = parsed.data.split(',')[1] || parsed.data;
                  const buf = Buffer.from(b64, 'base64');
                  res.setHeader('Content-Type', mime);
                  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
                  res.writeHead(200);
                  res.end(buf);
                  return;
                }
              } catch { /* not JSON, send raw */ }
            }
            sendError(res, 404, 'Image not found');
            return;
          }
          if (subAction === 'exists') {
            // exists should NOT create directories — use filePath directly
            const existsFp = filePath(key);
            sendJSON(res, 200, { exists: fs.existsSync(existsFp) });
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
      const prefix = decodeURIComponent(parts.slice(3).join('/') || '');
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
      const prefix = decodeURIComponent(parts.slice(3).join('/') || '');
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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[StorageServer] Listening on http://0.0.0.0:${PORT}`);
  console.log(`[StorageServer] Health: http://localhost:${PORT}/healthz`);
});

process.on('SIGINT', () => {
  console.log('\n[StorageServer] Shutting down...');
  server.close(() => process.exit(0));
});
process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
