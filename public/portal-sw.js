// Service Worker do Portal do Cliente
// Responsabilidades:
//   - Ativar push notifications
//   - Exibir notificação quando uma push chega
//   - Abrir a guia certa quando o usuário clica na notificação

const SW_VERSION = 'portal-v2';

self.addEventListener('install', () => {
  // Ativa o novo SW imediatamente, sem esperar a aba fechar
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {
      title: 'Triar Contabilidade',
      body: event.data ? event.data.text() : '',
    };
  }

  const title = data.title || 'Triar Contabilidade';
  // Caminhos absolutos para o Android renderizar de forma confiável
  const origin = self.location.origin;
  const iconUrl = data.icon ? new URL(data.icon, origin).toString() : `${origin}/triar.png`;
  const options = {
    body: data.body || 'Nova atualização disponível.',
    icon: iconUrl,
    // Badge na status bar — Android usa só o canal alpha (silhueta).
    // Sem PNG monocromático separado, reusamos o ícone normal.
    badge: iconUrl,
    tag: data.tag,
    data: {
      url: data.url || '/portal',
    },
    requireInteraction: false,
    vibrate: [200, 100, 200],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/portal';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientsList) => {
        // Tenta focar uma aba do portal já aberta
        for (const client of clientsList) {
          if (client.url.includes('/portal')) {
            client.navigate(url);
            return client.focus();
          }
        }
        // Senão, abre nova
        if (self.clients.openWindow) {
          return self.clients.openWindow(url);
        }
      })
  );
});
