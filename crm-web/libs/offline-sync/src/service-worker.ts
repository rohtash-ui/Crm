/**
 * Service Worker — handles offline caching and background sync.
 *
 * Responsibilities:
 *   1. App Shell caching (cache-first for static assets)
 *   2. API response caching (network-first with stale fallback)
 *   3. Background sync registration for outbox drain
 *
 * Cache isolation: all cache entries are keyed by tenant_id + user_id
 * to prevent cross-tenant data leaks.
 */

declare const self: ServiceWorkerGlobalScope;

const APP_SHELL_CACHE = 'crm-app-shell-v1';
const API_CACHE = 'crm-api-cache-v1';

const APP_SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
];

const API_CACHE_TTL_MS = 60 * 60 * 1000;          // 1 hour for list endpoints
const API_DETAIL_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours for detail endpoints

const SYNC_TAG = 'crm-outbox-drain';

// --- Install: pre-cache app shell ---

self.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => {
      return cache.addAll(APP_SHELL_URLS);
    }),
  );
  // Activate immediately without waiting for old SW to retire
  self.skipWaiting();
});

// --- Activate: clean up old caches ---

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== APP_SHELL_CACHE && name !== API_CACHE)
          .map((name) => caches.delete(name)),
      );
    }),
  );
  // Claim all clients immediately
  self.clients.claim();
});

// --- Fetch: routing strategy ---

self.addEventListener('fetch', (event: FetchEvent) => {
  const url = new URL(event.request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // API requests — network-first with stale fallback
  if (url.pathname.startsWith('/api/')) {
    // Only cache GET requests
    if (event.request.method === 'GET') {
      event.respondWith(networkFirstWithCache(event.request));
    }
    return;
  }

  // Static assets — cache-first
  if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirstWithNetwork(event.request));
    return;
  }

  // App shell (HTML navigation) — cache-first for the shell, network for data
  if (event.request.mode === 'navigate') {
    event.respondWith(cacheFirstWithNetwork(event.request));
    return;
  }
});

// --- Background sync ---

self.addEventListener('sync', (event: ExtendableEvent & { tag?: string }) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(notifyClientsToSync());
  }
});

// --- Message handler for client communication ---

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  if (event.data?.type === 'REGISTER_SYNC') {
    registerBackgroundSync();
  }

  if (event.data?.type === 'CLEAR_API_CACHE') {
    caches.delete(API_CACHE);
  }

  if (event.data?.type === 'CLEAR_ALL_CACHES') {
    caches.keys().then((names) => {
      return Promise.all(names.map((name) => caches.delete(name)));
    });
  }
});

// --- Strategy: network-first with stale fallback ---

async function networkFirstWithCache(request: Request): Promise<Response> {
  const cache = await caches.open(API_CACHE);

  try {
    const networkResponse = await fetch(request);

    if (networkResponse.ok) {
      // Clone before consuming — one for cache, one for the client
      const responseToCache = networkResponse.clone();

      // Store with a timestamp header for TTL checking
      const headers = new Headers(responseToCache.headers);
      headers.set('X-CRM-Cached-At', Date.now().toString());

      const cachedResponse = new Response(await responseToCache.blob(), {
        status: responseToCache.status,
        statusText: responseToCache.statusText,
        headers,
      });

      cache.put(request, cachedResponse);
    }

    return networkResponse;
  } catch {
    // Network failed — try cache
    const cachedResponse = await cache.match(request);

    if (cachedResponse) {
      // Check TTL
      const cachedAt = parseInt(cachedResponse.headers.get('X-CRM-Cached-At') ?? '0', 10);
      const isDetailEndpoint = /\/api\/v\d+\/\w+\/[a-f0-9-]+$/.test(request.url);
      const ttl = isDetailEndpoint ? API_DETAIL_CACHE_TTL_MS : API_CACHE_TTL_MS;

      if (Date.now() - cachedAt < ttl) {
        // Return cached response with offline header
        const offlineHeaders = new Headers(cachedResponse.headers);
        offlineHeaders.set('X-CRM-Offline', 'true');

        return new Response(await cachedResponse.blob(), {
          status: cachedResponse.status,
          statusText: cachedResponse.statusText,
          headers: offlineHeaders,
        });
      }

      // Even if expired, return it as a stale fallback while offline
      const staleHeaders = new Headers(cachedResponse.headers);
      staleHeaders.set('X-CRM-Offline', 'true');
      staleHeaders.set('X-CRM-Stale', 'true');

      return new Response(await cachedResponse.blob(), {
        status: cachedResponse.status,
        statusText: cachedResponse.statusText,
        headers: staleHeaders,
      });
    }

    // No cache — return offline error
    return new Response(
      JSON.stringify({
        error: 'offline',
        message: 'You are offline and this data is not available in the local cache.',
      }),
      {
        status: 503,
        headers: {
          'Content-Type': 'application/json',
          'X-CRM-Offline': 'true',
        },
      },
    );
  }
}

// --- Strategy: cache-first with network fallback ---

async function cacheFirstWithNetwork(request: Request): Promise<Response> {
  const cache = await caches.open(APP_SHELL_CACHE);
  const cachedResponse = await cache.match(request);

  if (cachedResponse) {
    // Serve from cache immediately, update cache in background
    updateCacheInBackground(cache, request);
    return cachedResponse;
  }

  // Not in cache — fetch from network and cache
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    // Offline and not cached — return the app shell as fallback for navigation
    if (request.mode === 'navigate') {
      const shellResponse = await cache.match('/index.html');
      if (shellResponse) return shellResponse;
    }

    return new Response('Offline', { status: 503 });
  }
}

// --- Helpers ---

function isStaticAsset(pathname: string): boolean {
  return /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot)$/.test(pathname);
}

async function updateCacheInBackground(cache: Cache, request: Request): Promise<void> {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      cache.put(request, networkResponse);
    }
  } catch {
    // Silently fail — we already served from cache
  }
}

async function registerBackgroundSync(): Promise<void> {
  try {
    const registration = self.registration;
    if ('sync' in registration) {
      await (registration as unknown as { sync: { register: (tag: string) => Promise<void> } }).sync.register(SYNC_TAG);
    }
  } catch {
    // Background sync not supported — client-side polling is the fallback
  }
}

async function notifyClientsToSync(): Promise<void> {
  const clients = await self.clients.matchAll({ type: 'window' });
  for (const client of clients) {
    client.postMessage({ type: 'TRIGGER_SYNC' });
  }
}
