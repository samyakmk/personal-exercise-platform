import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApi } from './api.mjs';
import { createStore } from './store.mjs';

const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.jpg': 'image/jpeg',
  '.png': 'image/png', '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.ico': 'image/x-icon',
};

export function createRepformServer({
  database = process.env.REPFORM_DB ?? resolve('.data/repform.sqlite'),
  dist = resolve('dist'),
  webOrigin = process.env.REPFORM_WEB_ORIGIN,
  secureCookies = process.env.REPFORM_SECURE_COOKIES === '1',
} = {}) {
  const store = createStore(database);
  const api = createApi(store, { webOrigin, secureCookies });

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);

      if (!['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(405, { Allow: 'GET, HEAD' }).end();
        return;
      }
      const pathname = decodeURIComponent(url.pathname);
      let file = resolve(dist, '.' + pathname);
      if (file !== dist && !file.startsWith(dist + sep)) {
        res.writeHead(404).end();
        return;
      }
      if (!extname(pathname)) file = resolve(dist, 'index.html');
      const info = await stat(file).catch(() => null);
      if (!info?.isFile()) {
        res.writeHead(404).end('Not found');
        return;
      }

      const headers = {
        'Content-Type': types[extname(file)] ?? 'application/octet-stream',
        'Content-Length': info.size,
        'X-Content-Type-Options': 'nosniff',
      };
      res.writeHead(200, headers);
      if (req.method === 'HEAD') res.end();
      else createReadStream(file).on('error', () => res.destroy()).pipe(res);
    } catch (error) {
      if (res.headersSent) res.destroy();
      else res.writeHead(error instanceof URIError ? 400 : 500).end();
    }
  });
  server.on('close', () => store.close());
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 4173);
  const host = process.env.HOST ?? '127.0.0.1';
  createRepformServer().listen(port, host, () => console.log(`Repform is running at http://${host}:${port}`));
}
