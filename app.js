const $ = selector => document.querySelector(selector);
const modal = $('#modal');
const obsModal = $('#obs-modal');
let appState = null;
let currentView = 'inicio';
let presenceTimer = null;
let presenceBusy = false;
let streamEventSource = null;
let authMode = 'login';
let authState = { professional: null, hasProfessionals: false };
let renderedRecordingSignature = null;
let renderedHomeRecordingSignature = null;
let recordingFilter = 'all';
let recordingsFilterRequest = 0;
const platformSymbols = { YouTube: '▶', Twitch: '▣', Facebook: 'f', TikTok: '♪', Personalizado: '↗' };
const platformClasses = { YouTube: 'youtube', Twitch: 'twitch', Facebook: 'facebook', TikTok: 'tiktok', Personalizado: 'personalizado' };
const recordingCategories = {
  registro_historico: 'Registro Histórico',
  capacitacion: 'Material de Capacitación',
  educativo: 'Material Educativo',
  streamings_finalizados: 'Streamings Finalizados',
  fenomenos_meteorologicos: 'Explicación de Fenómenos Meteorológicos'
};
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]); }
function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 3500); }
const publishedAlertList = $('#published-alert-list');
if (publishedAlertList) {
  publishedAlertList.replaceChildren();
  $('#published-alert-count').textContent = 'SIN AVISOS PUBLICADOS';
}
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Error ${response.status}`);
  return body;
}
async function sendPresence() {
  if (!authState.professional || presenceBusy || document.hidden) return;
  presenceBusy = true;
  const view = currentView === 'inicio' && (appState?.live || appState?.videoBroadcast?.status === 'en vivo') ? 'streaming' : currentView;
  try { await api('/api/presence', { method: 'POST', body: JSON.stringify({ view }) }); }
  catch { /* La presencia vence sola si el navegador pierde conexión. */ }
  finally { presenceBusy = false; }
}
function syncPresence() {
  if (!authState.professional) { clearInterval(presenceTimer); presenceTimer = null; return; }
  sendPresence();
  if (!presenceTimer) presenceTimer = setInterval(sendPresence, 25_000);
}
function syncStreamEvents() {
  if (!authState.professional) {
    streamEventSource?.close();
    streamEventSource = null;
    return;
  }
  if (streamEventSource || !window.EventSource) return;
  streamEventSource = new EventSource('/api/stream/events');
  streamEventSource.addEventListener('stats', event => {
    lastStreamStats = JSON.parse(event.data);
    renderStreamStats(lastStreamStats);
  });
  streamEventSource.addEventListener('reaction', event => {
    const data = JSON.parse(event.data);
    renderLiveReaction(data.emoji);
  });
}
function renderDestinations() {
  const destinations = appState?.destinations || [];
  $('#platform-list').innerHTML = destinations.map(d => {
    const labels = { conectando: 'Conectando', enviando: 'Enviando señal', detenido: 'Detenido', error: 'Error de salida' };
    const status = appState?.live ? (labels[d.outputStatus] || 'Esperando salida') : 'Listo';
    return `<div class="platform-row"><span class="platform-icon ${platformClasses[d.platform] || 'personalizado'}">${platformSymbols[d.platform] || '↗'}</span><span class="platform-meta"><b>${escapeHtml(d.name)}</b><small>${escapeHtml(d.platform)} · Clave cifrada</small></span><span class="row-live ${d.outputStatus === 'error' ? 'output-error' : ''}">● ${escapeHtml(status)}</span><button class="remove-destination" data-remove="${escapeHtml(d.id)}" aria-label="Quitar ${escapeHtml(d.name)}">×</button></div>`;
  }).join('');
  $('#nav-count').textContent = destinations.length;
  $('#dest-status').textContent = `${destinations.length} ${destinations.length === 1 ? 'DESTINO' : 'DESTINOS'}`;
  $('#dest-status').classList.toggle('ready', destinations.length > 0);
  $('#check-dest').checked = destinations.length > 0;
}
function renderRecordings(force = false) {
  const records = appState?.recordings || [];
  const visibleRecords = recordingFilter === 'all' ? records : records.filter(record => record.category === recordingFilter);
  const total = appState?.recordingTotalCount ?? records.length;
  $('#recording-count').textContent = `${total} ${total === 1 ? 'archivo' : 'archivos'}`;
  $('#home-recording-count').textContent = `${total} ${total === 1 ? 'archivo' : 'archivos'}`;
  $('#home-recording-summary').textContent = `${total} ${total === 1 ? 'video' : 'videos'}`;
  const signature = `${recordingFilter}|${records.map(record => `${record.url}:${record.createdAt}:${record.category || ''}:${record.thumbnailUrl || ''}:${record.subtitlesUrl || ''}`).join('|')}`;
  const cards = visibleRecords.length ? visibleRecords.map(record => {
    const title = record.title || record.name;
    const subtitleLanguage = record.subtitleLanguage || 'es';
    const category = recordingCategories[record.category] || recordingCategories.streamings_finalizados;
    const track = record.subtitlesUrl
      ? `<track kind="captions" src="${escapeHtml(record.subtitlesUrl)}" srclang="${escapeHtml(subtitleLanguage)}" label="${escapeHtml(subtitleLanguage === 'es' ? 'Español' : subtitleLanguage)}" default />`
      : '';
    return `<article class="vod-card"><div class="vod-player"><video controls preload="metadata" playsinline aria-label="Reproducir ${escapeHtml(title)}"${record.thumbnailUrl ? ` poster="${escapeHtml(record.thumbnailUrl)}"` : ''}><source src="${escapeHtml(record.url)}" type="video/mp4">${track}Tu navegador no puede reproducir este video.</video></div><div class="vod-details"><div><b>${escapeHtml(title)}</b><small>${new Date(record.createdAt).toLocaleString()} · ${formatSize(record.size)}${record.subtitlesUrl ? ' · Subtítulos disponibles' : ''}</small><span class="vod-category">${escapeHtml(category)}</span></div><a class="download-recording" href="${escapeHtml(record.url)}" download>Descargar ↓</a></div></article>`;
  }).join('') : `<div class="empty-recordings">${records.length ? 'No hay videos en esta categoría.' : 'Aún no hay videos disponibles en la biblioteca.'}</div>`;
  for (const [selector, signatureKey] of [['#recording-list', 'vod'], ['#home-recording-list', 'home']]) {
    const list = $(selector);
    const oldSignature = signatureKey === 'vod' ? renderedRecordingSignature : renderedHomeRecordingSignature;
    if (!force && signature === oldSignature) continue;
    const playerInUse = [...list.querySelectorAll('video')].some(video => !video.ended && (video.currentTime > 0 || !video.paused));
    if (!force && oldSignature !== null && playerInUse) continue;
    list.innerHTML = cards;
    if (signatureKey === 'vod') renderedRecordingSignature = signature;
    else renderedHomeRecordingSignature = signature;
  }
}
$('#recording-category-filters').addEventListener('click', async event => {
  const button = event.target.closest('[data-recording-category]');
  if (!button) return;
  recordingFilter = button.dataset.recordingCategory;
  const requestId = ++recordingsFilterRequest;
  document.querySelectorAll('[data-recording-category]').forEach(item => {
    const active = item === button;
    item.classList.toggle('active', active);
    item.setAttribute('aria-pressed', String(active));
  });
  renderRecordings(true);
  try {
    const result = await api(`/api/recordings?category=${encodeURIComponent(recordingFilter)}`);
    if (requestId !== recordingsFilterRequest) return;
    appState = { ...(appState || {}), recordings: result.recordings, recordingTotalCount: result.total };
    renderRecordings(true);
  } catch (error) {
    if (requestId === recordingsFilterRequest) toast(`No se pudo filtrar la biblioteca: ${error.message}`);
  }
});
function renderBroadcastAlerts(alerts = []) {
  const list = $('#published-alert-list');
  if (!list) return;
  const items = Array.isArray(alerts) ? [...new Map(alerts.filter(alert => alert?.id).map(alert => [alert.id, alert])).values()] : [];
  $('#published-alert-count').textContent = items.length ? `${items.length} AVISO${items.length === 1 ? '' : 'S'}` : 'SIN AVISOS PUBLICADOS';
  list.innerHTML = items.length ? items.map(alert => `<article class="published-alert-card severity-${escapeHtml(alert.severity)}"><div class="broadcast-alert-top"><h3>${escapeHtml(alert.title)}</h3><span class="tag ${alert.severity === 'urgente' ? 'danger' : alert.severity === 'precaucion' ? 'warning' : 'neutral'}">${escapeHtml(alert.severityLabel || alert.severity)}</span></div><div class="broadcast-alert-meta"><b>${escapeHtml(alert.categoryLabel || alert.category)}</b><span>${escapeHtml(alert.location || 'Nicaragua')}</span><time>${new Date(alert.createdAt).toLocaleString('es-NI')}</time></div><p>${escapeHtml(alert.message).replace(/\r?\n/g, '<br>')}</p><div class="broadcast-alert-meta"><span>Publicado por ${escapeHtml(alert.author || 'INETER')}</span><a href="${escapeHtml(alert.sourceUrl)}" target="_blank" rel="noopener">${escapeHtml(alert.sourceName || 'Ver fuente oficial')} ↗</a></div></article>`).join('') : '<p class="empty-recordings">No hay avisos de difusión publicados.</p>';
}
document.addEventListener('firebase-alerts-updated', event => {
  if (!Array.isArray(event.detail)) return;
  if (!appState) appState = {};
  appState.alerts = event.detail;
  renderBroadcastAlerts(event.detail);
  announceNewBroadcast(event.detail);
});
let knownBroadcastAlertIds = null;
function announceNewBroadcast(alerts = []) {
  if (!Array.isArray(alerts)) return;
  if (knownBroadcastAlertIds === null) { knownBroadcastAlertIds = new Set(alerts.map(alert => alert.id)); return; }
  const incoming = alerts.filter(alert => !knownBroadcastAlertIds.has(alert.id));
  alerts.forEach(alert => knownBroadcastAlertIds.add(alert.id));
  if (knownBroadcastAlertIds.size > 300) knownBroadcastAlertIds = new Set(alerts.map(alert => alert.id));
  if (incoming.length) toast(`Nueva alerta ${incoming[0].categoryLabel || ''}: ${incoming[0].title}`);
}
async function reviewAgriculture(event) {
  event.preventDefault();
  const location = $('#farm-location').value.trim();
  const crop = $('#farm-crop').value;
  const soil = $('#soil-condition').value;
  const rain = $('#rain-outlook').value;
  const result = $('#agriculture-result');
  let title, message, status;
  if (soil === 'waterlogged') {
    status = 'hold'; title = 'Espera y revisa el drenaje';
    message = 'El suelo encharcado o saturado no cumple la condición de humedad recomendada para iniciar la siembra. Espera a que drene y consulta el boletín vigente para tu zona.';
  } else if (soil === 'dry') {
    status = 'hold'; title = 'Conviene esperar';
    message = 'La humedad reportada está por debajo del criterio de referencia (>50 % de capacidad de campo). Verifica de nuevo el suelo y la perspectiva de lluvia antes de sembrar.';
  } else if (soil === 'unknown' || rain === 'unknown' || !rain) {
    status = 'check'; title = 'Faltan datos para recomendar';
    message = 'Confirma la humedad de la parcela y revisa el boletín agrometeorológico de INETER para tu municipio. Sin esos datos, la app no puede determinar si las condiciones son favorables.';
  } else if (rain === 'no') {
    status = 'check'; title = 'Precaución: verifica disponibilidad de agua';
    message = 'La humedad parece suficiente según lo que reportaste, pero el pronóstico indica tiempo seco. Revisa si cuentas con riego y confirma la recomendación específica del cultivo y la zona antes de sembrar.';
  } else {
    status = 'good'; title = 'Condiciones iniciales favorables';
    message = 'Reportas humedad superior al 50 % de capacidad de campo y lluvia prevista. Es una señal favorable para evaluar la siembra; confirma fechas y recomendaciones específicas para este cultivo y zona en el boletín vigente.';
  }
  result.dataset.status = status;
  result.innerHTML = `<div class="agri-icon">${status === 'good' ? '✓' : status === 'hold' ? '!' : '?'}</div><span class="tag ${status === 'good' ? 'ready' : 'neutral'}">${status === 'good' ? 'FAVORABLE CONDICIONAL' : status === 'hold' ? 'ESPERA / REVISA' : 'VERIFICAR'}</span><b>${title}</b><p>${message}</p><small>Parcela: ${escapeHtml(location || 'Ubicación no indicada')} · Cultivo: ${escapeHtml(crop)}</small>`;
  if (authState.professional) {
    try {
      await api('/api/reports', { method: 'POST', body: JSON.stringify({ municipality: location, crop, soil, rain, outcome: title }) });
      toast('Reporte agroclimático guardado.');
    } catch (error) { toast(`No se pudo guardar el reporte: ${error.message}`); }
  }
}
function formatSize(bytes) { if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 ** 2) return `${(bytes/1024).toFixed(0)} KB`; if (bytes < 1024 ** 3) return `${(bytes/1024**2).toFixed(1)} MB`; return `${(bytes/1024**3).toFixed(2)} GB`; }
function formatDuration(seconds) { const total = Math.max(0, Math.floor(Number(seconds) || 0)); const hours = Math.floor(total / 3600); const minutes = Math.floor((total % 3600) / 60); return hours ? `${hours} h ${minutes} min` : `${minutes} min`; }
function renderSchedules() {
  const schedules = appState?.schedules || [];
  const labels = { programada: 'Programada', 'en curso': 'En curso', finalizada: 'Finalizada', fallida: 'Fallida' };
  $('#schedule-list').innerHTML = schedules.length ? schedules.map(item => `<div class="schedule-row"><div class="schedule-date"><b>${new Date(item.startsAt).toLocaleDateString()}</b><small>${new Date(item.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></div><div class="schedule-meta"><b>${escapeHtml(item.title)}</b><small>${item.destinations.length ? escapeHtml(item.destinations.join(', ')) : 'Sin destinos configurados'}${item.durationMinutes ? ` · ${item.durationMinutes} min` : ''}${item.error ? ` · ${escapeHtml(item.error)}` : ''}</small></div><span class="tag ${item.status === 'programada' || item.status === 'en curso' ? 'ready' : 'neutral'}">${escapeHtml(labels[item.status] || item.status)}</span>${item.status === 'programada' ? `<button class="remove-destination" data-cancel-schedule="${escapeHtml(item.id)}" aria-label="Cancelar ${escapeHtml(item.title)}">×</button>` : ''}</div>`).join('') : '<div class="empty-event"><div class="calendar-art"><span>INETER</span><b>--</b><i>+</i></div><div><b>Aún no hay transmisiones programadas</b><p>Programa un horario para iniciar OBS automáticamente.</p></div></div>';
}
function renderState() {
  renderDestinations(); renderRecordings(); renderSchedules();
  renderBroadcastAlerts(appState.alerts);
  announceNewBroadcast(appState.alerts);
  const selected = appState.studio || 'OBS';
  document.querySelectorAll('.studio-option').forEach(button => button.classList.toggle('selected', button.dataset.studio === selected));
  $('#studio-status').textContent = `${selected.toUpperCase()} SELECCIONADO`;
  $('#connect-studio').innerHTML = `Ver guía de ${escapeHtml(selected)} <span>→</span>`;
  $('#check-studio').checked = true;
  const videoBroadcast = appState.videoBroadcast;
  const videoBroadcastLive = videoBroadcast?.status === 'en vivo';
  $('#stream-state').textContent = appState.live || videoBroadcastLive ? 'EN VIVO' : videoBroadcast?.status === 'programada' ? 'PREVIA' : 'ESPERANDO SEÑAL';
  $('#stream-state').classList.toggle('ready', Boolean(appState.live || videoBroadcastLive));
  const destinationCount = appState.destinations.length;
  $('#stream-note').textContent = videoBroadcast?.status === 'programada'
    ? `La transmisión de “${videoBroadcast.title}” inicia a las ${new Date(videoBroadcast.startAt).toLocaleTimeString()}.`
    : videoBroadcastLive
      ? `Transmitiendo “${videoBroadcast.title}” a las plataformas configuradas desde ${new Date(videoBroadcast.startedAt).toLocaleTimeString()}.`
      : videoBroadcast?.status === 'fallida'
        ? `No se pudo transmitir el video “${videoBroadcast.title}”: ${videoBroadcast.error}`
        : appState.live
    ? `Señal activa desde ${new Date(appState.liveSince).toLocaleTimeString()}. En Vivo procesa ${destinationCount} salida(s) y guarda la grabación local.`
    : 'Conecta el estudio para iniciar la emisión principal y publicarla en los destinos configurados.';
  if (appState.lastError) $('#stream-note').textContent = appState.lastError;
  const obs = appState.obs || {};
  const isTransmitting = Boolean(appState.live || obs.streaming || videoBroadcastLive);
  const videoBroadcastActive = ['programada', 'en vivo'].includes(videoBroadcast?.status);
  $('#home-live-chip').classList.toggle('is-live', isTransmitting);
  $('#home-live-status').textContent = isTransmitting ? 'Transmisión en vivo' : 'Esperando transmisión';
  $('#home-obs-label').textContent = obs.connected ? 'OBS conectado' : 'OBS sin conectar';
  $('#home-obs-label').classList.toggle('ready', !!obs.connected);
  $('#home-destination-count').textContent = destinationCount;
  $('#home-stream-description').textContent = appState.live
    ? `Señal activa desde ${new Date(appState.liveSince).toLocaleTimeString()}; la grabación se está guardando.`
    : obs.connected ? 'OBS está conectado y listo para iniciar la emisión.' : 'Conecta OBS para emitir y guardar tus transmisiones.';
  $('#obs-connection').textContent = obs.connected ? 'Estudio conectado' : 'Estudio sin conectar';
  $('#obs-toggle').disabled = !obs.connected || (videoBroadcastActive && !obs.streaming);
  const startLabel = destinationCount ? 'Iniciar todas las plataformas' : 'Iniciar transmisión';
  const streamButtonLabel = obs.streaming ? 'Detener todas las salidas' : videoBroadcastActive ? 'Video en transmisión' : startLabel;
  $('#obs-toggle').textContent = streamButtonLabel;
  $('#go-live').disabled = videoBroadcastActive && !obs.streaming;
  $('#go-live').innerHTML = `<span class="live-dot"></span>${escapeHtml(streamButtonLabel)}`;
  $('#studio-status').textContent = obs.connected ? 'OBS CONECTADO' : (obs.configured ? 'OBS DESCONECTADO' : 'OBS SIN CONECTAR');
  $('#studio-status').classList.toggle('ready', !!obs.connected);
  $('#system-status').textContent = appState.live ? 'En vivo' : (obs.connected ? 'OBS conectado' : 'Backend conectado');
  const complete = Number($('#check-studio').checked) + Number($('#check-dest').checked);
  $('#progress-count').textContent = `${complete}/2`;
  $('#progress-bar').style.width = `${complete * 50}%`;
  $('#notice').style.display = complete === 2 || currentView !== 'inicio' ? 'none' : '';
}
let stateRefreshBusy = false;
async function refresh() {
  if (stateRefreshBusy || document.hidden || !authState.professional) return;
  stateRefreshBusy = true;
  try {
    appState = await api('/api/state');
    renderState();
    const updated = $('#system-updated');
    if (updated) updated.textContent = new Intl.DateTimeFormat('es-NI', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date());
  } catch (error) {
    $('#system-status').textContent = 'Backend sin conexión';
    $('#home-live-status').textContent = 'Servidor sin conexión';
    $('#home-obs-label').textContent = 'Estado no disponible';
    $('#home-stream-description').textContent = 'Inicia el servidor local para cargar el estado de OBS, las plataformas y las grabaciones.';
    $('#stream-state').textContent = 'BACKEND SIN CONEXIÓN';
    $('#stream-note').textContent = 'Inicia iniciar-sin-docker.ps1 o Docker. Después abre http://127.0.0.1:3000.';
    const updated = $('#system-updated');
    if (updated) updated.textContent = 'Sin conexión';
  } finally { stateRefreshBusy = false; }
}
let livePlayerHls = null;
let livePlayerSource = '';
let livePlayerBusy = false;
async function refreshLivePlayer() {
  if (livePlayerBusy || document.hidden) return;
  livePlayerBusy = true;
  const video = $('#live-player');
  const placeholder = $('#live-player-placeholder');
  const status = $('#live-player-status');
  const badge = $('#live-player-badge');
  const panel = $('.live-player-panel');
  const shareButton = $('#share-live-btn');
  try {
    const liveState = await api('/api/live/status');
    if (!liveState.live || !liveState.playlistUrl) {
      shareButton.hidden = true;
      livePlayerHls?.destroy();
      livePlayerHls = null;
      livePlayerSource = '';
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.hidden = true;
      placeholder.hidden = false;
      placeholder.textContent = 'La transmisión aparecerá aquí cuando el equipo inicie la señal.';
      status.textContent = 'No hay una señal en vivo en este momento.';
      badge.classList.remove('ready');
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    shareButton.hidden = false;
    status.textContent = `Señal en vivo desde ${new Date(liveState.liveSince).toLocaleTimeString()}.`;
    badge.classList.add('ready');
    video.hidden = false;
    placeholder.hidden = true;
    if (livePlayerSource === liveState.playlistUrl) return;
    livePlayerHls?.destroy();
    livePlayerHls = null;
    livePlayerSource = liveState.playlistUrl;
    if (window.Hls?.isSupported()) {
      livePlayerHls = new window.Hls({
        lowLatencyMode: true,
        liveSyncDurationCount: 2,
        liveMaxLatencyDurationCount: 4,
        maxLiveSyncPlaybackRate: 1.1
      });
      livePlayerHls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {
          status.textContent = 'La transmisión está lista. Pulsa reproducir para comenzar.';
        });
      });
      livePlayerHls.on(window.Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          status.textContent = `Falló la reproducción HLS (${data.details || data.type}). Se intentará reconectar.`;
          livePlayerSource = '';
          livePlayerHls?.destroy();
          livePlayerHls = null;
          video.hidden = true;
          placeholder.hidden = false;
          placeholder.textContent = 'No se pudo cargar la señal. Reconectando en unos segundos…';
        }
      });
      livePlayerHls.loadSource(livePlayerSource);
      livePlayerHls.attachMedia(video);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.onloadedmetadata = () => {
        video.play().catch(() => {
          status.textContent = 'La transmisión está lista. Pulsa reproducir para comenzar.';
        });
      };
      video.onerror = () => {
        status.textContent = `El navegador no pudo reproducir la señal HLS (error ${video.error?.code || 'desconocido'}).`;
      };
      video.src = livePlayerSource;
      video.load();
    } else {
      video.hidden = true;
      placeholder.hidden = false;
      placeholder.textContent = 'No se pudo cargar un reproductor HLS compatible en este navegador.';
      status.textContent = 'El navegador no está listo para reproducir la señal en vivo.';
    }
  } catch (error) {
    status.textContent = `No se pudo consultar la transmisión: ${error.message}`;
  } finally { livePlayerBusy = false; }
}
function openModal() { $('#destination-form').reset(); $('#platform-select').dispatchEvent(new Event('change')); $('#modal-title').textContent = 'Conectar plataforma'; $('#modal-desc').textContent = 'Usa la URL RTMP y la clave que te entrega esa plataforma.'; modal.classList.add('open'); modal.setAttribute('aria-hidden','false'); $('#channel-name').focus(); }
function closeModal() { modal.classList.remove('open'); modal.setAttribute('aria-hidden','true'); }
function openObsModal() {
  $('#obs-host').value = appState?.obs?.host || 'host.docker.internal';
  $('#obs-port').value = appState?.obs?.port || 4458;
  $('#obs-password').value = '';
  obsModal.classList.add('open'); obsModal.setAttribute('aria-hidden','false'); $('#obs-password').focus();
}
function openScheduleModal() {
  const start = new Date(Date.now() + 60 * 60_000);
  start.setMinutes(start.getMinutes() - start.getTimezoneOffset());
  $('#schedule-start').value = start.toISOString().slice(0, 16);
  $('#schedule-duration').value = '';
  $('#schedule-modal').classList.add('open'); $('#schedule-modal').setAttribute('aria-hidden', 'false'); $('#schedule-name').focus();
}
function closeScheduleModal() { $('#schedule-modal').classList.remove('open'); $('#schedule-modal').setAttribute('aria-hidden', 'true'); }
function openStreamYardModal() {
  $('#streamyard-server').textContent = appState.ingest.server;
  $('#streamyard-key').textContent = appState.ingest.key;
  const local = /(^|\/\/)(localhost|127\.0\.0\.1)(:|\/)/i.test(appState.ingest.server);
  $('#streamyard-note').textContent = local
    ? 'Este servidor solo es accesible desde este equipo. Para recibir desde StreamYard necesitas desplegar En Vivo con una dirección pública RTMP/RTMPS y configurar PUBLIC_RTMP_URL.'
    : 'En StreamYard crea un destino RTMP personalizado. OBS debe quedar desconectado para evitar dos fuentes al mismo tiempo.';
  $('#streamyard-modal').classList.add('open'); $('#streamyard-modal').setAttribute('aria-hidden', 'false');
}
function renderAuth() {
  const user = authState.professional;
  $('#auth-trigger').textContent = user ? user.name.split(/\s+/)[0] : authState.hasProfessionals ? 'Iniciar sesión' : 'Crear cuenta';
  $('#profile-name').textContent = user?.name || 'Operador INETER';
  const monitorView = currentView === 'monitoreo';
  const roleLabels = { admin: 'Administración principal INETER', monitor_admin: monitorView ? 'Administrador de monitoreo INETER' : 'Usuario INETER', support: 'Soporte INETER', user: 'Usuario INETER', professional: 'Cuenta profesional' };
  const roleBadgeLabels = { admin: 'ADMINISTRADOR PRINCIPAL', monitor_admin: monitorView ? 'ADMINISTRADOR · SOLO MONITOREO' : 'CUENTA DE USUARIO', support: 'SOPORTE', user: 'CUENTA DE USUARIO', professional: 'CUENTA PROFESIONAL' };
  const roleBadge = $('#session-role-indicator');
  roleBadge.hidden = !user;
  roleBadge.textContent = user ? (roleBadgeLabels[user.role] || 'CUENTA INETER') : '';
  roleBadge.className = `session-role-indicator${user?.role === 'admin' ? ' is-admin' : ['admin', 'monitor_admin'].includes(user?.role) ? ' is-monitor' : user ? ' is-user' : ''}`;
  $('#profile-role').textContent = user ? (roleLabels[user.role] || 'Cuenta profesional') : 'Centro institucional';
  $('#profile-avatar').textContent = user ? user.name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() : 'IN';
  $('#auth-account-panel').hidden = !user;
  $('.auth-mode-toggle').hidden = !!user || !authState.hasProfessionals;
  $('#auth-account-name').textContent = user?.name || '';
  $('#auth-account-detail').textContent = user ? `${roleLabels[user.role] || 'Cuenta INETER'} · ${user.email}` : '';
  $('#auth-avatar').textContent = user ? user.name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() : 'PR';
  $('#auth-form').hidden = !!user;
  $('#auth-logout').hidden = !user;
  $('#admin-access-request-open').hidden = !user || ['admin','monitor_admin'].includes(user.role);
  $('#admin-access-request-open').textContent = 'Solicitar acceso al monitoreo';
  $('#auth-profile-fields').hidden = !!user || authMode !== 'register';
  $('#auth-name').required = authMode === 'register' && !user;
  $('#auth-password').autocomplete = authMode === 'register' ? 'new-password' : 'current-password';
  $('#auth-password-hint').textContent = authMode === 'register' ? 'La contraseña debe tener al menos 10 caracteres.' : 'Usa el correo asociado a tu cuenta.';
  $('#auth-title').textContent = user ? 'Sesión INETER' : authMode === 'register' ? 'Crear cuenta de usuario' : 'Iniciar sesión';
  $('#auth-desc').textContent = user ? 'Tu cuenta INETER está conectada en este equipo.' : authMode === 'register' ? 'Crea una cuenta de usuario para acceder a los servicios de la plataforma.' : 'Accede a tu cuenta de INETER.';
  $('#auth-submit').textContent = authMode === 'register' ? 'Crear cuenta y entrar' : 'Iniciar sesión';
  document.querySelectorAll('[data-auth-mode]').forEach(button => button.classList.toggle('selected', button.dataset.authMode === authMode));
  $('#auth-error').hidden = true;
  document.dispatchEvent(new CustomEvent('professional-auth-changed', { detail: { authenticated: !!user } }));
}
function openAuthModal() {
  if (!authState.professional) authMode = authState.hasProfessionals ? 'login' : 'register';
  $('#auth-form').reset();
  renderAuth();
  refreshAdminStatus();
  $('#auth-modal').classList.add('open');
  $('#auth-modal').setAttribute('aria-hidden', 'false');
  if (!authState.professional) $('#auth-email').focus();
}
function closeAuthModal() { $('#auth-modal').classList.remove('open'); $('#auth-modal').setAttribute('aria-hidden', 'true'); }
async function refreshAuth() {
  try {
    authState = await api('/api/auth/me');
    renderAuth();
    if (authState.professional) { syncPresence(); syncStreamEvents(); await refreshAdminStatus(); }
    else { syncPresence(); syncStreamEvents(); }
  }
  catch { $('#profile-role').textContent = 'No se pudo consultar la sesión'; }
}
async function refreshAdminStatus() {
  try {
    const status = await api('/api/admin/status');
    if (status.canMonitor && currentView === 'monitoreo') await refreshAdminMonitor();
  } catch { /* El panel de administración se abre desde su interfaz separada. */ }
}
async function openAdminAccessRequest() {
  if (!authState.professional || ['admin','monitor_admin'].includes(authState.professional.role)) return;
  const status = $('#admin-access-request-status');
  const form = $('#admin-access-request-form');
  const input = $('#admin-access-request-reason');
  const submit = $('#admin-access-request-submit');
  status.textContent = 'Consultando si ya tienes una solicitud…'; status.className = 'admin-feedback';
  input.disabled = true; submit.disabled = true; form.reset();
  $('#auth-modal').classList.remove('open'); $('#auth-modal').setAttribute('aria-hidden', 'true');
  $('#admin-access-request-modal').classList.add('open'); $('#admin-access-request-modal').setAttribute('aria-hidden', 'false');
  try {
    const { request } = await api('/api/account/admin-access-request');
    if (request?.status === 'pending') {
      input.value = request.reason; status.textContent = 'Tu solicitud está pendiente de revisión por la cuenta administradora principal.'; status.classList.add('success');
    } else if (request?.status === 'approved') {
      status.textContent = 'La solicitud fue aprobada. Cierra sesión y vuelve a entrar para actualizar tus permisos.'; status.classList.add('success');
    } else if (request?.status === 'rejected') {
      status.textContent = 'La solicitud anterior fue rechazada. Puedes enviar una nueva con más información.';
    } else status.textContent = 'Tu cuenta seguirá como usuario hasta que la cuenta administradora principal apruebe el monitoreo.';
    const pending = request?.status === 'pending' || request?.status === 'approved';
    input.disabled = pending; submit.disabled = pending;
  } catch (error) { status.textContent = error.message; status.classList.add('error'); input.disabled = false; submit.disabled = false; }
}
$('#admin-access-request-open').addEventListener('click', openAdminAccessRequest);
function closeAdminAccessRequest() { $('#admin-access-request-modal').classList.remove('open'); $('#admin-access-request-modal').setAttribute('aria-hidden', 'true'); }
$('#admin-access-request-close').addEventListener('click', closeAdminAccessRequest);
$('#admin-access-request-cancel').addEventListener('click', closeAdminAccessRequest);
$('#admin-access-request-modal').addEventListener('click', event => { if (event.target.id === 'admin-access-request-modal') closeAdminAccessRequest(); });
$('#admin-access-request-form').addEventListener('submit', async event => {
  event.preventDefault();
  const status = $('#admin-access-request-status');
  const submit = $('#admin-access-request-submit');
  submit.disabled = true; status.textContent = 'Enviando solicitud…'; status.className = 'admin-feedback';
  try {
    await api('/api/account/admin-access-request', { method: 'POST', body: JSON.stringify({ reason: $('#admin-access-request-reason').value.trim() }) });
    status.textContent = 'Solicitud enviada. Tu cuenta conservará sus permisos actuales hasta que la revise la cuenta administradora principal.'; status.classList.add('success');
    $('#admin-access-request-reason').disabled = true;
  } catch (error) { status.textContent = error.message; status.classList.add('error'); submit.disabled = false; }
});
function closeStreamYardModal() { $('#streamyard-modal').classList.remove('open'); $('#streamyard-modal').setAttribute('aria-hidden', 'true'); }
function closeObsModal() { obsModal.classList.remove('open'); obsModal.setAttribute('aria-hidden','true'); }
document.querySelectorAll('.studio-option').forEach(button => button.addEventListener('click', async () => {
  try { appState = await api('/api/studio', { method: 'PUT', body: JSON.stringify({ studio: button.dataset.studio }) }); renderState(); }
  catch (error) { toast(error.message); }
}));
$('#add-destination').addEventListener('click', openModal);
$('#cancel-modal').addEventListener('click', closeModal);
$('.modal-close').addEventListener('click', closeModal);
modal.addEventListener('click', event => { if (event.target === modal) closeModal(); });
$('#obs-close').addEventListener('click', closeObsModal);
$('#obs-cancel').addEventListener('click', closeObsModal);
obsModal.addEventListener('click', event => { if (event.target === obsModal) closeObsModal(); });
$('#destination-form').addEventListener('submit', async event => {
  event.preventDefault();
  const body = { platform: $('#platform-select').value, name: $('#channel-name').value.trim(), serverUrl: $('#server-url').value.trim(), key: $('#stream-key').value.trim() };
  try { appState = await api('/api/destinations', { method: 'POST', body: JSON.stringify(body) }); renderState(); closeModal(); toast('Destino conectado. La clave quedó cifrada en el servidor.'); }
  catch (error) { toast(error.message); }
});
$('#schedule-form').addEventListener('submit', async event => {
  event.preventDefault();
  const body = { title: $('#schedule-name').value.trim(), startsAt: new Date($('#schedule-start').value).toISOString(), durationMinutes: $('#schedule-duration').value || null };
  try { appState = await api('/api/schedules', { method: 'POST', body: JSON.stringify(body) }); renderState(); closeScheduleModal(); toast('Transmisión programada. OBS debe estar abierto y conectado a esa hora.'); }
  catch (error) { toast(error.message); }
});
$('#platform-select').addEventListener('change', () => {
  const isYouTube = $('#platform-select').value === 'YouTube';
  $('#server-url').placeholder = isYouTube ? 'Copia la URL de YouTube Studio (RTMPS)' : 'rtmps://servidor/plataforma';
  $('#destination-help').innerHTML = isYouTube
    ? 'YouTube: copia la URL y la clave desde <a href="https://studio.youtube.com/" target="_blank" rel="noopener">YouTube Studio</a>. Activa Auto-start en el evento antes de la emisión; después podrás iniciar OBS desde esta página sin abrir YouTube Studio. Sin Auto-start, YouTube exige confirmar el inicio en Studio.'
    : 'Usa la URL RTMP y la clave que te entrega esa plataforma.';
});
$('#obs-form').addEventListener('submit', async event => {
  event.preventDefault();
  const body = { host: $('#obs-host').value.trim(), port: Number($('#obs-port').value), password: $('#obs-password').value };
  try {
    appState = await api('/api/obs/connect', { method: 'POST', body: JSON.stringify(body) });
    renderState(); closeObsModal(); toast('OBS conectado y configurado para enviar a En Vivo.');
  } catch (error) { toast(error.message); $('#obs-connection').textContent = error.message; }
});
$('#platform-list').addEventListener('click', async event => {
  const button = event.target.closest('[data-remove]'); if (!button) return;
  try { appState = await api(`/api/destinations/${encodeURIComponent(button.dataset.remove)}`, { method: 'DELETE' }); renderState(); toast('Destino eliminado.'); }
  catch (error) { toast(error.message); }
});
document.querySelector('.dismiss')?.addEventListener('click', () => { $('#notice').style.display = 'none'; });
document.querySelectorAll('[data-dismiss-tip]').forEach(button => {
  const tip = document.getElementById(button.dataset.dismissTip);
  if (!tip) return;
  try { tip.hidden = localStorage.getItem(`ineter-dismissed-${tip.id}`) === '1'; } catch {}
  button.addEventListener('click', () => {
    tip.hidden = true;
    try { localStorage.setItem(`ineter-dismissed-${tip.id}`, '1'); } catch {}
  });
});
document.querySelectorAll('[data-scroll]').forEach(button => button.addEventListener('click', () => {
  const target = document.getElementById(button.dataset.scroll);
  if (!target) return;
  if (target.dataset.view) showView(target.dataset.view, true, false);
  requestAnimationFrame(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}));
$('#agriculture-form').addEventListener('submit', reviewAgriculture);
$('#recording-list').addEventListener('ended', () => renderRecordings(), true);
$('#home-recording-list').addEventListener('ended', () => renderRecordings(), true);
$('#refresh-recordings').addEventListener('click', async () => {
  const button = $('#refresh-recordings');
  button.disabled = true;
  try {
    appState = await api('/api/state');
    renderRecordings(true);
    toast(`${appState.recordings.length} ${appState.recordings.length === 1 ? 'video disponible' : 'videos disponibles'}.`);
  } catch (error) { toast(`No se pudo actualizar la biblioteca: ${error.message}`); }
  finally { button.disabled = false; }
});
$('#auth-trigger').addEventListener('click', openAuthModal);
$('#auth-close').addEventListener('click', closeAuthModal);
$('#auth-modal').addEventListener('click', event => { if (event.target.id === 'auth-modal') closeAuthModal(); });
document.querySelectorAll('[data-auth-mode]').forEach(button => button.addEventListener('click', () => {
  if (authState.professional) return;
  authMode = button.dataset.authMode;
  renderAuth();
}));
$('#auth-form').addEventListener('submit', async event => {
  event.preventDefault();
  const registering = authMode === 'register';
  try {
    if (!window.ineterFirebaseAuth) throw new Error('Firebase Authentication todavía está cargando. Inténtalo de nuevo.');
    authState = registering
      ? await window.ineterFirebaseAuth.register($('#auth-name').value.trim(), $('#auth-email').value.trim(), $('#auth-password').value)
      : await window.ineterFirebaseAuth.signIn($('#auth-email').value.trim(), $('#auth-password').value);
    renderAuth(); closeAuthModal(); await refreshAdminStatus(); toast(registering ? 'Cuenta de usuario creada con Firebase.' : 'Sesión iniciada con Firebase.');
  } catch (error) { $('#auth-error').textContent = error.message; $('#auth-error').hidden = false; }
});
$('#auth-logout').addEventListener('click', async () => {
  try {
    if (!window.ineterFirebaseAuth) throw new Error('Firebase Authentication no está disponible.');
    await window.ineterFirebaseAuth.signOut();
    authState = { professional: null, hasProfessionals: true }; renderAuth(); closeAuthModal();
    syncStreamEvents();
    if (currentView === 'monitoreo') showView('inicio');
    toast('Sesión cerrada.');
  }
  catch (error) { $('#auth-error').textContent = error.message; $('#auth-error').hidden = false; }
});
document.addEventListener('firebase-auth-session-ready', event => {
  if (!event.detail?.professional) return;
  authState = event.detail;
  renderAuth();
  syncPresence();
  syncStreamEvents();
  refresh();
  refreshAdminStatus();
  if (new URLSearchParams(location.search).get('next') === '/admin.html') {
    if (authState.professional.role === 'admin') location.replace('/admin.html');
    else { history.replaceState(null, '', '/#inicio'); toast('Esta cuenta no tiene acceso al panel administrativo.'); }
  }
});
document.addEventListener('firebase-auth-session-cleared', () => {
  clearInterval(presenceTimer); presenceTimer = null;
  authState = { professional: null, hasProfessionals: true };
  syncStreamEvents();
  renderAuth();
});
const viewTitles = { inicio: 'Inicio', streaming: 'Streaming', videos: 'Videos bajo demanda', agricultura: 'Asesoría agrícola', pronostico: 'Pronóstico climático', mapa: 'Mapa climático', alertas: 'Alertas', datos: 'Datos climáticos' };
function showView(name, updateLocation = true, scrollTop = true) {
  const views = [...document.querySelectorAll('[data-view]')];
  if (!views.some(view => view.dataset.view.split(/\s+/).includes(name))) name = 'inicio';
  currentView = name;
  renderAuth();
  if (name === 'videos') {
    api('/api/recordings').then(({ recordings, total }) => {
      if (currentView !== 'videos') return;
      appState = { ...(appState || {}), recordings, recordingTotalCount: total };
      renderRecordings(true);
    }).catch(error => toast(`No se pudo cargar la biblioteca: ${error.message}`));
  }
  views.forEach(view => {
    if (!Object.hasOwn(view.dataset, 'originalDisplay')) view.dataset.originalDisplay = view.hidden ? 'block' : getComputedStyle(view).display;
    view.style.display = name === 'inicio' || view.dataset.view.split(/\s+/).includes(name) ? view.dataset.originalDisplay : 'none';
  });
  document.querySelectorAll('[data-view-target]').forEach(link => link.classList.toggle('active', link.dataset.viewTarget === name));
  $('.crumb b').textContent = viewTitles[name] || 'Inicio';
  if (authState.professional) sendPresence();
  if (name === 'streaming') refreshLivePlayer();
  if (updateLocation && location.hash !== `#${name}`) history.pushState({ view: name }, '', `#${name}`);
  if (scrollTop) window.scrollTo({ top: 0, behavior: 'smooth' });
}
function restoreViewFromLocation() {
  const hash = decodeURIComponent(location.hash.slice(1));
  if (hash === 'monitoreo') { location.replace('/monitor.html'); return; }
  if (hash === 'administracion') { location.replace('/admin.html'); return; }
  const view = viewTitles[hash] ? hash : document.getElementById(hash)?.dataset.view || 'inicio';
  showView(view, false, false);
}
document.querySelectorAll('[data-view-target]').forEach(link => link.addEventListener('click', event => {
  event.preventDefault();
  setMobileMenuOpen(false);
  showView(link.dataset.viewTarget);
}));
const mobileMenuToggle = $('#mobile-menu-toggle');
const mobileSidebar = $('#sidebar');
const mobileSidebarBackdrop = $('#sidebar-backdrop');
function setMobileMenuOpen(open) {
  mobileSidebar.classList.toggle('open', open);
  mobileSidebarBackdrop.classList.toggle('active', open);
  mobileMenuToggle.setAttribute('aria-expanded', String(open));
  mobileMenuToggle.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
}
mobileMenuToggle.addEventListener('click', () => setMobileMenuOpen(!mobileSidebar.classList.contains('open')));
$('#sidebar-close').addEventListener('click', () => setMobileMenuOpen(false));
mobileSidebarBackdrop.addEventListener('click', () => setMobileMenuOpen(false));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && mobileSidebar.classList.contains('open')) {
    setMobileMenuOpen(false);
    mobileMenuToggle.focus();
  }
});
window.addEventListener('resize', () => {
  if (window.matchMedia('(min-width: 1025px)').matches) setMobileMenuOpen(false);
});
window.addEventListener('popstate', restoreViewFromLocation);
window.addEventListener('hashchange', restoreViewFromLocation);
$('#connect-studio').addEventListener('click', () => appState?.studio === 'StreamYard' ? openStreamYardModal() : openObsModal());
$('#obs-connect-inline').addEventListener('click', openObsModal);
async function toggleObsStream() {
  if (!appState?.obs?.connected) { openObsModal(); return; }
  const action = appState.obs.streaming ? 'stop' : 'start';
  try {
    appState = await api('/api/obs/stream', { method: 'POST', body: JSON.stringify({ action }) }); renderState();
    if (action === 'start') {
      const count = appState.destinations.length;
      if (appState.lastError) toast(appState.lastError);
      else if (!appState.live) toast(count ? 'OBS está transmitiendo; las plataformas se conectarán en cuanto reciban la señal.' : 'OBS inició; añade destinos para enviarlo a otras plataformas.');
      else toast(count ? 'Señal recibida; iniciando todas las plataformas configuradas.' : 'La transmisión está en vivo y se está guardando.');
    } else toast('Deteniendo OBS y todas las salidas configuradas.');
  }
  catch (error) { toast(error.message); }
}
$('#obs-toggle').addEventListener('click', toggleObsStream);
$('#go-live').addEventListener('click', toggleObsStream);
const monitorHistory = [];
let monitorRequestBusy = false;
async function refreshAdminMonitor() {
  if (monitorRequestBusy || currentView !== 'monitoreo' || !['admin','monitor_admin'].includes(authState.professional?.role) || document.hidden) return;
  monitorRequestBusy = true;
  try {
    const metrics = await api('/api/admin/monitor');
    if (!Array.isArray(metrics.activeUsers) || !metrics.streams || !metrics.alerts || !metrics.recordings || !metrics.server) throw new Error('Reinicia el servidor local para activar los roles y las métricas nuevas del dashboard.');
    $('#monitor-stream-status').textContent = metrics.streaming ? 'TRANSMISIÓN ACTIVA' : 'ESPERANDO TRANSMISIÓN';
    $('#monitor-stream-status').classList.toggle('ready', metrics.streaming);
    $('#monitor-upload').textContent = `${metrics.network.uploadMbps.toFixed(2)} Mbps`;
    $('#monitor-download').textContent = `${metrics.network.downloadMbps.toFixed(2)} Mbps`;
    $('#monitor-upload-total').textContent = `Total enviado: ${formatSize(metrics.network.uploadedBytes)}`;
    $('#monitor-download-total').textContent = `Total recibido: ${formatSize(metrics.network.downloadedBytes)}`;
    const latency = metrics.network.latency;
    $('#monitor-latency').textContent = latency.ms !== null ? `${latency.ms} ms` : latency.status === 'sin_respuesta' ? 'Sin respuesta' : 'Midiendo…';
    $('#monitor-latency-time').textContent = latency.checkedAt ? `TCP a Cloudflare · ${new Date(latency.checkedAt).toLocaleTimeString('es-NI')}` : 'TCP a Cloudflare · 1.1.1.1';
    $('#monitor-cpu').textContent = metrics.device.cpuPercent === null ? 'Midiendo…' : `${metrics.device.cpuPercent.toFixed(1)} %`;
    $('#monitor-cpu-model').textContent = `${metrics.device.cpuCores} núcleos lógicos`;
    $('#monitor-host').textContent = metrics.device.hostname;
    $('#monitor-os').textContent = metrics.device.os;
    $('#monitor-runtime').textContent = `${metrics.device.architecture} · ${metrics.device.nodeVersion}`;
    $('#monitor-device-cpu').textContent = metrics.device.cpuModel;
    $('#monitor-memory').textContent = `${formatSize(metrics.device.memoryTotalBytes)} total · ${formatSize(metrics.device.memoryFreeBytes)} libres · ${metrics.device.memoryUsedPercent.toFixed(1)} % usado`;
    $('#monitor-process-memory').textContent = formatSize(metrics.device.processRssBytes);
    $('#monitor-disk').textContent = metrics.device.disk ? `${formatSize(metrics.device.disk.freeBytes)} libres de ${formatSize(metrics.device.disk.totalBytes)}` : 'No disponible';
    $('#monitor-interfaces').textContent = metrics.network.available ? `${metrics.network.interfaces.join(', ')} · ${metrics.network.source}` : (metrics.network.error || 'No disponible');
    $('#monitor-destinations').innerHTML = `<div class="monitor-destination-row"><b>OBS Studio</b><span class="tag ${metrics.obs.connected ? 'ready' : 'neutral'}">${metrics.obs.connected ? metrics.obs.streaming ? 'TRANSMITIENDO' : 'CONECTADO' : 'DESCONECTADO'}</span></div>${metrics.destinations.length ? metrics.destinations.map(destination => `<div class="monitor-destination-row"><b>${escapeHtml(destination.name)} · ${escapeHtml(destination.platform)}</b><span class="tag ${destination.status === 'enviando' ? 'ready' : destination.status === 'error' ? 'warning' : 'neutral'}">${escapeHtml(destination.status)}</span></div>`).join('') : '<p class="empty-recordings">No hay plataformas configuradas.</p>'}`;
    $('#monitor-active-users').textContent = String(metrics.activeUsers.length);
    $('#monitor-active-users-updated').textContent = `Actividad en los últimos 90 s · ${new Date(metrics.sampledAt).toLocaleTimeString('es-NI')}`;
    $('#monitor-active-user-list').innerHTML = metrics.activeUsers.length ? metrics.activeUsers.map(user => `<div class="monitor-destination-row"><b>${escapeHtml(user.name)}<small>${escapeHtml(user.email)} · ${escapeHtml(user.role)}</small></b><span class="tag ready">${escapeHtml(viewTitles[user.view] || 'En línea')}</span></div>`).join('') : '<p class="empty-recordings">No hay otras sesiones activas en este momento.</p>';
    $('#monitor-alert-count').textContent = String(metrics.alerts.count);
    const newestAlert = metrics.alerts.recent[0];
    $('#monitor-alert-updated').textContent = newestAlert ? `Más reciente: ${new Date(newestAlert.createdAt).toLocaleString('es-NI')}` : 'Sin avisos difundidos';
    $('#monitor-recent-alerts').innerHTML = metrics.alerts.recent.length ? metrics.alerts.recent.map(alert => `<div class="monitor-destination-row"><b>${escapeHtml(alert.title)}<small>${escapeHtml(alert.categoryLabel)} · ${escapeHtml(alert.location || 'Nicaragua')}</small></b><span class="tag ${alert.severity === 'urgente' ? 'warning' : 'neutral'}">${escapeHtml(alert.severityLabel)}</span></div>`).join('') : '<p class="empty-recordings">Aún no se han difundido avisos.</p>';
    $('#monitor-stream-count').textContent = String(metrics.streams.total);
    $('#monitor-stream-duration').textContent = `Acumulada ${formatDuration(metrics.streams.accumulatedSeconds)} · actual ${formatDuration(metrics.streams.currentSeconds)}`;
    $('#monitor-recording-bytes').textContent = formatSize(metrics.recordings.totalBytes);
    $('#monitor-recording-count').textContent = `${metrics.recordings.count} grabaciones guardadas`;
    $('#monitor-server-uptime').textContent = formatDuration(metrics.server.uptimeSeconds);
    $('#monitor-server-heap').textContent = `${formatSize(metrics.server.heapUsedBytes)} usados de ${formatSize(metrics.server.heapTotalBytes)}`;
    $('#monitor-server-sampled').textContent = new Date(metrics.sampledAt).toLocaleString('es-NI');
    const climateText = [
      document.querySelector('#home-weather-place')?.textContent || 'Managua',
      document.querySelector('#home-temperature')?.textContent || '—',
      document.querySelector('#home-weather-condition')?.textContent || 'Sin dato',
      `Lluvia ${document.querySelector('#home-rain')?.textContent || '—'}`,
      `Humedad ${document.querySelector('#home-humidity')?.textContent || '—'}`,
      `Viento ${document.querySelector('#home-wind')?.textContent || '—'}`
    ];
    $('#monitor-climate-title').textContent = `Condiciones meteorológicas · ${document.querySelector('#home-weather-place')?.textContent || 'Managua'}`;
    $('#monitor-climate-reading').textContent = climateText.join(' · ');
    $('#monitor-climate-updated').textContent = `Open-Meteo · ${document.querySelector('#home-weather-updated')?.textContent || 'actualizando'} · verifica con INETER`;
    $('#monitor-climate-forecast').textContent = [...document.querySelectorAll('#home-forecast-days .home-forecast-day')].map(day => day.innerText.replace(/\s+/g, ' ').trim()).join('  |  ') || 'Pronóstico en actualización';
    $('#monitor-updated').textContent = `Última lectura: ${new Date(metrics.sampledAt).toLocaleTimeString('es-NI')}`;
    $('#monitor-error').textContent = metrics.latestError || (metrics.obs.error ? `OBS: ${metrics.obs.error}` : '');
    monitorHistory.push({ upload: metrics.network.uploadMbps, download: metrics.network.downloadMbps });
    if (monitorHistory.length > 30) monitorHistory.shift();
    const maximum = Math.max(0.1, ...monitorHistory.flatMap(point => [point.upload, point.download]));
    for (const [id, key] of [['monitor-chart-up', 'upload'], ['monitor-chart-down', 'download']]) {
      const path = monitorHistory.map((point, index) => `${index ? 'L' : 'M'} ${(index / Math.max(1, monitorHistory.length - 1) * 100).toFixed(2)} ${(98 - point[key] / maximum * 88).toFixed(2)}`).join(' ');
      $(`#${id}`).setAttribute('d', path);
    }
  } catch (error) {
    $('#monitor-error').textContent = error.message.includes('403') ? 'Acceso denegado: inicia sesión con una cuenta de soporte o administración.' : `No se pudo actualizar: ${error.message}`;
  } finally { monitorRequestBusy = false; }
}
$('#schedule').addEventListener('click', openScheduleModal);
$('#schedule-close').addEventListener('click', closeScheduleModal);
$('#schedule-cancel').addEventListener('click', closeScheduleModal);
$('#streamyard-close').addEventListener('click', closeStreamYardModal);
$('#streamyard-done').addEventListener('click', closeStreamYardModal);
$('#copy-streamyard').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(`Servidor: ${appState.ingest.server}\nClave: ${appState.ingest.key}`); toast('Datos RTMP de StreamYard copiados.'); }
  catch { toast('Copia manualmente el servidor y la clave.'); }
});

// Compartir transmisión (enlace + QR)
let shareModalOpen = false;
function openShareModal() {
  const url = `${window.location.origin}/#streaming`;
  const input = document.getElementById('share-link');
  const qr = document.getElementById('share-qr');
  const qrHint = document.getElementById('share-qr-hint');
  if (input) input.value = url;
  if (qrHint) qrHint.textContent = 'Generando código QR…';
  if (qr) {
    qr.hidden = true;
    qr.src = `/api/live/qr?url=${encodeURIComponent(url)}`;
    qr.onload = () => {
      qr.hidden = false;
      if (qrHint) qrHint.textContent = 'Escanea el código QR para abrir la transmisión.';
    };
    qr.onerror = () => {
      if (qrHint) qrHint.textContent = 'No se pudo generar el QR. Copia el enlace para compartirlo.';
    };
  }
  const modal = document.getElementById('share-modal');
  modal?.classList.add('open'); modal?.setAttribute('aria-hidden', 'false');
  shareModalOpen = true;
}
function closeShareModal() {
  const modal = document.getElementById('share-modal');
  modal?.classList.remove('open'); modal?.setAttribute('aria-hidden', 'true');
  shareModalOpen = false;
}
document.getElementById('share-live-btn')?.addEventListener('click', openShareModal);
document.getElementById('share-close')?.addEventListener('click', closeShareModal);
document.getElementById('share-done')?.addEventListener('click', closeShareModal);
document.getElementById('share-copy-link')?.addEventListener('click', async () => {
  const url = document.getElementById('share-link')?.value || '';
  try { await navigator.clipboard.writeText(url); toast('Enlace copiado.'); }
  catch { toast('Copia manualmente el enlace.'); }
});

// Estadísticas en vivo: espectadores y me gusta
let lastStreamStats = null;
function renderStreamStats(stats) {
  const row = document.getElementById('live-stats-row');
  if (!row) return;
  row.hidden = !stats.live;
  const viewers = document.getElementById('live-viewers-count');
  const likes = document.getElementById('live-likes-count');
  if (viewers) viewers.textContent = String(stats.viewers ?? 0);
  if (likes) likes.textContent = String(stats.likes ?? 0);
  const button = document.getElementById('like-live-btn');
  if (!button) return;
  const key = `ineter-liked-${stats.sessionId || 'global'}`;
  let liked = false;
  try { liked = localStorage.getItem(key) === '1'; } catch { liked = false; }
  button.disabled = !stats.live || liked;
  button.textContent = liked ? '♥ Gracias' : '♥ Me gusta';
  document.querySelectorAll('[data-live-reaction]').forEach(reaction => { reaction.disabled = !stats.live; });
}
function renderLiveReaction(emoji) {
  const container = document.getElementById('live-reaction-bursts');
  if (!container) return;
  const bubble = document.createElement('span');
  bubble.className = 'live-reaction-burst';
  bubble.textContent = emoji;
  bubble.setAttribute('aria-label', `Reacción ${emoji}`);
  container.append(bubble);
  while (container.childElementCount > 6) container.firstElementChild.remove();
  setTimeout(() => bubble.remove(), 3200);
}
async function refreshStreamStats() {
  if (!authState.professional || document.hidden) return;
  try {
    const stats = await api('/api/stream/stats');
    lastStreamStats = stats;
    renderStreamStats(stats);
  } catch { /* El panel se reintenta en el siguiente ciclo. */ }
}
document.getElementById('like-live-btn')?.addEventListener('click', async () => {
  try {
    const result = await api('/api/stream/like', { method: 'POST', body: '{}' });
    const sessionId = result.sessionId || lastStreamStats?.sessionId || 'global';
    const key = `ineter-liked-${sessionId}`;
    try { localStorage.setItem(key, '1'); } catch { /* almacenamiento no disponible */ }
    if (!lastStreamStats) lastStreamStats = { live: true, viewers: 0, likes: result.likes || 0, sessionId };
    lastStreamStats.likes = result.likes;
    renderStreamStats(lastStreamStats);
    toast(result.already ? 'Ya registramos tu me gusta para esta transmisión.' : '¡Gracias por tu me gusta!');
  } catch (error) { toast(error.message); }
});
document.querySelector('.live-reaction-menu')?.addEventListener('click', async event => {
  const button = event.target.closest('[data-live-reaction]');
  if (!button || button.disabled) return;
  button.disabled = true;
  try {
    await api('/api/stream/reactions', {
      method: 'POST',
      body: JSON.stringify({ emoji: button.dataset.liveReaction })
    });
    setTimeout(() => { if (lastStreamStats?.live) button.disabled = false; }, 800);
  } catch (error) {
    toast(`No se pudo enviar la reacción: ${error.message}`);
    button.disabled = false;
  }
});
$('#schedule-list').addEventListener('click', async event => {
  const button = event.target.closest('[data-cancel-schedule]'); if (!button) return;
  try { appState = await api(`/api/schedules/${encodeURIComponent(button.dataset.cancelSchedule)}`, { method: 'DELETE' }); renderState(); toast('Transmisión programada cancelada.'); }
  catch (error) { toast(error.message); }
});
restoreViewFromLocation(); refreshAuth().then(() => {
  if (location.hash === '#monitoreo' && ['admin','monitor_admin'].includes(authState.professional?.role)) showView('monitoreo', false, false);
});
refresh(); refreshLivePlayer(); setInterval(refresh, 2500); setInterval(refreshLivePlayer, 5000); setInterval(refreshAuth, 30_000); setInterval(refreshAdminMonitor, 2500); setInterval(refreshStreamStats, 15_000);
window.addEventListener('online', () => { refresh(); refreshLivePlayer(); refreshAuth(); refreshAdminMonitor(); refreshStreamStats(); sendPresence(); });
window.addEventListener('focus', () => { refresh(); refreshLivePlayer(); refreshAuth(); refreshAdminMonitor(); sendPresence(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { refresh(); refreshLivePlayer(); refreshAuth(); refreshAdminMonitor(); refreshStreamStats(); sendPresence(); } });

// Ayudante informativo local: responde preguntas frecuentes y dirige al usuario
// a los módulos correspondientes sin enviar mensajes ni datos a servicios externos.
const botPanel = document.querySelector('#info-bot');
const botLauncher = document.querySelector('#info-bot-launcher');
const botMessages = document.querySelector('#info-bot-messages');
const botInput = document.querySelector('#info-bot-input');
const botAnswers = [
  { keys: ['stream', 'obs', 'transmit', 'emitir', 'salida', 'youtube', 'twitch'], view: 'streaming', answer: 'En Streaming puedes conectar el estudio y controlar la emisión principal. Durante una transmisión, el reproductor muestra espectadores y permite enviar reacciones.' },
  { keys: ['video', 'grabacion', 'biblioteca', 'reproduc', 'descargar'], view: 'videos', answer: 'Videos bajo demanda reúne las grabaciones guardadas cuando finaliza una transmisión. Desde esa sección puedes reproducirlas y descargarlas.' },
  { keys: ['agric', 'sembr', 'cultivo', 'siembra', 'parcela'], view: 'agricultura', answer: 'Asesoría agrícola ofrece una orientación preliminar basada en la humedad observada y el pronóstico que consultes. Confirma las recomendaciones con los boletines de INETER y el personal técnico agrícola.' },
  { keys: ['pronost', 'clima', 'tiempo', 'lluvia', 'temperatura'], view: 'pronostico', answer: 'Pronóstico climático muestra la información meteorológica disponible por zona. La portada incluye un resumen de condiciones y cinco días; verifica siempre los avisos oficiales vigentes.' },
  { keys: ['mapa'], view: 'mapa', answer: 'Mapa climático presenta la vista territorial disponible para consultar condiciones por zona.' },
  { keys: ['alerta', 'sismo', 'volcan', 'tsunami', 'emergencia', 'aviso'], view: 'alertas', answer: 'Alertas reúne avisos publicados y señales de vigilancia. Para una emergencia, sigue las indicaciones de las autoridades y confirma los avisos en los canales oficiales de INETER.' },
  { keys: ['dato', 'estacion', 'registro'], view: 'datos', answer: 'Datos climáticos permite consultar información de estaciones y variables meteorológicas disponibles en la plataforma.' },
  { keys: ['iniciar sesion', 'cuenta', 'contraseña', 'contrasena', 'registr', 'acceder'], answer: 'El acceso se gestiona con Firebase Authentication. Usa el correo y contraseña de tu cuenta; si no recuerdas la contraseña, selecciona “¿Olvidaste tu contraseña?” en la pantalla de acceso.' },
  { keys: ['administr', 'monitoreo', 'monitor'], answer: 'Administración y Monitoreo técnico son apartados restringidos a cuentas con rol de administrador.' },
  { keys: ['ayuda', 'que hace', 'funcion', 'seccion', 'pagina', 'plataforma'], answer: 'La plataforma ofrece streaming institucional, biblioteca de videos, asesoría agrícola, pronósticos, mapa climático, alertas y datos. Puedes preguntarme por cualquiera de esas secciones.' }
];
function normalizeBotText(value) {
  return String(value).toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}
function appendBotMessage(text, kind = 'bot', view = '') {
  const message = document.createElement('div');
  message.className = `bot-message ${kind === 'user' ? 'user-message' : ''}`;
  const paragraph = document.createElement('p'); paragraph.textContent = text; message.append(paragraph);
  if (view) {
    const open = document.createElement('button'); open.type = 'button'; open.className = 'bot-open-section'; open.textContent = `Abrir ${viewTitles[view] || 'sección'}`;
    open.addEventListener('click', () => { showView(view); closeInfoBot(); }); message.append(open);
  }
  botMessages.append(message); botMessages.scrollTop = botMessages.scrollHeight;
}
function answerBot(question) {
  const normalized = normalizeBotText(question);
  const match = botAnswers.find(item => item.keys.some(key => normalized.includes(normalizeBotText(key))));
  appendBotMessage(match?.answer || 'No encontré una respuesta exacta. Pregúntame por streaming, OBS, videos, agricultura, pronóstico, mapa, alertas, datos o acceso a la cuenta.', 'bot', match?.view || '');
}
function closeInfoBot() { botPanel.hidden = true; botLauncher.setAttribute('aria-expanded', 'false'); }
botLauncher.addEventListener('click', () => {
  botPanel.hidden = !botPanel.hidden;
  botLauncher.setAttribute('aria-expanded', String(!botPanel.hidden));
  if (!botPanel.hidden) botInput.focus();
});
document.querySelector('#info-bot-close').addEventListener('click', closeInfoBot);
document.querySelector('#info-bot-form').addEventListener('submit', event => {
  event.preventDefault(); const question = botInput.value.trim(); if (!question) return;
  appendBotMessage(question, 'user'); botInput.value = ''; answerBot(question);
});
document.querySelector('.info-bot-quick').addEventListener('click', event => {
  const question = event.target.closest('[data-bot-question]')?.dataset.botQuestion; if (!question) return;
  appendBotMessage(question, 'user'); answerBot(question);
});
