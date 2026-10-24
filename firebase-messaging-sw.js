importScripts('https://www.gstatic.com/firebasejs/13.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/13.0.0/firebase-messaging-compat.js');

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification.data?.url || '/#alertas';
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
    const existing = windows.find(client => 'focus' in client);
    return existing ? existing.focus().then(() => existing.navigate(target)) : clients.openWindow(target);
  }));
});

fetch('/api/firebase/config', { cache: 'no-store' })
  .then(response => response.json())
  .then(({ config, configured }) => {
    if (!configured || !config) return;
    firebase.initializeApp(config);
    const messaging = firebase.messaging();
    messaging.onBackgroundMessage(payload => {
      const title = payload.data?.title || 'Nueva alerta de INETER';
      const options = {
        body: payload.data?.body || 'Consulta el aviso publicado en la plataforma.',
        icon: '/assets/ineter-logo.png',
        data: { url: payload.data?.url || '/#alertas' }
      };
      self.registration.showNotification(title, options);
    });
  })
  .catch(error => console.warn('No se pudo iniciar Firebase Messaging en segundo plano:', error));
