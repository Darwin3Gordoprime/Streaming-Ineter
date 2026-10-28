const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const api = async (path, options = {}) => {
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { ...(options.body && typeof options.body === 'string' ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Error del servidor (${response.status}).`);
  return data;
};
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const formatDate = value => value ? new Intl.DateTimeFormat('es-NI', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
let usersCache = [];
let accessRequestCanApprove = false;
let currentAdmin = null;
let systemBusy = false;
let adminStreamState = null;
let adminStreamBusy = false;
let adminObsFormEdited = false;
let adminYoutubeConfigEdited = false;
let activeStudioTab = 'obs';
let alertRefreshTimer = null;
const visibleStudioKeys = new Set();
const studioProfileFeedback = {};
const studioSoftwareLabels = { obs: 'OBS Studio', streamyard: 'StreamYard', streamlabs: 'Streamlabs Desktop', prism: 'PRISM Live Studio' };
const studioSources = { camera: 'Cámara', screen: 'Captura de pantalla', capture: 'Capturadora externa', mixed: 'Escena mixta' };
const studioResolutions = { sd: 'SD · 360p', '720p': 'HD · 720p', '1080p': 'Full HD · 1080p' };
let adminFirebase = null;
const systemNetworkHistory = [];
function configureMainAppLinks() {
  const page = new URL(location.href);
  if (page.port === '3012') page.port = '3000';
  const appRoot = new URL('/', page.origin);
  $$('[data-main-app]').forEach(link => { link.href = new URL(link.dataset.mainApp, appRoot).href; });
}
configureMainAppLinks();

function showAccess(title, message, login = false) {
  $('#admin-shell').hidden = true;
  $('#access-wall').hidden = false;
  $('#access-title').textContent = title;
  $('#access-message').textContent = message;
  $('#admin-login-form').hidden = !login;
}
async function initializeAdminFirebase() {
  if (adminFirebase) return adminFirebase;
  const configResponse = await fetch('/api/firebase/config', { cache: 'no-store' });
  const payload = await configResponse.json().catch(() => ({}));
  const config = payload.config || payload;
  if (!configResponse.ok || !config.apiKey || !config.authDomain || !config.projectId || !config.appId) throw new Error(payload.error || 'No se pudo cargar Firebase.');
  const sdk = 'https://www.gstatic.com/firebasejs/13.0.0';
  const [{ initializeApp, getApps }, { getAuth, signInWithEmailAndPassword, signOut }] = await Promise.all([
    import(`${sdk}/firebase-app.js`), import(`${sdk}/firebase-auth.js`)
  ]);
  const app = getApps().find(item => item.name === 'ineter-admin-login') || initializeApp(config, 'ineter-admin-login');
  adminFirebase = { auth: getAuth(app), signInWithEmailAndPassword, signOut };
  return adminFirebase;
}
function showAdminLoginError(message = '') {
  const error = $('#admin-login-error');
  error.textContent = message;
  error.hidden = !message;
}
async function submitAdminLogin(event) {
  event.preventDefault();
  const button = $('#admin-login-submit');
  button.disabled = true;
  button.textContent = 'Verificando con Firebase…';
  showAdminLoginError('');
  try {
    const firebase = await initializeAdminFirebase();
    const credential = await firebase.signInWithEmailAndPassword(firebase.auth, $('#admin-login-email').value.trim(), $('#admin-login-password').value);
    const idToken = await credential.user.getIdToken(true);
    const result = await api('/api/auth/firebase/monitor-session', { method: 'POST', body: JSON.stringify({ idToken }) });
    if (result.professional?.role !== 'admin') {
      await api('/api/auth/monitor-logout', { method: 'POST' }).catch(() => {});
      await firebase.signOut(firebase.auth).catch(() => {});
      throw new Error('Esta cuenta no tiene el rol de administrador principal. Los administradores técnicos ingresan por el panel de monitoreo.');
    }
    $('#admin-login-password').value = '';
    await boot();
  } catch (error) {
    const code = String(error.code || '');
    const message = code.includes('invalid-credential') || code.includes('invalid-login-credentials') || code.includes('user-not-found') || code.includes('wrong-password')
      ? 'El correo o la contraseña no son correctos.'
      : code.includes('unauthorized-domain') ? `Firebase no autoriza el dominio ${location.hostname}. Agrégalo a los dominios autorizados en Firebase Console.`
      : code.includes('api-key-not-valid') ? 'La clave web de Firebase no es válida. Revisa la configuración del proyecto.'
      : code.includes('user-disabled') ? 'Esta cuenta está deshabilitada en Firebase Authentication.'
      : code.includes('too-many-requests') ? 'Firebase bloqueó temporalmente los intentos. Espera y vuelve a probar.'
      : code.includes('network-request-failed') ? 'No se pudo conectar con Firebase. Revisa la conexión a Internet.'
      : error.message || 'No se pudo iniciar sesión.';
    showAdminLoginError(message);
  } finally {
    button.disabled = false;
    button.textContent = 'Iniciar sesión en administración';
  }
}
function setError(message = '') {
  const element = $('#page-error');
  element.textContent = message;
  element.hidden = !message;
}
function setPanel(name) {
  const titles = { overview: 'Resumen administrativo', streaming: 'Estudio de streaming', system: 'Equipo en vivo', accounts: 'Cuentas y roles', alerts: 'Alertas y difusión', requests: 'Solicitudes de acceso', videos: 'Biblioteca de videos', reports: 'Reportes agrícolas' };
  if (!Object.hasOwn(titles, name)) name = 'overview';
  setAdminMenuOpen(false);
  $$('.admin-nav button').forEach(button => button.classList.toggle('active', button.dataset.section === name));
  $$('.admin-section').forEach(panel => panel.classList.toggle('active', panel.dataset.panel === name));
  $('#page-title').textContent = titles[name] || titles.overview;
  history.replaceState(null, '', `#${name}`);
  if (name === 'accounts') loadUsers();
  if (name === 'alerts') loadAlerts();
  if (name === 'requests') loadRequests();
  if (name === 'reports') loadReports();
  if (name === 'videos') loadAdminVideos();
  if (name === 'system') updateSystemMetrics();
  if (name === 'streaming') {
    loadAdminStream();
    loadAdminYoutubeConfig();
  }
}
function setAdminMenuOpen(open) {
  const shell = $('#admin-shell');
  const toggle = $('#admin-menu-toggle');
  const backdrop = $('#admin-sidebar-backdrop');
  shell.classList.toggle('menu-open', open);
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
  backdrop.hidden = !open;
}
async function boot() {
  try {
    const session = await api('/api/auth/admin-session');
    if (!session.professional) { showAccess('Iniciar sesión de administración', 'Esta es una sesión separada de la aplicación INETER. Accede aquí con la cuenta administradora principal de Firebase.', true); return; }
    if (session.professional.role !== 'admin') { showAccess('Acceso restringido', 'Esta sesión no tiene el rol de administrador principal. Usa el panel de monitoreo correspondiente a tu cuenta.', false); return; }
    currentAdmin = session.professional;
    const status = await api('/api/admin/status');
    if (!status.isAdmin) { showAccess('Acceso restringido', 'El servidor no reconoce permisos administrativos para esta cuenta.'); return; }
    $('#access-wall').hidden = true;
    $('#admin-shell').hidden = false;
    $('#admin-name').textContent = currentAdmin.name || 'Administrador';
    $('#admin-email').textContent = currentAdmin.email || '';
    $('#admin-avatar').textContent = (currentAdmin.name || 'IN').split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
    setPanel(location.hash.slice(1) || 'overview');
    await loadUsers();
    await Promise.allSettled([loadAlerts(), loadRequests()]);
    setInterval(updateSystemMetrics, 2500);
    refreshStreamStatsAdmin();
    setInterval(refreshStreamStatsAdmin, 15_000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { updateSystemMetrics(); refreshStreamStatsAdmin(); } });
  } catch (error) {
    showAccess('No se pudo validar la sesión', `${error.message} Comprueba que el servidor esté iniciado e inténtalo de nuevo.`, true);
  }
}
$('#admin-login-form').addEventListener('submit', submitAdminLogin);

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB']; let size = bytes / 1024; let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit++; }
  return `${size.toFixed(size >= 100 ? 0 : 1)} ${units[unit]}`;
}
function formatUptime(value) {
  const seconds = Math.max(0, Number(value) || 0);
  const days = Math.floor(seconds / 86400); const hours = Math.floor(seconds % 86400 / 3600); const minutes = Math.floor(seconds % 3600 / 60);
  return days ? `${days} d ${hours} h` : hours ? `${hours} h ${minutes} min` : `${minutes} min`;
}
function setResource(id, value) {
  const bar = $(`#${id}`); if (!bar) return;
  const percent = Math.max(0, Math.min(100, Number(value) || 0));
  bar.style.width = `${percent}%`;
  bar.parentElement.setAttribute('aria-valuenow', percent.toFixed(0));
}
function renderSystemChart() {
  const max = Math.max(.05, ...systemNetworkHistory.flatMap(sample => [sample.up, sample.down]));
  for (const [id, key] of [['system-chart-upload', 'up'], ['system-chart-download', 'down']]) {
    const path = $(`#${id}`);
    path.setAttribute('d', systemNetworkHistory.map((sample, index) => `${index ? 'L' : 'M'} ${(index / Math.max(1, systemNetworkHistory.length - 1) * 100).toFixed(2)} ${(48 - sample[key] / max * 43).toFixed(2)}`).join(' '));
  }
}
function updateNetworkStatistics(network, latency) {
  const sampleLatency = Number.isFinite(Number(latency.ms)) ? Number(latency.ms) : null;
  systemNetworkHistory.push({ up: Number(network.uploadMbps) || 0, down: Number(network.downloadMbps) || 0, latency: sampleLatency });
  if (systemNetworkHistory.length > 30) systemNetworkHistory.shift();
  const average = key => {
    const values = systemNetworkHistory.map(item => item[key]).filter(Number.isFinite);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  };
  const peak = key => Math.max(0, ...systemNetworkHistory.map(item => Number(item[key]) || 0));
  const latencyValues = systemNetworkHistory.map(item => item.latency).filter(Number.isFinite);
  const fmtRate = value => value == null ? '—' : `${value.toFixed(2)} Mbps`;
  const fmtLatency = value => value == null ? '—' : `${Math.round(value)} ms`;
  $('#system-upload-avg').textContent = fmtRate(average('up'));
  $('#system-upload-peak').textContent = fmtRate(peak('up'));
  $('#system-download-avg').textContent = fmtRate(average('down'));
  $('#system-download-peak').textContent = fmtRate(peak('down'));
  $('#system-latency-avg').textContent = fmtLatency(average('latency'));
  $('#system-latency-min').textContent = fmtLatency(latencyValues.length ? Math.min(...latencyValues) : null);
  renderSystemChart();
}
async function updateSystemMetrics() {
  if (systemBusy || document.hidden || $('#admin-shell').hidden || !$('.admin-section[data-panel="system"]').classList.contains('active')) return;
  systemBusy = true;
  try {
    const m = await api('/api/admin/monitor');
    const device = m.device || {}; const network = m.network || {}; const memoryUsed = Math.max(0, (Number(device.memoryTotalBytes) || 0) - (Number(device.memoryFreeBytes) || 0));
    const memoryPercent = Number(device.memoryUsedPercent) || 0; const cpuPercent = Number.isFinite(device.cpuPercent) ? device.cpuPercent : null;
    $('#system-cpu-value').textContent = Number.isFinite(cpuPercent) ? `${cpuPercent.toFixed(0)}%` : 'Midiendo…';
    $('#system-cpu-detail').textContent = `${device.cpuCores || '—'} núcleos lógicos · ${device.cpuModel || 'Procesador no identificado'}`;
    setResource('system-cpu-bar', Number.isFinite(cpuPercent) ? cpuPercent : 0);
    $('#system-ram-value').textContent = `${memoryPercent.toFixed(0)}%`;
    $('#system-ram-detail').textContent = `${formatBytes(memoryUsed)} usados · ${formatBytes(device.memoryFreeBytes)} libres de ${formatBytes(device.memoryTotalBytes)}`;
    setResource('system-ram-bar', memoryPercent);
    const disk = device.disk;
    if (disk?.totalBytes > 0) {
      const used = Math.max(0, disk.totalBytes - disk.freeBytes); const percent = used / disk.totalBytes * 100;
      $('#system-disk-value').textContent = `${percent.toFixed(0)}%`;
      $('#system-disk-detail').textContent = `${formatBytes(used)} usados · ${formatBytes(disk.freeBytes)} libres`;
      setResource('system-disk-bar', percent);
      $('#system-disk-summary').textContent = `${formatBytes(disk.freeBytes)} libres de ${formatBytes(disk.totalBytes)}`;
    } else {
      $('#system-disk-value').textContent = 'N/D'; $('#system-disk-detail').textContent = 'No se pudo leer la unidad de grabaciones.';
      setResource('system-disk-bar', 0); $('#system-disk-summary').textContent = 'No disponible';
    }
    $('#system-process-value').textContent = formatBytes(device.processRssBytes);
    $('#system-process-detail').textContent = `Heap ${formatBytes(m.server?.heapUsedBytes)} de ${formatBytes(m.server?.heapTotalBytes)}`;
    const processStats = m.processStats || {};
    const processes = processStats.processes || [];
    $('#system-process-count').textContent = processStats.available ? `${processes.length} procesos` : 'No disponible';
    $('#system-process-scope').textContent = processStats.scope || 'Procesos visibles para el servidor';
    $('#system-process-table').innerHTML = processes.length ? processes.slice(0, 20).map(item => `<tr><td><b>${escapeHtml(item.name)}</b></td><td>${escapeHtml(item.pid)}</td><td>${Number.isFinite(item.cpuPercent) ? `${item.cpuPercent.toFixed(1)}%` : 'Midiendo…'}</td><td>${formatBytes(item.memoryBytes)}</td></tr>`).join('') : `<tr><td colspan="4">${processStats.available ? 'No hay procesos visibles.' : 'El sistema no permitió leer los procesos.'}</td></tr>`;
    $('#system-upload').textContent = `${Number(network.uploadMbps || 0).toFixed(2)} Mbps`;
    $('#system-download').textContent = `${Number(network.downloadMbps || 0).toFixed(2)} Mbps`;
    $('#system-upload-total').textContent = `Enviado total: ${formatBytes(network.uploadedBytes)}`;
    $('#system-download-total').textContent = `Recibido total: ${formatBytes(network.downloadedBytes)}`;
    $('#system-network-source').textContent = network.source || 'Red del equipo';
    $('#system-network-note').textContent = network.note || 'La medición corresponde a la actividad agregada de las interfaces de red del servidor.';
    $('#system-interfaces').textContent = `Interfaces: ${(network.interfaces || []).join(', ') || network.error || 'No disponibles'}`;
    const latency = network.latency || {};
    $('#system-latency').textContent = latency.ms != null ? `${latency.ms} ms` : latency.status === 'sin_respuesta' ? 'Sin respuesta' : m.streaming ? 'Midiendo…' : '—';
    updateNetworkStatistics(network, latency);
    $('#system-host').textContent = device.hostname || '—'; $('#system-os').textContent = device.os || '—';
    $('#system-runtime').textContent = `${device.architecture || '—'} · ${device.nodeVersion || '—'}`;
    $('#system-cpu-model').textContent = device.cpuModel || '—'; $('#system-cpu-cores').textContent = String(device.cpuCores || '—');
    $('#system-memory-summary').textContent = `${formatBytes(device.memoryTotalBytes)} total · ${formatBytes(device.memoryFreeBytes)} libres`;
    $('#system-heap').textContent = `${formatBytes(m.server?.heapUsedBytes)} usados de ${formatBytes(m.server?.heapTotalBytes)}`;
    $('#system-uptime').textContent = formatUptime(m.server?.uptimeSeconds);
    $('#system-stream-count').textContent = String(m.streams?.total ?? 0);
    $('#system-active-users').textContent = String(m.activeUsers?.length ?? 0);
    $('#system-recordings').textContent = `${m.recordings?.count ?? 0} · ${formatBytes(m.recordings?.totalBytes)}`;
    $('#system-stream-state').textContent = m.streaming ? `En vivo · ${formatUptime(m.streams?.currentSeconds)}` : 'Sin emisión';
    $('#system-stream-state').classList.toggle('is-live', !!m.streaming);
    const obs = $('#system-obs-status');
    obs.innerHTML = `<span>OBS Studio</span><b class="${m.obs?.connected ? 'healthy' : 'warning'}">${m.obs?.connected ? (m.obs.streaming ? 'Transmitiendo' : 'Conectado') : 'Desconectado'}</b>`;
    const destinations = m.destinations || [];
    $('#system-destinations').innerHTML = destinations.length ? destinations.map(destination => `<div class="system-destination"><span>${escapeHtml(destination.name)} · ${escapeHtml(destination.platform)}</span><b>${escapeHtml(destination.status)}</b></div>`).join('') : '<p class="form-message">No hay plataformas configuradas.</p>';
    $('#system-sampled-at').textContent = `Última lectura: ${new Date(m.sampledAt).toLocaleTimeString('es-NI')}`;
    $('#system-live-state').classList.remove('stale');
    $('#system-live-state').innerHTML = `<i></i> En vivo · ${new Date(m.sampledAt).toLocaleTimeString('es-NI')}`;
    setError('');
  } catch (error) {
    $('#system-live-state').classList.add('stale');
    $('#system-live-state').innerHTML = '<i></i> Sin actualización';
    setError(`No se pudo actualizar el monitoreo: ${error.message}`);
  } finally { systemBusy = false; }
}

$$('.admin-nav button').forEach(button => button.addEventListener('click', () => setPanel(button.dataset.section)));
$('#admin-menu-toggle').addEventListener('click', () => setAdminMenuOpen(!$('#admin-shell').classList.contains('menu-open')));
$('#admin-sidebar-close').addEventListener('click', () => setAdminMenuOpen(false));
$('#admin-sidebar-backdrop').addEventListener('click', () => setAdminMenuOpen(false));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && $('#admin-shell').classList.contains('menu-open')) {
    setAdminMenuOpen(false);
    $('#admin-menu-toggle').focus();
  }
});
window.addEventListener('resize', () => {
  if (window.matchMedia('(min-width: 761px)').matches) setAdminMenuOpen(false);
});
$$('[data-open]').forEach(button => button.addEventListener('click', () => setPanel(button.dataset.open)));
window.addEventListener('hashchange', () => {
  const name = location.hash.slice(1);
  if ($(`[data-panel="${CSS.escape(name)}"]`)) setPanel(name);
});

async function refreshStreamStatsAdmin() {
  try {
    const stats = await api('/api/stream/stats');
    const viewers = $('#stat-viewers');
    const likes = $('#stat-likes');
    if (viewers) viewers.textContent = String(stats.viewers ?? 0);
    if (likes) likes.textContent = String(stats.likes ?? 0);
  } catch { /* Se reintenta en el siguiente ciclo. */ }
}
function renderStudioProfiles() {
  const state = adminStreamState || {};
  const profiles = state.studioProfiles || {};
  const destinations = state.destinations || [];
  const panels = $('#studio-profile-panels');
  if (!panels) return;
  $('#active-studio-profile').textContent = `${studioSoftwareLabels[state.activeStudioProfile] || studioSoftwareLabels.obs} activo`;
  panels.innerHTML = Object.entries(studioSoftwareLabels).map(([software, label]) => {
    const profile = profiles[software] || { source: 'camera', resolution: '1080p', aspectRatio: '16:9', sceneName: '', destinationIds: null };
    const allDestinationsSelected = !Array.isArray(profile.destinationIds);
    const targetOptions = destinations.length
      ? destinations.map(destination => `<label class="studio-destination-option"><input name="destinationIds" type="checkbox" value="${escapeHtml(destination.id)}" ${allDestinationsSelected || profile.destinationIds.includes(destination.id) ? 'checked' : ''} /><span><b>${escapeHtml(destination.name)}</b><small>${escapeHtml(destination.platform)} · ${escapeHtml(destination.outputStatus || 'Listo')}</small></span></label>`).join('')
      : '<p class="form-message">Configura al menos una salida RTMP en la sección correspondiente para habilitar YouTube Live u otras plataformas.</p>';
    const isActive = state.activeStudioProfile === software;
    const status = software === 'obs'
      ? (state.obs?.connected ? 'WebSocket conectado' : state.obs?.configured ? 'WebSocket sin conexión' : 'WebSocket pendiente')
      : 'RTMP manual';
    const ingestServer = escapeHtml(state.ingest?.server || 'No disponible');
    const ingestKey = state.ingest?.key || '';
    const showKey = visibleStudioKeys.has(software);
    return `<article class="studio-profile-panel${activeStudioTab === software ? ' active' : ''}" id="studio-panel-${software}" role="tabpanel" aria-labelledby="studio-tab-${software}" data-studio-panel="${software}" ${activeStudioTab === software ? '' : 'hidden'}>
      <div class="studio-profile-heading"><div><h4>Perfil ${label}</h4><p>${software === 'obs' ? 'Control WebSocket y publicación RTMP hacia la VM de Azure.' : 'Perfil guardado; aplica la fuente y la calidad en la aplicación emisora.'}</p></div><span class="pill${isActive ? ' is-active' : ''}" data-profile-status="${software}">${isActive ? 'ACTIVO · ' : ''}${status}</span></div>
      <form class="studio-profile-form" data-studio-profile-form="${software}">
        <label>Fuente de video<select name="source" required>${Object.entries(studioSources).map(([value, name]) => `<option value="${value}" ${profile.source === value ? 'selected' : ''}>${name}</option>`).join('')}</select></label>
        <label>Resolución<select name="resolution" required>${Object.entries(studioResolutions).map(([value, name]) => `<option value="${value}" ${profile.resolution === value ? 'selected' : ''}>${name}</option>`).join('')}</select></label>
        <label>Relación de aspecto<select name="aspectRatio" required><option value="16:9" ${profile.aspectRatio === '16:9' ? 'selected' : ''}>Horizontal · 16:9</option><option value="9:16" ${profile.aspectRatio === '9:16' ? 'selected' : ''}>Vertical · 9:16</option></select></label>
        ${software === 'obs' ? `<label>Escena activa de OBS<select name="sceneName"><option value="">No cambiar escena</option>${(state.obsProduction?.scenes || []).map(scene => `<option value="${escapeHtml(scene.sceneName)}" ${profile.sceneName === scene.sceneName ? 'selected' : ''}>${escapeHtml(scene.sceneName)}</option>`).join('')}${profile.sceneName && !(state.obsProduction?.scenes || []).some(scene => scene.sceneName === profile.sceneName) ? `<option value="${escapeHtml(profile.sceneName)}" selected>${escapeHtml(profile.sceneName)} (no disponible)</option>` : ''}</select></label>${state.obsProduction?.error ? `<p class="form-message error wide">No se pudieron cargar las escenas de OBS: ${escapeHtml(state.obsProduction.error)}</p>` : ''}` : ''}
        <fieldset class="studio-destination-fieldset"><legend>Salidas automáticas</legend><p>Elige los destinos configurados. Azure MediaMTX recibe la señal por el puerto RTMP 1935.</p><div class="studio-destination-options">${targetOptions}</div></fieldset>
        <div class="studio-ingest"><small>MediaMTX en Azure · servidor RTMP de entrada</small><code data-profile-ingest-server="${software}">${ingestServer}</code><div><code data-profile-ingest-key="${software}">${showKey ? escapeHtml(ingestKey || 'No disponible') : '••••••••••••••••••••••••'}</code><button type="button" class="text-button" data-profile-key-reveal="${software}">${showKey ? 'Ocultar clave' : 'Mostrar clave'}</button><button type="button" class="text-button" data-profile-key-copy="${software}">Copiar RTMP</button></div></div>
        <div class="studio-profile-actions"><button class="button primary" type="submit">Guardar y activar ${label}</button>${software === 'obs' ? '<button class="button secondary" type="button" data-apply-obs-format>Aplicar resolución a OBS</button>' : ''}<span class="form-message${studioProfileFeedback[software]?.error ? ' error' : studioProfileFeedback[software]?.success ? ' success' : ''}" role="status" data-profile-feedback="${software}">${escapeHtml(studioProfileFeedback[software]?.text || '')}</span></div>
      </form>
      ${software === 'obs' ? `<form id="admin-stream-obs-form" class="admin-stream-form studio-websocket-form">
        <div class="studio-profile-heading"><div><h4>Enlace OBS WebSocket</h4><p>Para el túnel seguro de la VM, usa el puerto 4458. No lo expongas directamente a Internet.</p></div></div>
        <label>Host o endpoint del túnel<input name="host" value="${escapeHtml(state.obs?.host || 'host.docker.internal')}" maxlength="253" required /></label>
        <label>Puerto<input name="port" type="number" min="1" max="65535" value="${Number(state.obs?.port || 4458)}" required /></label>
        <label class="wide">Contraseña WebSocket<input name="password" type="password" autocomplete="new-password" placeholder="Vacío para reutilizar la contraseña guardada" /></label>
        <button class="button secondary wide" id="admin-stream-connect" type="submit">Conectar y vincular OBS</button>
        <p class="form-message wide">La contraseña se cifra en el servidor. Si ya está guardada, deja el campo vacío para conservarla.</p>
      </form>` : '<p class="studio-manual-note">Esta aplicación no está conectada a una API de control de terceros: usa el servidor RTMP y la clave mostrados arriba en sus ajustes de emisión. La retransmisión a los destinos seleccionados la realiza este servidor.</p>'}
    </article>`;
  }).join('');
}
function renderAdminStream() {
  if (!adminStreamState) return;
  const state = adminStreamState;
  const obs = state.obs || {};
  const live = Boolean(state.live);
  const isObsStreaming = Boolean(obs.streaming);
  $('#admin-stream-live-status').textContent = live ? 'EN VIVO' : 'ESPERANDO SEÑAL';
  $('#admin-stream-live-status').classList.toggle('is-live', live);
  $('#admin-stream-live-detail').textContent = live
    ? `La señal está disponible en la página de usuarios desde ${formatDate(state.liveSince)}.`
    : 'Inicia la emisión desde el control principal para publicarla en la página de usuarios.';
  const toggle = $('#admin-stream-toggle');
  toggle.textContent = isObsStreaming ? 'Detener emisión' : 'Iniciar emisión';
  toggle.disabled = !obs.connected || (Boolean(state.videoBroadcast?.status === 'programada' || state.videoBroadcast?.status === 'en vivo') && !isObsStreaming);
  const destinations = state.destinations || [];
  $('#admin-stream-destination-count').textContent = `${destinations.length} ${destinations.length === 1 ? 'destino' : 'destinos'}`;
  $('#admin-stream-destination-list').innerHTML = destinations.length ? destinations.map(destination => {
    const outputLabels = { conectando: 'Conectando', enviando: 'Enviando señal', detenido: 'Detenido', error: 'Error' };
    const status = live ? outputLabels[destination.outputStatus] || 'Esperando salida' : 'Listo';
    return `<div class="admin-stream-destination"><span><b>${escapeHtml(destination.name)}</b><small>${escapeHtml(destination.platform)} · ${escapeHtml(status)}</small></span><button class="remove-destination" type="button" data-admin-stream-remove="${escapeHtml(destination.id)}" aria-label="Quitar ${escapeHtml(destination.name)}">×</button></div>`;
  }).join('') : '<p class="form-message">Agrega una plataforma para retransmitir la señal.</p>';
  renderStudioProfiles();
  if (!adminObsFormEdited && obs.configured && $('#admin-stream-obs-form')) {
    $('#admin-stream-obs-form').elements.host.value = obs.host || 'host.docker.internal';
    $('#admin-stream-obs-form').elements.port.value = String(obs.port || 4458);
  }
}
async function loadAdminYoutubeConfig() {
  const status = $('#admin-youtube-status');
  const feedback = $('#admin-youtube-feedback');
  try {
    const { config } = await api('/api/admin/youtube-config');
    status.textContent = config.configured ? 'CONFIGURADO' : 'SIN CONFIGURAR';
    status.classList.toggle('is-live', config.configured);
    if (!adminYoutubeConfigEdited) {
      const form = $('#admin-youtube-form');
      form.elements.accountName.value = config.accountName || '';
      form.elements.accountEmail.value = config.accountEmail || '';
      form.elements.serverUrl.value = config.serverUrl || '';
      form.elements.key.value = '';
    }
    feedback.textContent = config.keyConfigured
      ? 'Clave de transmisión guardada y cifrada. Déjala vacía para conservarla.'
      : 'Aún no se ha guardado una clave de transmisión.';
    feedback.classList.remove('error');
  } catch (error) {
    status.textContent = 'SIN ACTUALIZACIÓN';
    feedback.textContent = `No se pudo consultar la configuración: ${error.message}`;
    feedback.classList.add('error');
  }
}
async function loadAdminStream() {
  if (adminStreamBusy || document.hidden || $('#admin-shell').hidden) return;
  adminStreamBusy = true;
  try {
    adminStreamState = await api('/api/admin/stream');
    if (adminStreamState.obs?.connected) {
      try { adminStreamState.obsProduction = await api('/api/obs/production'); }
      catch (error) { adminStreamState.obsProduction = { scenes: [], error: error.message }; }
    }
    renderAdminStream();
  } catch (error) {
    $('#admin-stream-live-status').textContent = 'SIN ACTUALIZACIÓN';
    $('#admin-stream-live-detail').textContent = `No se pudo consultar la transmisión: ${error.message}`;
  } finally { adminStreamBusy = false; }
}
$('.studio-software-tabs').addEventListener('click', event => {
  const tab = event.target.closest('[data-studio-tab]');
  if (!tab) return;
  activeStudioTab = tab.dataset.studioTab;
  $$('[data-studio-tab]').forEach(button => button.setAttribute('aria-selected', String(button === tab)));
  $$('[data-studio-panel]').forEach(panel => {
    const active = panel.dataset.studioPanel === activeStudioTab;
    panel.hidden = !active;
    panel.classList.toggle('active', active);
  });
});
$('#studio-profile-panels').addEventListener('submit', async event => {
  const form = event.target.closest('[data-studio-profile-form]');
  if (!form) return;
  event.preventDefault();
  const software = form.dataset.studioProfileForm;
  const button = form.querySelector('button[type="submit"]');
  const profile = {
    source: form.elements.source.value,
    resolution: form.elements.resolution.value,
    aspectRatio: form.elements.aspectRatio.value,
    sceneName: form.elements.sceneName?.value || '',
    destinationIds: [...form.querySelectorAll('input[name="destinationIds"]:checked')].map(input => input.value)
  };
  button.disabled = true;
  studioProfileFeedback[software] = { text: 'Guardando perfil y actualizando las salidas…' };
  try {
    adminStreamState = { ...adminStreamState, ...await api('/api/admin/studio-profiles', { method: 'PUT', body: JSON.stringify({ software, profile }) }) };
    studioProfileFeedback[software] = { text: 'Perfil guardado y activado. Las salidas seleccionadas se retransmitirán al recibir la señal.', success: true };
    renderAdminStream();
  } catch (error) {
    studioProfileFeedback[software] = { text: error.message, error: true };
    form.querySelector(`[data-profile-feedback="${software}"]`).textContent = error.message;
    form.querySelector(`[data-profile-feedback="${software}"]`).classList.add('error');
  } finally { button.disabled = false; }
});
$('#studio-profile-panels').addEventListener('click', async event => {
  const applyFormatButton = event.target.closest('[data-apply-obs-format]');
  if (applyFormatButton) {
    const form = applyFormatButton.closest('[data-studio-profile-form]');
    const profile = `${form.elements.aspectRatio.value === '16:9' ? 'landscape' : 'portrait'}-${form.elements.resolution.value}`;
    applyFormatButton.disabled = true;
    try {
      await api('/api/obs/video-settings', { method: 'PUT', body: JSON.stringify({ profile, fps: 30 }) });
      studioProfileFeedback.obs = { text: 'Resolución y aspecto aplicados en OBS.', success: true };
    } catch (error) { studioProfileFeedback.obs = { text: error.message, error: true }; }
    renderStudioProfiles();
    return;
  }
  const revealButton = event.target.closest('[data-profile-key-reveal]');
  if (revealButton) {
    const software = revealButton.dataset.profileKeyReveal;
    if (visibleStudioKeys.has(software)) visibleStudioKeys.delete(software);
    else visibleStudioKeys.add(software);
    renderStudioProfiles();
    return;
  }
  const copyButton = event.target.closest('[data-profile-key-copy]');
  if (!copyButton) return;
  try {
    await navigator.clipboard.writeText(`Servidor: ${adminStreamState?.ingest?.server || ''}\nClave: ${adminStreamState?.ingest?.key || ''}`);
    studioProfileFeedback[copyButton.dataset.profileKeyCopy] = { text: 'Datos RTMP copiados. Mantén la clave privada.', success: true };
    renderStudioProfiles();
  } catch (error) {
    studioProfileFeedback[copyButton.dataset.profileKeyCopy] = { text: `No se pudieron copiar los datos RTMP: ${error.message}`, error: true };
    renderStudioProfiles();
  }
});
document.addEventListener('input', event => {
  if (event.target.closest('#admin-stream-obs-form')) adminObsFormEdited = true;
});
document.addEventListener('submit', async event => {
  if (event.target.id !== 'admin-stream-obs-form') return;
  event.preventDefault();
  const form = event.target;
  const button = $('#admin-stream-connect');
  button.disabled = true;
  $('#admin-stream-feedback').textContent = 'Conectando con OBS…';
  try {
    adminStreamState = { ...adminStreamState, ...await api('/api/obs/connect', { method: 'POST', body: JSON.stringify({
      host: form.elements.host.value.trim(),
      port: Number(form.elements.port.value),
      password: form.elements.password.value
    }) }) };
    form.elements.password.value = '';
    adminObsFormEdited = false;
    try { adminStreamState.obsProduction = await api('/api/obs/production'); }
    catch (error) { adminStreamState.obsProduction = { scenes: [], error: error.message }; }
    renderAdminStream();
    $('#admin-stream-feedback').textContent = 'OBS conectado y configurado para publicar en INETER en vivo.';
    $('#admin-stream-feedback').classList.remove('error');
  } catch (error) {
    $('#admin-stream-feedback').textContent = error.message;
    $('#admin-stream-feedback').classList.add('error');
  } finally { button.disabled = false; }
});
$('#admin-stream-toggle').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  $('#admin-stream-feedback').textContent = '';
  try {
    const action = adminStreamState?.obs?.streaming ? 'stop' : 'start';
    adminStreamState = { ...adminStreamState, ...await api('/api/obs/stream', { method: 'POST', body: JSON.stringify({ action }) }) };
    renderAdminStream();
    $('#admin-stream-feedback').textContent = action === 'start' ? 'OBS inició. La página de usuarios se actualizará al recibir la señal.' : 'La transmisión de OBS se detuvo.';
    $('#admin-stream-feedback').classList.remove('error');
  } catch (error) {
    $('#admin-stream-feedback').textContent = error.message;
    $('#admin-stream-feedback').classList.add('error');
    await loadAdminStream();
  } finally { button.disabled = false; renderAdminStream(); }
});
$('#admin-stream-destination-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $('#admin-stream-add-destination');
  button.disabled = true;
  try {
    adminStreamState = { ...adminStreamState, ...await api('/api/destinations', { method: 'POST', body: JSON.stringify({
      platform: form.elements.platform.value,
      name: form.elements.name.value.trim(),
      serverUrl: form.elements.serverUrl.value.trim(),
      key: form.elements.key.value
    }) }) };
    form.reset();
    renderAdminStream();
    $('#admin-stream-feedback').textContent = 'Plataforma guardada. Su clave quedó cifrada en el servidor.';
    $('#admin-stream-feedback').classList.remove('error');
  } catch (error) {
    $('#admin-stream-feedback').textContent = error.message;
    $('#admin-stream-feedback').classList.add('error');
  } finally { button.disabled = false; }
});
$('#admin-stream-destination-form').elements.platform.addEventListener('change', event => {
  $('#admin-stream-youtube-help').textContent = 'La clave de transmisión se cifra y no se muestra después de guardarla.';
});
$('#admin-youtube-form').addEventListener('input', () => { adminYoutubeConfigEdited = true; });
$('#admin-youtube-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $('#admin-youtube-save');
  const feedback = $('#admin-youtube-feedback');
  button.disabled = true;
  feedback.textContent = 'Guardando configuración de YouTube…';
  feedback.classList.remove('error');
  try {
    const { config } = await api('/api/admin/youtube-config', {
      method: 'PUT',
      body: JSON.stringify({
        accountName: form.elements.accountName.value.trim(),
        accountEmail: form.elements.accountEmail.value.trim(),
        serverUrl: form.elements.serverUrl.value.trim(),
        key: form.elements.key.value
      })
    });
    form.elements.key.value = '';
    adminYoutubeConfigEdited = false;
    $('#admin-youtube-status').textContent = config.configured ? 'CONFIGURADO' : 'SIN CONFIGURAR';
    $('#admin-youtube-status').classList.toggle('is-live', config.configured);
    await loadAdminStream();
    feedback.textContent = 'Configuración guardada. La clave quedó cifrada y no se devolverá al navegador.';
  } catch (error) {
    feedback.textContent = error.message;
    feedback.classList.add('error');
  } finally { button.disabled = false; }
});
$('#admin-stream-destination-list').addEventListener('click', async event => {
  const button = event.target.closest('[data-admin-stream-remove]');
  if (!button) return;
  button.disabled = true;
  try {
    adminStreamState = { ...adminStreamState, ...await api(`/api/destinations/${encodeURIComponent(button.dataset.adminStreamRemove)}`, { method: 'DELETE' }) };
    renderAdminStream();
  } catch (error) {
    $('#admin-stream-feedback').textContent = error.message;
    $('#admin-stream-feedback').classList.add('error');
    button.disabled = false;
  }
});
async function loadUsers() {  const body = $('#users-table');
  body.innerHTML = '<tr><td colspan="4">Sincronizando cuentas con Firebase…</td></tr>';
  try {
    const { users } = await api('/api/admin/users');
    usersCache = users || [];
    renderUsers();
    $('#stat-users').textContent = usersCache.length;
    $('#stat-active').textContent = usersCache.filter(user => user.active).length;
    $('#user-count').textContent = `${usersCache.length} cuenta${usersCache.length === 1 ? '' : 's'} encontradas en Firebase`;
  } catch (error) { body.innerHTML = `<tr><td colspan="4">${escapeHtml(error.message)}</td></tr>`; $('#user-count').textContent = 'No se pudo cargar Firebase Authentication'; }
}
function renderUsers() {
  const query = $('#user-search').value.trim().toLocaleLowerCase('es');
  const list = usersCache.filter(user => `${user.name} ${user.email}`.toLocaleLowerCase('es').includes(query));
  $('#users-table').innerHTML = list.length ? list.map(user => {
    const protectedRole = ['admin', 'monitor_admin'].includes(user.role) || user.email?.toLowerCase() === (currentAdmin?.email || '').toLowerCase();
    const role = user.role || 'user';
    const roleLabel = { admin: 'Administrador principal', monitor_admin: 'Administrador de monitoreo', support: 'Soporte', user: 'Usuario', professional: 'Profesional' }[role] || role;
    const roleCell = protectedRole
      ? `<span class="role-lock">${escapeHtml(roleLabel)} · protegido</span>`
      : `<select class="role-select" data-role-uid="${escapeHtml(user.firebaseUid || user.id)}" aria-label="Rol de ${escapeHtml(user.email)}"><option value="user" ${role === 'user' ? 'selected' : ''}>Usuario</option><option value="support" ${role === 'support' ? 'selected' : ''}>Soporte</option></select>`;
    return `<tr><td><b>${escapeHtml(user.name || 'Cuenta INETER')}</b><small>${escapeHtml(user.email)}</small></td><td><span class="user-state ${user.active ? 'online' : ''}"><i></i>${user.disabled ? 'Deshabilitada' : user.active ? 'En línea' : 'Registrada'}${user.emailVerified ? ' · correo verificado' : ''}</span></td><td>${roleCell}</td><td>${escapeHtml(formatDate(user.createdAt))}</td></tr>`;
  }).join('') : '<tr><td colspan="4">No hay cuentas que coincidan con la búsqueda.</td></tr>';
}
$('#user-search').addEventListener('input', renderUsers);
$('#refresh-users').addEventListener('click', loadUsers);
$('#users-table').addEventListener('change', async event => {
  const select = event.target.closest('[data-role-uid]');
  if (!select) return;
  const role = select.value;
  select.disabled = true;
  try {
    await api(`/api/admin/users/${encodeURIComponent(select.dataset.roleUid)}/role`, { method: 'PATCH', body: JSON.stringify({ role }) });
    const user = usersCache.find(item => (item.firebaseUid || item.id) === select.dataset.roleUid);
    if (user) user.role = role;
    setError('');
  } catch (error) { setError(error.message); await loadUsers(); }
  finally { select.disabled = false; }
});

$('#create-user-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $('#create-user-submit');
  const message = $('#create-user-message');
  const data = Object.fromEntries(new FormData(form));
  button.disabled = true; message.className = 'form-message'; message.textContent = 'Creando cuenta en Firebase…';
  try {
    await api('/api/admin/users', { method: 'POST', body: JSON.stringify(data) });
    message.classList.add('success'); message.textContent = 'Cuenta creada. Ya aparece en el directorio.';
    form.reset(); await loadUsers();
  } catch (error) { message.classList.add('error'); message.textContent = error.message; }
  finally { button.disabled = false; }
});

$('#create-monitor-admin-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $('#create-monitor-admin-submit');
  const message = $('#create-monitor-admin-message');
  const data = Object.fromEntries(new FormData(form));
  button.disabled = true; message.className = 'form-message'; message.textContent = 'Creando cuenta autorizada en Firebase…';
  try {
    await api('/api/admin/monitor-admins', { method: 'POST', body: JSON.stringify(data) });
    message.classList.add('success'); message.textContent = 'Cuenta de administrador de monitoreo creada.';
    form.reset(); await loadUsers();
  } catch (error) { message.classList.add('error'); message.textContent = error.message; }
  finally { button.disabled = false; }
});

async function loadAlerts() {
  clearTimeout(alertRefreshTimer);
  alertRefreshTimer = null;
  const list = $('#alert-list');
  list.textContent = 'Consultando avisos…';
  try {
    const data = await api('/api/admin/alerts');
    $('#recipient-count').textContent = `Destinatarios: ${data.registeredCount ?? 0}`;
    const mailSetup = data.mail?.ready
      ? `Correo listo · ${escapeHtml(data.mail.sender)}${data.mail.usingDefaultSender ? ' (remitente predeterminado)' : ''}`
      : 'Correo sin configurar · falta RESEND_API_KEY; ALERT_FROM_EMAIL es opcional.';
    $('#stat-alerts').textContent = (data.alerts || []).length;
    const alerts = [...new Map((data.alerts || []).filter(alert => alert?.id).map(alert => [alert.id, alert])).values()];
    list.innerHTML = `<small>${mailSetup}</small>` + (alerts.length ? alerts.map(alert => `<article class="record-item"><div><h3>${escapeHtml(alert.title)}</h3><p>${escapeHtml(alert.categoryLabel || alert.category)} · ${escapeHtml(alert.severityLabel || alert.severity)} · ${escapeHtml(alert.location || 'Sin zona')}</p><p>${escapeHtml(alert.message)}</p><small>${escapeHtml(formatDate(alert.createdAt))} · correo: ${escapeHtml(alert.emailStatus || 'pendiente')} (${Number(alert.emailAccepted || 0)}/${Number(alert.recipientCount || 0)}) · notificaciones: ${escapeHtml(alert.firebaseStatus || 'pendiente')}${alert.emailError ? ` · ${escapeHtml(alert.emailError)}` : ''}</small></div>${['fallido', 'parcial', 'sin_configuracion', 'sin_destinatarios'].includes(alert.emailStatus) ? `<div class="record-actions"><button data-retry-alert="${escapeHtml(alert.id)}">Reintentar correo</button></div>` : ''}</article>`).join('') : '<p>No hay avisos publicados.</p>');
    if (alerts.some(alert => ['en_cola', 'enviando'].includes(alert.emailStatus)) && !document.hidden) {
      alertRefreshTimer = setTimeout(loadAlerts, 2500);
    }
  } catch (error) { list.textContent = error.message; }
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) loadAlerts();
});
$('#refresh-alerts').addEventListener('click', loadAlerts);
$('#clear-alerts').addEventListener('click', async event => {
  const button = event.currentTarget;
  const feedback = $('#clear-alerts-feedback');
  if (!confirm('¿Limpiar el registro completo de alertas? Esta acción no se puede deshacer.')) return;
  button.disabled = true;
  feedback.className = 'form-message';
  feedback.textContent = 'Limpiando el registro…';
  try {
    const result = await api('/api/admin/alerts', { method: 'DELETE' });
    await loadAlerts();
    feedback.classList.add('success');
    feedback.textContent = result.removedCount
      ? `Se eliminaron ${result.removedCount} alertas del historial.`
      : 'El historial ya estaba vacío.';
  } catch (error) {
    feedback.classList.add('error');
    feedback.textContent = error.message;
  } finally { button.disabled = false; }
});
$('#alert-list').addEventListener('click', async event => {
  const button = event.target.closest('[data-retry-alert]'); if (!button) return;
  button.disabled = true;
  try { await api(`/api/admin/alerts/${encodeURIComponent(button.dataset.retryAlert)}/retry`, { method: 'POST', body: '{}' }); await loadAlerts(); }
  catch (error) { setError(error.message); button.disabled = false; }
});
$('#alert-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $('#publish-alert'); const message = $('#alert-message');
  const data = Object.fromEntries(new FormData(form)); data.confirmedOfficial = form.elements.confirmedOfficial.checked;
  button.disabled = true; message.className = 'form-message'; message.textContent = 'Publicando aviso y encolando difusión…';
  try {
    const result = await api('/api/admin/alerts', { method: 'POST', body: JSON.stringify(data) });
    message.classList.add('success'); message.textContent = (result.mailConfigured
      ? `Aviso publicado en la página de usuarios. Encolado para ${result.recipientCount || 0} cuentas registradas; el historial se actualizará al terminar el envío.`
      : `Aviso publicado en la página de usuarios, pero no se enviará por correo hasta configurar RESEND_API_KEY. ALERT_FROM_EMAIL es opcional. Cuentas destinatarias: ${result.recipientCount || 0}.`)
      + (result.directorySyncError ? ` No se pudo actualizar el directorio de Firebase: ${result.directorySyncError}` : '');
    form.reset(); form.elements.sourceName.value = 'INETER'; await loadAlerts();
  } catch (error) { message.classList.add('error'); message.textContent = error.message; }
  finally { button.disabled = false; }
});

async function loadRequests() {
  const list = $('#request-list'); list.textContent = 'Consultando solicitudes…';
  try {
    const data = await api('/api/admin/access-requests');
    accessRequestCanApprove = !!data.canApprove;
    $('#request-permission').hidden = accessRequestCanApprove;
    $('#request-permission').textContent = 'Esta cuenta puede revisar solicitudes, pero solo la administradora principal puede aprobar nuevos administradores de monitoreo.';
    const requests = data.requests || [];
    $('#stat-requests').textContent = requests.length;
    list.innerHTML = requests.length ? requests.map(request => `<article class="record-item"><div><h3>${escapeHtml(request.name)} · ${escapeHtml(request.email)}</h3><p>${escapeHtml(request.reason)}</p><small>Enviada ${escapeHtml(formatDate(request.createdAt))}</small></div><div class="record-actions"><button class="approve" data-request-decision="approve" data-request-id="${escapeHtml(request.id)}" ${accessRequestCanApprove ? '' : 'disabled'}>Aprobar monitoreo</button><button data-request-decision="reject" data-request-id="${escapeHtml(request.id)}">Rechazar</button></div></article>`).join('') : '<p>No hay solicitudes pendientes.</p>';
  } catch (error) { list.textContent = error.message; $('#stat-requests').textContent = '—'; }
}
$('#refresh-requests').addEventListener('click', loadRequests);
$('#request-list').addEventListener('click', async event => {
  const button = event.target.closest('[data-request-decision]'); if (!button || button.disabled) return;
  button.disabled = true;
  try { await api(`/api/admin/access-requests/${encodeURIComponent(button.dataset.requestId)}/decision`, { method: 'POST', body: JSON.stringify({ decision: button.dataset.requestDecision }) }); await loadRequests(); await loadUsers(); }
  catch (error) { setError(error.message); button.disabled = false; }
});

let adminVideosCache = [];
let adminVideoBroadcast = null;
const adminVideoCategories = {
  registro_historico: 'Registro Histórico',
  capacitacion: 'Material de Capacitación',
  educativo: 'Material Educativo',
  streamings_finalizados: 'Streamings Finalizados',
  fenomenos_meteorologicos: 'Explicación de Fenómenos Meteorológicos'
};
function renderAdminVideos() {
  const list = $('#admin-video-list');
  const selectedDelays = new Map($$('[data-video-delay]', list).map(select => [select.dataset.videoDelay, select.value]));
  const broadcast = adminVideoBroadcast;
  const active = broadcast && ['programada', 'en vivo'].includes(broadcast.status);
  const remaining = broadcast?.status === 'programada' ? Math.max(0, Math.ceil((Date.parse(broadcast.startAt) - Date.now()) / 1000)) : 0;
  const countdown = remaining > 60 ? `${Math.floor(remaining / 60)} min ${remaining % 60} s` : `${remaining} s`;
  const statusLabel = broadcast?.status === 'programada'
    ? `Previa: “${broadcast.title}” inicia en ${countdown}.`
    : broadcast?.status === 'en vivo'
      ? `Transmitiendo “${broadcast.title}” desde ${formatDate(broadcast.startedAt)}.`
      : broadcast?.status === 'fallida'
        ? `La última transmisión falló: ${broadcast.error || 'revisa las salidas RTMP.'}`
        : broadcast?.status === 'finalizada'
          ? `Finalizó la transmisión de “${broadcast.title}”.`
          : broadcast?.status === 'detenida' ? 'La transmisión de video se detuvo.' : 'Selecciona un video para transmitirlo en la página y las plataformas configuradas.';
  $('#video-broadcast-status').textContent = statusLabel;
  list.innerHTML = adminVideosCache.length ? adminVideosCache.map(video => {
    const ownsBroadcast = active && broadcast.videoId === video.id;
    const preview = video.thumbnailUrl
      ? `<img src="${escapeHtml(video.thumbnailUrl)}" alt="Miniatura de ${escapeHtml(video.title)}" loading="lazy" />`
      : '<span class="admin-video-placeholder">▶</span>';
    const action = ownsBroadcast
      ? `<button class="button secondary" type="button" data-video-broadcast="stop" data-video-id="${escapeHtml(video.id)}">Detener video</button>`
      : `<label class="video-delay-label">Iniciar en<select data-video-delay="${escapeHtml(video.id)}" ${active ? 'disabled' : ''}><option value="0">Ahora</option><option value="30">30 segundos</option><option value="60">1 minuto</option><option value="120">2 minutos</option><option value="300">5 minutos</option><option value="600">10 minutos</option></select></label><button class="button primary" type="button" data-video-broadcast="start" data-video-id="${escapeHtml(video.id)}" ${active ? 'disabled' : ''}>Transmitir</button>`;
    const categoryOptions = Object.entries(adminVideoCategories).map(([category, label]) => `<option value="${category}" ${video.category === category ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('');
    const deleteAction = `<button class="button secondary" type="button" data-video-delete="${escapeHtml(video.id)}" data-video-title="${escapeHtml(video.title)}" ${ownsBroadcast ? 'disabled title="Detén la transmisión antes de eliminar este video."' : ''}>Eliminar video</button>`;
    return `<article class="admin-video-card"><div class="admin-video-poster">${preview}</div><div class="admin-video-info"><h4>${escapeHtml(video.title)}</h4><small>${escapeHtml(formatDate(video.createdAt))} · ${formatBytes(video.size)}${video.subtitlesUrl ? ' · Subtítulos' : ''}</small><div class="admin-video-assets"><label>Categoría<select data-video-category="${escapeHtml(video.id)}">${categoryOptions}</select></label><label>Miniatura<input type="file" accept="image/jpeg,image/png,image/webp" data-video-asset="thumbnail" data-video-id="${escapeHtml(video.id)}" /></label><label>Subtítulos WebVTT<input type="file" accept=".vtt,text/vtt" data-video-asset="subtitles" data-video-id="${escapeHtml(video.id)}" /></label></div><div class="admin-video-controls">${action}${deleteAction}</div></div></article>`;
  }).join('') : '<p class="empty-admin-videos">Aún no hay videos en la biblioteca. Sube un MP4 para empezar.</p>';
  $$('[data-video-delay]', list).forEach(select => {
    if (selectedDelays.has(select.dataset.videoDelay)) select.value = selectedDelays.get(select.dataset.videoDelay);
  });
}
async function loadAdminVideos() {
  const list = $('#admin-video-list');
  try {
    const data = await api('/api/admin/videos');
    adminVideosCache = Array.isArray(data.videos) ? data.videos : [];
    adminVideoBroadcast = data.broadcast || null;
    renderAdminVideos();
  } catch (error) {
    if (!adminVideosCache.length) list.textContent = error.message;
    $('#video-broadcast-status').textContent = `No se pudo actualizar la biblioteca: ${error.message}`;
  }
}
function uploadAdminBinary(url, file, contentType, headers = {}, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.timeout = 0;
    xhr.withCredentials = true;
    xhr.setRequestHeader('content-type', contentType);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = event => { if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total, event.loaded, event.total); };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || `No se pudo subir el archivo (${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error('Se perdió la conexión durante la subida.'));
    xhr.ontimeout = () => reject(new Error('La transferencia del archivo agotó el tiempo de espera. Vuelve a intentarlo con la conexión estable.'));
    xhr.onabort = () => reject(new Error('La transferencia del archivo se canceló antes de completarse.'));
    xhr.send(file);
  });
}
$('#refresh-admin-videos').addEventListener('click', loadAdminVideos);
$('#video-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const file = form.elements.file.files[0];
  const thumbnail = form.elements.thumbnail.files[0];
  const subtitles = form.elements.subtitles.files[0];
  const message = $('#video-message'); const progress = $('#upload-progress'); const button = $('#upload-video');
  const thumbnailType = thumbnail?.type || ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' })[thumbnail?.name.split('.').pop().toLowerCase()];
  if (!file || !/\.mp4$/i.test(file.name) || (file.type && file.type !== 'video/mp4')) { message.className = 'form-message error'; message.textContent = 'Selecciona un archivo MP4.'; return; }
  if (file.size > 1024 * 1024 * 1024) { message.className = 'form-message error'; message.textContent = 'El archivo supera el máximo de 1 GB.'; return; }
  if (thumbnail && !['image/jpeg', 'image/png', 'image/webp'].includes(thumbnailType)) { message.className = 'form-message error'; message.textContent = 'La miniatura debe ser JPG, PNG o WebP.'; return; }
  if (subtitles && subtitles.size > 2 * 1024 * 1024) { message.className = 'form-message error'; message.textContent = 'Los subtítulos superan el máximo de 2 MB.'; return; }
  button.disabled = true; progress.hidden = false; progress.value = 0; message.textContent = 'Subiendo video…';
  try {
    const data = await uploadAdminBinary('/api/admin/videos', file, 'video/mp4', {
      'x-video-title': encodeURIComponent(form.elements.title.value.trim()),
      'x-video-category': form.elements.category.value
    }, (value, loaded, total) => {
      progress.value = Math.round(value * 80);
      message.textContent = `Subiendo video… ${Math.round(value * 100)} % (${formatBytes(loaded)} de ${formatBytes(total)}).`;
    });
    const video = data.video;
    if (thumbnail) {
      message.textContent = 'Video publicado. Subiendo miniatura…';
      await uploadAdminBinary(`/api/admin/videos/${encodeURIComponent(video.id)}/thumbnail`, thumbnail, thumbnailType);
      progress.value = 90;
    }
    if (subtitles) {
      message.textContent = 'Subiendo subtítulos…';
      await uploadAdminBinary(`/api/admin/videos/${encodeURIComponent(video.id)}/subtitles`, subtitles, 'text/vtt', {
        'x-subtitle-language': form.elements.subtitleLanguage.value.trim() || 'es'
      });
    }
    message.className = 'form-message success';
    message.textContent = 'Video publicado en la biblioteca con sus archivos complementarios.';
    form.reset();
    form.elements.subtitleLanguage.value = 'es';
    progress.value = 100;
    await loadAdminVideos();
  } catch (error) {
    message.className = 'form-message error';
    message.textContent = `No se completó la publicación: ${error.message}. Si el MP4 ya se subió, aparecerá en la biblioteca y podrás intentarlo de nuevo.`;
    await loadAdminVideos();
  } finally {
    button.disabled = false;
    setTimeout(() => { progress.hidden = true; }, 1200);
  }
});
$('#admin-video-list').addEventListener('click', async event => {
  const deleteButton = event.target.closest('[data-video-delete]');
  if (deleteButton) {
    if (!window.confirm(`¿Eliminar “${deleteButton.dataset.videoTitle}” y sus archivos de la biblioteca?`)) return;
    deleteButton.disabled = true;
    try {
      await api(`/api/admin/vod/${encodeURIComponent(deleteButton.dataset.videoDelete)}`, { method: 'DELETE' });
      await loadAdminVideos();
    } catch (error) {
      setError(error.message);
      deleteButton.disabled = false;
    }
    return;
  }
  const button = event.target.closest('[data-video-broadcast]');
  if (!button) return;
  const action = button.dataset.videoBroadcast;
  const delay = action === 'start' ? Number($$('[data-video-delay]').find(select => select.dataset.videoDelay === button.dataset.videoId)?.value || 0) : 0;
  button.disabled = true;
  try {
    const result = await api('/api/admin/video-broadcast', {
      method: 'POST',
      body: JSON.stringify({ action, videoId: button.dataset.videoId, delaySeconds: delay })
    });
    adminVideoBroadcast = result.broadcast;
    renderAdminVideos();
  } catch (error) {
    setError(error.message);
    button.disabled = false;
  }
});
$('#admin-video-list').addEventListener('change', async event => {
  const categorySelect = event.target.closest('[data-video-category]');
  if (categorySelect) {
    categorySelect.disabled = true;
    try {
      await api(`/api/admin/videos/${encodeURIComponent(categorySelect.dataset.videoCategory)}/category`, {
        method: 'PUT',
        body: JSON.stringify({ category: categorySelect.value })
      });
      await loadAdminVideos();
    } catch (error) {
      setError(error.message);
      categorySelect.disabled = false;
    }
    return;
  }
  const input = event.target.closest('[data-video-asset]');
  const file = input?.files?.[0];
  if (!input || !file) return;
  const assetType = input.dataset.videoAsset;
  if (assetType === 'subtitles' && (file.size > 2 * 1024 * 1024 || !/\.vtt$/i.test(file.name))) {
    setError('El archivo de subtítulos debe ser WebVTT (.vtt) y no superar 2 MB.');
    input.value = '';
    return;
  }
  let contentType = 'text/vtt';
  if (assetType === 'thumbnail') {
    const extension = file.name.split('.').pop().toLowerCase();
    contentType = file.type || ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' })[extension];
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType) || file.size > 8 * 1024 * 1024) {
      setError('La miniatura debe ser JPG, PNG o WebP y no superar 8 MB.');
      input.value = '';
      return;
    }
  }
  input.disabled = true;
  try {
    await uploadAdminBinary(`/api/admin/videos/${encodeURIComponent(input.dataset.videoId)}/${assetType}`, file, contentType, assetType === 'subtitles' ? { 'x-subtitle-language': 'es' } : {});
    await loadAdminVideos();
  } catch (error) {
    setError(error.message);
    input.value = '';
    input.disabled = false;
  }
});
setInterval(() => {
  if ($('.admin-section.active')?.dataset.panel === 'videos') loadAdminVideos();
}, 5000);
setInterval(() => {
  if ($('.admin-section.active')?.dataset.panel === 'streaming') loadAdminStream();
}, 4000);

async function loadReports() {
  const body = $('#reports-table'); body.innerHTML = '<tr><td colspan="6">Cargando reportes…</td></tr>';
  try {
    const { reports } = await api('/api/admin/reports');
    body.innerHTML = reports?.length ? reports.map(report => `<tr><td>${escapeHtml(formatDate(report.createdAt))}</td><td>${escapeHtml(report.municipality)}</td><td>${escapeHtml(report.crop)}</td><td>${escapeHtml(`${report.soil || ''} · lluvia: ${report.rain || ''}`)}</td><td>${escapeHtml(report.outcome)}</td><td>${escapeHtml(report.reporter)}</td></tr>`).join('') : '<tr><td colspan="6">No hay reportes agrícolas.</td></tr>';
  } catch (error) { body.innerHTML = `<tr><td colspan="6">${escapeHtml(error.message)}</td></tr>`; }
}
$('#refresh-reports').addEventListener('click', loadReports);

$('#admin-signout').addEventListener('click', async () => {
  const button = $('#admin-signout'); button.disabled = true;
  try {
    const sdk = 'https://www.gstatic.com/firebasejs/13.0.0';
    const [{ initializeApp, getApps }, { getAuth, signOut }] = await Promise.all([import(`${sdk}/firebase-app.js`), import(`${sdk}/firebase-auth.js`)]);
    const config = await fetch('/api/firebase/config', { cache: 'no-store' }).then(response => response.json());
    const app = getApps().find(item => item.name === 'ineter-admin-login') || initializeApp(config.config || config, 'ineter-admin-login');
    await signOut(getAuth(app));
    await api('/api/auth/monitor-logout', { method: 'POST' }).catch(() => {});
    location.replace('/admin.html');
  } catch (error) { setError(`No se pudo cerrar sesión de Firebase: ${error.message}`); button.disabled = false; }
});

$('#stat-alerts').textContent = '—';
$('#stat-requests').textContent = '—';
$('#stat-viewers').textContent = '—';
$('#stat-likes').textContent = '—';
boot();
