import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createOpenAi } from './ai.mjs';
import { createCoaching } from './coaching.mjs';
import { createApi } from './api.mjs';
import { createStore } from './store.mjs';
import { createStaticHandler } from './static.mjs';
import { closeAfterResponse } from './http.mjs';
import { createPosePool } from './pose-pool.mjs';
import { trainerPlusEnv } from './config.mjs';

function defaultDatabase() {
  // Open the existing database in place so its WAL and active readers stay intact.
  const databases = ['trainer-plus', 'liftmorrow', 'repform'].map((name) => resolve('.data', name + '.sqlite'));
  return databases.find((database) => existsSync(database)) ?? databases[0];
}

export function createTrainerPlusServer({
  database = trainerPlusEnv('DB') ?? defaultDatabase(),
  dist = resolve('dist'),
  webOrigin = trainerPlusEnv('WEB_ORIGIN'),
  secureCookies = trainerPlusEnv('SECURE_COOKIES') === '1',
  respond = createOpenAi(),
  sampleFrames,
  posePool = sampleFrames ? null : createPosePool(),
  reviewLeaseMs,
  reviewHeartbeatMs,
  convertVideo,
  uploadIdleTimeoutMs,
  legacyReadBudgetBytes,
  allowedHosts = trainerPlusEnv('ALLOWED_HOSTS')?.split(','),
} = {}) {
  const store = createStore(database);
  const coaching = createCoaching(store, { respond, sampleFrames, estimate: posePool?.estimate, reviewLeaseMs, reviewHeartbeatMs });
  const api = createApi(store, { webOrigin, secureCookies, coaching, convertVideo, uploadIdleTimeoutMs, legacyReadBudgetBytes });
  const serve = createStaticHandler(dist);
  const hosts = new Set(allowedHosts?.map((host) => host.trim().toLowerCase()).filter(Boolean)
    ?? ['localhost', '127.0.0.1', '[::1]']);

  const handle = async (req, res) => {
    try {
      const address = req.headers.host?.toLowerCase();
      const hostname = address?.replace(/:\d+$/, '');
      if (!address || (!hosts.has(address) && !hosts.has(hostname))) {
        closeAfterResponse(req, res);
        res.writeHead(421, { 'Cache-Control': 'no-store' }).end('This host is not configured for Trainer Plus.');
        return;
      }
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);

      closeAfterResponse(req, res);
      await serve(req, res, url);
    } catch (error) {
      if (res.headersSent) res.destroy();
      else {
        closeAfterResponse(req, res);
        res.writeHead(error instanceof URIError ? 400 : 500).end();
      }
    }
  };
  const server = createServer({ headersTimeout: 15_000, requestTimeout: 105_000 }, handle);
  server.on('checkContinue', (req, res) => {
    closeAfterResponse(req, res);
    return handle(req, res);
  });
  let shutdown;
  const stopCoaching = () => {
    shutdown ??= coaching.stop().finally(() => posePool?.stop());
    return shutdown;
  };
  server.once('close', () => { void stopCoaching().then(() => store.close()); });
  return Object.assign(server, { stopCoaching });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 4173);
  const host = process.env.HOST ?? '127.0.0.1';
  const server = createTrainerPlusServer();
  server.listen(port, host, () => console.log(`Trainer Plus is running at http://${host}:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      server.close();
      void server.stopCoaching();
      setTimeout(() => server.closeAllConnections(), 2000).unref();
    });
  }
}
