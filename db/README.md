# Migración a PostgreSQL (Azure Database for PostgreSQL)

Este directorio contiene todo lo necesario para migrar la base de datos JSON (`data/state.json`) a PostgreSQL y desplegarla en Azure.

## Archivos

- `schema.postgres.sql` - Esquema completo con todas las tablas, índices, triggers y extensiones
- `.env.postgres.example` - Plantilla de variables de entorno para conexión
- `../scripts/export-state-to-sql.js` - Genera `db/import.sql` desde `data/state.json` (sin dependencias externas)

## Estado real de la integración

El backend **todavía lee y escribe `data/state.json`**. El esquema y el exportador dejan la base preparada para la migración, pero no hay una capa de acceso a PostgreSQL en `server.js`. Para usar PostgreSQL en producción hay que añadir esa capa (con la dependencia `pg`) o mantener `data/` en un disco persistente de la VM.

- Despliegue recomendado actual: **VM de Azure** con `data/` y `recordings/` en disco persistente (ver `deploy/azure/README.md`).
- **Azure App Service / Container Apps no son adecuados** con el almacenamiento JSON actual, porque el disco local es efímero.

## Pasos para migrar

### 1. Crear base de datos en Azure
En Azure Portal: `Azure Database for PostgreSQL Flexible Server` → Crear servidor con credenciales y habilitar acceso público/restricciones según necesidad.

### 2. Configurar conexión
Copiar `.env.postgres.example` a `.env` y ajustar con tus credenciales:

```env
DATABASE_URL=postgresql://usuario:contraseña@tu-servidor.postgres.database.azure.com:5432/ineter?sslmode=require
USE_POSTGRES=false
```

### 3. Generar esquema
Conectar a la base de datos y ejecutar el schema:

```bash
psql "$DATABASE_URL" -f db/schema.postgres.sql
```

### 4. Exportar los datos actuales
```bash
node scripts/export-state-to-sql.js
psql "$DATABASE_URL" -f db/import.sql
```

El script no modifica `data/state.json`; solo genera SQL revisable antes de aplicarlo.

## Notas importantes

- Todas las contraseñas/secrets se siguen cifrando con `encryptionKey` (AES-256-GCM) igual que ahora
- Los tokens de sesión usan hash SHA-256
- Las URLs RTMP y claves se mantienen cifradas
- Compatible con el código existente (transición gradual JSON → PostgreSQL)
- El esquema incluye soporte para likes, vistas en vivo y estadísticas

## Seguridad

- Usar siempre `sslmode=require` en Azure
- Restringir IPs en el firewall de PostgreSQL
- Rotar credenciales después de la migración
- Mantener `firebase-service-account.json` fuera del repositorio (ya está en `.gitignore`)
