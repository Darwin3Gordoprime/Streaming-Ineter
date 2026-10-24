#!/usr/bin/env node
/**
 * Exporta data/state.json a un archivo SQL compatible con db/schema.postgres.sql.
 *
 * Uso:
 *   node scripts/export-state-to-sql.js
 *   node scripts/export-state-to-sql.js --out db/import.sql
 *
 * Después aplica el resultado en Azure:
 *   psql "$DATABASE_URL" -f db/schema.postgres.sql
 *   psql "$DATABASE_URL" -f db/import.sql
 *
 * No requiere dependencias de Node: solo lee el JSON local y genera SQL.
 * No incluye las grabaciones (se descubren del sistema de archivos) ni
 * contraseñas en claro (solo los hashes que ya existen en state.json).
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const stateFile = path.join(root, 'data', 'state.json');
const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const outFile = outIndex >= 0 && args[outIndex + 1]
  ? path.resolve(process.cwd(), args[outIndex + 1])
  : path.join(root, 'db', 'import.sql');

if (!fs.existsSync(stateFile)) {
  console.error(`No existe ${stateFile}. Ejecuta este script en el equipo donde está el estado actual.`);
  process.exit(1);
}

const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));

const sqlValue = (value) => {
  if (value === null || value === undefined || value === '') return 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
};
const sqlJson = (value) => `'${JSON.stringify(value ?? []).replace(/'/g, "''")}'::jsonb`;
const sqlTimestamp = (value) => {
  if (!value) return 'NULL';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'NULL' : `'${date.toISOString()}'`;
};
const sqlDate = (value) => (value ? sqlTimestamp(value) : 'NOW()');

const lines = [];
const counts = {};
const push = (label, statement) => {
  counts[label] = (counts[label] || 0) + 1;
  lines.push(statement);
};

const userIds = new Set((state.professionals || []).map(user => String(user.id)));

for (const user of state.professionals || []) {
  push('professionals', `INSERT INTO professionals (id, firebase_uid, name, email, profession, role, password_salt, password_hash, email_verified, firebase_disabled, created_at)
VALUES (${sqlValue(user.id)}, ${sqlValue(user.firebaseUid || null)}, ${sqlValue(user.name || 'Usuario INETER')}, ${sqlValue(user.email)}, ${sqlValue(user.profession || null)}, ${sqlValue(user.role || 'user')}, ${sqlValue(user.passwordSalt || null)}, ${sqlValue(user.passwordHash || null)}, ${user.emailVerified ? 'TRUE' : 'FALSE'}, ${user.firebaseDisabled ? 'TRUE' : 'FALSE'}, ${sqlDate(user.createdAt)})
ON CONFLICT (id) DO NOTHING;`);
}

for (const [tokenHash, session] of Object.entries(state.authSessions || {})) {
  if (!session || !userIds.has(String(session.userId))) continue;
  push('auth_sessions', `INSERT INTO auth_sessions (token_hash, user_id, scope, expires_at)
VALUES (${sqlValue(tokenHash)}, ${sqlValue(session.userId)}, ${sqlValue(session.scope || null)}, ${sqlTimestamp(session.expiresAt)})
ON CONFLICT (token_hash) DO NOTHING;`);
}

for (const destination of state.destinations || []) {
  push('destinations', `INSERT INTO destinations (id, platform, name, server_url, secret_encrypted)
VALUES (${sqlValue(destination.id)}::uuid, ${sqlValue(destination.platform)}, ${sqlValue(destination.name)}, ${sqlValue(destination.serverUrl)}, ${sqlValue(destination.secret)})
ON CONFLICT (id) DO NOTHING;`);
}

for (const schedule of state.schedules || []) {
  push('schedules', `INSERT INTO schedules (id, title, starts_at, duration_minutes, destinations, status, error, started_at, ended_at, created_at)
VALUES (${sqlValue(schedule.id)}::uuid, ${sqlValue(schedule.title)}, ${sqlTimestamp(schedule.startsAt)}, ${sqlValue(schedule.durationMinutes ?? null)}, ${sqlJson(schedule.destinations)}, ${sqlValue(schedule.status || 'programada')}, ${sqlValue(schedule.error || null)}, ${sqlTimestamp(schedule.startedAt)}, ${sqlTimestamp(schedule.endedAt)}, ${sqlDate(schedule.createdAt)})
ON CONFLICT (id) DO NOTHING;`);
}

for (const session of state.sessions || []) {
  push('sessions', `INSERT INTO sessions (id, started_at, ended_at, recording, destinations, status)
VALUES (${sqlValue(session.id)}::uuid, ${sqlTimestamp(session.startedAt)}, ${sqlTimestamp(session.endedAt)}, ${sqlValue(session.recording || null)}, ${sqlJson(session.destinations)}, ${sqlValue(session.status || 'grabando')})
ON CONFLICT (id) DO NOTHING;`);
}

for (const alert of state.alerts || []) {
  push('alerts', `INSERT INTO alerts (id, category, category_label, severity, severity_label, title, location, message, source_name, source_url, author, recipient_count, email_accepted, email_status, email_error, email_sent_at, firebase_status, push_accepted, firebase_error, created_at)
VALUES (${sqlValue(alert.id)}::uuid, ${sqlValue(alert.category)}, ${sqlValue(alert.categoryLabel || alert.category)}, ${sqlValue(alert.severity)}, ${sqlValue(alert.severityLabel || alert.severity)}, ${sqlValue(alert.title)}, ${sqlValue(alert.location || null)}, ${sqlValue(alert.message)}, ${sqlValue(alert.sourceName || null)}, ${sqlValue(alert.sourceUrl)}, ${sqlValue(alert.author || null)}, ${sqlValue(alert.recipientCount || 0)}, ${sqlValue(alert.emailAccepted || 0)}, ${sqlValue(alert.emailStatus || 'sin_configuracion')}, ${sqlValue(alert.emailError || null)}, ${sqlTimestamp(alert.emailSentAt)}, ${sqlValue(alert.firebaseStatus || 'pendiente_configuracion')}, ${sqlValue(alert.pushAccepted || 0)}, ${sqlValue(alert.firebaseError || null)}, ${sqlDate(alert.createdAt)})
ON CONFLICT (id) DO NOTHING;`);
}

for (const token of state.pushTokens || []) {
  if (!userIds.has(String(token.userId))) continue;
  push('push_tokens', `INSERT INTO push_tokens (user_id, token, created_at)
VALUES (${sqlValue(token.userId)}, ${sqlValue(token.token)}, ${sqlDate(token.createdAt)})
ON CONFLICT (user_id, token) DO NOTHING;`);
}

for (const report of state.agricultureReports || []) {
  push('agriculture_reports', `INSERT INTO agriculture_reports (id, municipality, crop, soil, rain, outcome, reporter_name, created_at)
VALUES (${sqlValue(report.id)}::uuid, ${sqlValue(report.municipality || null)}, ${sqlValue(report.crop)}, ${sqlValue(report.soil)}, ${sqlValue(report.rain)}, ${sqlValue(report.outcome)}, ${sqlValue(report.reporter || null)}, ${sqlDate(report.createdAt)})
ON CONFLICT (id) DO NOTHING;`);
}

for (const request of state.adminAccessRequests || []) {
  if (!userIds.has(String(request.userId))) continue;
  push('admin_access_requests', `INSERT INTO admin_access_requests (id, user_id, name, email, reason, status, reviewed_at, reviewed_by, created_at)
VALUES (${sqlValue(request.id)}::uuid, ${sqlValue(request.userId)}, ${sqlValue(request.name)}, ${sqlValue(request.email)}, ${sqlValue(request.reason)}, ${sqlValue(request.status || 'pending')}, ${sqlTimestamp(request.reviewedAt)}, ${sqlValue(request.reviewedBy || null)}, ${sqlDate(request.createdAt)})
ON CONFLICT (id) DO NOTHING;`);
}

if (state.obs?.secret) {
  push('obs_config', `INSERT INTO obs_config (id, host, port, secret_encrypted)
VALUES (1, ${sqlValue(state.obs.host || '127.0.0.1')}, ${sqlValue(Number(state.obs.port || 4455))}, ${sqlValue(state.obs.secret)})
ON CONFLICT (id) DO NOTHING;`);
}

push('app_state', `INSERT INTO app_state (key, value) VALUES ('likes', ${sqlJson(state.likes || {})}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();`);
push('app_state', `INSERT INTO app_state (key, value) VALUES ('studio', ${sqlJson({ studio: state.studio || 'OBS' })}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();`);

fs.mkdirSync(path.dirname(outFile), { recursive: true });
const header = `-- Generado por scripts/export-state-to-sql.js el ${new Date().toISOString()}\n-- Aplicar después de db/schema.postgres.sql\n\nBEGIN;\n\n`;
fs.writeFileSync(outFile, `${header}${lines.join('\n\n')}\n\nCOMMIT;\n`, 'utf8');

console.log(`SQL generado en ${outFile}`);
for (const [table, count] of Object.entries(counts)) console.log(`  ${table}: ${count}`);
console.log('\nAplícalo con:');
console.log(`  psql "$DATABASE_URL" -f db/schema.postgres.sql`);
console.log(`  psql "$DATABASE_URL" -f ${path.relative(root, outFile).split(path.sep).join('/')}`);
