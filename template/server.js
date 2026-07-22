import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { renderToString } from '@driftjs/runtime';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

async function startServer() {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'custom'
  });

  const server = http.createServer((req, res) => {
    vite.middlewares(req, res, async () => {
      try {
        const url = req.url || '/';

        let template = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8');
        template = await vite.transformIndexHtml(url, template);

        const componentModule = await vite.ssrLoadModule('./src/App.drift');
        const App = componentModule.default || componentModule;

        const appHtml = renderToString(App);

        const html = template.replace('<div id="app"></div>', `<div id="app">${appHtml}</div>`);

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      } catch (err) {
        vite.ssrFixStacktrace(err);
        console.error('SSR Error:', err);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(err.stack || err.message);
      }
    });
  });

  server.listen(PORT, () => {
    console.log(`\n🚀 DriftJS SSR Server running at http://localhost:${PORT}/\n`);
  });
}

startServer();
