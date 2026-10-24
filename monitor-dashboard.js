const monitor$ = id => document.getElementById(id);
const monitorHistory = [];
let monitorBusy = false;
let climateCheckedAt = 0;
let monitorIntervalsStarted = false;
let monitorFirebaseAuth = null;
const monitorCreateAdminRequested = new URLSearchParams(location.search).get('action') === 'create-admin';
const escapeMonitor = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
const formatMonitorSize = bytes => { const value = Number(bytes) || 0; if (value < 1024) return `${value} B`; if (value < 1024 ** 2) return `${(value/1024).toFixed(0)} KB`; if (value < 1024 ** 3) return `${(value/1024**2).toFixed(1)} MB`; return `${(value/1024**3).toFixed(2)} GB`; };
const formatMonitorDuration = seconds => { const total = Math.max(0, Math.floor(Number(seconds) || 0)); const hours = Math.floor(total / 3600); const minutes = Math.floor((total % 3600) / 60); return hours ? `${hours} h ${minutes} min` : `${minutes} min`; };
function setMonitorProgress(id, value) {
  const fill = monitor$(id);
  const track = fill.closest('[role="progressbar"]');
  const percent = Math.max(0, Math.min(100, Number(value) || 0));
  fill.style.width = `${percent}%`;
  track.setAttribute('aria-valuenow', percent.toFixed(0));
  track.classList.toggle('is-high', percent >= 85);
}
async function monitorApi(path) {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(body.error || `Error ${response.status}`); error.status = response.status; throw error; }
  return body;
}
function showMonitorWall(title, message) {
  monitor$('monitor-dashboard').hidden = true;
  monitor$('monitor-access-wall').hidden = false;
  monitor$('monitor-access-title').textContent = title;
  monitor$('monitor-access-message').textContent = message;
  monitor$('monitor-page-status').textContent = 'Sesión requerida';
  monitor$('monitor-page-status').classList.remove('is-live');
  monitor$('monitor-logout').hidden = true;
  monitor$('monitor-account').textContent = '';
}
async function initializeMonitorFirebase() {
  if (monitorFirebaseAuth) return monitorFirebaseAuth;
  const firebaseConfig = await fetch('/api/firebase/config', { cache: 'no-store' }).then(async response => {
    const body = await response.json().catch(() => ({}));
    const config = body.config || body;
    if (!response.ok || !config.apiKey || !config.authDomain || !config.projectId || !config.appId) {
      throw new Error(body.error || 'No se pudo cargar la configuración de Firebase.');
    }
    return config;
  });
  const sdk = 'https://www.gstatic.com/firebasejs/13.0.0';
  const [{ initializeApp }, { getAuth, signInWithEmailAndPassword, signOut }] = await Promise.all([
    import(`${sdk}/firebase-app.js`), import(`${sdk}/firebase-auth.js`)
  ]);
  const app = initializeApp(firebaseConfig, 'ineter-monitor-login');
  monitorFirebaseAuth = { auth: getAuth(app), signInWithEmailAndPassword, signOut };
  return monitorFirebaseAuth;
}
function showMonitorLoginError(message) {
  const error = monitor$('monitor-login-error');
  error.textContent = message;
  error.hidden = !message;
}
async function openMonitorDashboard(professional) {
  monitor$('monitor-access-wall').hidden = true;
  monitor$('monitor-dashboard').hidden = false;
  monitor$('monitor-account').textContent = `${professional.name} · Administrador de monitoreo`;
  monitor$('monitor-page-status').textContent = 'Monitoreo activo';
  monitor$('monitor-page-status').classList.add('is-live');
  monitor$('monitor-logout').hidden = false;
  await Promise.all([refreshMonitorData(), refreshMonitorClimate(true)]);
  if (monitorCreateAdminRequested) {
    const createPanel = monitor$('monitor-admin-create');
    const notice = monitor$('monitor-admin-create-notice');
    if (createPanel.hidden) {
      notice.hidden = false;
      notice.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      createPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
  if (!monitorIntervalsStarted) {
    setInterval(refreshMonitorData, 2500);
    setInterval(() => refreshMonitorClimate(false), 15 * 60 * 1000);
    monitorIntervalsStarted = true;
  }
}
async function submitMonitorLogin(event) {
  event.preventDefault();
  const form = monitor$('monitor-login-form');
  const button = monitor$('monitor-login-submit');
  const email = monitor$('monitor-login-email').value.trim();
  const password = monitor$('monitor-login-password').value;
  showMonitorLoginError('');
  button.disabled = true;
  button.textContent = 'Verificando con Firebase…';
  try {
    const firebase = await initializeMonitorFirebase();
    const credential = await firebase.signInWithEmailAndPassword(firebase.auth, email, password);
    const idToken = await credential.user.getIdToken(true);
    const response = await fetch('/api/auth/firebase/monitor-session', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      await firebase.signOut(firebase.auth).catch(() => {});
      throw new Error(result.error || `No se pudo autorizar el acceso (${response.status}).`);
    }
    monitor$('monitor-login-password').value = '';
    await openMonitorDashboard(result.professional);
  } catch (error) {
    const firebaseCode = String(error.code || '');
    const message = firebaseCode.includes('invalid-credential') || firebaseCode.includes('user-not-found') || firebaseCode.includes('wrong-password')
      ? 'El correo o la contraseña no son correctos.'
      : firebaseCode.includes('too-many-requests') ? 'Firebase bloqueó temporalmente los intentos. Espera un momento y vuelve a probar.'
      : firebaseCode.includes('network-request-failed') ? 'No se pudo conectar con Firebase. Revisa tu conexión a Internet.'
      : error.message || 'No se pudo iniciar sesión.';
    showMonitorLoginError(message);
  } finally {
    button.disabled = false;
    button.textContent = 'Iniciar sesión';
  }
}
async function logoutMonitor() {
  try { await fetch('/api/auth/monitor-logout', { method: 'POST', credentials: 'same-origin', cache: 'no-store' }); } catch {}
  if (monitorFirebaseAuth) await monitorFirebaseAuth.signOut(monitorFirebaseAuth.auth).catch(() => {});
  monitor$('monitor-login-form').reset();
  showMonitorLoginError('');
  showMonitorWall('Iniciar sesión de monitoreo', 'Ingresa con una cuenta autorizada para abrir el centro de control. Esta sesión es independiente de tu sesión normal en INETER.');
}
async function createMonitorAdministrator(event) {
  event.preventDefault();
  const form = monitor$('monitor-create-admin-form');
  const button = monitor$('monitor-create-admin-submit');
  const message = monitor$('monitor-create-admin-message');
  const password = monitor$('monitor-new-admin-password').value;
  const confirmPassword = monitor$('monitor-new-admin-confirm').value;
  message.hidden = true;
  message.classList.remove('is-success');
  if (password !== confirmPassword) {
    message.textContent = 'Las contraseñas no coinciden.';
    message.hidden = false;
    return;
  }
  button.disabled = true;
  button.textContent = 'Creando cuenta…';
  try {
    const response = await fetch('/api/admin/monitor-admins', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: monitor$('monitor-new-admin-name').value.trim(), email: monitor$('monitor-new-admin-email').value.trim(), password })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `No se pudo crear la cuenta (${response.status}).`);
    form.reset();
    message.textContent = `Cuenta administradora creada para ${result.administrator.email}. Ya puede iniciar sesión en este panel.`;
    message.classList.add('is-success');
    message.hidden = false;
    await refreshMonitorData();
  } catch (error) {
    message.textContent = error.message || 'No se pudo crear la cuenta.';
    message.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = 'Crear administrador';
  }
}
function initMonitorDashboard() {
  monitor$('monitor-login-form').addEventListener('submit', submitMonitorLogin);
  monitor$('monitor-logout').addEventListener('click', logoutMonitor);
  monitor$('monitor-create-admin-form').addEventListener('submit', createMonitorAdministrator);
  showMonitorWall('Iniciar sesión de monitoreo', 'Ingresa con una cuenta autorizada para abrir el centro de control. Esta sesión es independiente de tu sesión normal en INETER.');
}
async function refreshMonitorClimate(force) {
  if (!force && Date.now() - climateCheckedAt < 15 * 60 * 1000) return;
  try {
    const params = new URLSearchParams({ latitude: '12.1364', longitude: '-86.251', current: 'temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m', timezone: 'America/Managua' });
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Fuente meteorológica no disponible');
    const data = await response.json();
    const current = data.current;
    const weather = current.weather_code >= 95 ? 'Tormenta' : current.weather_code >= 51 ? 'Lluvia' : current.weather_code >= 45 ? 'Neblina' : current.weather_code === 0 ? 'Despejado' : current.weather_code <= 2 ? 'Parcialmente nublado' : 'Nublado';
    monitor$('monitor-climate-reading').textContent = `${Math.round(current.temperature_2m)} °C · ${weather} · Lluvia ${current.precipitation} mm · Humedad ${current.relative_humidity_2m}% · Viento ${Math.round(current.wind_speed_10m)} km/h`;
    monitor$('monitor-climate-updated').textContent = `Open-Meteo · Managua · actualizado ${new Date().toLocaleTimeString('es-NI')} · confirma con INETER`;
    climateCheckedAt = Date.now();
  } catch (error) { monitor$('monitor-climate-reading').textContent = error.message; }
}
async function refreshMonitorData() {
  if (monitorBusy || document.hidden || monitor$('monitor-dashboard').hidden) return;
  monitorBusy = true;
  try {
    const m = await monitorApi('/api/admin/monitor');
    monitor$('monitor-admin-create').hidden = !m.canCreateAdmins;
    monitor$('monitor-page-status').textContent = m.streaming ? 'Transmisión activa' : 'Monitoreo activo';
    monitor$('monitor-hero-state').textContent = m.streaming ? 'TRANSMISIÓN EN CURSO' : 'SISTEMA EN MONITOREO';
    monitor$('monitor-upload').textContent = `${m.network.uploadMbps.toFixed(2)} Mbps`;
    monitor$('monitor-download').textContent = `${m.network.downloadMbps.toFixed(2)} Mbps`;
    monitor$('monitor-upload-total').textContent = `Total enviado: ${formatMonitorSize(m.network.uploadedBytes)}`;
    monitor$('monitor-download-total').textContent = `Total recibido: ${formatMonitorSize(m.network.downloadedBytes)}`;
    const latency = m.network.latency;
    monitor$('monitor-latency').textContent = latency.ms !== null ? `${latency.ms} ms` : latency.status === 'sin_respuesta' ? 'Sin respuesta' : 'Midiendo…';
    monitor$('monitor-latency-time').textContent = latency.checkedAt ? `TCP a Cloudflare · ${new Date(latency.checkedAt).toLocaleTimeString('es-NI')}` : 'TCP a Cloudflare · 1.1.1.1';
    const cpuPercent = Number.isFinite(m.device.cpuPercent) ? m.device.cpuPercent : null;
    monitor$('monitor-cpu').textContent = cpuPercent === null ? 'Midiendo…' : `${cpuPercent.toFixed(1)} %`;
    monitor$('monitor-cpu-model').textContent = `${m.device.cpuCores} núcleos lógicos`;
    monitor$('monitor-task-cpu').textContent = cpuPercent === null ? '—' : `${cpuPercent.toFixed(0)}%`;
    monitor$('monitor-task-cpu-detail').textContent = `${m.device.cpuModel} · ${m.device.cpuCores} núcleos lógicos`;
    setMonitorProgress('monitor-task-cpu-bar', cpuPercent);
    monitor$('monitor-host').textContent = m.device.hostname;
    monitor$('monitor-os').textContent = m.device.os;
    monitor$('monitor-runtime').textContent = `${m.device.architecture} · ${m.device.nodeVersion}`;
    monitor$('monitor-device-cpu').textContent = m.device.cpuModel;
    const memoryUsedBytes = Math.max(0, m.device.memoryTotalBytes - m.device.memoryFreeBytes);
    const memoryPercent = Number(m.device.memoryUsedPercent) || 0;
    monitor$('monitor-memory').textContent = `${formatMonitorSize(m.device.memoryTotalBytes)} total · ${formatMonitorSize(memoryUsedBytes)} usadas · ${formatMonitorSize(m.device.memoryFreeBytes)} libres · ${memoryPercent.toFixed(1)} % usado`;
    monitor$('monitor-task-ram').textContent = `${memoryPercent.toFixed(0)}%`;
    monitor$('monitor-task-ram-detail').textContent = `${formatMonitorSize(memoryUsedBytes)} usados de ${formatMonitorSize(m.device.memoryTotalBytes)} · ${formatMonitorSize(m.device.memoryFreeBytes)} libres`;
    setMonitorProgress('monitor-task-ram-bar', memoryPercent);
    monitor$('monitor-process-memory').textContent = formatMonitorSize(m.device.processRssBytes);
    if (m.device.disk?.totalBytes > 0) {
      const diskUsedBytes = Math.max(0, m.device.disk.totalBytes - m.device.disk.freeBytes);
      const diskPercent = diskUsedBytes / m.device.disk.totalBytes * 100;
      monitor$('monitor-disk').textContent = `${formatMonitorSize(m.device.disk.freeBytes)} libres de ${formatMonitorSize(m.device.disk.totalBytes)}`;
      monitor$('monitor-task-disk').textContent = `${diskPercent.toFixed(0)}%`;
      monitor$('monitor-task-disk-detail').textContent = `${formatMonitorSize(diskUsedBytes)} usados · ${formatMonitorSize(m.device.disk.freeBytes)} libres`;
      setMonitorProgress('monitor-task-disk-bar', diskPercent);
    } else {
      monitor$('monitor-disk').textContent = 'No disponible';
      monitor$('monitor-task-disk').textContent = '—';
      monitor$('monitor-task-disk-detail').textContent = 'El sistema no informó datos de esta unidad.';
      setMonitorProgress('monitor-task-disk-bar', 0);
    }
    monitor$('monitor-interfaces').textContent = m.network.available ? `${m.network.interfaces.join(', ')} · ${m.network.source}` : (m.network.error || 'No disponible');
    monitor$('monitor-destinations').innerHTML = `<div class="monitor-destination-row"><b>OBS Studio</b><span class="tag ${m.obs.connected ? 'ready' : 'neutral'}">${m.obs.connected ? m.obs.streaming ? 'TRANSMITIENDO' : 'CONECTADO' : 'DESCONECTADO'}</span></div>${m.destinations.length ? m.destinations.map(d => `<div class="monitor-destination-row"><b>${escapeMonitor(d.name)} · ${escapeMonitor(d.platform)}</b><span class="tag ${d.status === 'enviando' ? 'ready' : d.status === 'error' ? 'warning' : 'neutral'}">${escapeMonitor(d.status)}</span></div>`).join('') : '<p class="empty-recordings">No hay plataformas configuradas.</p>'}`;
    monitor$('monitor-active-users').textContent = String(m.activeUsers.length);
    monitor$('monitor-active-users-updated').textContent = `Actividad en últimos 90 s · ${new Date(m.sampledAt).toLocaleTimeString('es-NI')}`;
    monitor$('monitor-active-user-list').innerHTML = m.activeUsers.length ? m.activeUsers.map(u => `<div class="monitor-destination-row"><b>${escapeMonitor(u.name)}<small>${escapeMonitor(u.email)} · ${escapeMonitor(u.role)}</small></b><span class="tag ready">${escapeMonitor(u.view)}</span></div>`).join('') : '<p class="empty-recordings">No hay otras sesiones activas.</p>';
    monitor$('monitor-alert-count').textContent = String(m.alerts.count);
    const newest = m.alerts.recent[0];
    monitor$('monitor-alert-updated').textContent = newest ? `Más reciente: ${new Date(newest.createdAt).toLocaleString('es-NI')}` : 'Sin avisos difundidos';
    monitor$('monitor-recent-alerts').innerHTML = m.alerts.recent.length ? m.alerts.recent.map(a => `<div class="monitor-destination-row"><b>${escapeMonitor(a.title)}<small>${escapeMonitor(a.categoryLabel)} · ${escapeMonitor(a.location || 'Nicaragua')}</small></b><span class="tag ${a.severity === 'urgente' ? 'warning' : 'neutral'}">${escapeMonitor(a.severityLabel)}</span></div>`).join('') : '<p class="empty-recordings">Aún no se han difundido avisos.</p>';
    monitor$('monitor-stream-count').textContent = String(m.streams.total);
    monitor$('monitor-stream-duration').textContent = `Acumulada ${formatMonitorDuration(m.streams.accumulatedSeconds)} · actual ${formatMonitorDuration(m.streams.currentSeconds)}`;
    monitor$('monitor-recording-bytes').textContent = formatMonitorSize(m.recordings.totalBytes);
    monitor$('monitor-recording-count').textContent = `${m.recordings.count} grabaciones guardadas`;
    monitor$('monitor-server-uptime').textContent = formatMonitorDuration(m.server.uptimeSeconds);
    monitor$('monitor-server-heap').textContent = `${formatMonitorSize(m.server.heapUsedBytes)} usados de ${formatMonitorSize(m.server.heapTotalBytes)}`;
    monitor$('monitor-server-sampled').textContent = new Date(m.sampledAt).toLocaleString('es-NI');
    monitor$('monitor-updated').textContent = `Última lectura: ${new Date(m.sampledAt).toLocaleTimeString('es-NI')}`;
    monitor$('monitor-error').textContent = m.latestError || (m.obs.error ? `OBS: ${m.obs.error}` : '');
    monitorHistory.push({ upload: m.network.uploadMbps, download: m.network.downloadMbps });
    if (monitorHistory.length > 30) monitorHistory.shift();
    const max = Math.max(.1, ...monitorHistory.flatMap(p => [p.upload, p.download]));
    for (const [id, key] of [['monitor-chart-up', 'upload'], ['monitor-chart-down', 'download']]) monitor$(id).setAttribute('d', monitorHistory.map((p, i) => `${i ? 'L' : 'M'} ${(i / Math.max(1, monitorHistory.length - 1) * 100).toFixed(2)} ${(98 - p[key] / max * 88).toFixed(2)}`).join(' '));
  } catch (error) {
    if (error.status === 401 || error.status === 403) { showMonitorWall('Se cerró o venció la sesión', 'Vuelve a INETER en vivo e inicia sesión con la cuenta autorizada de monitoreo.'); return; }
    monitor$('monitor-error').textContent = `No se pudo actualizar: ${error.message}`;
  } finally { monitorBusy = false; }
}
initMonitorDashboard();
window.addEventListener('online', () => { refreshMonitorData(); refreshMonitorClimate(true); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshMonitorData(); });
