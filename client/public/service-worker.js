const SHELL_CACHE = 'mkm-shell-v1';
const ASSET_CACHE = 'mkm-assets-v1';
const APP_SHELL = '/';
const CACHEABLE_PATHS = ['/manifest.webmanifest', '/icons/'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll([APP_SHELL, '/manifest.webmanifest', '/icons/mkm-icon.svg']))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('mkm-') && ![SHELL_CACHE, ASSET_CACHE].includes(key))
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(APP_SHELL, copy));
          }
          return response;
        })
        .catch(async () => (await caches.match(APP_SHELL)) ?? Response.error()),
    );
    return;
  }

  const shouldCache = url.pathname.startsWith('/assets/')
    || CACHEABLE_PATHS.some((path) => url.pathname.startsWith(path));
  if (!shouldCache) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        const cacheControl = response.headers.get('Cache-Control') ?? '';
        if (response.ok && !/private|no-store/i.test(cacheControl)) {
          const copy = response.clone();
          caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});
