import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

function apiProxyPlugin(): Plugin {
  return {
    name: 'api-proxy',
    configureServer(server) {
      server.middlewares.use('/__api_proxy', async (req, res) => {
        // CORS 预检
        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'access-control-allow-origin': '*',
            'access-control-allow-methods': '*',
            'access-control-allow-headers': '*',
          });
          res.end();
          return;
        }

        // 设置 CORS
        res.setHeader('access-control-allow-origin', '*');

        // 从 URL 参数和自定义头中提取目标信息
        const parsed = new URL(req.url || '', `http://${req.headers.host}`);
        const targetUrl = parsed.searchParams.get('url');
        if (!targetUrl) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Missing url parameter' }));
          return;
        }

        const targetMethod = (req.headers['x-target-method'] as string) || 'GET';
        const targetHeadersRaw = (req.headers['x-target-headers'] as string) || '{}';
        let targetHeaders: Record<string, string> = {};
        try { targetHeaders = JSON.parse(targetHeadersRaw); } catch {}

        // 收集请求 body
        const chunks: Uint8Array[] = [];
        for await (const chunk of req) {
          chunks.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : new Uint8Array(chunk));
        }
        const totalLen = chunks.reduce((s, c) => s + c.length, 0);
        const body = new Uint8Array(totalLen);
        let offset = 0;
        for (const c of chunks) { body.set(c, offset); offset += c.length; }

        console.log(`[ApiProxy] ${targetMethod} ${targetUrl} (${body.length}B)`);

        try {
          const fetchHeaders = new Headers();
          for (const [k, v] of Object.entries(targetHeaders)) {
            // 跳过代理专用头
            if (k.startsWith('x-target-') || k === 'host') continue;
            fetchHeaders.set(k, v);
          }

          // CRITICAL: Forward the incoming Content-Type header for FormData uploads.
          // When the browser sends a fetch() with FormData body, it auto-generates
          // Content-Type: multipart/form-data; boundary=... which is required for the
          // target server to parse the form fields correctly (e.g. file uploads to catbox).
          const incomingContentType = req.headers['content-type'];
          if (incomingContentType && !fetchHeaders.has('content-type')) {
            fetchHeaders.set('content-type', incomingContentType);
          }

          const resp = await fetch(targetUrl, {
            method: targetMethod,
            headers: fetchHeaders,
            body: body.length > 0 ? body : undefined,
          });

          const respBuf = new Uint8Array(await resp.arrayBuffer());
          resp.headers.forEach((v, k) => {
            if (k !== 'content-encoding' && k !== 'transfer-encoding') {
              res.setHeader(k, v);
            }
          });

          res.writeHead(resp.status);
          res.end(Buffer.from(respBuf));
        } catch (err: any) {
          console.error(`[ApiProxy] Error:`, err.message);
          res.writeHead(502);
          res.end(JSON.stringify({ error: 'Proxy error', detail: err.message }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), apiProxyPlugin()],
  root: '.',
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version || '0.2.3'),
  },
  server: {
    port: 5174,
    host: '0.0.0.0',
    proxy: {
      // 将 /api/storage 代理到本地存储服务（端口 3002）
      // 这样无论从 localhost、IP、还是反向代理访问，只要请求到了 Vite
      // 存储请求就会自动转发到存储服务，不会因为 URL 不同而丢失数据
      '/api/storage': {
        target: 'http://127.0.0.1:3002',
        changeOrigin: true,
      },
      '/api/images': {
        target: 'http://127.0.0.1:3002',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist-web',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'index.html'),
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
})
