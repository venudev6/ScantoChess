const CACHE_NAME = 'scan-to-chess-v5';
// Add all local assets and key CDN assets to the cache
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.svg',
  '/dist/bundle.js',
  'https://pub-820795c92eeb4491bb7106d80626755b.r2.dev/best_mobile.onnx',
  '/styles/global.css',
  '/styles/components.css',
  '/styles/layouts.css',
  '/components/ui/CapturedPieces.css',
  '/components/Chessboard.css',
  '/components/views/InitialView.css',
  '/components/views/CameraView.css',
  '/components/views/ImagePreview.css',
  '/components/views/PdfView.css',
  '/components/views/LoadingView.css',
  '/components/views/ResultView.css',
  '/components/views/SolveView.css',
  '/components/ui/MoveHistory.css',
  '/components/views/LoginView.css',
  '/components/views/AdminView.css',
  '/components/ui/UserMenu.css',
  '/components/views/HistoryView.css',
  '/components/ui/ConfirmationDialog.css',
  '/components/views/SavedGamesView.css',
  '/components/result/EditorBoard.css',
  '/components/result/EditorControls.css',
  '/components/result/UserPanel.css',
  '/components/views/ProfileView.css',
  '/components/ui/PieceSetSelectorModal.css',
  '/components/ui/UpdatePrompt.css',
  'https://aistudiocdn.com/react-image-crop@^11.0.10/dist/ReactCrop.css',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Merriweather:wght@400;700&display=swap',
  'https://accounts.google.com/gsi/client',
  'https://apis.google.com/js/api.js',
  'https://aistudiocdn.com/react-dom@^19.1.1',
  'https://aistudiocdn.com/react@^19.1.1',
  'https://aistudiocdn.com/pdfjs-dist@4.10.38/build/pdf.worker.mjs',
  'https://aistudiocdn.com/pdfjs-dist@4.10.38/build/pdf.mjs',
  'https://aistudiocdn.com/chess.js@^1.4.0',
  'https://aistudiocdn.com/react-image-crop@^11.0.10',
  // Client-side pipeline dependencies
  'https://docs.opencv.org/4.9.0/opencv.js',
  'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
  'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache and caching assets');
        return cache.addAll(urlsToCache.map(url => new Request(url, { mode: 'cors' })));
      }).catch(err => {
        console.error('Failed to cache assets during install:', err);
      })
  );
});

self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  return self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const url = new URL(event.request.url);

  // For critical app files (HTML, JS bundle) and navigation, use a network-first strategy.
  // This ensures users who are online always get the latest version.
  const isAppShell = url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/dist/bundle.js' || url.pathname === '/manifest.json';
  if (isAppShell || event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // If the network request is successful, cache the response and return it.
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
          return response;
        })
        .catch(() => {
          // If the network fails, try to serve from the cache.
          return caches.match(event.request);
        })
    );
    return;
  }

  // For all other assets (fonts, CDN libraries, etc.), use a cache-first strategy for performance.
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Cache hit - return response
        if (response) {
          return response;
        }

        // Not in cache, fetch from network and then cache the new response.
        return fetch(event.request).then(
          (response) => {
            if (!response || (response.status !== 200 && response.type !== 'opaque' && response.type !== 'cors')) {
              return response;
            }
            const responseToCache = response.clone();
            caches.open(CACHE_NAME)
              .then((cache) => {
                 cache.put(event.request, responseToCache);
              });
            return response;
          }
        );
      })
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
