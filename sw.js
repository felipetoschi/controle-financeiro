// Service worker: guarda os arquivos do app para ele abrir mesmo sem internet.
// Ao alterar qualquer arquivo do app, aumente o número da versão abaixo.
const CACHE = 'controle-financeiro-v2';

const ARQUIVOS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' evita pegar versões antigas guardadas pelo navegador.
  const pedidos = ARQUIVOS.map((url) => new Request(url, { cache: 'reload' }));
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(pedidos)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// Responde do cache na hora e atualiza o cache em segundo plano.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const salvo = await cache.match(e.request, { ignoreSearch: true });
      const daRede = fetch(e.request)
        .then((resp) => {
          if (resp.ok && new URL(e.request.url).origin === location.origin) cache.put(e.request, resp.clone());
          return resp;
        })
        .catch(() => salvo);
      return salvo || daRede;
    })
  );
});
