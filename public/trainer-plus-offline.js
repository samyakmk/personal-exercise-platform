const cacheName = 'trainer-plus-shell-v1';
const shell = '/';
const appRoutes = new Set(['/', '/explore', '/workouts', '/sessions', '/progress', '/form-review', '/chat', '/photo-credits', '/profile']);

function staticAsset(path) {
  return /^\/(?:_expo\/static\/|assets\/).+\.[a-f\d]{32}\.[a-z]+$/i.test(path)
    || /^\/(?:_expo\/static\/|assets\/).+[.-][a-f\d]{32}\.[a-z]+$/i.test(path);
}

async function saveShell(cache, response) {
  if (!response.ok || !response.headers.get('Content-Type')?.startsWith('text/html')) return;
  const html = await response.clone().text();
  const critical = [...html.matchAll(/(?:src|href)="(\/[^"?#]+\.(?:js|css))"/g)]
    .map(([, path]) => path).filter(staticAsset);
  if (!critical.length) return;
  await Promise.all(critical.map(async (path) => {
    if (!await cache.match(path)) await cache.add(path);
  }));
  await cache.put(shell, response);
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    await saveShell(await caches.open(cacheName), await fetch(shell, { cache: 'reload' }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate' && appRoutes.has(url.pathname.replace(/\/$/, '') || '/')) {
    const cache = caches.open(cacheName);
    const live = fetch(request);
    event.waitUntil(Promise.all([cache, live]).then(([store, response]) => saveShell(store, response.clone())).catch(() => {}));
    event.respondWith(live.catch(async () => await (await cache).match(shell) ?? Response.error()));
  } else if (staticAsset(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(cacheName);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone()).catch(() => {});
      return response;
    })());
  }
});
