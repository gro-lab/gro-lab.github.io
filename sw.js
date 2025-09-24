// Service Worker for consiliereonline.com
// Version: 3.3 - Fixed navigation preload handling
const CACHE_VERSION = '3.3'; // Increment version to trigger update
const CACHE_NAME = `consiliereonline-v${CACHE_VERSION}`;
const OFFLINE_PAGE = '/404.html';

// Core assets to cache during installation
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/script.js',
  OFFLINE_PAGE,
  '/manifest.json'
];

// Dynamic assets (workshop images)
const DYNAMIC_ASSETS = [
  '/consiliere-online-razvan-mischie-event-1.webp',
  '/consiliere-online-razvan-mischie-event-2.webp',
  '/consiliere-online-razvan-mischie-event-3.webp',
  '/consiliere-online-razvan-mischie-event-4.webp',
  '/consiliere-online-razvan-mischie-event-5.webp'
];

// Optional assets
const OPTIONAL_ASSETS = [
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon-32x32.png',
  '/icons/favicon-16x16.png',
  '/favicon.ico'
];

// ===== INSTALLATION =====
self.addEventListener('install', (event) => {
  console.log('[ServiceWorker] Installing version:', CACHE_VERSION);
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[ServiceWorker] Caching core assets');
        return cache.addAll(CORE_ASSETS)
          .then(() => {
            console.log('[ServiceWorker] Caching dynamic assets');
            return Promise.all(
              DYNAMIC_ASSETS.map(url => {
                return fetch(url, { cache: 'reload' })
                  .then(response => {
                    if (response.ok) return cache.put(url, response);
                    throw new Error(`Bad response for ${url}: ${response.status}`);
                  })
                  .catch(err => {
                    console.warn(`[ServiceWorker] Failed to cache ${url}:`, err);
                  });
              })
            );
          })
          .then(() => {
            console.log('[ServiceWorker] Caching optional assets');
            return Promise.all(
              OPTIONAL_ASSETS.map(url => {
                return fetch(url, { cache: 'reload' })
                  .then(response => {
                    if (response.ok) {
                      return cache.put(url, response);
                    }
                  })
                  .catch(err => {
                    console.info(`[ServiceWorker] Optional asset not found: ${url}`);
                  });
              })
            );
          });
      })
      .catch(err => {
        console.error('[ServiceWorker] Installation failed:', err);
        throw err;
      })
  );
});

// ===== MESSAGE HANDLER FOR SKIP WAITING =====
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[ServiceWorker] Received skipWaiting message');
    self.skipWaiting();
  }
});

// ===== FIXED FETCH HANDLER WITH PROPER NAVIGATION PRELOAD =====
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests and cross-origin requests
  if (request.method !== 'GET' || !url.origin.startsWith(self.location.origin)) {
    return;
  }

  // For service worker file itself, always fetch from network
  if (url.pathname.endsWith('/sw.js')) {
    event.respondWith(fetch(request));
    return;
  }

  // FIXED: Handle navigation requests with preload response
  if (request.mode === 'navigate') {
    event.respondWith(handleNavigationRequest(event));
    return;
  }

  // Strategy 1: Network-first for API calls
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then(networkResponse => {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME)
            .then(cache => cache.put(request, responseClone));
          return networkResponse;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Strategy 2: Cache-first for core assets
  if (CORE_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(request)
        .then(cached => cached || fetch(request))
    );
    return;
  }

  // Strategy 3: Stale-while-revalidate for dynamic assets
  if (DYNAMIC_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then(cached => {
        const networkFetch = fetch(request)
          .then(response => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME)
                .then(cache => cache.put(request, clone));
            }
            return response;
          })
          .catch(() => cached);
        
        return cached || networkFetch;
      })
    );
    return;
  }

  // Default: Network with cache fallback
  event.respondWith(
    fetch(request)
      .catch(() => {
        if (request.headers.get('Accept') && request.headers.get('Accept').includes('text/html')) {
          return caches.match(OFFLINE_PAGE);
        }
      })
  );
});

// ===== NEW: PROPER NAVIGATION REQUEST HANDLER =====
async function handleNavigationRequest(event) {
  const { request, preloadResponse } = event;
  
  try {
    // First, try to use the preloaded response
    const preloadedResponse = await preloadResponse;
    if (preloadedResponse) {
      console.log('[ServiceWorker] Using preloaded response for:', request.url);
      return preloadedResponse;
    }
  } catch (error) {
    console.log('[ServiceWorker] Preload failed, falling back to cache/network:', error);
  }
  
  // If no preload response, try cache first
  try {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      console.log('[ServiceWorker] Found navigation request in cache:', request.url);
      return cachedResponse;
    }
  } catch (error) {
    console.warn('[ServiceWorker] Cache lookup failed:', error);
  }
  
  // Fallback to network
  try {
    console.log('[ServiceWorker] Fetching navigation request from network:', request.url);
    const networkResponse = await fetch(request);
    
    // Cache successful responses
    if (networkResponse.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone()).catch(err => {
        console.warn('[ServiceWorker] Failed to cache navigation response:', err);
      });
    }
    
    return networkResponse;
  } catch (error) {
    console.error('[ServiceWorker] Network fetch failed for navigation:', error);
    
    // Ultimate fallback - try to serve offline page or cached index
    const offlineResponse = await caches.match(OFFLINE_PAGE);
    if (offlineResponse) {
      return offlineResponse;
    }
    
    const indexResponse = await caches.match('/index.html');
    if (indexResponse) {
      return indexResponse;
    }
    
    // If all else fails, return a basic offline response
    return new Response(`
      <!DOCTYPE html>
      <html lang="ro">
        <head>
          <title>Offline - Consiliere Online</title>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { 
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
              text-align: center; 
              padding: 2rem; 
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
              min-height: 100vh;
              display: flex;
              flex-direction: column;
              justify-content: center;
              align-items: center;
              margin: 0;
            }
            h1 { margin-bottom: 1rem; }
            p { opacity: 0.9; margin-bottom: 2rem; }
            button {
              background: white;
              color: #667eea;
              border: none;
              padding: 1rem 2rem;
              border-radius: 8px;
              cursor: pointer;
              font-size: 1rem;
              font-weight: 600;
            }
            button:hover { background: #f0f0f0; }
          </style>
        </head>
        <body>
          <h1>Sunteți Offline</h1>
          <p>Nu se poate încărca pagina. Verificați conexiunea la internet și încercați din nou.</p>
          <button onclick="window.location.reload()">Reîncărcați Pagina</button>
        </body>
      </html>
    `, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 200
    });
  }
}

// ===== ACTIVATION =====
self.addEventListener('activate', (event) => {
  console.log('[ServiceWorker] Activating version:', CACHE_VERSION);
  
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('[ServiceWorker] Removing old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
    .then(() => {
      // Enable navigation preload if supported
      if (self.registration.navigationPreload) {
        return self.registration.navigationPreload.enable()
          .then(() => {
            console.log('[ServiceWorker] Navigation preload enabled');
          })
          .catch(error => {
            console.warn('[ServiceWorker] Navigation preload not supported:', error);
          });
      }
    })
    .then(() => {
      // Only claim clients after everything is ready
      return self.clients.claim();
    })
    .then(() => {
      console.log('[ServiceWorker] Activation complete, version:', CACHE_VERSION);
      
      // Notify all clients about the activation
      return self.clients.matchAll().then(clients => {
        clients.forEach(client => {
          client.postMessage({
            type: 'SERVICE_WORKER_ACTIVATED',
            version: CACHE_VERSION
          });
        });
      });
    })
  );
});

// ===== BACKGROUND SYNC =====
self.addEventListener('sync', (event) => {
  if (event.tag === 'update-content') {
    event.waitUntil(updateContent());
  }
});

async function updateContent() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(
    DYNAMIC_ASSETS.map(async (url) => {
      try {
        const response = await fetch(url, { cache: 'reload' });
        if (response.ok) await cache.put(url, response);
      } catch (err) {
        console.warn(`[ServiceWorker] Background sync failed for ${url}:`, err);
      }
    })
  );
}