/* ============================================================
   MBBS STUDY COMMAND CENTER — sw.js
   Service Worker: offline-first caching strategy

   Strategy per resource type:
   ─ App shell (HTML, CSS, JS, manifest) → Cache-first, fallback network
   ─ Google Fonts                         → Stale-while-revalidate
   ─ Chart.js CDN                         → Cache-first (versioned URL)
   ─ API / dynamic data                   → Network-only (IndexedDB handles persistence)
   ─ Everything else                      → Network-first, fallback cache
   ============================================================ */

'use strict';

/* ────────────────────────────────────────────────────────────
   CACHE NAMES — bump CACHE_VERSION to force full refresh
──────────────────────────────────────────────────────────── */
const CACHE_VERSION   = 'v1.0.0';
const CACHE_SHELL     = `mbbs-shell-${CACHE_VERSION}`;
const CACHE_FONTS     = `mbbs-fonts-${CACHE_VERSION}`;
const CACHE_CDN       = `mbbs-cdn-${CACHE_VERSION}`;
const CACHE_RUNTIME   = `mbbs-runtime-${CACHE_VERSION}`;

const ALL_CACHES = [CACHE_SHELL, CACHE_FONTS, CACHE_CDN, CACHE_RUNTIME];

/* ────────────────────────────────────────────────────────────
   APP SHELL — pre-cached on install
   All paths relative to sw.js location (project root)
──────────────────────────────────────────────────────────── */
const SHELL_ASSETS = [
  './',
  './index.html',
  './style.css',
  './manifest.json',
  './js/db.js',
  './js/sessions.js',
  './js/stats.js',
  './js/streak.js',
  './js/countdown.js',
  './js/syllabus.js',
  './js/charts.js',
  './js/timer.js',
  './js/backup.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

/* CDN assets — cached on first use, then served cache-first */
const CDN_ORIGINS = [
  'https://cdn.jsdelivr.net',
];

/* Font origins — stale-while-revalidate */
const FONT_ORIGINS = [
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
];

/* ────────────────────────────────────────────────────────────
   INSTALL — pre-cache app shell
──────────────────────────────────────────────────────────── */
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_SHELL);

      // Cache shell assets individually so one failure doesn't
      // block the whole install.
      const results = await Promise.allSettled(
        SHELL_ASSETS.map(url =>
          cache.add(url).catch(err => {
            console.warn(`[SW] Failed to pre-cache: ${url}`, err);
          })
        )
      );

      const failed = results.filter(r => r.status === 'rejected').length;
      if (failed > 0) {
        console.warn(`[SW] Install: ${failed} asset(s) could not be cached.`);
      }

      console.log(`[SW] Install complete — ${CACHE_SHELL}`);

      // Take control immediately without waiting for old SW to finish
      await self.skipWaiting();
    })()
  );
});

/* ────────────────────────────────────────────────────────────
   ACTIVATE — clean up old caches
──────────────────────────────────────────────────────────── */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Delete any cache whose name is not in ALL_CACHES
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(key => !ALL_CACHES.includes(key))
          .map(key => {
            console.log(`[SW] Deleting old cache: ${key}`);
            return caches.delete(key);
          })
      );

      // Claim all open clients immediately
      await self.clients.claim();
      console.log(`[SW] Activated — ${CACHE_VERSION}`);

      // Notify all open tabs that a new version is active
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach(client => {
        client.postMessage({ type: 'SW_ACTIVATED', version: CACHE_VERSION });
      });
    })()
  );
});

/* ────────────────────────────────────────────────────────────
   FETCH — route requests to the right strategy
──────────────────────────────────────────────────────────── */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests
  if (request.method !== 'GET') return;

  // Chrome extensions & non-http(s) — ignore
  if (!url.protocol.startsWith('http')) return;

  // ── 1. Google Fonts → stale-while-revalidate ──────────────
  if (FONT_ORIGINS.some(o => url.origin === o || url.href.startsWith(o))) {
    event.respondWith(staleWhileRevalidate(request, CACHE_FONTS));
    return;
  }

  // ── 2. CDN assets (Chart.js, etc.) → cache-first ──────────
  if (CDN_ORIGINS.some(o => url.origin === o || url.href.startsWith(o))) {
    event.respondWith(cacheFirst(request, CACHE_CDN));
    return;
  }

  // ── 3. Same-origin app shell assets → cache-first ─────────
  if (url.origin === self.location.origin) {
    // Navigation requests (HTML pages) → network-first for freshness
    if (request.mode === 'navigate') {
      event.respondWith(networkFirstWithFallback(request, CACHE_SHELL));
      return;
    }

    // Static assets (CSS, JS, images, manifest) → cache-first
    const ext = url.pathname.split('.').pop().toLowerCase();
    if (['css', 'js', 'png', 'jpg', 'jpeg', 'svg', 'ico', 'webp', 'json'].includes(ext)) {
      event.respondWith(cacheFirst(request, CACHE_SHELL));
      return;
    }

    // Root path → cache-first (catches './' → index.html)
    if (url.pathname === '/' || url.pathname === '') {
      event.respondWith(cacheFirst(request, CACHE_SHELL));
      return;
    }
  }

  // ── 4. Everything else → network-first, runtime cache ─────
  event.respondWith(networkFirstWithFallback(request, CACHE_RUNTIME));
});

/* ────────────────────────────────────────────────────────────
   CACHING STRATEGIES
──────────────────────────────────────────────────────────── */

/**
 * Cache-First
 * Return cached response if available; otherwise fetch, cache, and return.
 * Best for: versioned/immutable assets (JS, CSS, CDN libs, icons).
 */
async function cacheFirst(request, cacheName) {
  try {
    const cache    = await caches.open(cacheName);
    const cached   = await cache.match(request);
    if (cached) return cached;

    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (err) {
    // Offline and not cached — return offline fallback if it's a navigation
    if (request.mode === 'navigate') return offlineFallback();
    console.warn('[SW] cache-first failed:', request.url, err);
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

/**
 * Network-First with Cache Fallback
 * Try network first for freshness; on failure serve stale cache.
 * Best for: HTML navigation, frequently-updated resources.
 */
async function networkFirstWithFallback(request, cacheName) {
  const cache = await caches.open(cacheName);

  try {
    const response = await fetch(request, { signal: timeoutSignal(5000) });

    if (response.ok || response.type === 'opaque') {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (_err) {
    // Network failed — try cache
    const cached = await cache.match(request);
    if (cached) return cached;

    // Nothing in cache either
    if (request.mode === 'navigate') return offlineFallback();
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

/**
 * Stale-While-Revalidate
 * Serve cached immediately; update cache in background.
 * Best for: fonts, semi-static resources.
 */
async function staleWhileRevalidate(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);

  // Kick off background revalidation regardless
  const fetchPromise = fetch(request)
    .then(response => {
      if (response.ok || response.type === 'opaque') {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => null);

  // Return cached immediately, or wait for network if nothing cached
  return cached || await fetchPromise ||
    new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
}

/* ────────────────────────────────────────────────────────────
   OFFLINE FALLBACK PAGE
──────────────────────────────────────────────────────────── */
async function offlineFallback() {
  // Try to return the cached index.html first
  const cache  = await caches.open(CACHE_SHELL);
  const cached = await cache.match('./index.html') ||
                 await cache.match('./') ||
                 await cache.match('/index.html');

  if (cached) return cached;

  // Last-resort inline offline page
  const html = `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>MBBS CMD — Offline</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{
      font-family:'Barlow',sans-serif;
      background:#07090f;
      color:#e8edf8;
      display:flex;
      flex-direction:column;
      align-items:center;
      justify-content:center;
      min-height:100vh;
      gap:20px;
      padding:24px;
      text-align:center;
    }
    .icon{font-size:4rem;color:#00d4ff;filter:drop-shadow(0 0 16px rgba(0,212,255,.4))}
    h1{font-size:1.6rem;font-weight:700;letter-spacing:.06em}
    p{color:#8a9bbf;font-size:.95rem;max-width:320px;line-height:1.6}
    button{
      margin-top:8px;
      padding:10px 28px;
      background:#00d4ff;
      color:#07090f;
      border:none;
      border-radius:999px;
      font-size:.9rem;
      font-weight:700;
      cursor:pointer;
    }
  </style>
</head>
<body>
  <div class="icon">⚕</div>
  <h1>You're Offline</h1>
  <p>No internet connection detected. Your study data is safe in local storage.</p>
  <button onclick="location.reload()">Try Again</button>
</body>
</html>`;

  return new Response(html, {
    status:  200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

/* ────────────────────────────────────────────────────────────
   HELPERS
──────────────────────────────────────────────────────────── */

/**
 * Returns an AbortSignal that fires after `ms` milliseconds.
 * Used to give network-first a reasonable timeout before
 * falling back to cache.
 */
function timeoutSignal(ms) {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

/* ────────────────────────────────────────────────────────────
   MESSAGE HANDLER
   Allows the app to communicate with the SW at runtime.
──────────────────────────────────────────────────────────── */
self.addEventListener('message', (event) => {
  const { type } = event.data || {};

  switch (type) {

    // Force the SW to activate immediately (called after user
    // dismisses the "update available" toast)
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;

    // Purge only the runtime cache (keeps shell intact)
    case 'CLEAR_RUNTIME_CACHE':
      caches.delete(CACHE_RUNTIME).then(() => {
        event.source?.postMessage({ type: 'RUNTIME_CACHE_CLEARED' });
      });
      break;

    // Return the current cache version to the app
    case 'GET_VERSION':
      event.source?.postMessage({ type: 'VERSION', version: CACHE_VERSION });
      break;

    default:
      break;
  }
});

/* ────────────────────────────────────────────────────────────
   BACKGROUND SYNC (if supported)
   Queues failed requests and retries when connectivity returns.
   Currently used as a hook; actual sync logic lives in app JS.
──────────────────────────────────────────────────────────── */
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-sessions') {
    // IndexedDB is the source of truth, nothing to sync to a server.
    // This hook is here so future cloud-sync can be wired in.
    console.log('[SW] Background sync: sync-sessions');
  }
});

/* ────────────────────────────────────────────────────────────
   PUSH NOTIFICATIONS (hook for future use)
──────────────────────────────────────────────────────────── */
self.addEventListener('push', (event) => {
  const data = event.data?.json() || {};
  const title   = data.title   || 'MBBS Command Center';
  const options = {
    body:    data.body    || 'Time to study!',
    icon:    './icons/icon-192.png',
    badge:   './icons/icon-192.png',
    tag:     data.tag     || 'mbbs-reminder',
    vibrate: [200, 100, 200],
    data:    { url: data.url || './' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || './';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clients => {
        // Focus existing window if open
        for (const client of clients) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            return client.focus();
          }
        }
        // Otherwise open a new window
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      })
  );
});
