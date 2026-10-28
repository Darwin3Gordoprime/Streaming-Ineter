const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const os = require('node:os');
const net = require('node:net');
const QRCode = require('qrcode');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const root = __dirname;
const dataDir = path.join(root, 'data');
const recordingsDir = path.join(root, 'recordings');
const videoCategoryLabels = {
  registro_historico: 'Registro Histórico',
  capacitacion: 'Material de Capacitación',
  educativo: 'Material Educativo',
  streamings_finalizados: 'Streamings Finalizados',
  fenomenos_meteorologicos: 'Explicación de Fenómenos Meteorológicos'
};
function loadLocalEnvironment() {
  const file = path.join(root, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, '$2');
    process.env[match[1]] = value;
  }
}
loadLocalEnvironment();
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(recordingsDir, { recursive: true });
const secretFile = path.join(dataDir, 'secret.key');
if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32), { mode: 0o600 });
const encryptionKey = fs.readFileSync(secretFile);
const stateFile = path.join(dataDir, 'state.json');
const ingestTokenFile = path.join(dataDir, 'ingest.key');
if (!fs.existsSync(ingestTokenFile)) fs.writeFileSync(ingestTokenFile, crypto.randomBytes(24).toString('hex'), { mode: 0o600 });
const ingestToken = fs.readFileSync(ingestTokenFile, 'utf8').trim();

function readState() {
  try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); }
  catch { return { studio: 'OBS', destinations: [], sessions: [] }; }
}
function requestUsesHttps(req) {
  return !!req.socket.encrypted || (process.env.TRUST_PROXY === '1' && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https');
}
let state = readState();
if (!Array.isArray(state.sessions)) state.sessions = [];
if (!Array.isArray(state.schedules)) state.schedules = [];
if (!Array.isArray(state.videos)) state.videos = [];
if (!Array.isArray(state.professionals)) state.professionals = [];
if (!Array.isArray(state.adminAccessRequests)) state.adminAccessRequests = [];
if (!Array.isArray(state.agricultureReports)) state.agricultureReports = [];
if (!Array.isArray(state.alerts)) state.alerts = [];
if (!Array.isArray(state.pushTokens)) state.pushTokens = [];
if (!state.likes || typeof state.likes !== 'object') state.likes = {};
if (!Array.isArray(state.likesLog)) state.likesLog = [];
if (!state.authSessions || typeof state.authSessions !== 'object') state.authSessions = {};
let firebaseAdmin = null;
let firebaseAdminError = '';
const firebasePublicDefaults = {
  apiKey: 'AIzaSyBfU9WnRJ4qhK1-XFJMUmHQfhekCv1lA0s',
  authDomain: 'ineter-streaming.firebaseapp.com',
  projectId: 'ineter-streaming',
  storageBucket: 'ineter-streaming.firebasestorage.app',
  messagingSenderId: '730781702967',
  appId: '1:730781702967:web:b3f26527a9aeb18c7858b2',
  measurementId: 'G-NDF526PBM8'
};
function firebaseWebConfig() {
  const config = {
    ...firebasePublicDefaults,
    apiKey: process.env.FIREBASE_API_KEY || firebasePublicDefaults.apiKey,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || firebasePublicDefaults.authDomain,
    projectId: process.env.FIREBASE_PROJECT_ID || firebasePublicDefaults.projectId,
    appId: process.env.FIREBASE_APP_ID || firebasePublicDefaults.appId,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || firebasePublicDefaults.messagingSenderId
  };
  return { configured: true, config, vapidKey: process.env.FIREBASE_VAPID_KEY || '' };
}
function initializeFirebaseAdmin() {
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  const hasAmbientCredentials = !!(process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.K_SERVICE || process.env.GAE_ENV);
  if (!serviceAccountPath && !hasAmbientCredentials) {
    firebaseAdminError = 'Falta configurar credenciales de Firebase Admin en el servidor.';
    return;
  }
  try {
    const { initializeApp, applicationDefault, cert, getApps } = require('firebase-admin/app');
    const credentialPath = serviceAccountPath
      ? (path.isAbsolute(serviceAccountPath) ? serviceAccountPath : path.join(root, serviceAccountPath))
      : '';
    const app = getApps()[0] || initializeApp({
      credential: serviceAccountPath
        ? cert(require(credentialPath))
        : applicationDefault(),
      projectId: process.env.FIREBASE_PROJECT_ID || firebasePublicDefaults.projectId
    });
    firebaseAdmin = {
      firestore: require('firebase-admin/firestore').getFirestore(app),
      messaging: require('firebase-admin/messaging').getMessaging(app),
      auth: require('firebase-admin/auth').getAuth(app)
    };
  } catch (error) {
    firebaseAdminError = error.code === 'MODULE_NOT_FOUND'
      ? 'Instala dependencias con npm install para activar Firebase Admin.'
      : `Firebase Admin no está listo: ${String(error.message || error).slice(0, 220)}`;
    console.warn(firebaseAdminError);
  }
}
initializeFirebaseAdmin();
const primaryAdminEmailAtBoot = String(process.env.INETER_INITIAL_ADMIN_EMAIL || '').trim().toLowerCase();
const primaryAdminUids = [];
let primaryAdminChanged = false;
if (primaryAdminEmailAtBoot) {
  for (const profile of state.professionals) {
    const profileEmail = String(profile.email || '').trim().toLowerCase();
    if (profileEmail === primaryAdminEmailAtBoot) {
      if (profile.role !== 'admin' || profile.profession !== 'Administración principal INETER') primaryAdminChanged = true;
      profile.role = 'admin';
      profile.profession = 'Administración principal INETER';
      if (profile.firebaseUid) primaryAdminUids.push(profile.firebaseUid);
    } else if (profile.role === 'admin') {
      primaryAdminChanged = true;
      profile.role = 'monitor_admin';
      profile.profession = 'Monitoreo técnico INETER';
    }
  }
  if (primaryAdminChanged) saveState();
  if (firebaseAdmin?.auth) for (const uid of primaryAdminUids) {
    firebaseAdmin.auth.getUser(uid).then(user => firebaseAdmin.auth.setCustomUserClaims(uid, { ...(user.customClaims || {}), role: 'admin' })).catch(error => console.warn(`No se pudieron actualizar los permisos de la cuenta principal: ${String(error.message || error).slice(0, 160)}`));
  }
}
let live = false;
let ffmpegJobs = [];
let activeSession = null;
let liveSince = null;
let livePublisherReady = false;
let liveDisconnectTimer = null;
let liveLimitStartedAt = null;
let liveLimitTimer = null;
let lastError = '';
let scanBusy = false;
let obsSocket = null;
let obsConnected = false;
let obsStreaming = false;
let obsError = '';
let obsConnectPromise = null;
let obsPending = new Map();
let videoBroadcast = null;
const MAX_LIVE_DURATION_MS = 3.5 * 60 * 60 * 1000;
const MAX_LIVE_DURATION_SECONDS = Math.floor(MAX_LIVE_DURATION_MS / 1000);
const LIVE_RECONNECT_GRACE_MS = 15_000;
const obsVideoProfiles = {
  'landscape-1080': { baseWidth: 1920, baseHeight: 1080, outputWidth: 1920, outputHeight: 1080 },
  'landscape-720': { baseWidth: 1280, baseHeight: 720, outputWidth: 1280, outputHeight: 720 },
  'portrait-1080': { baseWidth: 1080, baseHeight: 1920, outputWidth: 1080, outputHeight: 1920 },
  'portrait-720': { baseWidth: 720, baseHeight: 1280, outputWidth: 720, outputHeight: 1280 },
  'square-1080': { baseWidth: 1080, baseHeight: 1080, outputWidth: 1080, outputHeight: 1080 },
  'square-720': { baseWidth: 720, baseHeight: 720, outputWidth: 720, outputHeight: 720 }
};
const destinationOutputs = new Map();
let scheduleBusy = false;
const authAttempts = new Map();
let adminBootstrapPending = false;
const adminCreationEmails = new Set();
let previousNetworkCounters = null;
let cpuSample = null;
let cachedInternetLatency = { ms: null, checkedAt: null, status: 'pendiente' };
let latencyProbePending = false;
const processCpuSamples = new Map();
const activePresence = new Map();
const streamEventClients = new Set();
const reactionTimes = new Map();
let peakStreamViewers = 0;
let streamEventTimer = null;

function saveState() {
  const tmp = `${stateFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, stateFile);
}
function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const separator = part.indexOf('=');
    if (separator < 0) return [part, ''];
    const value = part.slice(separator + 1);
    try { return [part.slice(0, separator), decodeURIComponent(value)]; } catch { return [part.slice(0, separator), '']; }
  }));
}
function safeProfessional(user) {
  return user ? { id: user.id, name: user.name, email: user.email, profession: user.profession, role: user.role || 'professional' } : null;
}
async function syncFirebaseAccountDirectory() {
  if (!firebaseAdmin?.auth) throw new Error('Firebase Admin no está configurado para consultar Authentication.');
  const supportedRoles = new Set(['admin', 'monitor_admin', 'support', 'user', 'professional']);
  const firebaseAccounts = [];
  let pageToken;
  let changed = false;
  do {
    const page = await firebaseAdmin.auth.listUsers(1000, pageToken);
    for (const account of page.users) {
      if (!account.email) continue;
      firebaseAccounts.push(account);
      const uid = String(account.uid);
      const email = String(account.email).trim().toLowerCase();
      let profile = state.professionals.find(item => item.firebaseUid === uid)
        || state.professionals.find(item => String(item.email || '').trim().toLowerCase() === email && !item.firebaseUid);
      if (!profile) {
        const claimRole = String(account.customClaims?.role || 'user');
        const role = supportedRoles.has(claimRole) ? claimRole : 'user';
        profile = {
          id: uid, firebaseUid: uid,
          name: String(account.displayName || email.split('@')[0]).trim().slice(0, 80) || 'Usuario INETER',
          profession: ({ admin: 'Administración INETER', monitor_admin: 'Monitoreo técnico INETER', support: 'Soporte INETER' })[role] || 'Usuario INETER',
          role, email, createdAt: account.metadata?.creationTime || new Date().toISOString()
        };
        state.professionals.push(profile);
        changed = true;
      } else {
        if (profile.firebaseUid !== uid) { profile.firebaseUid = uid; changed = true; }
        if (profile.email !== email) { profile.email = email; changed = true; }
        if (!profile.name && account.displayName) { profile.name = String(account.displayName).slice(0, 80); changed = true; }
        if (!profile.createdAt && account.metadata?.creationTime) { profile.createdAt = account.metadata.creationTime; changed = true; }
      }
      if (profile.emailVerified !== !!account.emailVerified) { profile.emailVerified = !!account.emailVerified; changed = true; }
      if (profile.firebaseDisabled !== !!account.disabled) { profile.firebaseDisabled = !!account.disabled; changed = true; }
    }
    pageToken = page.pageToken;
  } while (pageToken);
  if (changed) saveState();
  return firebaseAccounts;
}
function isLoopbackRequest(req) {
  const address = String(req.socket.remoteAddress || '').toLowerCase();
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}
function currentProfessional(req) {
  const token = parseCookies(req).ineter_prof_session;
  if (!token) return null;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const session = state.authSessions[tokenHash];
  if (!session || Date.parse(session.expiresAt) <= Date.now()) {
    if (session) { delete state.authSessions[tokenHash]; saveState(); }
    return null;
  }
  const user = state.professionals.find(profile => profile.id === session.userId) || null;
  return user?.firebaseUid ? user : null;
}
function setProfessionalSession(req, res, user) {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();
  for (const [hash, session] of Object.entries(state.authSessions)) if (Date.parse(session.expiresAt) <= Date.now()) delete state.authSessions[hash];
  state.authSessions[tokenHash] = { userId: user.id, expiresAt };
  saveState();
  const secure = requestUsesHttps(req) ? '; Secure' : '';
  res.setHeader('set-cookie', `ineter_prof_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${secure}`);
}
function currentMonitorProfessional(req) {
  const token = parseCookies(req).ineter_monitor_session;
  if (!token) return null;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const session = state.authSessions[tokenHash];
  if (!session || session.scope !== 'monitor' || Date.parse(session.expiresAt) <= Date.now()) {
    if (session) { delete state.authSessions[tokenHash]; saveState(); }
    return null;
  }
  const user = state.professionals.find(profile => profile.id === session.userId) || null;
  return user?.firebaseUid && ['admin', 'monitor_admin'].includes(user.role) ? user : null;
}
function currentAdminProfessional(req) {
  const appUser = currentProfessional(req);
  if (appUser?.role === 'admin') return appUser;
  const monitorUser = currentMonitorProfessional(req);
  return monitorUser?.role === 'admin' ? monitorUser : null;
}
function setMonitorSession(req, res, user) {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
  for (const [hash, session] of Object.entries(state.authSessions)) if (Date.parse(session.expiresAt) <= Date.now()) delete state.authSessions[hash];
  state.authSessions[tokenHash] = { userId: user.id, scope: 'monitor', expiresAt };
  saveState();
  const secure = requestUsesHttps(req) ? '; Secure' : '';
  res.setHeader('set-cookie', `ineter_monitor_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600${secure}`);
}
function clearMonitorSession(req, res) {
  const token = parseCookies(req).ineter_monitor_session;
  if (token) delete state.authSessions[crypto.createHash('sha256').update(token).digest('hex')];
  saveState();
  const secure = requestUsesHttps(req) ? '; Secure' : '';
  res.setHeader('set-cookie', `ineter_monitor_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);
}
function clearProfessionalSession(req, res) {
  const user = currentProfessional(req);
  if (user) activePresence.delete(user.id);
  const token = parseCookies(req).ineter_prof_session;
  if (token) delete state.authSessions[crypto.createHash('sha256').update(token).digest('hex')];
  saveState();
  const secure = requestUsesHttps(req) ? '; Secure' : '';
  res.setHeader('set-cookie', `ineter_prof_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);
}
function scryptPassword(password, salt) {
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (error, key) => error ? reject(error) : resolve(key)));
}
function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted.toString('hex')}`;
}
function decrypt(value) {
  const [iv, tag, body] = value.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'hex')), decipher.final()]).toString('utf8');
}
function obsAuth(password, salt, challenge) {
  const secret = crypto.createHash('sha256').update(password + salt).digest('base64');
  return crypto.createHash('sha256').update(secret + challenge).digest('base64');
}
function connectObs() {
  if (obsConnected && obsSocket && obsSocket.readyState === WebSocket.OPEN) return Promise.resolve();
  if (obsConnectPromise) return obsConnectPromise;
  if (!state.obs?.secret) return Promise.reject(new Error('Primero guarda la contraseña de OBS WebSocket.'));
  const host = state.obs.host || process.env.OBS_WS_HOST || '127.0.0.1';
  const port = Number(state.obs.port || 4455);
  const password = decrypt(state.obs.secret);
  obsConnectPromise = new Promise((resolve, reject) => {
    let settled = false;
    const socket = new WebSocket(`ws://${host}:${port}`);
    obsSocket = socket;
    const timeout = setTimeout(() => {
      finish(new Error(`Tiempo agotado conectando a OBS en ${host}:${port}. Comprueba el puerto WebSocket, la contraseña y que el backend pueda alcanzar ese equipo.`));
      try { socket.close(); } catch {}
    }, 8000);
    function finish(error) {
      if (settled) return;
      settled = true; clearTimeout(timeout);
      if (socket === obsSocket) {
        obsConnectPromise = null;
        if (error) { obsConnected = false; obsError = error.message; }
        else { obsConnected = true; obsError = ''; }
      }
      if (error) reject(error); else resolve();
    }
    socket.addEventListener('message', event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.op === 0) {
        const data = message.d || {};
        const identify = { rpcVersion: Math.min(Number(data.rpcVersion || 1), 1), eventSubscriptions: 64 };
        if (data.authentication) identify.authentication = obsAuth(password, data.authentication.salt, data.authentication.challenge);
        try { socket.send(JSON.stringify({ op: 1, d: identify })); }
        catch (error) { finish(new Error(`No se pudo completar la identificación de OBS: ${error.message}`)); }
      } else if (message.op === 2) finish();
      else if (message.op === 5) {
        const eventType = message.d?.eventType;
        if (eventType === 'StreamStateChanged') obsStreaming = !!message.d?.eventData?.outputActive;
      }
      else if (message.op === 7) {
        const pending = obsPending.get(message.d?.requestId);
        if (pending) {
          obsPending.delete(message.d.requestId); clearTimeout(pending.timeout);
          const status = message.d.requestStatus || {};
          if (status.result) pending.resolve(message.d.responseData || {});
          else pending.reject(new Error(status.comment || `OBS rechazó la solicitud (${status.code}).`));
        }
      }
    });
    socket.addEventListener('error', () => finish(new Error(`No se pudo conectar con OBS WebSocket en ${host}:${port}. Verifica que el servidor WebSocket de OBS esté habilitado y que el firewall permita la conexión.`)));
    socket.addEventListener('close', event => {
      const closeError = event.code === 4009
        ? new Error('OBS rechazó la autenticación WebSocket (4009). Verifica la contraseña configurada en OBS y vuelve a conectarte. Si no cambiaste la contraseña, deja el campo vacío para reutilizar la que ya está guardada.')
        : new Error(`OBS cerró la conexión WebSocket (${event.code}${event.reason ? `: ${event.reason}` : ''}). Revisa la contraseña y el permiso de red.`);
      if (socket === obsSocket) {
        obsConnected = false;
        obsStreaming = false;
        for (const [requestId, pending] of obsPending) {
          clearTimeout(pending.timeout);
          obsPending.delete(requestId);
          pending.reject(closeError);
        }
      }
      if (!settled) finish(closeError);
    });
  });
  return obsConnectPromise;
}
async function obsRequest(requestType, requestData = {}) {
  await connectObs();
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { obsPending.delete(requestId); reject(new Error(`OBS no respondió a ${requestType}.`)); }, 8000);
    obsPending.set(requestId, { resolve, reject, timeout });
    try {
      if (!obsSocket || obsSocket.readyState !== WebSocket.OPEN) throw new Error('La conexión WebSocket de OBS ya no está abierta.');
      obsSocket.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
    } catch (error) {
      clearTimeout(timeout);
      obsPending.delete(requestId);
      reject(error);
    }
  });
}
async function obsStatus() {
  if (!state.obs?.secret) return { configured: false, connected: false, streaming: false, host: state.obs?.host || 'host.docker.internal', port: Number(state.obs?.port || 4455), error: '' };
  try {
    const status = await obsRequest('GetStreamStatus');
    obsStreaming = !!status.outputActive;
    obsError = '';
  } catch (error) { obsError = error.message; }
  return { configured: true, connected: obsConnected, streaming: obsStreaming, host: state.obs.host || process.env.OBS_WS_HOST || '127.0.0.1', port: state.obs.port, error: obsError };
}
async function configureObsStream() {
  return obsRequest('SetStreamServiceSettings', {
    streamServiceType: 'rtmp_custom',
    streamServiceSettings: { server: process.env.OBS_INGEST_SERVER || 'rtmp://127.0.0.1:1935/live', key: ingestToken, use_auth: false }
  });
}
function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
function publicAlert(alert) {
  const { id, category, categoryLabel, severity, severityLabel, title, location, message, sourceUrl, sourceName, createdAt, author } = alert;
  return { id, category, categoryLabel, severity, severityLabel, title, location, message, sourceUrl, sourceName, createdAt, author };
}
async function publishAlertToFirebase(alert) {
  if (!firebaseAdmin) return { published: false, pushSent: 0, error: firebaseAdminError || 'Configura credenciales de Firebase Admin.' };
  try {
    await firebaseAdmin.firestore.collection('publicAlerts').doc(alert.id).set(publicAlert(alert));
    let pushSent = 0;
    const validTokens = state.pushTokens.filter(item => item.token && item.userId);
    for (let index = 0; index < validTokens.length; index += 500) {
      const batch = validTokens.slice(index, index + 500);
      const result = await firebaseAdmin.messaging.sendEachForMulticast({
        tokens: batch.map(item => item.token),
        data: {
          title: `INETER · ${alert.severityLabel}`,
          body: `${alert.title}${alert.location ? ` · ${alert.location}` : ''}`,
          alertId: alert.id,
          url: '/#alertas'
        }
      });
      pushSent += result.successCount;
      const invalid = new Set();
      result.responses.forEach((item, responseIndex) => {
        const code = item.error?.code || '';
        if (['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(code)) invalid.add(batch[responseIndex].token);
      });
      if (invalid.size) state.pushTokens = state.pushTokens.filter(item => !invalid.has(item.token));
    }
    saveState();
    return { published: true, pushSent, error: '' };
  } catch (error) {
    return { published: false, pushSent: 0, error: String(error.message || error).slice(0, 240) };
  }
}
function firebaseStatus() {
  const web = firebaseWebConfig();
  return { webConfigured: web.configured, firestore: !!firebaseAdmin, push: !!firebaseAdmin && !!web.vapidKey && !!web.config.messagingSenderId, adminError: firebaseAdminError };
}
function firebaseTokenVerificationError(error) {
  const code = String(error?.code || 'auth/verification-failed');
  const detail = String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 240);
  console.warn(`Firebase ID token verification failed (${code}): ${detail}`);
  if (code === 'app/invalid-credential' && /invalid_grant|short-lived token|iat and exp/i.test(detail)) {
    return 'Firebase rechazó las credenciales del servidor: el reloj de Windows está desincronizado o la clave de cuenta de servicio fue revocada. Abre PowerShell como administrador y ejecuta: Set-Service W32Time -StartupType Automatic; Start-Service W32Time; w32tm /resync /force. Luego reinicia En Vivo. Si la hora ya está sincronizada, genera una clave nueva de Firebase Admin.';
  }
  return `Firebase no pudo validar la sesión (${code}): ${detail}`;
}
function alertMailStatus() {
  return { ready: !!(process.env.RESEND_API_KEY && process.env.ALERT_FROM_EMAIL), provider: 'Resend', sender: process.env.ALERT_FROM_EMAIL || '' };
}
function alertEmailRecipients(firebaseAccounts = null) {
  const currentlyRegistered = firebaseAccounts ? new Set(firebaseAccounts.filter(account => !account.disabled).map(account => String(account.email || '').trim().toLowerCase())) : null;
  const allowedRoles = new Set(['user', 'professional', 'support', 'monitor_admin', 'admin']);
  return [...new Set(state.professionals
    .filter(user => {
      if (user.firebaseDisabled) return false;
      if (user.disabled) return false;
      const role = user.role || 'user';
      if (!allowedRoles.has(role)) return false;
      const email = String(user.email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return false;
      if (currentlyRegistered && !currentlyRegistered.has(email)) return false;
      return true;
    })
    .map(user => String(user.email || '').trim().toLowerCase())
    .filter(email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))];
}
async function sendAlertBroadcast(alertId) {
  const alert = state.alerts.find(item => item.id === alertId);
  if (!alert) return;
  let firebaseAccounts = null;
  try {
    if (firebaseAdmin?.auth) firebaseAccounts = await syncFirebaseAccountDirectory();
  } catch (error) {
    alert.emailStatus = 'fallido';
    alert.emailError = `No se pudo sincronizar la lista de usuarios de Firebase: ${String(error.message || error).slice(0, 220)}`;
    saveState();
    return;
  }
  const recipients = alertEmailRecipients(firebaseAccounts);
  alert.recipientCount = recipients.length;
  alert.emailAccepted = 0;
  alert.emailStatus = 'enviando';
  alert.emailError = '';
  saveState();
  const config = alertMailStatus();
  if (!config.ready) {
    alert.emailStatus = 'sin_configuracion';
    alert.emailError = 'Configura RESEND_API_KEY y ALERT_FROM_EMAIL en .env.';
    saveState();
    return;
  }
  if (!recipients.length) {
    alert.emailStatus = 'sin_destinatarios';
    saveState();
    return;
  }
  const safeTitle = escapeHtml(alert.title);
  const safeCategory = escapeHtml(alert.categoryLabel);
  const safeSeverity = escapeHtml(alert.severityLabel);
  const safeLocation = escapeHtml(alert.location || 'Nicaragua');
  const safeMessage = escapeHtml(alert.message).replace(/\r?\n/g, '<br>');
  const safeSource = escapeHtml(alert.sourceUrl);
  const safeSourceName = escapeHtml(alert.sourceName || 'Fuente oficial');
  const subject = `[INETER · ${alert.severityLabel.toUpperCase()}] ${alert.title}`.slice(0, 180);
  const batches = [];
  for (let index = 0; index < recipients.length; index += 100) batches.push(recipients.slice(index, index + 100));
  try {
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const payload = batches[batchIndex].map(email => ({
        from: process.env.ALERT_FROM_EMAIL,
        to: [email],
        subject,
        text: `${alert.categoryLabel} · ${alert.severityLabel}\n${alert.title}\nZona: ${alert.location || 'Nicaragua'}\n\n${alert.message}\n\nFuente oficial: ${alert.sourceName || alert.sourceUrl} ${alert.sourceUrl}\n\nVerifica siempre las instrucciones de las autoridades competentes.`,
        html: `<main style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#163d43"><p style="letter-spacing:.08em;color:#137d78;font-weight:bold">INETER · AVISO ${safeCategory.toUpperCase()}</p><h1 style="font-size:24px">${safeTitle}</h1><p><strong>${safeSeverity}</strong> · ${safeLocation}</p><p style="line-height:1.6">${safeMessage}</p><p><a href="${safeSource}">${safeSourceName}</a></p><small>Verifica siempre las instrucciones de las autoridades competentes. Aviso difundido por la plataforma INETER.</small></main>`
      }));
      const response = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json', 'Idempotency-Key': `ineter-alert-${alert.id}-${batchIndex}` },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20000)
      });
      if (!response.ok) {
        let reason = `Proveedor de correo respondió HTTP ${response.status}.`;
        try { const body = await response.json(); if (body.message) reason = String(body.message).slice(0, 240); } catch {}
        throw new Error(reason);
      }
      const result = await response.json();
      alert.emailAccepted += Array.isArray(result.data) ? result.data.length : payload.length;
      saveState();
    }
    alert.emailStatus = 'aceptado';
  } catch (error) {
    alert.emailStatus = alert.emailAccepted ? 'parcial' : 'fallido';
    alert.emailError = String(error.message || 'Error enviando correos.').slice(0, 300);
  }
  alert.emailSentAt = new Date().toISOString();
  saveState();
}
function queueAlertBroadcast(alertId) {
  setImmediate(() => sendAlertBroadcast(alertId).catch(error => {
    const alert = state.alerts.find(item => item.id === alertId);
    if (!alert) return;
    alert.emailStatus = 'fallido';
    alert.emailError = String(error.message || 'No se pudo iniciar la difusión por correo.').slice(0, 300);
    saveState();
  }));
}
function queueFirebaseBroadcast(alertId) {
  setImmediate(async () => {
    const alert = state.alerts.find(item => item.id === alertId);
    if (!alert) return;
    const result = await publishAlertToFirebase(alert);
    alert.firebaseStatus = result.published ? 'publicado' : 'pendiente_configuracion';
    alert.pushAccepted = result.pushSent;
    alert.firebaseError = result.error;
    saveState();
  });
}
function publicState() {
  return {
    studio: state.studio,
    destinations: state.destinations.map(({ id, platform, name, serverUrl }) => ({ id, platform, name, serverUrl, configured: true, outputStatus: destinationOutputs.get(id) || 'listo' })),
    sessions: state.sessions.slice(-20).reverse(), schedules: state.schedules.slice(-20).sort((a, b) => a.startsAt.localeCompare(b.startsAt)), live, liveSince, lastError,
    ingest: { server: process.env.PUBLIC_RTMP_URL || 'rtmp://127.0.0.1:1935/live', key: ingestToken },
    recordings: listRecordings(),
    videoBroadcast: publicVideoBroadcast(),
    alerts: state.alerts.slice(-20).reverse().map(publicAlert),
    streamStats: streamStatsSnapshot(),
    obs: { configured: !!state.obs?.secret, connected: obsConnected, streaming: obsStreaming, host: state.obs?.host || process.env.OBS_WS_HOST || '127.0.0.1', port: Number(state.obs?.port || 4455), error: obsError }
  };
}
function streamStatsSnapshot() {
  const now = Date.now();
  let viewers = 0;
  let totalViewers = 0;
  for (const [userId, presence] of activePresence) {
    if (now - presence.lastSeen > 90_000) { activePresence.delete(userId); continue; }
    totalViewers++;
    if (presence.view === 'streaming' && now - presence.lastSeen <= 35_000) viewers++;
  }
  const sessionKey = activeSession ? `session:${activeSession.id}` : 'global';
  const likes = Number(state.likes?.[sessionKey] || 0);
  return { live, viewers, totalViewers, likes, sessionId: activeSession?.id || null, liveSince };
}
function stopStreamEventTicker() {
  if (streamEventClients.size || !streamEventTimer) return;
  clearInterval(streamEventTimer);
  streamEventTimer = null;
}
function removeStreamEventClient(response) {
  streamEventClients.delete(response);
  stopStreamEventTicker();
}
function closeStreamEventClients() {
  clearInterval(streamEventTimer);
  streamEventTimer = null;
  for (const response of streamEventClients) response.end();
  streamEventClients.clear();
}
function broadcastStreamEvent(type, data) {
  const frame = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const response of streamEventClients) {
    if (response.writableLength > 256 * 1024) {
      response.destroy();
      removeStreamEventClient(response);
      continue;
    }
    try { response.write(frame); }
    catch { response.destroy(); removeStreamEventClient(response); }
  }
}
function addStreamEventClient(response) {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no'
  });
  response.write('retry: 3000\n\n');
  streamEventClients.add(response);
  response.on('close', () => removeStreamEventClient(response));
  response.write(`event: stats\ndata: ${JSON.stringify(streamStatsSnapshot())}\n\n`);
  if (!streamEventTimer) {
    streamEventTimer = setInterval(() => broadcastStreamEvent('stats', streamStatsSnapshot()), 2500);
    streamEventTimer.unref();
  }
}
function readNetworkCounters() {
  if (process.platform === 'win32') return new Promise(resolve => {
    const command = "$ErrorActionPreference='Stop'; Get-NetAdapterStatistics | Select-Object Name,ReceivedBytes,SentBytes | ConvertTo-Json -Compress";
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { timeout: 4000, maxBuffer: 256 * 1024, windowsHide: true }, (error, stdout) => {
      if (error) return resolve({ available: false, source: 'Adaptadores de red de Windows', interfaces: [], rxBytes: 0, txBytes: 0, error: 'No se pudieron leer las estadísticas de red de Windows.' });
      try {
        const adapters = (Array.isArray(JSON.parse(stdout)) ? JSON.parse(stdout) : [JSON.parse(stdout)])
          .filter(adapter => Number.isFinite(Number(adapter.ReceivedBytes)) && Number.isFinite(Number(adapter.SentBytes)));
        resolve({ available: adapters.length > 0, source: 'Adaptadores de red de Windows', interfaces: adapters.map(adapter => String(adapter.Name)),
          rxBytes: adapters.reduce((sum, adapter) => sum + Number(adapter.ReceivedBytes), 0),
          txBytes: adapters.reduce((sum, adapter) => sum + Number(adapter.SentBytes), 0), error: '' });
      } catch { resolve({ available: false, source: 'Adaptadores de red de Windows', interfaces: [], rxBytes: 0, txBytes: 0, error: 'Windows devolvió estadísticas en un formato no reconocido.' }); }
    });
  });
  if (process.platform === 'linux') {
    try {
      const interfaces = fs.readdirSync('/sys/class/net').filter(name => name !== 'lo');
      let rxBytes = 0, txBytes = 0;
      for (const name of interfaces) {
        rxBytes += Number(fs.readFileSync(`/sys/class/net/${name}/statistics/rx_bytes`, 'utf8').trim()) || 0;
        txBytes += Number(fs.readFileSync(`/sys/class/net/${name}/statistics/tx_bytes`, 'utf8').trim()) || 0;
      }
      return Promise.resolve({ available: interfaces.length > 0, source: 'Interfaces de red del servidor', interfaces, rxBytes, txBytes, error: '' });
    } catch { return Promise.resolve({ available: false, source: 'Interfaces de red del servidor', interfaces: [], rxBytes: 0, txBytes: 0, error: 'No se pudieron leer las estadísticas de las interfaces de red.' }); }
  }
  return Promise.resolve({ available: false, source: 'Sistema operativo', interfaces: [], rxBytes: 0, txBytes: 0, error: 'La lectura de bytes de red no está disponible en este sistema.' });
}
function cpuUsagePercent() {
  const cpus = os.cpus();
  const times = cpus.reduce((sum, cpu) => {
    for (const [name, value] of Object.entries(cpu.times)) sum[name] = (sum[name] || 0) + value;
    return sum;
  }, {});
  const total = Object.values(times).reduce((sum, value) => sum + value, 0);
  let percent = null;
  if (cpuSample && total > cpuSample.total) {
    const totalDelta = total - cpuSample.total;
    const idleDelta = times.idle - cpuSample.idle;
    percent = Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100));
  }
  cpuSample = { total, idle: times.idle };
  return percent;
}
function probeInternetLatency() {
  if (latencyProbePending) return;
  latencyProbePending = true;
  const startedAt = Date.now();
  const socket = net.createConnection({ host: '1.1.1.1', port: 443 });
  let settled = false;
  const finish = (error) => {
    if (settled) return;
    settled = true;
    socket.destroy();
    cachedInternetLatency = { ms: error ? null : Date.now() - startedAt, checkedAt: new Date().toISOString(), status: error ? 'sin_respuesta' : 'disponible' };
    latencyProbePending = false;
  };
  socket.setTimeout(2500, () => finish(new Error('timeout')));
  socket.once('connect', () => finish());
  socket.once('error', finish);
}
function enrichProcessRows(rows, now = Date.now()) {
  const cpuCount = Math.max(1, os.cpus().length);
  const nextSamples = new Map();
  const result = rows.map(row => {
    const id = String(row.id);
    const cpuSeconds = Number(row.cpuSeconds);
    const old = processCpuSamples.get(id);
    let cpuPercent = null;
    if (Number.isFinite(cpuSeconds) && old && now > old.at && cpuSeconds >= old.cpuSeconds) {
      cpuPercent = Math.min(100, Math.max(0, (cpuSeconds - old.cpuSeconds) / ((now - old.at) / 1000) / cpuCount * 100));
    }
    if (Number.isFinite(cpuSeconds)) nextSamples.set(id, { cpuSeconds, at: now });
    return { pid: id, name: String(row.name || 'Proceso').slice(0, 100), cpuPercent,
      memoryBytes: Math.max(0, Number(row.memoryBytes) || 0) };
  });
  processCpuSamples.clear();
  for (const [id, sample] of nextSamples) processCpuSamples.set(id, sample);
  return result.sort((a, b) => (b.cpuPercent ?? -1) - (a.cpuPercent ?? -1)).slice(0, 30);
}
function readProcessStatistics() {
  const now = Date.now();
  if (process.platform === 'linux') {
    const rows = [];
    try {
      for (const entry of fs.readdirSync('/proc', { withFileTypes: true })) {
        if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
        try {
          const stat = fs.readFileSync(`/proc/${entry.name}/stat`, 'utf8');
          const close = stat.lastIndexOf(')');
          const fields = stat.slice(close + 2).trim().split(/\s+/);
          const ticks = Number(fields[11]) + Number(fields[12]);
          const status = fs.readFileSync(`/proc/${entry.name}/status`, 'utf8');
          const rssMatch = status.match(/^VmRSS:\s+(\d+)\s+kB/im);
          rows.push({ id: entry.name, name: stat.slice(stat.indexOf('(') + 1, close),
            cpuSeconds: ticks / 100, memoryBytes: Number(rssMatch?.[1] || 0) * 1024 });
        } catch { /* Process ended while the snapshot was being collected. */ }
      }
      return Promise.resolve({ available: true, scope: 'Procesos visibles para el servidor', processes: enrichProcessRows(rows, now) });
    } catch { return Promise.resolve({ available: false, scope: 'Procesos visibles para el servidor', processes: [] }); }
  }
  if (process.platform === 'win32') return new Promise(resolve => {
    const command = "$ErrorActionPreference='Stop'; Get-Process | Select-Object ProcessName,Id,CPU,WorkingSet64 | ConvertTo-Json -Compress";
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { timeout: 5000, maxBuffer: 1024 * 1024, windowsHide: true }, (error, stdout) => {
      if (error) return resolve({ available: false, scope: 'Procesos visibles para el servidor', processes: [] });
      try {
        const parsed = JSON.parse(stdout);
        const items = (Array.isArray(parsed) ? parsed : [parsed]).map(item => ({ id: item.Id,
          name: item.ProcessName, cpuSeconds: item.CPU == null ? NaN : Number(item.CPU), memoryBytes: Number(item.WorkingSet64) || 0 }));
        resolve({ available: true, scope: 'Procesos visibles para el servidor', processes: enrichProcessRows(items, now) });
      } catch { resolve({ available: false, scope: 'Procesos visibles para el servidor', processes: [] }); }
    });
  });
  return Promise.resolve({ available: false, scope: 'Procesos visibles para el servidor', processes: [] });
}
async function adminMonitoringSnapshot() {
  const now = Date.now();
  const streaming = !!(live || obsStreaming);
  const counters = await readNetworkCounters();
  let uploadMbps = 0, downloadMbps = 0;
  if (counters.available && previousNetworkCounters) {
    const seconds = Math.max(0.1, (now - previousNetworkCounters.at) / 1000);
    uploadMbps = Math.max(0, (counters.txBytes - previousNetworkCounters.txBytes) * 8 / seconds / 1_000_000);
    downloadMbps = Math.max(0, (counters.rxBytes - previousNetworkCounters.rxBytes) * 8 / seconds / 1_000_000);
  }
  if (counters.available) previousNetworkCounters = { at: now, txBytes: counters.txBytes, rxBytes: counters.rxBytes };
  if (!cachedInternetLatency.checkedAt || now - Date.parse(cachedInternetLatency.checkedAt) > 10_000) probeInternetLatency();
  const processStats = await readProcessStatistics();
  const cpus = os.cpus();
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  let recordingDisk = null;
  try {
    const disk = fs.statfsSync(recordingsDir);
    recordingDisk = { totalBytes: disk.blocks * disk.bsize, freeBytes: disk.bavail * disk.bsize };
  } catch {}
  const sessions = state.sessions.filter(session => Number.isFinite(Date.parse(session.startedAt)));
  const completedDuration = sessions.reduce((sum, session) => sum + (session.endedAt ? Math.max(0, Date.parse(session.endedAt) - Date.parse(session.startedAt)) : 0), 0);
  const currentDuration = activeSession?.startedAt ? Math.max(0, now - Date.parse(activeSession.startedAt)) : 0;
  const recordings = listRecordings();
  const activeUsers = [];
  for (const [userId, presence] of activePresence) {
    if (now - presence.lastSeen > 90_000) { activePresence.delete(userId); continue; }
    activeUsers.push({ userId, name: presence.name, email: presence.email, role: presence.role, view: presence.view, lastSeen: new Date(presence.lastSeen).toISOString() });
  }
  activeUsers.sort((a, b) => Date.parse(b.lastSeen) - Date.parse(a.lastSeen));
  const streamingViewers = activeUsers.filter(user => user.view === 'streaming').length;
  if (streamingViewers > peakStreamViewers) peakStreamViewers = streamingViewers;
  const currentSessionId = activeSession?.id || null;
  const sessionKey = currentSessionId ? `session:${currentSessionId}` : 'global';
  const likesCount = Number(state.likes?.[sessionKey] || 0);
  const likesUnique = Array.isArray(state.likesLog) ? state.likesLog.filter(item => item.sessionKey === sessionKey).length : likesCount;
  const totalRecordingBytes = recordings.reduce((sum, recording) => sum + (Number(recording.size) || 0), 0);
  return {
    sampledAt: new Date().toISOString(), streaming, liveSince: liveSince || null,
    network: { available: counters.available, source: counters.source, interfaces: counters.interfaces, uploadMbps, downloadMbps,
      uploadedBytes: counters.txBytes, downloadedBytes: counters.rxBytes, latency: cachedInternetLatency, note: 'Velocidad agregada de las interfaces del equipo que ejecuta el backend; incluye su otro tráfico de red.' },
    device: { hostname: os.hostname(), os: `${os.type()} ${os.release()}`, platform: os.platform(), architecture: os.arch(),
      cpuModel: cpus[0]?.model || 'No disponible', cpuCores: cpus.length, cpuPercent: cpuUsagePercent(),
      memoryTotalBytes: totalMemory, memoryFreeBytes: freeMemory, memoryUsedPercent: Math.max(0, Math.min(100, (totalMemory - freeMemory) / totalMemory * 100)),
      nodeVersion: process.version, processRssBytes: process.memoryUsage().rss, disk: recordingDisk },
    obs: { connected: obsConnected, streaming: obsStreaming, error: obsError },
    destinations: state.destinations.map(destination => ({ name: destination.name, platform: destination.platform, status: destinationOutputs.get(destination.id) || 'listo' })),
    recordingCount: recordings.length, latestError: lastError,
    activeUsers,
    streamStats: { viewers: streamingViewers, totalViewers: activeUsers.length, likes: likesCount, likesUnique, peakViewers: peakStreamViewers, sessionId: currentSessionId },
    alerts: { count: state.alerts.length, recent: state.alerts.slice(-5).reverse().map(publicAlert) },
    streams: { total: sessions.length, completed: sessions.filter(session => session.endedAt).length,
      accumulatedSeconds: Math.round((completedDuration + currentDuration) / 1000), currentSeconds: Math.round(currentDuration / 1000),
      lastStartedAt: sessions.at(-1)?.startedAt || null },
    recordings: { count: recordings.length, totalBytes: totalRecordingBytes },
    processStats,
    server: { uptimeSeconds: Math.round(process.uptime()), heapUsedBytes: process.memoryUsage().heapUsed,
      heapTotalBytes: process.memoryUsage().heapTotal }
  };
}
function listRecordings() {
  const found = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.mp4')) {
        const stat = fs.statSync(full);
        const startedAt = liveSince ? Date.parse(liveSince) : 0;
        if (live && startedAt && stat.birthtimeMs >= startedAt - 10_000) continue;
        const relative = path.relative(recordingsDir, full);
        const url = `/recordings/${relative.split(path.sep).map(encodeURIComponent).join('/')}`;
        const video = state.videos.find(item => item.filename === relative);
        found.push({
          id: video?.id || crypto.createHash('sha256').update(relative).digest('hex').slice(0, 32),
          name: relative,
          title: video?.title || path.basename(relative, path.extname(relative)),
          size: stat.size,
          createdAt: video?.createdAt || stat.birthtime.toISOString(),
          url,
          thumbnailUrl: video?.thumbnailFilename ? `/recordings/biblioteca/${encodeURIComponent(video.thumbnailFilename)}` : '',
          subtitlesUrl: video?.subtitleFilename ? `/recordings/biblioteca/${encodeURIComponent(video.subtitleFilename)}` : '',
          subtitleLanguage: video?.subtitleLanguage || 'es',
          category: videoCategoryLabels[video?.category] ? video.category : 'streamings_finalizados'
        });
      }
    }
  }
  walk(recordingsDir);
  return found.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
function listRecordingsByCategory(category = 'all') {
  const recordings = listRecordings();
  return category === 'all' ? recordings : recordings.filter(recording => recording.category === category);
}
function publicVideoBroadcast() {
  if (!videoBroadcast) return null;
  const { id, videoId, title, status, startAt, startedAt, endedAt, error, delaySeconds } = videoBroadcast;
  return { id, videoId, title, status, startAt, startedAt, endedAt, error, delaySeconds };
}
function videoBroadcastIsActive() {
  return !!videoBroadcast && (
    ['programada', 'en vivo'].includes(videoBroadcast.status) ||
    videoBroadcast.jobs.some(job => job.exitCode === null && job.signalCode === null)
  );
}
function stopVideoBroadcast() {
  if (!videoBroadcastIsActive()) return false;
  clearTimeout(videoBroadcast.timer);
  videoBroadcast.timer = null;
  videoBroadcast.status = 'detenida';
  videoBroadcast.endedAt = new Date().toISOString();
  for (const job of videoBroadcast.jobs) if (!job.killed) job.kill('SIGINT');
  return true;
}
async function stopLiveAtMaximumDuration() {
  if (!liveLimitStartedAt) return;
  lastError = 'La transmisión se detuvo al alcanzar el límite máximo de 3 horas y 30 minutos.';
  console.warn(lastError);
  if (videoBroadcastIsActive() && videoBroadcast.source === 'video') stopVideoBroadcast();
  if (state.obs?.secret) {
    try {
      const status = await obsRequest('GetStreamStatus');
      obsStreaming = !!status.outputActive;
      if (obsStreaming) {
        await obsRequest('StopStream');
        obsStreaming = false;
      }
    } catch (error) {
      lastError = `Se alcanzó el límite máximo de 3 horas y 30 minutos, pero no se pudo detener OBS: ${error.message}`;
      console.error(lastError);
    }
  }
  try {
    const baseUrl = process.env.MEDIAMTX_API_URL || 'http://127.0.0.1:9997';
    const headers = {};
    if (process.env.MEDIAMTX_API_USER && process.env.MEDIAMTX_API_PASS) {
      const auth = Buffer.from(`${process.env.MEDIAMTX_API_USER}:${process.env.MEDIAMTX_API_PASS}`).toString('base64');
      headers.Authorization = `Basic ${auth}`;
    }
    const connectionsResponse = await fetch(`${baseUrl}/v3/rtmp/conns/list`, { headers });
    if (!connectionsResponse.ok) throw new Error(`MediaMTX API ${connectionsResponse.status}`);
    const connections = await connectionsResponse.json();
    for (const connection of connections.items || []) {
      if (connection.path !== `live/${ingestToken}`) continue;
      const kickResponse = await fetch(`${baseUrl}/v3/rtmp/conns/kick/${encodeURIComponent(connection.id)}`, { method: 'POST', headers });
      if (!kickResponse.ok && kickResponse.status !== 404) throw new Error(`MediaMTX API ${kickResponse.status}`);
    }
  } catch (error) {
    lastError = `Se alcanzó el límite máximo de 3 horas y 30 minutos, pero no se pudo cerrar la entrada de MediaMTX: ${error.message}`;
    console.error(lastError);
  }
}
function startLiveDurationLimit() {
  if (liveLimitStartedAt) return;
  liveLimitStartedAt = Date.now();
  liveLimitTimer = setTimeout(() => {
    liveLimitTimer = null;
    stopLiveAtMaximumDuration().catch(error => {
      lastError = `No se pudo aplicar el límite máximo de transmisión: ${error.message}`;
      console.error(lastError);
    });
  }, MAX_LIVE_DURATION_MS);
}
function clearLiveDurationLimit() {
  clearTimeout(liveLimitTimer);
  liveLimitTimer = null;
  liveLimitStartedAt = null;
}
async function startVideoBroadcast(broadcast) {
  if (videoBroadcast !== broadcast || broadcast.status !== 'programada') return;
  try {
    if (live || activeSession?.status === 'grabando') throw new Error('Ya hay una señal de OBS activa.');
    if (state.obs?.secret && obsConnected) {
      const obs = await obsStatus();
      if (!obs.connected) throw new Error(`No se pudo comprobar el estado de OBS: ${obs.error || 'desconectado'}`);
      if (obs.streaming) throw new Error('OBS ya está transmitiendo. Detén esa emisión antes de iniciar un video.');
    }
    if (videoBroadcast !== broadcast || broadcast.status !== 'programada') return;
    if (obsStreaming) throw new Error('OBS ya está transmitiendo. Detén esa emisión antes de iniciar un video.');
    const video = listRecordings().find(recording => recording.id === broadcast.videoId);
    if (!video) throw new Error('El video ya no está disponible.');
    const inputPath = path.resolve(recordingsDir, ...video.name.split('/'));
    if (!inputPath.startsWith(recordingsDir + path.sep) || !fs.existsSync(inputPath)) throw new Error('No se encontró el archivo de video.');
    for (const destination of state.destinations) {
      if (!validRtmp(destination.serverUrl)) throw new Error(`La URL de ${destination.name} no es RTMP válida.`);
      const key = decrypt(destination.secret).trim();
      if (!key) throw new Error(`Falta la clave de transmisión de ${destination.name}.`);
    }
    const ingestBase = (process.env.MEDIAMTX_RTMP_BASE || 'rtmp://127.0.0.1:1935').replace(/\/+$/, '');
    const output = `${ingestBase}/live/${ingestToken}`;
    broadcast.status = 'en vivo';
    broadcast.startedAt = new Date().toISOString();
    broadcast.source = 'video';
    const child = spawn(process.env.FFMPEG_PATH || 'ffmpeg', [
      '-hide_banner', '-loglevel', 'warning', '-re', '-i', inputPath, '-t', String(MAX_LIVE_DURATION_SECONDS),
      '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'veryfast',
      '-tune', 'zerolatency', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k',
      '-ar', '44100', '-f', 'flv', output
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    broadcast.jobs.push(child);
    child.stderr.on('data', data => {
      const line = data.toString().trim();
      if (!line) return;
      const safeLine = line.replace(/rtmps?:\/\/[^\s"'<>]+/gi, '[RTMP URL protegida]');
      if (/\b(error|failed|refused|timed out|invalid|could not|unable to|not found|connection reset|broken pipe|permission denied)\b/i.test(safeLine)) {
        broadcast.error = safeLine.slice(-300);
        console.error('[ffmpeg video]', safeLine);
      }
    });
    child.once('error', error => {
      broadcast.status = 'fallida';
      broadcast.error = `No se pudo iniciar FFmpeg para la transmisión: ${String(error.message || error).slice(0, 180)}`;
      broadcast.endedAt = new Date().toISOString();
      console.error('[ffmpeg video]', broadcast.error);
    });
    child.once('close', (code, signal) => {
      if (videoBroadcast !== broadcast || broadcast.status !== 'en vivo') return;
      if (code === 0) broadcast.status = 'finalizada';
      else {
        broadcast.status = 'fallida';
        if (!broadcast.error) broadcast.error = `FFmpeg terminó con código ${code ?? `señal ${signal || 'desconocida'}`}.`;
      }
      broadcast.endedAt = new Date().toISOString();
    });
  } catch (error) {
    broadcast.status = 'fallida';
    broadcast.error = String(error.message || error);
    broadcast.endedAt = new Date().toISOString();
    console.error('[video broadcast]', broadcast.error);
  }
}
async function saveUploadedAsset(req, destination, maxBytes, limitMessage) {
  let size = 0;
  const limiter = new Transform({ transform(chunk, encoding, callback) {
    size += chunk.length;
    callback(size > maxBytes ? new Error(limitMessage) : null, chunk);
  } });
  await pipeline(req, limiter, fs.createWriteStream(destination, { flags: 'wx' }));
  if (!size) throw new Error('El archivo está vacío.');
  return size;
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let tooLarge = false;
    req.on('data', chunk => {
      if (tooLarge) return;
      body += chunk;
      if (Buffer.byteLength(body) > 100_000) { tooLarge = true; reject(new Error('Solicitud demasiado grande')); }
    });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { reject(new Error('JSON no válido')); } });
    req.on('error', reject);
  });
}
async function saveUploadedVideo(req, destination, maxBytes) {
  let size = 0;
  const limiter = new Transform({ transform(chunk, encoding, callback) {
    size += chunk.length;
    callback(size > maxBytes ? new Error('El video supera el límite de 1 GB.') : null, chunk);
  } });
  await pipeline(req, limiter, fs.createWriteStream(destination, { flags: 'wx' }));
  if (!size) throw new Error('El archivo está vacío.');
  return size;
}
function validRtmp(value) {
  try { const url = new URL(value); return ['rtmp:', 'rtmps:'].includes(url.protocol) && !!url.hostname; }
  catch { return false; }
}
function startRelay() {
  if (!activeSession) {
    activeSession = { id: crypto.randomUUID(), startedAt: new Date().toISOString(), recording: 'MediaMTX', destinations: state.destinations.map(d => d.name), status: 'grabando' };
    peakStreamViewers = 0;
    state.sessions.push(activeSession); saveState();
  }
  const source = `${process.env.MEDIAMTX_RTSP_BASE || 'rtsp://127.0.0.1:8554'}/live/${ingestToken}`;
  const base = ['-hide_banner', '-loglevel', 'warning', '-rtsp_transport', 'tcp', '-i', source];
  const activeDestinationIds = new Set(ffmpegJobs
    .filter(job => !job.killed && job.exitCode === null && job.signalCode === null)
    .map(job => job.destinationId));
  for (const destination of state.destinations) {
    if (activeDestinationIds.has(destination.id)) continue;
    try {
      const key = decrypt(destination.secret);
      const separator = destination.serverUrl.includes('?') ? '&' : (destination.serverUrl.endsWith('/') ? '' : '/');
      const output = `${destination.serverUrl}${separator}${key}`;
      destinationOutputs.set(destination.id, 'conectando');
      spawnFfmpeg([...base, '-map', '0:v:0?', '-map', '0:a:0?', '-c', 'copy', '-f', 'flv', output], `salida ${destination.name}`, destination.id);
    } catch { lastError = `No se pudo leer la clave de ${destination.name}.`; }
  }
}
function spawnFfmpeg(args, label, destinationId) {
  const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
  const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  child.destinationId = destinationId;
  ffmpegJobs.push(child);
  child.once('spawn', () => { if (destinationId) destinationOutputs.set(destinationId, 'enviando'); });
  child.stderr.on('data', data => {
    const line = data.toString().trim();
    if (!line) return;
    const safeLine = line.replace(/rtmps?:\/\/[^\s"'<>]+/gi, '[RTMP URL protegida]');
    const isFailure = /\b(error|failed|refused|timed out|invalid|could not|unable to|not found|connection reset|broken pipe|permission denied)\b/i.test(safeLine);
    if (isFailure) {
      lastError = `${label}: ${safeLine.slice(-400)}`;
      if (destinationId) destinationOutputs.set(destinationId, 'error');
      console.error('[ffmpeg]', label, safeLine);
    } else console.warn('[ffmpeg]', label, safeLine);
  });
  child.on('error', err => {
    lastError = `No se pudo iniciar FFmpeg (${label}): ${String(err.message || err).replace(/rtmps?:\/\/[^\s"'<>]+/gi, '[RTMP URL protegida]')}`;
    if (destinationId) destinationOutputs.set(destinationId, 'error');
    console.error(lastError);
  });
  child.on('exit', (code, signal) => {
    ffmpegJobs = ffmpegJobs.filter(job => job !== child);
    if (destinationId) {
      const stopped = code === 0 || signal === 'SIGINT';
      destinationOutputs.set(destinationId, stopped ? 'detenido' : 'error');
      if (!stopped && !lastError.startsWith(`${label}:`)) lastError = `${label}: FFmpeg terminó con código ${code ?? `señal ${signal || 'desconocida'}`}.`;
    }
  });
}
function stopRelay() {
  for (const job of ffmpegJobs) if (!job.killed) job.kill('SIGINT');
}
async function scanStream() {
  if (scanBusy) return;
  scanBusy = true;
  try {
    const baseUrl = process.env.MEDIAMTX_API_URL || 'http://127.0.0.1:9997';
    const headers = {};
    if (process.env.MEDIAMTX_API_USER && process.env.MEDIAMTX_API_PASS) {
      const auth = Buffer.from(`${process.env.MEDIAMTX_API_USER}:${process.env.MEDIAMTX_API_PASS}`).toString('base64');
      headers['Authorization'] = `Basic ${auth}`;
    }
    const response = await fetch(`${baseUrl}/v3/paths/list`, { headers });
    if (!response.ok) throw new Error(`MediaMTX API ${response.status}`);
    const result = await response.json();
    const item = (result.items || []).find(pathItem => pathItem.name === `live/${ingestToken}` && pathItem.ready);
    livePublisherReady = !!item;
    if (item) {
      clearTimeout(liveDisconnectTimer);
      liveDisconnectTimer = null;
      if (!live) {
        const interruptedVideo = videoBroadcastIsActive() && videoBroadcast.source !== 'video';
        if (interruptedVideo) stopVideoBroadcast();
        live = true; liveSince = new Date().toISOString();
        lastError = interruptedVideo ? 'Se detuvo el video para dar paso a la señal entrante de OBS.' : '';
        startLiveDurationLimit();
      }
      startRelay();
    } else if (live && !liveDisconnectTimer) {
      liveDisconnectTimer = setTimeout(() => {
        liveDisconnectTimer = null;
        if (livePublisherReady) return;
        live = false; liveSince = null;
        stopRelay();
        if (activeSession && activeSession.status === 'grabando') {
          activeSession.endedAt = new Date().toISOString();
          activeSession.status = 'guardada';
          saveState();
        }
        activeSession = null;
        clearLiveDurationLimit();
      }, LIVE_RECONNECT_GRACE_MS);
    }
  } catch (error) { lastError = `No se pudo contactar MediaMTX: ${error.message}`; }
  finally { scanBusy = false; }
}
async function processSchedules() {
  if (scheduleBusy || !state.schedules.length) return;
  scheduleBusy = true;
  try {
    const now = Date.now();
    for (const schedule of state.schedules) {
      if (schedule.status === 'programada' && Date.parse(schedule.startsAt) <= now) {
        try {
          if (state.studio !== 'OBS' || !state.obs?.secret) throw new Error('Conecta OBS para iniciar la transmisión programada.');
          const current = await obsRequest('GetStreamStatus');
          if (current.outputActive) throw new Error('OBS ya tiene una transmisión activa.');
          await obsRequest('StartStream');
          schedule.status = 'en curso'; schedule.startedAt = new Date().toISOString(); schedule.error = '';
          obsStreaming = true;
        } catch (error) { schedule.status = 'fallida'; schedule.error = error.message; schedule.endedAt = new Date().toISOString(); }
        saveState();
      } else if (schedule.status === 'en curso') {
        const current = await obsRequest('GetStreamStatus');
        obsStreaming = !!current.outputActive;
        const durationEnded = schedule.durationMinutes && Date.now() >= Date.parse(schedule.startedAt) + schedule.durationMinutes * 60_000;
        if (durationEnded && current.outputActive) await obsRequest('StopStream');
        if (!current.outputActive || durationEnded) {
          schedule.status = 'finalizada'; schedule.endedAt = new Date().toISOString(); saveState();
        }
      }
    }
  } catch (error) { lastError = `Programador: ${error.message}`; }
  finally { scheduleBusy = false; }
}
setInterval(scanStream, 1200);
setInterval(processSchedules, 5000);
setInterval(async () => {
  if (!state.obs?.secret) return;
  try { const status = await obsRequest('GetStreamStatus'); obsStreaming = !!status.outputActive; obsError = ''; }
  catch (error) { obsError = error.message; }
}, 4000);

const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.vtt': 'text/vtt; charset=utf-8' };
const server = http.createServer((req, res) => {
  handleHttpRequest(req, res).catch(error => {
    console.error('Error al atender una solicitud HTTP:', error);
    if (res.headersSent) return res.destroy();
    json(res, 500, { error: 'Error interno del servidor.' });
  });
});
const adminServer = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, 'http://localhost');
  if (requestUrl.pathname === '/' || requestUrl.pathname === '/index.html') {
    req.url = `/admin.html${requestUrl.search}`;
  }
  handleHttpRequest(req, res).catch(error => {
    console.error('Error al atender una solicitud del panel administrativo:', error);
    if (res.headersSent) return res.destroy();
    json(res, 500, { error: 'Error interno del servidor.' });
  });
});
async function handleHttpRequest(req, res) {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
  res.setHeader('x-frame-options', 'DENY');
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/api/live/status') {
    return json(res, 200, {
      live,
      liveSince,
      playlistUrl: live ? '/live/playback/index.m3u8' : null
    });
  }
  if (req.method === 'GET' && url.pathname === '/api/stream/events') return addStreamEventClient(res);
  if (req.method === 'GET' && url.pathname === '/api/live/qr') {
    const targetUrl = url.searchParams.get('url') || '';
    let target;
    try { target = new URL(targetUrl); }
    catch { return json(res, 400, { error: 'El enlace para el código QR no es válido.' }); }
    const expectedOrigin = `${requestUsesHttps(req) ? 'https' : 'http'}://${req.headers.host}`;
    if (!['http:', 'https:'].includes(target.protocol) || target.origin !== expectedOrigin || targetUrl.length > 2048) {
      return json(res, 400, { error: 'El enlace del código QR debe pertenecer a este sitio.' });
    }
    try {
      const image = await QRCode.toBuffer(target.href, { width: 256, margin: 1 });
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      return res.end(image);
    } catch (error) {
      console.error('No se pudo generar el código QR de la transmisión:', error);
      return json(res, 500, { error: 'No se pudo generar el código QR de la transmisión.' });
    }
  }
  const livePlaybackPrefix = '/live/playback/';
  if (req.method === 'GET' && url.pathname.startsWith(livePlaybackPrefix)) {
    const relativePath = url.pathname.slice(livePlaybackPrefix.length);
    const segments = relativePath.split('/');
    if (!relativePath || !/^[A-Za-z0-9._/-]+$/.test(relativePath) || segments.some(segment => !segment || segment === '.' || segment === '..')) {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('Ruta de transmisión no válida.');
    }
    const hlsBaseUrl = (process.env.MEDIAMTX_HLS_URL || 'http://127.0.0.1:8888').replace(/\/+$/, '');
    try {
      const upstreamUrl = `${hlsBaseUrl}/live/${ingestToken}/${relativePath}${url.search}`;
      const upstream = await fetch(upstreamUrl);
      if (!upstream.ok) {
        const detail = await upstream.text();
        res.writeHead(upstream.status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(detail || 'MediaMTX no tiene contenido disponible para esta transmisión.');
      }
      if (relativePath.endsWith('.m3u8')) {
        let playlist = await upstream.text();
        const internalPrefix = `/live/${ingestToken}/`;
        const publicPrefix = '/live/playback/';
        playlist = playlist
          .split(`${hlsBaseUrl}${internalPrefix}`).join(publicPrefix)
          .split(`http://${req.headers.host}${internalPrefix}`).join(publicPrefix)
          .split(`https://${req.headers.host}${internalPrefix}`).join(publicPrefix)
          .split(internalPrefix).join(publicPrefix);
        res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl', 'cache-control': 'no-store' });
        return res.end(playlist);
      }
      res.writeHead(200, {
        'content-type': upstream.headers.get('content-type') || 'application/octet-stream',
        'cache-control': 'no-store'
      });
      if (!upstream.body) return res.end();
      return pipeline(upstream.body, res);
    } catch (error) {
      if (res.headersSent) { res.destroy(error); return; }
      return json(res, 502, { error: `No se pudo obtener el video en vivo: ${error.message}` });
    }
  }
  if (req.method === 'GET' && (url.pathname === '/healthz' || url.pathname === '/api/health')) {
    return json(res, 200, { status: 'ok', live, obsConnected, uptimeSeconds: Math.round(process.uptime()) });
  }
  if (url.pathname.startsWith('/api/')) {
    if (req.method === 'GET' && url.pathname === '/api/firebase/config') {
      return json(res, 200, { ...firebaseWebConfig(), status: firebaseStatus() });
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/firebase/monitor-session') {
      if (!firebaseAdmin?.auth) return json(res, 503, { error: 'Firebase Authentication no está disponible en el servidor.' });
      const body = await readBody(req).catch(() => null);
      const idToken = String(body?.idToken || '');
      if (idToken.length < 100 || idToken.length > 8192) return json(res, 400, { error: 'La sesión de Firebase no es válida.' });
      let identity;
      try { identity = await firebaseAdmin.auth.verifyIdToken(idToken); }
      catch (error) {
        return json(res, 401, { error: firebaseTokenVerificationError(error) });
      }
      const uid = String(identity.uid || '');
      const email = String(identity.email || '').trim().toLowerCase();
      if (!uid || !identity.email_verified || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, 403, { error: 'La cuenta debe tener un correo válido y verificado en Firebase.' });
      let user = state.professionals.find(profile => profile.firebaseUid === uid && String(profile.email || '').trim().toLowerCase() === email);
      if (!user) {
        user = state.professionals.find(profile => String(profile.email || '').trim().toLowerCase() === email);
        if (user) user.firebaseUid = uid;
      }
      const initialAdminEmail = String(process.env.INETER_INITIAL_ADMIN_EMAIL || '').trim().toLowerCase();
      if (!user && initialAdminEmail && email === initialAdminEmail) {
        user = { id: uid, firebaseUid: uid, name: String(identity.name || email.split('@')[0]).slice(0, 80), profession: 'Administración principal INETER', role: 'admin', email, createdAt: new Date().toISOString() };
        state.professionals.push(user);
      }
      if (user && initialAdminEmail && email === initialAdminEmail && user.role !== 'admin') {
        try {
          const firebaseUser = await firebaseAdmin.auth.getUser(uid);
          await firebaseAdmin.auth.setCustomUserClaims(uid, { ...(firebaseUser.customClaims || {}), role: 'admin' });
        } catch (error) { return json(res, 502, { error: `Firebase no pudo habilitar el monitoreo: ${String(error.message || error).slice(0, 180)}` }); }
        user.role = 'admin';
        user.profession = 'Administración principal INETER';
      }
      if (!user || !['admin', 'monitor_admin'].includes(user.role)) return json(res, 403, { error: 'Esta cuenta no tiene permiso para entrar al dashboard de monitoreo.' });
      user.firebaseUid = uid;
      user.email = email;
      saveState();
      setMonitorSession(req, res, user);
      return json(res, 200, { professional: safeProfessional(user) });
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/monitor-logout') {
      clearMonitorSession(req, res);
      return json(res, 200, { signedOut: true });
    }
    if (req.method === 'GET' && url.pathname === '/api/auth/admin-session') {
      const user = currentMonitorProfessional(req);
      return json(res, 200, { professional: safeProfessional(user?.role === 'admin' ? user : null) });
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/firebase/session') {
      if (!firebaseAdmin?.auth) return json(res, 503, { error: 'Firebase Authentication no está disponible en el servidor.' });
      const body = await readBody(req).catch(() => null);
      const idToken = String(body?.idToken || '');
      if (idToken.length < 100 || idToken.length > 8192) return json(res, 400, { error: 'La sesión de Firebase no es válida.' });
      let identity;
      try { identity = await firebaseAdmin.auth.verifyIdToken(idToken, true); }
      catch (error) {
        return json(res, 401, { error: firebaseTokenVerificationError(error) });
      }
      const uid = String(identity.uid || '');
      const email = String(identity.email || '').trim().toLowerCase();
      if (!uid || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, 403, { error: 'La cuenta de Firebase debe tener un correo válido.' });
      const designatedAdminEmail = String(process.env.INETER_INITIAL_ADMIN_EMAIL || '').trim().toLowerCase();
      if (designatedAdminEmail && email === designatedAdminEmail && !identity.email_verified) return json(res, 403, { error: 'Verifica tu correo de Firebase para activar la cuenta administradora principal.' });
      let user = state.professionals.find(profile => profile.firebaseUid === uid);
      if (!user) {
        user = state.professionals.find(profile => String(profile.email || '').trim().toLowerCase() === email);
        if (user && !identity.email_verified) return json(res, 403, { error: 'Verifica tu correo de Firebase para vincular esta cuenta institucional.' });
        if (user) user.firebaseUid = uid;
      }
      if (!user) {
        const name = String(body?.name || identity.name || email.split('@')[0]).trim().replace(/\s+/g, ' ').slice(0, 80) || 'Profesional';
        user = { id: uid, firebaseUid: uid, name, profession: 'Usuario INETER', role: 'user', email, createdAt: new Date().toISOString() };
        state.professionals.push(user);
      }
      user.email = email;
      const initialAdminEmail = String(process.env.INETER_INITIAL_ADMIN_EMAIL || '').trim().toLowerCase();
      if (initialAdminEmail && email === initialAdminEmail && identity.email_verified) {
        try {
          const firebaseUser = await firebaseAdmin.auth.getUser(uid);
          if (firebaseUser.customClaims?.role !== 'admin') await firebaseAdmin.auth.setCustomUserClaims(uid, { ...(firebaseUser.customClaims || {}), role: 'admin' });
        }
        catch (error) { return json(res, 502, { error: `Firebase no pudo habilitar el monitoreo: ${String(error.message || error).slice(0, 180)}` }); }
        user.role = 'admin';
        user.profession = 'Administración principal INETER';
      }
      if (identity.name && !user.name) user.name = String(identity.name).slice(0, 80);
      user.firebaseUid = uid;
      saveState();
      setProfessionalSession(req, res, user);
      return json(res, 200, { professional: safeProfessional(user), hasProfessionals: true });
    }
    const publicAuthRoutes = new Set([
      '/api/auth/firebase/session', '/api/auth/me', '/api/auth/logout', '/api/auth/admin-session',
      '/api/firebase/push-token/status'
    ]);
    const isMonitorSnapshot = req.method === 'GET' && url.pathname === '/api/admin/monitor';
    const isMonitorAdminCreation = req.method === 'POST' && url.pathname === '/api/admin/monitor-admins';
    const isAdminStreamManagement = (req.method === 'POST' && ['/api/obs/connect', '/api/obs/stream', '/api/destinations'].includes(url.pathname))
      || (req.method === 'DELETE' && /^\/api\/destinations\/[\w-]+$/.test(url.pathname));
    if (!publicAuthRoutes.has(url.pathname) && !currentProfessional(req) && !(url.pathname.startsWith('/api/admin/') && currentMonitorProfessional(req)) && !((isMonitorSnapshot || isMonitorAdminCreation) && currentMonitorProfessional(req)) && !(isAdminStreamManagement && currentAdminProfessional(req))) {
      return json(res, 401, { error: 'Inicia sesión con Firebase para acceder al contenido de INETER.' });
    }
    if (req.method === 'POST' && url.pathname === '/api/presence') {
      const user = currentProfessional(req);
      if (!user) return json(res, 401, { error: 'Inicia sesión para registrar actividad.' });
      const body = await readBody(req).catch(() => ({}));
      const allowedViews = new Set(['inicio','streaming','videos','agricultura','pronostico','mapa','alertas','datos','administracion','monitoreo']);
      activePresence.set(user.id, { name: user.name, email: user.email, role: user.role || 'user', view: allowedViews.has(body?.view) ? body.view : 'inicio', lastSeen: Date.now() });
      broadcastStreamEvent('stats', streamStatsSnapshot());
      return json(res, 200, { active: true, sampledAt: new Date().toISOString() });
    }
    if (req.method === 'GET' && url.pathname === '/api/firebase/push-token/status') {
      const user = currentProfessional(req);
      return json(res, 200, { authenticated: !!user, registered: !!user && state.pushTokens.some(item => item.userId === user.id) });
    }
    if (req.method === 'POST' && url.pathname === '/api/firebase/push-token') {
      const user = currentProfessional(req);
      if (!user) return json(res, 401, { error: 'Inicia sesión para activar avisos en este dispositivo.' });
      const body = await readBody(req).catch(() => null);
      const token = String(body?.token || '').trim();
      if (token.length < 40 || token.length > 4096) return json(res, 400, { error: 'El token de notificaciones no es válido.' });
      state.pushTokens = state.pushTokens.filter(item => item.userId !== user.id && item.token !== token);
      state.pushTokens.push({ userId: user.id, token, createdAt: new Date().toISOString() });
      saveState();
      return json(res, 201, { registered: true });
    }
    if (req.method === 'DELETE' && url.pathname === '/api/firebase/push-token') {
      const user = currentProfessional(req);
      if (!user) return json(res, 401, { error: 'Inicia sesión para administrar avisos de este dispositivo.' });
      state.pushTokens = state.pushTokens.filter(item => item.userId !== user.id);
      saveState();
      return json(res, 200, { removed: true });
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/status') {
      const user = currentAdminProfessional(req) || currentMonitorProfessional(req);
      const canMonitor = ['admin','monitor_admin'].includes(user?.role);
      return json(res, 200, { isAdmin: user?.role === 'admin', canMonitor, bootstrapAvailable: false });
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/stream') {
      if (!currentAdminProfessional(req)) return json(res, 403, { error: 'Solo la cuenta administradora principal puede controlar la transmisión.' });
      return json(res, 200, publicState());
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/monitor') {
      const mainAdmin = currentProfessional(req);
      const monitorAdmin = mainAdmin?.role === 'admin' ? mainAdmin : currentMonitorProfessional(req);
      if (!monitorAdmin) return json(res, 401, { error: 'Inicia sesión de nuevo para continuar con el monitoreo.' });
      try {
        const snapshot = await adminMonitoringSnapshot();
        const initialAdminEmail = String(process.env.INETER_INITIAL_ADMIN_EMAIL || '').trim().toLowerCase();
        return json(res, 200, { ...snapshot, canCreateAdmins: !!initialAdminEmail && String(monitorAdmin.email || '').trim().toLowerCase() === initialAdminEmail });
      }
      catch (error) { return json(res, 500, { error: `No se pudo leer el monitoreo: ${error.message}` }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/monitor-admins') {
      const creator = currentProfessional(req) || currentMonitorProfessional(req);
      const initialAdminEmail = String(process.env.INETER_INITIAL_ADMIN_EMAIL || '').trim().toLowerCase();
      if (!creator || !initialAdminEmail || String(creator.email || '').trim().toLowerCase() !== initialAdminEmail) return json(res, 403, { error: 'Solo la cuenta administradora principal puede crear otros administradores.' });
      if (!firebaseAdmin?.auth) return json(res, 503, { error: 'Firebase Authentication no está disponible en el servidor.' });
      const body = await readBody(req).catch(() => null);
      const name = String(body?.name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
      const email = String(body?.email || '').trim().toLowerCase();
      const password = String(body?.password || '');
      if (name.length < 2) return json(res, 400, { error: 'Escribe el nombre de la persona administradora.' });
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, 400, { error: 'Escribe un correo electrónico válido.' });
      if (password.length < 10 || password.length > 128) return json(res, 400, { error: 'La contraseña inicial debe tener entre 10 y 128 caracteres.' });
      if (email === initialAdminEmail) return json(res, 409, { error: 'Esa dirección ya corresponde a la cuenta administradora principal.' });
      try {
        const created = await firebaseAdmin.auth.createUser({ email, password, displayName: name, emailVerified: true, disabled: false });
        try { await firebaseAdmin.auth.setCustomUserClaims(created.uid, { role: 'monitor_admin' }); }
        catch (error) { await firebaseAdmin.auth.deleteUser(created.uid).catch(() => {}); throw error; }
        const profile = { id: created.uid, firebaseUid: created.uid, name, profession: 'Administrador de monitoreo', role: 'monitor_admin', email, createdAt: new Date().toISOString() };
        state.professionals.push(profile);
        saveState();
        return json(res, 201, { administrator: safeProfessional(profile) });
      } catch (error) {
        if (error.code === 'auth/email-already-exists') return json(res, 409, { error: 'Ya existe una cuenta de Firebase con ese correo.' });
        return json(res, 502, { error: `Firebase no pudo crear la cuenta: ${String(error.message || error).slice(0, 180)}` });
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/bootstrap') {
      return json(res, 410, { error: 'La asignación inicial ahora se realiza únicamente para el correo autorizado y verificado en Firebase.' });
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/alerts') {
      if (currentAdminProfessional(req)?.role !== 'admin') return json(res, 403, { error: 'Se requiere una cuenta administradora.' });
      let firebaseAccounts = null;
      if (firebaseAdmin?.auth) firebaseAccounts = await syncFirebaseAccountDirectory().catch(error => { console.warn(`No se pudo sincronizar el directorio de usuarios para alertas: ${String(error.message || error).slice(0, 180)}`); return null; });
      const recipients = new Set(alertEmailRecipients(firebaseAccounts));
      return json(res, 200, { alerts: state.alerts.slice(-100).reverse().map(alert => ({ ...publicAlert(alert), emailStatus: alert.emailStatus || 'sin_configuracion', emailError: alert.emailError || '', recipientCount: alert.recipientCount || 0, emailAccepted: alert.emailAccepted || 0, emailSentAt: alert.emailSentAt || null, firebaseStatus: alert.firebaseStatus || 'pendiente_configuracion', pushAccepted: alert.pushAccepted || 0, firebaseError: alert.firebaseError || '' })), registeredCount: recipients.size, mail: alertMailStatus(), firebase: firebaseStatus(), pushTokenCount: state.pushTokens.length });
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/alerts') {
      const admin = currentAdminProfessional(req);
      if (admin?.role !== 'admin') return json(res, 403, { error: 'Se requiere una cuenta administradora.' });
      let firebaseAccounts = null;
      let directorySyncError = '';
      if (firebaseAdmin?.auth) {
        try { firebaseAccounts = await syncFirebaseAccountDirectory(); }
        catch (error) { directorySyncError = String(error.message || error).slice(0, 180); console.warn(`No se pudo sincronizar usuarios antes de publicar alerta: ${directorySyncError}`); }
      }
      const body = await readBody(req).catch(() => null);
      const categoryLabels = { sismica: 'Sísmica', volcanica: 'Volcánica', tsunami: 'Tsunami', meteorologica: 'Meteorológica', hidrologica: 'Hidrológica', otra: 'Otro aviso' };
      const severityLabels = { informativa: 'Informativa', precaucion: 'Precaución', urgente: 'Urgente' };
      const category = String(body?.category || '');
      const severity = String(body?.severity || '');
      const title = String(body?.title || '').trim().replace(/\s+/g, ' ');
      const location = String(body?.location || '').trim().replace(/\s+/g, ' ');
      const message = String(body?.message || '').trim();
      const sourceName = String(body?.sourceName || 'INETER').trim().replace(/\s+/g, ' ').slice(0, 80);
      let sourceUrl;
      try { sourceUrl = new URL(String(body?.sourceUrl || '')); } catch { sourceUrl = null; }
      const officialHost = sourceUrl && (sourceUrl.hostname === 'ineter.gob.ni' || sourceUrl.hostname.endsWith('.ineter.gob.ni'));
      if (!body || !categoryLabels[category] || !severityLabels[severity] || title.length < 5 || title.length > 140 || location.length > 120 || message.length < 10 || message.length > 3000 || !officialHost || sourceUrl.protocol !== 'https:' || body?.confirmedOfficial !== true) {
        return json(res, 400, { error: 'Completa la alerta, confirma que fue verificada y agrega un enlace HTTPS de un sitio oficial de INETER.' });
      }
      const recipientCount = directorySyncError ? 0 : alertEmailRecipients(firebaseAccounts).length;
      const alert = {
        id: crypto.randomUUID(), category, categoryLabel: categoryLabels[category], severity, severityLabel: severityLabels[severity],
        title, location, message, sourceName, sourceUrl: sourceUrl.href, createdAt: new Date().toISOString(), author: admin.name,
        emailStatus: 'en_cola', recipientCount, emailAccepted: 0, emailError: ''
      };
      state.alerts.push(alert);
      state.alerts = state.alerts.slice(-500);
      saveState();
      queueAlertBroadcast(alert.id);
      queueFirebaseBroadcast(alert.id);
      return json(res, 201, { alert: publicAlert(alert), emailStatus: alert.emailStatus, recipientCount, mailConfigured: alertMailStatus().ready, directorySyncError });
    }
    const retryAlertMatch = url.pathname.match(/^\/api\/admin\/alerts\/([\w-]+)\/retry$/);
    if (req.method === 'POST' && retryAlertMatch) {
      if (currentAdminProfessional(req)?.role !== 'admin') return json(res, 403, { error: 'Se requiere una cuenta administradora.' });
      const alert = state.alerts.find(item => item.id === retryAlertMatch[1]);
      if (!alert) return json(res, 404, { error: 'No se encontró el aviso.' });
      if (alert.emailStatus === 'enviando' || alert.emailStatus === 'en_cola') return json(res, 409, { error: 'El envío ya está en curso.' });
      if (alert.emailStatus === 'aceptado') return json(res, 409, { error: 'El proveedor ya aceptó este envío.' });
      alert.emailStatus = 'en_cola'; alert.emailError = ''; saveState();
      queueAlertBroadcast(alert.id);
      return json(res, 202, { emailStatus: 'en_cola' });
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/users') {
      if (currentAdminProfessional(req)?.role !== 'admin') return json(res, 403, { error: 'Se requiere una cuenta administradora.' });
      try { await syncFirebaseAccountDirectory(); }
      catch (error) { return json(res, 503, { error: `No se pudo consultar Firebase Authentication: ${String(error.message || error).slice(0, 180)}` }); }
      return json(res, 200, { users: state.professionals.map(user => ({ id: user.id, firebaseUid: user.firebaseUid || null, name: user.name, email: user.email, role: user.role || 'user', createdAt: user.createdAt || null, active: activePresence.has(user.id) && Date.now() - activePresence.get(user.id).lastSeen <= 90_000, emailVerified: !!user.emailVerified, disabled: !!user.firebaseDisabled, firebaseLinked: !!user.firebaseUid })) });
    }
    const userRoleMatch = url.pathname.match(/^\/api\/admin\/users\/([\w-]+)\/role$/);
    if (req.method === 'PATCH' && userRoleMatch) {
      const admin = currentAdminProfessional(req);
      if (admin?.role !== 'admin') return json(res, 403, { error: 'Se requiere una cuenta administradora.' });
      const body = await readBody(req).catch(() => null);
      const role = String(body?.role || '');
      if (!['user', 'support'].includes(role)) return json(res, 400, { error: 'El rol debe ser Usuario o Soporte. El acceso administrador se gestiona por separado.' });
      const target = state.professionals.find(user => user.firebaseUid === userRoleMatch[1]);
      if (!target) return json(res, 404, { error: 'No se encontró esa cuenta de Firebase.' });
      const primaryAdminEmail = String(process.env.INETER_INITIAL_ADMIN_EMAIL || '').trim().toLowerCase();
      if (['admin', 'monitor_admin'].includes(target.role) || String(target.email || '').trim().toLowerCase() === primaryAdminEmail) return json(res, 403, { error: 'Las cuentas administradoras están protegidas y sus permisos se gestionan mediante el flujo administrativo.' });
      if (!firebaseAdmin?.auth) return json(res, 503, { error: 'Firebase Admin no está configurado.' });
      try {
        const firebaseUser = await firebaseAdmin.auth.getUser(target.firebaseUid);
        await firebaseAdmin.auth.setCustomUserClaims(target.firebaseUid, { ...(firebaseUser.customClaims || {}), role });
        target.role = role;
        target.profession = role === 'support' ? 'Soporte INETER' : 'Usuario INETER';
        saveState();
        return json(res, 200, { user: { id: target.id, firebaseUid: target.firebaseUid, name: target.name, email: target.email, role: target.role } });
      } catch (error) {
        return json(res, 502, { error: `Firebase no pudo actualizar el rol: ${String(error.message || error).slice(0, 180)}` });
      }
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/access-requests') {
      const admin = currentAdminProfessional(req);
      if (admin?.role !== 'admin') return json(res, 403, { error: 'Se requiere una cuenta administradora.' });
      const primaryAdminEmail = String(process.env.INETER_INITIAL_ADMIN_EMAIL || '').trim().toLowerCase();
      return json(res, 200, { canApprove: !!primaryAdminEmail && String(admin.email || '').trim().toLowerCase() === primaryAdminEmail, requests: state.adminAccessRequests.filter(item => item.status === 'pending').slice().reverse() });
    }
    if (req.method === 'POST' && url.pathname === '/api/account/admin-access-request') {
      const user = currentProfessional(req);
      if (!user) return json(res, 401, { error: 'Inicia sesión para solicitar permisos.' });
      if (['admin','monitor_admin'].includes(user.role)) return json(res, 409, { error: 'Tu cuenta ya tiene permisos de monitoreo o administración.' });
      const body = await readBody(req).catch(() => null);
      const reason = String(body?.reason || '').trim().replace(/\s+/g, ' ');
      if (reason.length < 10 || reason.length > 1000) return json(res, 400, { error: 'Explica el motivo en al menos 10 caracteres.' });
      const pending = state.adminAccessRequests.find(item => item.userId === user.id && item.status === 'pending');
      if (pending) return json(res, 409, { error: 'Ya tienes una solicitud pendiente de revisión.', request: pending });
      const request = { id: crypto.randomUUID(), userId: user.id, name: user.name, email: user.email, reason, status: 'pending', createdAt: new Date().toISOString() };
      state.adminAccessRequests.push(request);
      state.adminAccessRequests = state.adminAccessRequests.slice(-1000);
      saveState();
      return json(res, 201, { request });
    }
    if (req.method === 'GET' && url.pathname === '/api/account/admin-access-request') {
      const user = currentProfessional(req);
      if (!user) return json(res, 401, { error: 'Inicia sesión para consultar tu solicitud.' });
      const request = state.adminAccessRequests.filter(item => item.userId === user.id).slice(-1)[0] || null;
      return json(res, 200, { request });
    }
    const accessDecisionMatch = url.pathname.match(/^\/api\/admin\/access-requests\/([\w-]+)\/decision$/);
    if (req.method === 'POST' && accessDecisionMatch) {
      const admin = currentAdminProfessional(req);
      if (admin?.role !== 'admin') return json(res, 403, { error: 'Se requiere una cuenta administradora.' });
      const request = state.adminAccessRequests.find(item => item.id === accessDecisionMatch[1]);
      if (!request || request.status !== 'pending') return json(res, 404, { error: 'La solicitud ya fue atendida o no existe.' });
      const body = await readBody(req).catch(() => null);
      const decision = String(body?.decision || '');
      if (!['approve','reject'].includes(decision)) return json(res, 400, { error: 'La decisión debe ser aprobar o rechazar.' });
      const primaryAdminEmail = String(process.env.INETER_INITIAL_ADMIN_EMAIL || '').trim().toLowerCase();
      if (decision === 'approve' && (!primaryAdminEmail || String(admin.email || '').trim().toLowerCase() !== primaryAdminEmail)) return json(res, 403, { error: 'Solo la cuenta administradora principal puede aprobar nuevas cuentas administradoras.' });
      const target = state.professionals.find(item => item.id === request.userId);
      if (decision === 'approve') {
        if (!target?.firebaseUid || !firebaseAdmin?.auth) return json(res, 503, { error: 'No se encontró una cuenta Firebase vinculada para asignar el rol.' });
        try {
          const firebaseUser = await firebaseAdmin.auth.getUser(target.firebaseUid);
          if (!firebaseUser.emailVerified) return json(res, 409, { error: 'La cuenta debe verificar su correo en Firebase antes de recibir acceso al monitoreo.' });
          await firebaseAdmin.auth.setCustomUserClaims(target.firebaseUid, { ...(firebaseUser.customClaims || {}), role: 'monitor_admin' });
        }
        catch (error) { return json(res, 502, { error: `Firebase no pudo asignar el rol: ${String(error.message || error).slice(0, 180)}` }); }
        target.role = 'monitor_admin';
        target.profession = 'Monitoreo técnico INETER';
        request.status = 'approved';
        request.reviewedAt = new Date().toISOString();
        request.reviewedBy = admin.email;
      } else {
        request.status = 'rejected';
        request.reviewedAt = new Date().toISOString();
        request.reviewedBy = admin.email;
      }
      saveState();
      return json(res, 200, { request, user: target ? safeProfessional(target) : null });
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/reports') {
      if (currentAdminProfessional(req)?.role !== 'admin') return json(res, 403, { error: 'Se requiere una cuenta administradora.' });
      return json(res, 200, { reports: state.agricultureReports.slice(-200).reverse() });
    }
    if (req.method === 'POST' && url.pathname === '/api/reports') {
      const user = currentProfessional(req);
      if (!user) return json(res, 401, { error: 'Inicia sesión para guardar un reporte agroclimático.' });
      const body = await readBody(req).catch(() => null);
      const municipality = String(body?.municipality || '').trim().slice(0, 80);
      const crop = String(body?.crop || '').trim().slice(0, 40);
      const soil = String(body?.soil || '').trim();
      const rain = String(body?.rain || '').trim();
      const outcome = String(body?.outcome || '').trim().slice(0, 100);
      if (!crop || !['adequate','dry','waterlogged','unknown'].includes(soil) || !['yes','no','unknown'].includes(rain) || !outcome) return json(res, 400, { error: 'Datos de reporte incompletos.' });
      const report = { id: crypto.randomUUID(), municipality, crop, soil, rain, outcome, createdAt: new Date().toISOString(), reporter: user.name };
      state.agricultureReports.push(report); state.agricultureReports = state.agricultureReports.slice(-1000); saveState();
      return json(res, 201, { report });
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/users') {
      const admin = currentAdminProfessional(req);
      if (admin?.role !== 'admin') return json(res, 403, { error: 'Se requiere una cuenta administradora.' });
      const body = await readBody(req).catch(() => null);
      const name = String(body?.name || '').trim().replace(/\s+/g, ' ');
      const email = String(body?.email || '').trim().toLowerCase();
      const password = String(body?.password || '');
      const role = String(body?.role || 'user');
      if (name.length < 2 || name.length > 80 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || password.length < 12 || password.length > 128 || !['user','support'].includes(role)) return json(res, 400, { error: 'Revisa el nombre, correo, rol permitido y contraseña de al menos 12 caracteres.' });
      if (!firebaseAdmin?.auth) return json(res, 503, { error: 'Firebase Admin no está configurado; no se puede crear una cuenta de Firebase desde aquí.' });
      if (state.professionals.some(user => String(user.email || '').toLowerCase() === email) || adminCreationEmails.has(email)) return json(res, 409, { error: 'Ya existe una cuenta con ese correo.' });
      adminCreationEmails.add(email);
      let firebaseUser;
      try {
        firebaseUser = await firebaseAdmin.auth.createUser({ email, password, displayName: name, emailVerified: false, disabled: false });
        await firebaseAdmin.auth.setCustomUserClaims(firebaseUser.uid, { role });
        const roleLabels = { user: 'Usuario INETER', support: 'Soporte INETER' };
        const user = { id: firebaseUser.uid, firebaseUid: firebaseUser.uid, name, email, profession: roleLabels[role], role, createdAt: new Date().toISOString() };
        state.professionals.push(user); saveState();
        return json(res, 201, { user: { id: user.id, name: user.name, email: user.email, role: user.role, createdAt: user.createdAt } });
      } catch (error) {
        if (firebaseUser?.uid) await firebaseAdmin.auth.deleteUser(firebaseUser.uid).catch(() => {});
        const duplicate = error.code === 'auth/email-already-exists';
        return json(res, duplicate ? 409 : 400, { error: duplicate ? 'Firebase ya tiene una cuenta con ese correo.' : `Firebase no pudo crear la cuenta: ${String(error.message || error).slice(0, 200)}` });
      } finally { adminCreationEmails.delete(email); }
    }
    if (url.pathname === '/api/admin/videos' && req.method === 'GET') {
      if (currentAdminProfessional(req)?.role !== 'admin') return json(res, 403, { error: 'Se requiere una cuenta administradora.' });
      const category = url.searchParams.get('category') || 'all';
      if (category !== 'all' && !Object.hasOwn(videoCategoryLabels, category)) return json(res, 400, { error: 'La categoría de video no es válida.' });
      return json(res, 200, { videos: listRecordingsByCategory(category), broadcast: publicVideoBroadcast() });
    }
    const videoCategoryMatch = url.pathname.match(/^\/api\/admin\/videos\/([\w-]+)\/category$/);
    if (req.method === 'PUT' && videoCategoryMatch) {
      if (currentAdminProfessional(req)?.role !== 'admin') return json(res, 403, { error: 'Se requiere una cuenta administradora.' });
      const body = await readBody(req).catch(() => null);
      const category = String(body?.category || '');
      if (!Object.hasOwn(videoCategoryLabels, category)) return json(res, 400, { error: 'Selecciona una categoría de video válida.' });
      const recording = listRecordings().find(item => item.id === videoCategoryMatch[1]);
      if (!recording) return json(res, 404, { error: 'Video no encontrado en la biblioteca.' });
      let video = state.videos.find(item => item.filename === recording.name);
      if (!video) {
        video = {
          id: recording.id,
          filename: recording.name,
          title: recording.title,
          createdAt: recording.createdAt,
          thumbnailFilename: '',
          subtitleFilename: '',
          subtitleLanguage: 'es'
        };
        state.videos.push(video);
      }
      video.category = category;
      saveState();
      return json(res, 200, { video: { ...recording, category } });
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/videos') {
      if (currentAdminProfessional(req)?.role !== 'admin') return json(res, 403, { error: 'Se requiere una cuenta administradora.' });
      if (!/^video\/mp4(?:\s*;|$)/i.test(String(req.headers['content-type'] || ''))) return json(res, 415, { error: 'Elige un archivo MP4.' });
      const category = String(req.headers['x-video-category'] || 'streamings_finalizados');
      if (!Object.hasOwn(videoCategoryLabels, category)) { req.resume(); return json(res, 400, { error: 'Selecciona una categoría de video válida.' }); }
      const declaredSize = Number(req.headers['content-length'] || 0);
      const maxBytes = 1024 * 1024 * 1024;
      if (declaredSize > maxBytes) { req.resume(); return json(res, 413, { error: 'El video supera el límite de 1 GB.' }); }
      let title = String(req.headers['x-video-title'] || 'Video INETER');
      try { title = decodeURIComponent(title); } catch { title = 'Video INETER'; }
      title = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || 'Video INETER';
      const vodDir = path.join(recordingsDir, 'biblioteca');
      fs.mkdirSync(vodDir, { recursive: true });
      const slug = title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'video-ineter';
      const filename = `${Date.now()}-${crypto.randomUUID()}-${slug}.mp4`;
      const destination = path.join(vodDir, filename);
      try {
        const size = await saveUploadedVideo(req, destination, maxBytes);
        const video = {
          id: crypto.randomUUID(),
          filename: path.join('biblioteca', filename),
          title,
          createdAt: new Date().toISOString(),
          category,
          thumbnailFilename: '',
          subtitleFilename: '',
          subtitleLanguage: 'es'
        };
        state.videos.push(video);
        saveState();
        return json(res, 201, { video: { ...video, name: filename, size, url: `/recordings/biblioteca/${encodeURIComponent(filename)}` } });
      } catch (error) {
        fs.rmSync(destination, { force: true });
        state.videos = state.videos.filter(video => video.filename !== path.join('biblioteca', filename));
        if (!res.headersSent) return json(res, error.message.includes('límite') ? 413 : 400, { error: error.message || 'No se pudo guardar el video.' });
        return;
      }
    }
    const videoAssetMatch = url.pathname.match(/^\/api\/admin\/videos\/([a-f0-9-]{36})\/(thumbnail|subtitles)$/i);
    if (req.method === 'POST' && videoAssetMatch) {
      if (currentAdminProfessional(req)?.role !== 'admin') return json(res, 403, { error: 'Se requiere una cuenta administradora.' });
      const video = state.videos.find(item => item.id === videoAssetMatch[1]);
      if (!video) return json(res, 404, { error: 'Video no encontrado en la biblioteca.' });
      const assetType = videoAssetMatch[2].toLowerCase();
      const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      let extension;
      let maxBytes;
      let maxMessage;
      if (assetType === 'thumbnail') {
        extension = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' })[contentType];
        maxBytes = 8 * 1024 * 1024;
        maxMessage = 'La miniatura supera el límite de 8 MB.';
        if (!extension) { req.resume(); return json(res, 415, { error: 'La miniatura debe ser JPG, PNG o WebP.' }); }
      } else {
        maxBytes = 2 * 1024 * 1024;
        maxMessage = 'Los subtítulos superan el límite de 2 MB.';
        if (!['text/vtt', 'application/octet-stream'].includes(contentType)) { req.resume(); return json(res, 415, { error: 'Los subtítulos deben estar en formato WebVTT (.vtt).' }); }
      }
      const declaredSize = Number(req.headers['content-length'] || 0);
      if (declaredSize > maxBytes) { req.resume(); return json(res, 413, { error: maxMessage }); }
      const vodDir = path.join(recordingsDir, 'biblioteca');
      const filename = `${video.id}-${crypto.randomUUID()}.${assetType === 'thumbnail' ? extension : 'vtt'}`;
      const destination = path.join(vodDir, filename);
      const previousThumbnail = video.thumbnailFilename;
      const previousSubtitle = video.subtitleFilename;
      const previousLanguage = video.subtitleLanguage;
      let metadataSaved = false;
      try {
        await saveUploadedAsset(req, destination, maxBytes, maxMessage);
        let language = video.subtitleLanguage || 'es';
        if (assetType === 'thumbnail') {
          const imageBytes = await fs.promises.readFile(destination);
          const validImage = extension === 'jpg'
            ? imageBytes[0] === 0xff && imageBytes[1] === 0xd8 && imageBytes[2] === 0xff
            : extension === 'png'
              ? imageBytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
              : imageBytes.subarray(0, 4).toString() === 'RIFF' && imageBytes.subarray(8, 12).toString() === 'WEBP';
          if (!validImage) throw new Error('El contenido no coincide con una imagen JPG, PNG o WebP válida.');
        } else {
          const contents = await fs.promises.readFile(destination, 'utf8');
          if (!/^\uFEFF?WEBVTT(?:[ \t].*)?(?:\r?\n|$)/.test(contents)) throw new Error('El archivo no contiene un encabezado WebVTT válido.');
          language = String(req.headers['x-subtitle-language'] || 'es').trim();
          if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language)) throw new Error('El idioma de los subtítulos no es válido.');
        }
        const previous = assetType === 'thumbnail' ? video.thumbnailFilename : video.subtitleFilename;
        if (assetType === 'thumbnail') video.thumbnailFilename = filename;
        else {
          video.subtitleFilename = filename;
          video.subtitleLanguage = language;
        }
        saveState();
        metadataSaved = true;
        if (previous) fs.rmSync(path.join(vodDir, path.basename(previous)), { force: true });
        return json(res, 200, { video: listRecordings().find(item => item.id === video.id) });
      } catch (error) {
        if (metadataSaved) {
          console.error('No se pudo limpiar el archivo complementario anterior:', error);
          return json(res, 500, { error: 'El archivo se guardó, pero no se pudo limpiar la versión anterior.' });
        }
        video.thumbnailFilename = previousThumbnail;
        video.subtitleFilename = previousSubtitle;
        video.subtitleLanguage = previousLanguage;
        fs.rmSync(destination, { force: true });
        return json(res, error.message.includes('límite') ? 413 : 400, { error: error.message || 'No se pudo guardar el archivo complementario.' });
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/video-broadcast') {
      if (currentAdminProfessional(req)?.role !== 'admin') return json(res, 403, { error: 'Se requiere una cuenta administradora.' });
      const body = await readBody(req).catch(() => null);
      if (body?.action === 'stop') {
        if (!videoBroadcastIsActive()) return json(res, 409, { error: 'No hay una transmisión de video activa o en cuenta regresiva.' });
        stopVideoBroadcast();
        return json(res, 200, { broadcast: publicVideoBroadcast() });
      }
      if (body?.action !== 'start') return json(res, 400, { error: 'Acción de transmisión no válida.' });
      if (videoBroadcastIsActive()) return json(res, 409, { error: 'Ya hay una transmisión de video activa o en cuenta regresiva.' });
      const video = listRecordings().find(item => item.id === String(body.videoId || ''));
      if (!video) return json(res, 404, { error: 'Selecciona un video disponible en la biblioteca.' });
      const delaySeconds = Number(body.delaySeconds);
      if (!Number.isInteger(delaySeconds) || delaySeconds < 0 || delaySeconds > 600) return json(res, 400, { error: 'El tiempo de previa debe estar entre 0 y 600 segundos.' });
      videoBroadcast = {
        id: crypto.randomUUID(),
        videoId: video.id,
        title: video.title,
        status: 'programada',
        delaySeconds,
        startAt: new Date(Date.now() + delaySeconds * 1000).toISOString(),
        startedAt: null,
        endedAt: null,
        error: '',
        jobs: [],
        timer: null
      };
      const broadcast = videoBroadcast;
      if (delaySeconds) broadcast.timer = setTimeout(() => startVideoBroadcast(broadcast), delaySeconds * 1000);
      else setImmediate(() => startVideoBroadcast(broadcast));
      return json(res, 202, { broadcast: publicVideoBroadcast() });
    }
    if (req.method === 'GET' && url.pathname === '/api/auth/me') {
      return json(res, 200, { professional: safeProfessional(currentProfessional(req)), hasProfessionals: state.professionals.length > 0 });
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/register') {
      const body = await readBody(req).catch(() => null);
      const name = String(body?.name || '').trim().replace(/\s+/g, ' ');
      const profession = 'Profesional';
      const email = String(body?.email || '').trim().toLowerCase();
      const password = String(body?.password || '');
      if (name.length < 2 || name.length > 80 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || password.length < 10 || password.length > 128) {
        return json(res, 400, { error: 'Revisa nombre, correo y contraseña (10 a 128 caracteres).' });
      }
      if (state.professionals.some(user => user.email === email)) return json(res, 409, { error: 'Ya existe una cuenta con ese correo.' });
      const salt = crypto.randomBytes(16).toString('hex');
      const passwordHash = (await scryptPassword(password, salt)).toString('hex');
      const user = { id: crypto.randomUUID(), name, profession, role: 'professional', email, passwordSalt: salt, passwordHash, createdAt: new Date().toISOString() };
      state.professionals.push(user);
      setProfessionalSession(req, res, user);
      return json(res, 201, { professional: safeProfessional(user), hasProfessionals: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      const body = await readBody(req).catch(() => null);
      const email = String(body?.email || '').trim().toLowerCase();
      const password = String(body?.password || '');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 1 || password.length > 128) return json(res, 400, { error: 'Escribe un correo y una contraseña válidos.' });
      const attemptKey = `${req.socket.remoteAddress || 'local'}:${email}`;
      let attempts = authAttempts.get(attemptKey) || { count: 0, resetAt: Date.now() + 15 * 60_000 };
      if (attempts.resetAt <= Date.now()) attempts = { count: 0, resetAt: Date.now() + 15 * 60_000 };
      if (attempts.count >= 6) return json(res, 429, { error: 'Demasiados intentos. Espera 15 minutos antes de volver a probar.' });
      const user = state.professionals.find(profile => profile.email === email);
      const salt = user?.passwordSalt || crypto.createHash('sha256').update(`ineter-login:${email}`).digest('hex').slice(0, 32);
      const candidate = await scryptPassword(password, salt);
      const expected = user ? Buffer.from(user.passwordHash, 'hex') : Buffer.alloc(candidate.length);
      const matches = expected.length === candidate.length && crypto.timingSafeEqual(expected, candidate);
      if (!user || !matches) {
        attempts.count += 1; authAttempts.set(attemptKey, attempts);
        return json(res, 401, { error: 'Correo o contraseña incorrectos.' });
      }
      authAttempts.delete(attemptKey);
      setProfessionalSession(req, res, user);
      return json(res, 200, { professional: safeProfessional(user), hasProfessionals: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
      clearProfessionalSession(req, res);
      return json(res, 200, { professional: null, hasProfessionals: state.professionals.length > 0 });
    }
    if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, publicState());
    if (req.method === 'GET' && url.pathname === '/api/stream/stats') {
      return json(res, 200, streamStatsSnapshot());
    }
    if (req.method === 'POST' && url.pathname === '/api/stream/reactions') {
      if (!live) return json(res, 409, { error: 'Las reacciones solo están disponibles durante una transmisión en vivo.' });
      const user = currentProfessional(req);
      if (!user) return json(res, 401, { error: 'Inicia sesión para enviar una reacción.' });
      const body = await readBody(req).catch(() => null);
      const emoji = String(body?.emoji || '');
      if (!['👏', '❤️', '😮', '👍'].includes(emoji)) return json(res, 400, { error: 'La reacción seleccionada no está permitida.' });
      const now = Date.now();
      const lastReactionAt = reactionTimes.get(user.id) || 0;
      if (now - lastReactionAt < 800) return json(res, 429, { error: 'Espera un momento antes de enviar otra reacción.' });
      reactionTimes.set(user.id, now);
      if (reactionTimes.size > 10_000) {
        for (const [userId, createdAt] of reactionTimes) if (now - createdAt > 60_000) reactionTimes.delete(userId);
      }
      broadcastStreamEvent('reaction', { emoji, createdAt: new Date(now).toISOString() });
      return json(res, 202, { accepted: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/stream/like') {
      if (!live) return json(res, 409, { error: 'La transmisión no está en vivo.' });
      const user = currentProfessional(req);
      const cookies = parseCookies(req);
      let identifier = cookies.ineter_like_id;
      if (!identifier) {
        identifier = crypto.randomUUID();
        const secure = requestUsesHttps(req) ? '; Secure' : '';
        res.setHeader('set-cookie', `ineter_like_id=${encodeURIComponent(identifier)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secure}`);
      }
      const currentSessionId = activeSession?.id || null;
      const sessionKey = currentSessionId ? `session:${currentSessionId}` : 'global';
      const key = user?.id ? `u:${user.id}:${sessionKey}` : `a:${identifier}:${sessionKey}`;
      if (!state.likes || typeof state.likes !== 'object') state.likes = {};
      if (!Array.isArray(state.likesLog)) state.likesLog = [];
      if (state.likesLog.some(item => item.key === key)) {
        return json(res, 200, { liked: true, already: true, likes: Number(state.likes[sessionKey] || 0), sessionId: currentSessionId });
      }
      state.likes[sessionKey] = Number(state.likes[sessionKey] || 0) + 1;
      state.likesLog.push({ key, sessionKey, userId: user?.id || null, createdAt: new Date().toISOString() });
      if (state.likesLog.length > 10000) state.likesLog = state.likesLog.slice(-10000);
      saveState();
      broadcastStreamEvent('stats', streamStatsSnapshot());
      return json(res, 201, { liked: true, likes: state.likes[sessionKey], sessionId: currentSessionId });
    }
    if (req.method === 'GET' && url.pathname === '/api/obs/production') {
      if (!state.obs?.secret) return json(res, 409, { error: 'Conecta OBS para consultar los ajustes de video y escenas.' });
      try {
        const [videoSettings, sceneList, currentScene, recordingStatus] = await Promise.all([
          obsRequest('GetVideoSettings'),
          obsRequest('GetSceneList'),
          obsRequest('GetCurrentProgramScene'),
          obsRequest('GetRecordStatus')
        ]);
        return json(res, 200, {
          videoSettings: {
            baseWidth: Number(videoSettings.baseWidth),
            baseHeight: Number(videoSettings.baseHeight),
            outputWidth: Number(videoSettings.outputWidth),
            outputHeight: Number(videoSettings.outputHeight),
            fpsNumerator: Number(videoSettings.fpsNumerator),
            fpsDenominator: Number(videoSettings.fpsDenominator)
          },
          scenes: (sceneList.scenes || []).map(scene => ({ sceneName: String(scene.sceneName || '') })).filter(scene => scene.sceneName),
          currentScene: String(currentScene.currentProgramSceneName || ''),
          recording: !!recordingStatus.outputActive
        });
      } catch (error) { return json(res, 502, { error: `No se pudieron consultar los ajustes de OBS: ${error.message}` }); }
    }
    if (req.method === 'PUT' && url.pathname === '/api/obs/video-settings') {
      if (!state.obs?.secret) return json(res, 409, { error: 'Conecta OBS antes de cambiar el formato de video.' });
      const body = await readBody(req).catch(() => null);
      const profile = Object.hasOwn(obsVideoProfiles, body?.profile) ? obsVideoProfiles[body.profile] : null;
      const fps = Number(body?.fps);
      if (!profile || ![24, 25, 30, 50, 60].includes(fps)) return json(res, 400, { error: 'Selecciona un formato y una frecuencia de cuadros válidos.' });
      try {
        const streamStatus = await obsRequest('GetStreamStatus');
        const recordingStatus = await obsRequest('GetRecordStatus');
        obsStreaming = !!streamStatus.outputActive;
        if (obsStreaming || recordingStatus.outputActive || live) return json(res, 409, { error: 'Detén la transmisión y la grabación antes de cambiar resolución o FPS.' });
        await obsRequest('SetVideoSettings', { ...profile, fpsNumerator: fps, fpsDenominator: 1 });
        const [videoSettings, sceneList, currentScene, currentRecordingStatus] = await Promise.all([
          obsRequest('GetVideoSettings'),
          obsRequest('GetSceneList'),
          obsRequest('GetCurrentProgramScene'),
          obsRequest('GetRecordStatus')
        ]);
        return json(res, 200, {
          videoSettings: {
            baseWidth: Number(videoSettings.baseWidth),
            baseHeight: Number(videoSettings.baseHeight),
            outputWidth: Number(videoSettings.outputWidth),
            outputHeight: Number(videoSettings.outputHeight),
            fpsNumerator: Number(videoSettings.fpsNumerator),
            fpsDenominator: Number(videoSettings.fpsDenominator)
          },
          scenes: (sceneList.scenes || []).map(scene => ({ sceneName: String(scene.sceneName || '') })).filter(scene => scene.sceneName),
          currentScene: String(currentScene.currentProgramSceneName || ''),
          recording: !!currentRecordingStatus.outputActive
        });
      } catch (error) { return json(res, 502, { error: `OBS no pudo aplicar el formato: ${error.message}` }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/obs/scene') {
      if (!state.obs?.secret) return json(res, 409, { error: 'Conecta OBS antes de cambiar de escena.' });
      const body = await readBody(req).catch(() => null);
      const sceneName = String(body?.sceneName || '').trim();
      if (!sceneName || sceneName.length > 100) return json(res, 400, { error: 'Selecciona una escena de OBS válida.' });
      try {
        const sceneList = await obsRequest('GetSceneList');
        if (!(sceneList.scenes || []).some(scene => scene.sceneName === sceneName)) return json(res, 404, { error: 'La escena seleccionada ya no existe en OBS. Actualiza la lista.' });
        await obsRequest('SetCurrentProgramScene', { sceneName });
        return json(res, 200, { currentScene: sceneName });
      } catch (error) { return json(res, 502, { error: `OBS no pudo cambiar la escena: ${error.message}` }); }
    }
    if (req.method === 'GET' && url.pathname === '/api/obs/preview') {
      if (!state.obs?.secret) return json(res, 409, { error: 'Conecta OBS para ver la vista previa.' });
      try {
        const scene = await obsRequest('GetCurrentProgramScene');
        const screenshot = await obsRequest('GetSourceScreenshot', { sourceName: scene.sceneName, imageFormat: 'jpeg', imageWidth: 960, imageHeight: 540, imageCompressionQuality: 65 });
        return json(res, 200, { sceneName: scene.sceneName, imageData: screenshot.imageData });
      } catch (error) { return json(res, 502, { error: error.message }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/obs/connect') {
      const body = await readBody(req).catch(() => null);
      const host = String(body?.host || 'host.docker.internal').trim();
      const port = Number(body?.port || 4455);
      if (!/^[a-zA-Z0-9.\-]+$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) return json(res, 400, { error: 'Host o puerto de OBS no válido.' });
      const previousObs = state.obs;
      const submittedPassword = typeof body?.password === 'string' ? body.password : '';
      const secret = submittedPassword.length
        ? encrypt(submittedPassword)
        : previousObs?.secret || encrypt('');
      const oldSocket = obsSocket;
      obsConnected = false; obsStreaming = false; obsConnectPromise = null; obsPending.forEach(item => { clearTimeout(item.timeout); item.reject(new Error('Configuración de OBS actualizada.')); }); obsPending.clear();
      try { oldSocket?.close(); } catch {}
      obsSocket = null;
      state.obs = { host, port, secret };
      try {
        await connectObs();
        const current = await obsRequest('GetStreamStatus');
        obsStreaming = !!current.outputActive;
        if (!obsStreaming) await configureObsStream();
        else obsError = 'OBS está transmitiendo; detén la emisión para aplicar el destino RTMP de En Vivo.';
        saveState();
        return json(res, 200, publicState());
      } catch (error) {
        const failedSocket = obsSocket;
        obsSocket = null;
        obsConnected = false;
        obsStreaming = false;
        obsConnectPromise = null;
        try { failedSocket?.close(); } catch {}
        state.obs = previousObs;
        obsError = error.message;
        return json(res, 502, { ...publicState(), error: obsError });
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/obs/stream') {
      const body = await readBody(req).catch(() => null);
      if (!['start', 'stop'].includes(body?.action)) return json(res, 400, { error: 'Acción no válida.' });
      try {
        if (!state.obs?.secret) throw new Error('Conecta OBS primero desde el panel.');
        if (body.action === 'start') {
          if (videoBroadcastIsActive()) throw new Error('Hay una transmisión de video activa o en cuenta regresiva. Deténla antes de iniciar OBS.');
          const invalidDestination = state.destinations.find(destination => {
            try { return !validRtmp(destination.serverUrl) || !decrypt(destination.secret).trim(); }
            catch { return true; }
          });
          if (invalidDestination) throw new Error(`Revisa la URL RTMP y la clave cifrada de ${invalidDestination.name} antes de iniciar.`);
        }
        const status = await obsRequest('GetStreamStatus');
        obsStreaming = !!status.outputActive;
        if (body.action === 'start' && !obsStreaming) {
          await obsRequest('StartStream');
          const deadline = Date.now() + 4000;
          do {
            await new Promise(resolve => setTimeout(resolve, 300));
            obsStreaming = !!(await obsRequest('GetStreamStatus')).outputActive;
          } while (!obsStreaming && Date.now() < deadline);
          if (!obsStreaming) throw new Error('OBS recibió la orden, pero no confirmó que esté transmitiendo. Revisa OBS y vuelve a intentar.');
          await scanStream();
        }
        if (body.action === 'stop' && obsStreaming) {
          await obsRequest('StopStream');
          obsStreaming = false;
        }
        return json(res, 200, publicState());
      } catch (error) { obsError = error.message; return json(res, 502, { ...publicState(), error: obsError }); }
    }
    if (req.method === 'PUT' && url.pathname === '/api/studio') {
      const body = await readBody(req).catch(() => null);
      if (!body || !['OBS', 'StreamYard'].includes(body.studio)) return json(res, 400, { error: 'Estudio no válido.' });
      state.studio = body.studio; saveState(); return json(res, 200, publicState());
    }
    if (req.method === 'POST' && url.pathname === '/api/destinations') {
      const body = await readBody(req).catch(() => null);
      if (!body || !String(body.name || '').trim() || !validRtmp(body.serverUrl) || !String(body.key || '').trim()) return json(res, 400, { error: 'Completa nombre, URL RTMP y clave de transmisión válida.' });
      const destination = { id: crypto.randomUUID(), platform: String(body.platform || 'RTMP').slice(0, 30), name: String(body.name).trim().slice(0, 60), serverUrl: body.serverUrl.trim(), secret: encrypt(body.key.trim()) };
      state.destinations.push(destination); saveState(); return json(res, 201, publicState());
    }
    const deleteMatch = url.pathname.match(/^\/api\/destinations\/([\w-]+)$/);
    if (req.method === 'DELETE' && deleteMatch) {
      state.destinations = state.destinations.filter(d => d.id !== deleteMatch[1]); saveState(); return json(res, 200, publicState());
    }
    if (req.method === 'GET' && url.pathname === '/api/recordings') {
      const category = url.searchParams.get('category') || 'all';
      if (category !== 'all' && !Object.hasOwn(videoCategoryLabels, category)) return json(res, 400, { error: 'La categoría de video no es válida.' });
      const recordings = listRecordings();
      return json(res, 200, { recordings: category === 'all' ? recordings : recordings.filter(recording => recording.category === category), total: recordings.length });
    }
    if (req.method === 'POST' && url.pathname === '/api/schedules') {
      const body = await readBody(req).catch(() => null);
      const title = String(body?.title || '').trim().slice(0, 80);
      const startTime = Date.parse(body?.startsAt);
      const duration = body?.durationMinutes === '' || body?.durationMinutes == null ? null : Number(body.durationMinutes);
      if (!title || !Number.isFinite(startTime) || startTime < Date.now() + 10_000 || (duration !== null && (!Number.isInteger(duration) || duration < 1 || duration > 720))) {
        return json(res, 400, { error: 'Indica un nombre, una fecha futura y una duración entre 1 y 720 minutos (o déjala vacía).' });
      }
      const schedule = { id: crypto.randomUUID(), title, startsAt: new Date(startTime).toISOString(), durationMinutes: duration, destinations: state.destinations.map(d => d.name), status: 'programada', createdAt: new Date().toISOString() };
      state.schedules.push(schedule); saveState(); return json(res, 201, publicState());
    }
    const scheduleMatch = url.pathname.match(/^\/api\/schedules\/([\w-]+)$/);
    if (req.method === 'DELETE' && scheduleMatch) {
      const schedule = state.schedules.find(item => item.id === scheduleMatch[1]);
      if (!schedule) return json(res, 404, { error: 'Programación no encontrada.' });
      if (schedule.status !== 'programada') return json(res, 409, { error: 'Solo se pueden cancelar transmisiones que aún están programadas.' });
      state.schedules = state.schedules.filter(item => item.id !== schedule.id); saveState(); return json(res, 200, publicState());
    }
    return json(res, 404, { error: 'Ruta no encontrada.' });
  }
  if (url.pathname.startsWith('/recordings/')) {
    if (!currentProfessional(req)) { res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('Inicia sesión para ver las grabaciones.'); }
    let relative;
    try { relative = decodeURIComponent(url.pathname.slice('/recordings/'.length)).replace(/[\\/]+/g, path.sep); } catch { res.writeHead(400); return res.end('Ruta no válida'); }
    const file = path.resolve(recordingsDir, relative);
    const extension = path.extname(file).toLowerCase();
    if (!file.startsWith(recordingsDir + path.sep) || !['.mp4', '.vtt', '.jpg', '.jpeg', '.png', '.webp'].includes(extension) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('No encontrado'); }
    const name = path.basename(file);
    const size = fs.statSync(file).size;
    if (extension !== '.mp4') {
      res.writeHead(200, {
        'content-type': mime[extension] || 'application/octet-stream',
        'content-length': size,
        'cache-control': 'private, max-age=300',
        'x-content-type-options': 'nosniff'
      });
      return fs.createReadStream(file).pipe(res);
    }
    const range = req.headers.range;
    res.setHeader('content-type', 'video/mp4');
    res.setHeader('accept-ranges', 'bytes');
    res.setHeader('content-disposition', `inline; filename="${name}"`);
    if (range) {
      const match = range.match(/^bytes=(\d*)-(\d*)$/);
      if (!match) { res.writeHead(416, { 'content-range': `bytes */${size}` }); return res.end(); }
      const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
      const end = match[2] && match[1] ? Math.min(Number(match[2]), size - 1) : size - 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) { res.writeHead(416, { 'content-range': `bytes */${size}` }); return res.end(); }
      res.writeHead(206, { 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'content-length': size });
    return fs.createReadStream(file).pipe(res);
  }
  let requestPath;
  try { requestPath = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname); }
  catch { res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('Ruta no válida'); }
  const filePath = path.resolve(root, `.${requestPath}`);
  if (!filePath.startsWith(root + path.sep) && filePath !== path.join(root, 'index.html')) { res.writeHead(403); return res.end('Forbidden'); }
  const relativeStaticPath = path.relative(root, filePath).split(path.sep).join('/');
  const publicStaticFiles = new Set([
    'index.html', 'monitor.html', 'admin.html', 'styles.css', 'backend.css', 'monitoring.css', 'monitor-dashboard.css', 'monitor-dashboard.js', 'admin-dashboard.css', 'admin-monitor.css', 'admin-dashboard.js', 'app.js',
    'home-climate.js', 'national-climate.js', 'firebase-client.js', 'firebase-messaging-sw.js',
    'assets/ineter-logo.png', 'assets/ineter-logo.svg', 'assets/hls/hls.min.js', 'streaming-controls.css', 'admin-theme.css'
  ]);
  if (!publicStaticFiles.has(relativeStaticPath)) { res.writeHead(404); return res.end('No encontrado'); }
  fs.readFile(filePath, (error, content) => {
    if (error) { res.writeHead(404); return res.end('No encontrado'); }
    res.writeHead(200, { 'content-type': mime[path.extname(filePath)] || 'application/octet-stream', 'cache-control': 'no-cache' }); res.end(content);
  });
}
const port = Number(process.env.PORT || 3000);
const adminPort = Number(process.env.ADMIN_PORT || 3012);
const bindAddress = process.env.BIND_ADDRESS || '127.0.0.1';
server.listen(port, bindAddress, () => console.log(`Aplicación INETER escuchando en ${port}`));
if (adminPort !== port) adminServer.listen(adminPort, bindAddress, () => console.log(`Dashboard administrativo escuchando en ${adminPort}`));
process.on('SIGTERM', () => {
  closeStreamEventClients();
  stopVideoBroadcast();
  stopRelay();
  const servers = adminPort === port ? [server] : [server, adminServer];
  let remaining = servers.length;
  for (const listener of servers) listener.close(() => { if (--remaining === 0) process.exit(0); });
});
