import { createServer } from 'node:http';
import { createServer as createHttp2Server } from 'node:http2';
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
import { googleIdentity } from './google-profiles.mjs';

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
  google = googleIdentity(trainerPlusEnv('GOOGLE_CLIENT_ID'), trainerPlusEnv('GOOGLE_ALLOWED_EMAILS')),
  http2 = false,
} = {}) {
  const store = typeof database === 'string' ? createStore(database) : database;
  const coaching = createCoaching(store, { respond, sampleFrames, estimate: posePool?.estimate, reviewLeaseMs, reviewHeartbeatMs });
  const api = createApi(store, { webOrigin, secureCookies, coaching, convertVideo, uploadIdleTimeoutMs, legacyReadBudgetBytes, google });
  const serve = createStaticHandler(dist, { google: Boolean(google) });
  const hosts = new Set(allowedHosts?.map((host) => host.trim().toLowerCase()).filter(Boolean)
    ?? ['localhost', '127.0.0.1', '[::1]']);

  const handle = async (req, res) => {
    try {
      const address = (req.headers[':authority'] ?? req.headers.host)?.toLowerCase();
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
  const server = http2 ? createHttp2Server({ settings: { maxConcurrentStreams: 32 } }, handle)
    : createServer({ headersTimeout: 15_000, requestTimeout: 105_000 }, handle);
  const sessions = new Set();
  if (http2) server.on('session', (session) => {
    sessions.add(session);
    session.on('error', () => {});
    session.once('close', () => sessions.delete(session));
  });
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
  const closeConnections = () => {
    if (http2) for (const session of sessions) session.destroy();
    else server.closeAllConnections();
  };
  return Object.assign(server, { stopCoaching, closeConnections });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 4173);
  const host = process.env.HOST ?? '127.0.0.1';
  const socket = trainerPlusEnv('SQL_SOCKET');
  const bucket = trainerPlusEnv('VIDEO_BUCKET');
  if (process.env.K_SERVICE && (!socket || !bucket || !trainerPlusEnv('GOOGLE_CLIENT_ID') || !trainerPlusEnv('ALLOWED_HOSTS'))) {
    throw new Error('Cloud Run requires Cloud SQL, a private video bucket, allowed hosts, and Google sign-in.');
  }
  let database;
  if (socket) {
    const { openPostgresStore } = await import('./postgres.mjs');
    const { createCloudMedia } = await import('./cloud-media.mjs');
    database = await openPostgresStore({ host: socket }, bucket ? createCloudMedia(bucket) : undefined);
    void database.flushMedia();
  }
  const server = createTrainerPlusServer({ database, http2: trainerPlusEnv('HTTP2') === '1' });
  server.listen(port, host, () => console.log(`Trainer Plus is running at http://${host}:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      server.close();
      void server.stopCoaching();
      setTimeout(server.closeConnections, 2000).unref();
    });
  }
}
