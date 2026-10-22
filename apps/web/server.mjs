// Self-hosted Next server with SAME-ORIGIN API and WebSocket proxy. Never send browser traffic to localhost.
import http from 'node:http';
import path from 'node:path';
import dotenv from 'dotenv';
import next from 'next';
import proxyModule from 'http-proxy';
// Resolve the monorepo's root .env before reading WEB_PORT/API_INTERNAL_URL.
dotenv.config({ path: path.resolve(import.meta.dirname, '../../.env') });
const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev, dir: import.meta.dirname, hostname: '0.0.0.0', port: Number(process.env.WEB_PORT || 3000) });
await app.prepare();
const proxy = proxyModule.createProxyServer({ target: process.env.API_INTERNAL_URL || 'http://127.0.0.1:4000', ws: true, changeOrigin: false, xfwd: true });
proxy.on('error', (error, _req, res) => {
  console.error('API proxy unavailable:', error.message);
  if (res && 'writeHead' in res && !res.headersSent) { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { code: 'API_UNAVAILABLE', message: 'The API is temporarily unavailable.' } })); }
});
const handle = app.getRequestHandler();
const server = http.createServer((req, res) => {
  if (req.url?.startsWith('/api/') || req.url?.startsWith('/socket.io/')) proxy.web(req, res);
  else handle(req, res);
});
const handleUpgrade = app.getUpgradeHandler();
server.on('upgrade', (req, socket, head) => {
  if (req.url?.startsWith('/socket.io/')) proxy.ws(req, socket, head);
  else handleUpgrade(req, socket, head); // Next.js HMR also uses a WebSocket in development.
});
const port = Number(process.env.WEB_PORT || 3000);
server.listen(port, '0.0.0.0', () => console.log(`Cove web listening on 0.0.0.0:${port}`));
const shutdown = () => server.close(() => process.exit(0));
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
