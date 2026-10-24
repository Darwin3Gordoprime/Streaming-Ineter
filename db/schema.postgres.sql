-- INETER En Vivo - Esquema PostgreSQL para migración a Azure
-- Generado para sincronización automática al migrar desde GitHub a Azure
-- Recomendado: Azure Database for PostgreSQL Flexible Server

BEGIN;

-- Extensiones
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Profesionales / usuarios registrados
CREATE TABLE IF NOT EXISTS professionals (
  id VARCHAR(64) PRIMARY KEY,
  firebase_uid VARCHAR(128),
  name VARCHAR(80) NOT NULL,
  email VARCHAR(254) NOT NULL,
  profession VARCHAR(120),
  role VARCHAR(32) NOT NULL DEFAULT 'user',
  password_salt VARCHAR(64),
  password_hash VARCHAR(128),
  email_verified BOOLEAN DEFAULT FALSE,
  firebase_disabled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (email),
  UNIQUE (firebase_uid)
);

CREATE INDEX IF NOT EXISTS idx_professionals_role ON professionals(role);
CREATE INDEX IF NOT EXISTS idx_professionals_email ON professionals(email);

-- Sesiones de autenticación
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  scope VARCHAR(16),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions(expires_at);

-- Destinos RTMP
CREATE TABLE IF NOT EXISTS destinations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform VARCHAR(30) NOT NULL,
  name VARCHAR(60) NOT NULL,
  server_url TEXT NOT NULL,
  secret_encrypted TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Programaciones
CREATE TABLE IF NOT EXISTS schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(80) NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER,
  destinations JSONB DEFAULT '[]'::jsonb,
  status VARCHAR(16) NOT NULL DEFAULT 'programada',
  error TEXT,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_schedules_starts_at ON schedules(starts_at);
CREATE INDEX IF NOT EXISTS idx_schedules_status ON schedules(status);

-- Sesiones de transmisión
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  recording VARCHAR(32),
  destinations JSONB DEFAULT '[]'::jsonb,
  status VARCHAR(16) NOT NULL DEFAULT 'grabando',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at);

-- Grabaciones
CREATE TABLE IF NOT EXISTS recordings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  title VARCHAR(100),
  relative_path TEXT NOT NULL,
  size_bytes BIGINT,
  url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recordings_created_at ON recordings(created_at DESC);

-- Alertas
CREATE TABLE IF NOT EXISTS alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category VARCHAR(16) NOT NULL,
  category_label VARCHAR(32) NOT NULL,
  severity VARCHAR(16) NOT NULL,
  severity_label VARCHAR(16) NOT NULL,
  title VARCHAR(140) NOT NULL,
  location VARCHAR(120),
  message TEXT NOT NULL,
  source_name VARCHAR(80),
  source_url TEXT NOT NULL,
  author VARCHAR(80),
  recipient_count INTEGER DEFAULT 0,
  email_accepted INTEGER DEFAULT 0,
  email_status VARCHAR(24) DEFAULT 'sin_configuracion',
  email_error TEXT,
  email_sent_at TIMESTAMPTZ,
  firebase_status VARCHAR(24) DEFAULT 'pendiente_configuracion',
  push_accepted INTEGER DEFAULT 0,
  firebase_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts(created_at DESC);

-- Destinatarios de alertas (histórico)
CREATE TABLE IF NOT EXISTS alert_recipients (
  id BIGSERIAL PRIMARY KEY,
  alert_id UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  email VARCHAR(254) NOT NULL,
  sent_at TIMESTAMPTZ,
  status VARCHAR(16),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_recipients_alert_id ON alert_recipients(alert_id);
CREATE INDEX IF NOT EXISTS idx_alert_recipients_email ON alert_recipients(email);

-- Tokens push
CREATE TABLE IF NOT EXISTS push_tokens (
  id BIGSERIAL PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, token)
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_user_id ON push_tokens(user_id);

-- Me gusta en transmisión
CREATE TABLE IF NOT EXISTS stream_likes (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID,
  user_id VARCHAR(64) REFERENCES professionals(id) ON DELETE SET NULL,
  ip_hash VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stream_likes_session_id ON stream_likes(session_id);
CREATE INDEX IF NOT EXISTS idx_stream_likes_created_at ON stream_likes(created_at);

-- Vistas de transmisión
CREATE TABLE IF NOT EXISTS stream_views (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID,
  user_id VARCHAR(64) REFERENCES professionals(id) ON DELETE SET NULL,
  view VARCHAR(32),
  ip_hash VARCHAR(64),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stream_views_session_id ON stream_views(session_id);
CREATE INDEX IF NOT EXISTS idx_stream_views_last_seen_at ON stream_views(last_seen_at);

-- Reportes agrícolas
CREATE TABLE IF NOT EXISTS agriculture_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality VARCHAR(80),
  crop VARCHAR(40) NOT NULL,
  soil VARCHAR(16) NOT NULL,
  rain VARCHAR(16) NOT NULL,
  outcome VARCHAR(100) NOT NULL,
  reporter_id VARCHAR(64) REFERENCES professionals(id) ON DELETE SET NULL,
  reporter_name VARCHAR(80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agriculture_reports_created_at ON agriculture_reports(created_at DESC);

-- Solicitudes de acceso admin
CREATE TABLE IF NOT EXISTS admin_access_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(64) NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  name VARCHAR(80) NOT NULL,
  email VARCHAR(254) NOT NULL,
  reason TEXT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  reviewed_at TIMESTAMPTZ,
  reviewed_by VARCHAR(254),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_access_requests_status ON admin_access_requests(status);
CREATE INDEX IF NOT EXISTS idx_admin_access_requests_created_at ON admin_access_requests(created_at DESC);

-- Configuración OBS
CREATE TABLE IF NOT EXISTS obs_config (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  host VARCHAR(255) NOT NULL DEFAULT '127.0.0.1',
  port INTEGER NOT NULL DEFAULT 4455,
  secret_encrypted TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_obs_singleton CHECK (id = 1)
);

-- Estado global (opcional para migración)
CREATE TABLE IF NOT EXISTS app_state (
  key VARCHAR(64) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_professionals_updated_at ON professionals;
CREATE TRIGGER update_professionals_updated_at BEFORE UPDATE ON professionals FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

DROP TRIGGER IF EXISTS update_destinations_updated_at ON destinations;
CREATE TRIGGER update_destinations_updated_at BEFORE UPDATE ON destinations FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

DROP TRIGGER IF EXISTS update_schedules_updated_at ON schedules;
CREATE TRIGGER update_schedules_updated_at BEFORE UPDATE ON schedules FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

DROP TRIGGER IF EXISTS update_obs_config_updated_at ON obs_config;
CREATE TRIGGER update_obs_config_updated_at BEFORE UPDATE ON obs_config FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

COMMIT;
