// Service worker mínimo: permite instalar nontion como app (tablet y escritorio).
// No guarda nada en caché: páginas, pizarras y la interfaz siempre vienen de la API local.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
