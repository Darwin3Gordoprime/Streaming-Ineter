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
    const message = code.includes('invalid-credential') || code.includes('user-not-found') || code.includes('wrong-password')
      ? 'El correo o la contraseña no son correctos.'
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
  const titles = { overview: 'Resumen administrativo', system: 'Equipo en vivo', accounts: 'Cuentas y roles', alerts: 'Alertas y difusión', requests: 'Solicitudes de acceso', videos: 'Biblioteca de videos', reports: 'Reportes agrícolas' };
  if (!Object.hasOwn(titles, name)) name = 'overview';
  $$('.admin-nav button').forEach(button => button.classList.toggle('active', button.dataset.section === name));
  $$('.admin-section').forEach(panel => panel.classList.toggle('active', panel.dataset.panel === name));
  $('#page-title').textContent = titles[name] || titles.overview;
  history.replaceState(null, '', `#${name}`);
  if (name === 'accounts') loadUsers();
  if (name === 'alerts') loadAlerts();
  if (name === 'requests') loadRequests();
  if (name === 'reports') loadReports();
  if (name === 'system') updateSystemMetrics();
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
  const list = $('#alert-list');
  list.textContent = 'Consultando avisos…';
  try {
    const data = await api('/api/admin/alerts');
    $('#recipient-count').textContent = `Destinatarios: ${data.registeredCount ?? 0}`;
    const mailSetup = data.mail?.ready
      ? `Correo listo · ${escapeHtml(data.mail.sender)}`
      : 'Correo sin configurar · define ALERT_FROM_EMAIL y RESEND_API_KEY en .env';
    $('#stat-alerts').textContent = (data.alerts || []).length;
    list.innerHTML = `<small>${mailSetup}</small>` + (data.alerts?.length ? data.alerts.map(alert => `<article class="record-item"><div><h3>${escapeHtml(alert.title)}</h3><p>${escapeHtml(alert.categoryLabel || alert.category)} · ${escapeHtml(alert.severityLabel || alert.severity)} · ${escapeHtml(alert.location || 'Sin zona')}</p><p>${escapeHtml(alert.message)}</p><small>${escapeHtml(formatDate(alert.createdAt))} · correo: ${escapeHtml(alert.emailStatus || 'pendiente')} (${Number(alert.emailAccepted || 0)}/${Number(alert.recipientCount || 0)}) · notificaciones: ${escapeHtml(alert.firebaseStatus || 'pendiente')}${alert.emailError ? ` · ${escapeHtml(alert.emailError)}` : ''}</small></div>${['fallido', 'parcial', 'sin_configuracion', 'sin_destinatarios'].includes(alert.emailStatus) ? `<div class="record-actions"><button data-retry-alert="${escapeHtml(alert.id)}">Reintentar correo</button></div>` : ''}</article>`).join('') : '<p>No hay avisos publicados.</p>');
  } catch (error) { list.textContent = error.message; }
}
$('#refresh-alerts').addEventListener('click', loadAlerts);
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
      ? `Aviso publicado en la página de usuarios. Encolado para ${result.recipientCount || 0} cuentas registradas; revisa el historial para ver el resultado del proveedor de correo.`
      : `Aviso publicado en la página de usuarios, pero no se enviará por correo hasta configurar RESEND_API_KEY y ALERT_FROM_EMAIL. Cuentas destinatarias: ${result.recipientCount || 0}.`)
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

$('#video-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget; const file = form.elements.file.files[0];
  const message = $('#video-message'); const progress = $('#upload-progress'); const button = $('#upload-video');
  if (!file || file.type !== 'video/mp4') { message.className = 'form-message error'; message.textContent = 'Selecciona un archivo MP4.'; return; }
  if (file.size > 1024 * 1024 * 1024) { message.className = 'form-message error'; message.textContent = 'El archivo supera el máximo de 1 GB.'; return; }
  button.disabled = true; progress.hidden = false; progress.value = 0; message.textContent = 'Subiendo video…';
  const xhr = new XMLHttpRequest(); xhr.open('POST', '/api/admin/videos'); xhr.withCredentials = true;
  xhr.setRequestHeader('content-type', 'video/mp4'); xhr.setRequestHeader('x-video-title', encodeURIComponent(form.elements.title.value.trim()));
  xhr.upload.onprogress = event => { if (event.lengthComputable) progress.value = Math.round(event.loaded / event.total * 100); };
  xhr.onload = () => {
    let data = {}; try { data = JSON.parse(xhr.responseText); } catch {}
    if (xhr.status >= 200 && xhr.status < 300) { message.className = 'form-message success'; message.textContent = `Video publicado en la biblioteca. ${data.recording?.title || ''}`; form.reset(); progress.value = 100; }
    else { message.className = 'form-message error'; message.textContent = data.error || `No se pudo subir el video (${xhr.status}).`; }
    button.disabled = false;
  };
  xhr.onerror = () => { message.className = 'form-message error'; message.textContent = 'Se perdió la conexión durante la subida.'; button.disabled = false; };
  xhr.send(file);
});

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
