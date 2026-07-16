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
  server: {
    port: 5173,
    host: '0.0.0.0',
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
