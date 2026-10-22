/**
 * Single-origin production/dev server:
 *  - `/api/*` and `/socket.io/*` are proxied to the backend (including
 *    WebSocket upgrades), so the browser only ever talks to ONE origin and
 *    session cookies work without cross-site configuration.
 *  - everything else is served by Next.js.
 *
 * For split-origin deployments (e.g. Vercel + separate API host) run Next
 * directly (`next start`) and set NEXT_PUBLIC_API_URL instead — see
 * DEPLOYMENT.md.
 */
import { createServer } from 'node:http';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import next from 'next';
import httpProxy from 'http-proxy';

const webRoot = dirname(fileURLToPath(import.meta.url));
const dev = process.env.NODE_ENV !== 'production';
const port = Number(process.env.PORT || 3000);
const apiTarget = process.env.API_ORIGIN || 'http://127.0.0.1:4000';

const app = next({ dev, dir: webRoot });
const handle = app.getRequestHandler();
const proxy = httpProxy.createProxyServer({ target: apiTarget, changeOrigin: true });

proxy.on('error', (err, _req, res) => {
  console.error('[proxy]', err.message);
  const r = res;
  if (r && 'writeHead' in r && !r.headersSent) {
    r.writeHead(502, { 'content-type': 'application/json' });
  }
  if (r && 'end' in r) r.end(JSON.stringify({ error: { code: 'UPSTREAM_UNAVAILABLE', message: 'API unavailable' } }));
});

await app.prepare();

const server = createServer((req, res) => {
  const url = req.url ?? '/';
  if (url.startsWith('/api/') || url.startsWith('/socket.io/')) {
    proxy.web(req, res);
    return;
  }
  handle(req, res);
});

server.on('upgrade', (req, socket, head) => {
  const url = req.url ?? '/';
  if (url.startsWith('/socket.io/') || url.startsWith('/api/')) {
    proxy.ws(req, socket, head);
    return;
  }
  socket.destroy();
});

server.listen(port, '0.0.0.0', () => {
  console.log(`[web] ready on http://0.0.0.0:${port} (api → ${apiTarget})`);
});
