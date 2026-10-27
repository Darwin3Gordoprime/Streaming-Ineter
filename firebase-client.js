const FIREBASE_SDK_VERSION = '13.0.0';
const firebaseConfig = {
  apiKey: 'AIzaSyBfU9WnRJ4qhK1-XFJMUmHQfhekCv1lA0s',
  authDomain: 'ineter-streaming.firebaseapp.com',
  projectId: 'ineter-streaming',
  storageBucket: 'ineter-streaming.firebasestorage.app',
  messagingSenderId: '730781702967',
  appId: '1:730781702967:web:b3f26527a9aeb18c7858b2',
  measurementId: 'G-NDF526PBM8'
};
const statusEl = document.getElementById('firebase-alert-status');
const pushButton = document.getElementById('enable-push');
const pushStateEl = document.getElementById('push-state');
const gateForm = document.getElementById('firebase-auth-gate-form');
const gateError = document.getElementById('firebase-auth-gate-error');
const gateSubmit = document.getElementById('firebase-auth-gate-submit');
const gateNameField = document.getElementById('gate-name-field');
const gateName = document.getElementById('firebase-auth-gate-name');
const gateEmail = document.getElementById('firebase-auth-gate-email');
const gatePassword = document.getElementById('firebase-auth-gate-password');
const gateToggle = document.getElementById('firebase-auth-gate-toggle');
const gateSwitch = document.getElementById('firebase-auth-gate-switch');
const gateReset = document.getElementById('firebase-auth-gate-reset');
const gateVerify = document.getElementById('firebase-auth-gate-verify');
const gateResend = document.getElementById('firebase-auth-gate-resend');
const gateAdminAccess = document.getElementById('gate-admin-access');
const gateAccessHint = document.getElementById('gate-access-hint');
const monitorLoginMode = new URLSearchParams(location.search).get('access') === 'monitor';
const adminPortalLoginMode = new URLSearchParams(location.search).get('next') === '/admin.html';
const monitorReturnPath = '/monitor.html';
let gateMode = 'login';
let selectedAccessRole = 'user';
let requestedLoginRole = null;
let authApi = null;
let firebaseAuth = null;
let lastSessionUid = null;
let lastSessionData = null;
let sessionExchangeInFlight = null;
let backendLogoutInFlight = null;
let explicitLogoutInProgress = false;
let verificationNeededUser = null;
const pendingNames = new Map();
let messaging = null;
let messagingApi = null;
let pushSetup = null;
let pushSupported = false;
let pushBusy = false;

function showGateError(message = '') {
  if (!gateError) return;
  gateError.classList.remove('success');
  gateError.textContent = message;
  gateError.hidden = !message;
}

function setGateMode(mode) {
  gateMode = mode;
  const registering = mode === 'register';
  gateNameField.hidden = !registering;
  gateName.required = registering;
  gatePassword.autocomplete = registering ? 'new-password' : 'current-password';
  gateReset.hidden = registering;
  document.getElementById('firebase-auth-gate-title').textContent = registering ? 'Crear cuenta de usuario' : monitorLoginMode ? 'Acceso al monitoreo' : 'INETER en vivo';
  document.getElementById('firebase-auth-gate-desc').textContent = registering
    ? 'Crea una cuenta segura para acceder a la plataforma institucional.'
    : monitorLoginMode ? 'Acceso restringido al dashboard técnico de monitoreo.' : 'Inicia sesión para entrar a los servicios de INETER.';
  gateSubmit.textContent = registering ? 'Crear cuenta y entrar' : 'Iniciar sesión';
  gateToggle.textContent = registering ? 'Ya tengo una cuenta' : 'Crear cuenta de usuario';
  gateToggle.hidden = monitorLoginMode || selectedAccessRole === 'admin';
  showGateError();
}

function setGateAccessRole(role) {
  selectedAccessRole = role === 'admin' ? 'admin' : 'user';
  gateAdminAccess?.setAttribute('aria-pressed', String(selectedAccessRole === 'admin'));
  if (gateAdminAccess) gateAdminAccess.textContent = selectedAccessRole === 'admin' ? 'Volver al acceso de usuario' : 'Acceso de administración';
  if (selectedAccessRole === 'admin' && gateMode === 'register') setGateMode('login');
  if (gateAccessHint) gateAccessHint.textContent = selectedAccessRole === 'admin'
    ? 'Acceso restringido: usa la cuenta administradora autorizada.'
    : 'Inicia sesión o crea una cuenta de usuario.';
  gateToggle.hidden = selectedAccessRole === 'admin';
  showGateError();
}

function withTimeout(promise, milliseconds, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })
  ]).finally(() => clearTimeout(timer));
}

function clearBackendSession() {
  if (backendLogoutInFlight) return backendLogoutInFlight;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  backendLogoutInFlight = fetch('/api/auth/logout', {
    method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
    body: '{}', signal: controller.signal
  }).catch(() => {}).finally(() => {
    clearTimeout(timeout);
    backendLogoutInFlight = null;
  });
  return backendLogoutInFlight;
}

async function exchangeFirebaseSession(user, name = '') {
  if (lastSessionUid === user.uid && lastSessionData) return lastSessionData;
  if (location.protocol === 'file:') throw new Error('Abre la plataforma desde http://localhost:3000; el archivo local no puede conectarse al backend.');
  if (sessionExchangeInFlight?.uid === user.uid) return sessionExchangeInFlight.promise;

  const promise = (async () => {
    const idToken = await withTimeout(user.getIdToken(true), 15000, 'Firebase tardó demasiado en validar tu sesión. Revisa Internet e inténtalo otra vez.');
    if (gateSubmit && document.body.classList.contains('auth-required')) gateSubmit.textContent = 'Conectando con INETER…';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let response;
    try {
      response = await fetch('/api/auth/firebase/session', {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idToken, name: name || pendingNames.get(user.uid) || user.displayName || '' }),
        signal: controller.signal
      });
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('El servidor no respondió en 15 segundos. Confirma que En Vivo esté iniciado y vuelve a intentarlo.');
      throw new Error('No se pudo conectar con el servidor de En Vivo. Abre la dirección localhost y revisa que el backend esté iniciado.');
    } finally { clearTimeout(timeout); }
    const result = await withTimeout(response.json().catch(() => ({})), 5000, 'El servidor respondió, pero no terminó de validar la sesión. Recarga la página e inténtalo otra vez.');
    if (!response.ok) {
      if (response.status === 403 && String(result.error || '').includes('Verifica tu correo') && !user.emailVerified) {
        verificationNeededUser = user;
        gateVerify.hidden = false;
        gateResend.hidden = false;
        try {
          await withTimeout(authApi.sendEmailVerification(user), 10000, 'No se pudo confirmar el envío del correo. Pulsa “Reenviar correo de verificación”.');
          throw new Error(`Firebase requiere verificar ${user.email} para vincular esta cuenta. Revisa tu correo y spam; luego pulsa “Ya verifiqué mi correo”.`);
        } catch (verificationError) {
          if (verificationError.message.startsWith('Firebase requiere verificar')) throw verificationError;
          throw new Error(firebaseErrorMessage(verificationError));
        }
      }
      throw new Error(result.error || `El servidor rechazó la sesión (${response.status}).`);
    }
    const actualRole = result.professional?.role || 'user';
    const hasAdminAccess = ['admin','monitor_admin'].includes(actualRole);
    const expectedAccessMismatch = monitorLoginMode
      ? !hasAdminAccess
      : requestedLoginRole === 'admin'
        ? !hasAdminAccess
        : requestedLoginRole === 'user' && actualRole === 'monitor_admin';
    if (expectedAccessMismatch) {
      requestedLoginRole = null;
      await clearBackendSession();
      await authApi.signOut(firebaseAuth).catch(() => {});
      throw new Error(hasAdminAccess
        ? 'Esta cuenta está autorizada para monitoreo. Entra desde el acceso restringido del dashboard.'
        : 'Esta cuenta no tiene autorización para el dashboard de monitoreo.');
    }
    if (firebaseAuth.currentUser?.uid !== user.uid) throw new Error('La cuenta cambió durante el inicio de sesión. Vuelve a ingresar con la cuenta que deseas usar.');
    lastSessionUid = user.uid;
    lastSessionData = result;
    pendingNames.delete(user.uid);
    document.body.classList.remove('auth-required');
    const gate = document.getElementById('firebase-auth-gate');
    if (gate) gate.setAttribute('aria-hidden', 'true');
    showGateError();
    document.dispatchEvent(new CustomEvent('firebase-auth-session-ready', { detail: result }));
    if (monitorLoginMode && hasAdminAccess) location.replace(monitorReturnPath);
    return result;
  })();
  sessionExchangeInFlight = { uid: user.uid, promise };
  try { return await promise; }
  finally { if (sessionExchangeInFlight?.promise === promise) sessionExchangeInFlight = null; }
}

function firebaseErrorMessage(error) {
  const known = {
    'auth/operation-not-allowed': 'Activa el proveedor Correo electrónico/Contraseña en Firebase Console → Authentication → Sign-in method.',
    'auth/invalid-credential': 'El correo o la contraseña no son correctos.',
    'auth/user-not-found': 'No existe una cuenta de Firebase con ese correo. Usa “Crear cuenta de usuario”.',
    'auth/email-already-in-use': 'Ese correo ya tiene cuenta en Firebase. Inicia sesión o restablece su contraseña.',
    'auth/weak-password': 'La contraseña debe tener al menos 10 caracteres.',
    'auth/invalid-email': 'Escribe un correo válido.',
    'auth/unauthorized-domain': `Firebase no autoriza el dominio ${location.hostname}. Agrégalo en Firebase Console → Authentication → Settings → Authorized domains.`,
    'auth/api-key-not-valid': 'La clave web de Firebase no es válida para esta app. Revisa FIREBASE_API_KEY y que coincida con el proyecto configurado.',
    'auth/project-not-found': 'Firebase no encuentra el proyecto configurado. Revisa FIREBASE_PROJECT_ID y la configuración de la app web.',
    'auth/invalid-login-credentials': 'Firebase no aceptó el correo y la contraseña. Verifica que la cuenta exista en el mismo proyecto Firebase de esta app.',
    'auth/user-disabled': 'Esta cuenta está deshabilitada en Firebase Authentication. Contacta a la persona administradora.',
    'auth/too-many-requests': 'Firebase bloqueó temporalmente los intentos desde esta cuenta o dispositivo. Deja de intentar por ahora y vuelve a probar más tarde; los intentos repetidos pueden prolongar el bloqueo.',
    'auth/network-request-failed': 'No se pudo conectar con Firebase. Revisa tu conexión a Internet.'
  };
  return known[error?.code] || error?.message || 'No se pudo iniciar sesión con Firebase.';
}

async function firebaseSignIn(email, password) {
  try {
    const credential = await withTimeout(authApi.signInWithEmailAndPassword(firebaseAuth, email, password), 20000, 'Firebase no respondió en 20 segundos. Revisa tu conexión a Internet e inténtalo otra vez.');
    return exchangeFirebaseSession(credential.user);
  } catch (error) { throw new Error(firebaseErrorMessage(error)); }
}

async function firebaseRegister(name, email, password) {
  try {
    const credential = await withTimeout(authApi.createUserWithEmailAndPassword(firebaseAuth, email, password), 20000, 'Firebase no respondió en 20 segundos. Revisa tu conexión a Internet e inténtalo otra vez.');
    pendingNames.set(credential.user.uid, name);
    await withTimeout(authApi.updateProfile(credential.user, { displayName: name }), 10000, 'Firebase tardó en guardar el nombre. La cuenta se creó; continúo con el acceso.').catch(() => {});
    return await exchangeFirebaseSession(credential.user, name);
  } catch (error) { throw new Error(firebaseErrorMessage(error)); }
}

async function firebaseSignOut() {
  explicitLogoutInProgress = true;
  const pendingExchange = sessionExchangeInFlight?.promise;
  try {
    await authApi.signOut(firebaseAuth);
    if (pendingExchange) await pendingExchange.catch(() => {});
    await clearBackendSession();
    lastSessionUid = null;
    lastSessionData = null;
    document.body.classList.add('auth-required');
    document.getElementById('firebase-auth-gate')?.setAttribute('aria-hidden', 'false');
    document.dispatchEvent(new CustomEvent('firebase-auth-session-cleared'));
  } finally { explicitLogoutInProgress = false; }
}

function configureAuthGate() {
  gateAdminAccess?.addEventListener('click', () => setGateAccessRole(selectedAccessRole === 'admin' ? 'user' : 'admin'));
  gateToggle?.addEventListener('click', () => setGateMode(gateMode === 'login' ? 'register' : 'login'));
  gateSwitch?.addEventListener('click', async () => {
    gateSwitch.disabled = true;
    try {
      await firebaseSignOut();
      gateForm.reset();
      setGateMode('login');
      gateEmail.focus();
    } catch (error) { showGateError(firebaseErrorMessage(error)); }
    finally { gateSwitch.disabled = false; }
  });
  gateResend?.addEventListener('click', async () => {
    const user = verificationNeededUser || firebaseAuth?.currentUser;
    if (!user) { showGateError('Inicia sesión con el correo que deseas verificar.'); return; }
    gateResend.disabled = true;
    try {
      await withTimeout(authApi.sendEmailVerification(user), 10000, 'Firebase no respondió al solicitar el correo. Inténtalo de nuevo.');
      showGateError(`Solicitamos otro enlace para ${user.email}. Revisa la bandeja de entrada y spam.`);
      gateError.classList.add('success');
    } catch (error) { showGateError(firebaseErrorMessage(error)); }
    finally { gateResend.disabled = false; }
  });
  gateVerify?.addEventListener('click', async () => {
    const user = verificationNeededUser || firebaseAuth?.currentUser;
    if (!user) { showGateError('Inicia sesión de nuevo después de verificar el correo.'); return; }
    gateVerify.disabled = true;
    try {
      await withTimeout(user.reload(), 10000, 'Firebase tardó en comprobar el correo. Inténtalo otra vez.');
      if (!user.emailVerified) throw new Error('Firebase aún no confirma el correo. Abre el enlace recibido y vuelve a pulsar aquí.');
      verificationNeededUser = null;
      gateVerify.hidden = true;
      gateResend.hidden = true;
      lastSessionUid = null;
      lastSessionData = null;
      const result = await exchangeFirebaseSession(user);
      document.dispatchEvent(new CustomEvent('firebase-auth-session-ready', { detail: result }));
      gateForm.reset();
    } catch (error) { showGateError(firebaseErrorMessage(error)); }
    finally { gateVerify.disabled = false; }
  });
  gateReset?.addEventListener('click', async () => {
    const email = gateEmail.value.trim();
    if (!email || !gateEmail.checkValidity()) {
      showGateError('Escribe primero el correo de la cuenta que quieres recuperar.');
      gateEmail.focus();
      return;
    }
    gateReset.disabled = true;
    try {
      await withTimeout(authApi.sendPasswordResetEmail(firebaseAuth, email), 10000, 'Firebase no respondió al solicitar el restablecimiento. Inténtalo de nuevo.');
      showGateError(`Enviamos un enlace para restablecer la contraseña a ${email}. Revisa también la carpeta de spam.`);
      gateError.classList.add('success');
    } catch (error) {
      showGateError(firebaseErrorMessage(error));
    } finally { gateReset.disabled = false; }
  });
  gateForm?.addEventListener('submit', async event => {
    event.preventDefault();
    showGateError();
    gateSubmit.disabled = true;
    gateSubmit.textContent = gateMode === 'register' ? 'Creando cuenta…' : 'Validando en Firebase…';
    try {
      const result = gateMode === 'register'
        ? (requestedLoginRole = 'user', await firebaseRegister(gateName.value.trim(), gateEmail.value.trim(), gatePassword.value))
        : (requestedLoginRole = selectedAccessRole, await firebaseSignIn(gateEmail.value.trim(), gatePassword.value));
      document.dispatchEvent(new CustomEvent('firebase-auth-session-ready', { detail: result }));
      gateForm.reset();
    } catch (error) {
      showGateError(firebaseErrorMessage(error));
    } finally {
      gateSubmit.disabled = false;
      if (document.body.classList.contains('auth-required')) gateSubmit.textContent = gateMode === 'register' ? 'Crear cuenta y entrar' : 'Iniciar sesión';
    }
  });
}

function renderPushState(state, label, buttonLabel, { disabled = false, detail = '' } = {}) {
  if (pushStateEl) {
    pushStateEl.className = `push-indicator ${state}`;
    pushStateEl.textContent = label;
    pushStateEl.title = detail || label;
  }
  if (pushButton) {
    pushButton.textContent = buttonLabel;
    pushButton.disabled = disabled || pushBusy;
    pushButton.dataset.state = state;
    pushButton.setAttribute('aria-pressed', String(state === 'active'));
  }
}

async function getPushRegistrationStatus() {
  const response = await fetch('/api/firebase/push-token/status', { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) throw new Error(`No se pudo consultar el estado (${response.status}).`);
  return response.json();
}

async function refreshPushStatus() {
  if (!pushButton || !pushSetup) return;
  try {
    const registration = await getPushRegistrationStatus();
    if (!pushSupported) return;
    if (Notification.permission === 'denied') {
      renderPushState('blocked', 'Bloqueadas en el navegador', 'Permiso bloqueado', {
        disabled: true,
        detail: 'Cambia el permiso de notificaciones de este sitio desde la configuración del navegador.'
      });
      return;
    }
    if (registration.registered && Notification.permission === 'granted') {
      renderPushState('active', 'Notificaciones activas', 'Desactivar notificaciones');
      return;
    }
    if (!registration.authenticated) {
      renderPushState('inactive', 'Desactivadas · inicia sesión', 'Iniciar sesión para activar');
      return;
    }
    if (Notification.permission === 'granted') {
      renderPushState('inactive', 'Permiso concedido · falta registrar', 'Completar activación');
      return;
    }
    renderPushState('inactive', 'Notificaciones desactivadas', 'Activar notificaciones');
  } catch (error) {
    renderPushState('error', 'No se pudo consultar el estado', 'Reintentar estado', { detail: error.message });
  }
}

async function handlePushButton() {
  if (pushBusy) return;
  pushBusy = true;
  pushButton.disabled = true;
  try {
    const registrationStatus = await getPushRegistrationStatus();
    if (!registrationStatus.authenticated) {
      renderPushState('inactive', 'Inicia sesión para activar', 'Iniciar sesión para activar');
      document.getElementById('auth-trigger')?.click();
      return;
    }
    if (registrationStatus.registered && Notification.permission === 'granted') {
      await messagingApi.deleteToken(messaging);
      const response = await fetch('/api/firebase/push-token', {
        method: 'DELETE', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}'
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Error ${response.status}`);
      renderPushState('inactive', 'Notificaciones desactivadas', 'Activar notificaciones');
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      if (permission === 'denied') {
        renderPushState('blocked', 'Bloqueadas en el navegador', 'Permiso bloqueado', {
          disabled: true,
          detail: 'Cambia el permiso de notificaciones de este sitio desde la configuración del navegador.'
        });
      } else {
        renderPushState('inactive', 'Notificaciones desactivadas', 'Activar notificaciones');
      }
      return;
    }
    const serviceWorker = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    const token = await messagingApi.getToken(messaging, { vapidKey: pushSetup.vapidKey, serviceWorkerRegistration: serviceWorker });
    if (!token) throw new Error('Firebase no devolvió un token para este dispositivo.');
    const response = await fetch('/api/firebase/push-token', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Error ${response.status}`);
    renderPushState('active', 'Notificaciones activas', 'Desactivar notificaciones');
  } catch (error) {
    renderPushState('error', 'No se pudieron activar', 'Reintentar activación', { detail: error.message });
    if (statusEl) statusEl.textContent = error.message || 'No se pudo cambiar el estado de las notificaciones.';
  } finally {
    pushBusy = false;
    if (pushButton) pushButton.disabled = pushButton.dataset.state === 'blocked';
  }
}

async function startFirebase() {
  if (location.protocol === 'file:') {
    const message = 'Estás abriendo el archivo directamente. Inicia el backend y entra por http://localhost:3000 para que Firebase pueda iniciar sesión.';
    showGateError(message);
    if (gateSubmit) { gateSubmit.disabled = true; gateSubmit.textContent = 'Abre la plataforma desde localhost'; }
    if (gateToggle) gateToggle.disabled = true;
    return;
  }
  try {
    const response = await withTimeout(fetch('/api/firebase/config', { cache: 'no-store' }), 8000, 'El servidor de En Vivo no respondió. Inícialo y recarga la página.');
    if (!response.ok) throw new Error(`No se pudo cargar la configuración (${response.status}).`);
    const setup = await response.json();
    const { status, vapidKey } = setup;
    pushSetup = { status, vapidKey };
    const config = setup.config || firebaseConfig;
    if (!config.apiKey || !config.authDomain || !config.projectId || !config.appId) {
      if (statusEl) statusEl.textContent = 'Firebase pendiente de configuración: completa FIREBASE_* en .env.';
      renderPushState('error', 'Push sin configurar', 'No disponible', { disabled: true });
      return;
    }

    const sdk = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;
    const [{ initializeApp }, firebaseAuthSdk, { getFirestore, collection, limit, onSnapshot, orderBy, query }] = await Promise.all([
      import(`${sdk}/firebase-app.js`), import(`${sdk}/firebase-auth.js`), import(`${sdk}/firebase-firestore.js`)
    ]);
    const app = initializeApp(config, 'ineter-platform');
    authApi = firebaseAuthSdk;
    firebaseAuth = authApi.getAuth(app);
    window.ineterFirebaseAuth = { signIn: firebaseSignIn, register: firebaseRegister, signOut: firebaseSignOut };
    configureAuthGate();
    setGateAccessRole(monitorLoginMode ? 'admin' : 'user');
    gateAdminAccess.hidden = true;
    gateAccessHint.hidden = !(monitorLoginMode || adminPortalLoginMode);
    if (monitorLoginMode) gateAccessHint.textContent = 'Acceso privado. Solo las cuentas autorizadas pueden abrir el dashboard.';
    else if (adminPortalLoginMode) gateAccessHint.textContent = 'Accede con la misma cuenta Firebase de la plataforma. El servidor comprobará tu rol administrativo.';
    gateSubmit.disabled = false;
    gateToggle.disabled = false;
    setGateMode('login');
    authApi.onAuthStateChanged(firebaseAuth, async user => {
      if (gateSwitch) {
        gateSwitch.hidden = !user;
        gateSwitch.textContent = user ? `Cambiar de cuenta (${user.email || 'sesión actual'})` : 'Cambiar de cuenta';
      }
      if (!user) {
        const hadBackendSession = Boolean(lastSessionUid);
        lastSessionUid = null;
        lastSessionData = null;
        document.body.classList.add('auth-required');
        document.getElementById('firebase-auth-gate')?.setAttribute('aria-hidden', 'false');
        if (hadBackendSession && !explicitLogoutInProgress) clearBackendSession();
        document.dispatchEvent(new CustomEvent('firebase-auth-session-cleared'));
        return;
      }
      try { await exchangeFirebaseSession(user); }
      catch (error) {
        document.body.classList.add('auth-required');
        document.getElementById('firebase-auth-gate')?.setAttribute('aria-hidden', 'false');
        showGateError(firebaseErrorMessage(error));
      }
    });
    try {
      const analyticsSdk = await import(`${sdk}/firebase-analytics.js`);
      if (await analyticsSdk.isSupported()) analyticsSdk.getAnalytics(app);
    } catch (error) { console.info('Firebase Analytics no está disponible en este navegador:', error.message); }

    const db = getFirestore(app);
    const alertsQuery = query(collection(db, 'publicAlerts'), orderBy('createdAt', 'desc'), limit(50));
    onSnapshot(alertsQuery, snapshot => {
      const alerts = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
      document.dispatchEvent(new CustomEvent('firebase-alerts-updated', { detail: alerts }));
      if (statusEl) statusEl.textContent = 'Alertas sincronizadas en tiempo real con Firebase.';
    }, error => {
      console.warn('Firestore:', error);
      if (statusEl) statusEl.textContent = `Firebase conectado; Firestore necesita configuración: ${error.code || error.message}`;
    });

    if (!status.firestore && statusEl) statusEl.textContent = status.adminError || 'Firebase web listo. Falta configurar Firebase Admin en el servidor.';
    if (!vapidKey || !status.push) {
      renderPushState('error', 'Push sin configurar', 'No disponible', { disabled: true, detail: status.adminError || 'Falta la clave VAPID o la configuración del servidor.' });
      if (!vapidKey && status.firestore && statusEl) statusEl.textContent = 'Alertas en tiempo real activas. Configura FIREBASE_VAPID_KEY para habilitar push.';
      return;
    }
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      renderPushState('unsupported', 'No compatible con este navegador', 'No disponible', { disabled: true });
      return;
    }

    try {
      const api = await import(`${sdk}/firebase-messaging.js`);
      if (!await api.isSupported()) {
        renderPushState('unsupported', 'Push no compatible en este navegador', 'No disponible', { disabled: true });
        return;
      }
      messagingApi = api;
      messaging = api.getMessaging(app);
      pushSupported = true;
      pushButton.addEventListener('click', handlePushButton);
      await refreshPushStatus();
    } catch (error) {
      console.warn('Firebase Messaging:', error);
      renderPushState('error', 'No se pudo iniciar Push', 'No disponible', { disabled: true, detail: error.message });
      if (statusEl) statusEl.textContent = 'Firestore está disponible; revisa la configuración de Firebase Cloud Messaging.';
    }
  } catch (error) {
    console.warn('Firebase no disponible:', error);
    if (statusEl) statusEl.textContent = 'Firebase no está disponible en este momento; las alertas locales siguen funcionando.';
    renderPushState('error', 'No conectado a Firebase', 'Reintentar al recargar', { disabled: true, detail: error.message });
    if (gateSubmit) { gateSubmit.disabled = true; gateSubmit.textContent = 'Firebase no disponible'; }
    if (gateToggle) gateToggle.disabled = true;
    showGateError('No se pudo conectar con Firebase Authentication. Revisa la configuración y vuelve a cargar.');
  }
}

document.addEventListener('professional-auth-changed', refreshPushStatus);
if (statusEl && pushButton) startFirebase();
