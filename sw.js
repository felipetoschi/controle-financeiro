// Service worker: guarda os arquivos do app para ele abrir mesmo sem internet.
// Ao alterar qualquer arquivo do app, aumente o número da versão abaixo.
const CACHE = 'controle-financeiro-v3';

const ARQUIVOS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './nuvem.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

// Biblioteca do Firebase: também fica guardada para o app abrir offline.
const CDN_FIREBASE = 'https://www.gstatic.com/firebasejs/';

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
// Outras requisições (login, banco de dados) passam direto, sem cache.
self.addEventListener('fetch', (e) => {
  const url = e.request.url;
  const doApp = new URL(url).origin === location.origin;
  if (e.request.method !== 'GET' || !(doApp || url.startsWith(CDN_FIREBASE))) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const salvo = await cache.match(e.request, { ignoreSearch: doApp });
      const daRede = fetch(e.request)
        .then((resp) => {
          if (resp.ok) cache.put(e.request, resp.clone());
          return resp;
        })
        .catch(() => salvo);
      return salvo || daRede;
    })
  );
});
