# En Vivo

Panel local de retransmisión para OBS Studio o una fuente RTMP compatible, con salidas RTMP múltiples y grabación MP4 automática.

## Arrancar en Windows, macOS o Linux

La forma recomendada para mantener el mismo funcionamiento entre sistemas operativos es **Docker Compose**. Instala Docker Desktop en Windows/macOS o Docker Engine con el complemento Compose en Linux, abre una terminal en esta carpeta y ejecuta:

```sh
docker compose up --build
```

También puedes ejecutar `npm start` (requiere que Docker Compose esté instalado). Para dejar los servicios en segundo plano usa `npm run start:detached`; para detenerlos, `npm stop` o `docker compose down`. Abre `http://localhost:3000`.

No uses `npm run start:backend` como forma normal de inicio: arranca solo el backend Node y requiere que MediaMTX y FFmpeg ya estén instalados y configurados aparte.

La plataforma principal está en `http://localhost:3000` y el dashboard administrativo independiente en `http://localhost:3012`. Ambos puertos los sirve el mismo backend, así que comparten Firebase, datos y API; la raíz del puerto 3012 abre directamente el panel de administración. Inicia sesión en el propio panel con Firebase. Desde ahí se consultan las cuentas, se gestionan alertas, solicitudes, videos y reportes agrícolas. La cuenta indicada en `INETER_INITIAL_ADMIN_EMAIL` recibe el rol de administradora principal; solo ella puede crear o aprobar administradores de monitoreo.

De forma predeterminada, el sitio y RTMP solo aceptan conexiones desde la misma PC. Para entrar desde otra PC de la misma red, crea `.env` a partir de `.env.example`, cambia `APP_BIND_ADDRESS=0.0.0.0`, permite el puerto 3000 en el firewall y abre `http://IP-DE-LA-PC:3000`. Si OBS también está en otra PC, cambia además `RTMP_BIND_ADDRESS=0.0.0.0`, `OBS_INGEST_SERVER=rtmp://IP-DE-LA-PC:1935/live` y permite el puerto 1935. Limita esos puertos a la red local; no los expongas directamente a Internet.

### Mover el proyecto a otra PC o sistema

1. Detén el proyecto y copia toda la carpeta, incluyendo `data/` y `recordings/`. No copies `node_modules/`; se vuelve a generar si usas el modo Node local.
2. Copia también `.env` y la clave privada de Firebase Admin que hayas configurado. No las publiques ni las envíes en un repositorio. Si Compose usa la ruta predeterminada, coloca el JSON en la raíz con el nombre `firebase-service-account.json`; también puedes cambiar `FIREBASE_SERVICE_ACCOUNT_FILE` en `.env`.
3. Conserva `data/secret.key`: es necesaria para descifrar las claves de salida RTMP que ya estaban guardadas. Si migras sin ella, tendrás que volver a registrar esas claves en la app. `data/` también conserva el estado local y la configuración de OBS.
4. Instala Docker en el otro sistema, inicia Docker y ejecuta `docker compose up --build`. Los archivos de `recordings/` se conservan en esa carpeta compartida y siguen disponibles tras el cambio de sistema.

La configuración pública de Firebase puede permanecer en `.env`; los secretos privados (cuenta de servicio, clave de cifrado y claves RTMP) deben viajar por un medio seguro. La carpeta `data/` contiene material sensible.

Para desplegar en una VM Debian de Azure con HTTPS y entrada RTMPS, sigue [la guía de Azure](deploy/azure/README.md).

### Inicio directo en Windows (alternativa)

El inicio directo mediante scripts PowerShell es específico de Windows. Para macOS y Linux, usa Docker Compose como se indica arriba.

Para detener el servicio: `docker compose down`. Las claves cifradas se conservan en `data/`; las grabaciones se guardan en `recordings/`.

### Alternativa local sin Docker

También puedes ejecutar los servicios directamente en Windows:

1. Descarga el binario independiente de MediaMTX desde su [guía oficial de instalación](https://mediamtx.org/docs/kickoff/install) y coloca `mediamtx.exe` en `tools/`.
2. Descarga una compilación de FFmpeg para Windows desde los [enlaces que publica FFmpeg](https://www.ffmpeg.org/download.html); coloca `ffmpeg.exe` en `tools/` (si la compilación incluye DLL, coloca también esas DLL junto al ejecutable).
3. Ejecuta `iniciar-sin-docker.ps1`. Abre el panel en `http://localhost:3000`; OBS y los puertos de entrada se limitan a este equipo.
4. Para cerrar el backend local y MediaMTX, ejecuta `detener-sin-docker.ps1`.

Node.js ya está instalado en este equipo. MediaMTX ofrece binarios independientes para Windows y FFmpeg publica enlaces a compilaciones de Windows desde su página oficial. ([MediaMTX](https://mediamtx.org/docs/kickoff/install), [FFmpeg](https://www.ffmpeg.org/download.html))

## Vincular OBS

En OBS, abre **Herramientas → Ajustes del servidor WebSocket**, activa el servidor y conserva el puerto 4455. En modo Docker, el panel se conecta mediante `host.docker.internal:4455`; en modo local usa `127.0.0.1:4455`. Escribe la contraseña de OBS en el panel y pulsa **Conectar y vincular**. La app aplica automáticamente el destino RTMP local de En Vivo. Después puedes iniciar o detener OBS desde el panel, o hacerlo desde OBS como siempre. OBS WebSocket v5 admite autenticación y `SetStreamServiceSettings` permite configurar un destino RTMP personalizado con `server` y `key`. ([Protocolo oficial](https://github.com/obsproject/obs-websocket/blob/master/docs/docs/partials/introduction.md), [ajustes del servicio](https://github.com/obsproject/obs-websocket/blob/master/src/requesthandler/RequestHandler_Config.cpp))

El panel muestra una captura actualizada cada dos segundos de la escena activa de OBS. Al recibir la señal, MediaMTX guarda la grabación MP4 y el backend abre una salida FFmpeg independiente por cada destino. Al detener la emisión, el archivo aparece en **Grabaciones recientes**.

Usa H.264 para video y AAC para audio en OBS para maximizar compatibilidad con RTMP y MP4. Asegúrate de tener espacio suficiente en disco: las grabaciones no se eliminan automáticamente.

## Añadir plataformas

En cada plataforma, crea una transmisión y copia la URL del servidor RTMP y la clave de transmisión. Añade ambos datos desde **Añadir plataforma**. El backend cifra la clave con AES-256-GCM y no la devuelve a la interfaz. Una salida con problemas no debería detener la grabación ni las otras salidas, porque cada una usa un proceso FFmpeg separado.

El botón de inicio de En Vivo inicia OBS; al detectar la señal, el backend abre en paralelo una salida hacia cada plataforma configurada. Para YouTube, copia la URL y clave del evento desde YouTube Studio y activa **Auto-start** en ese evento para que comience al recibir la señal. Si Auto-start está desactivado, revisa la vista previa y pulsa **Emitir en directo** en Studio. [Ayuda oficial de YouTube sobre Auto-start](https://support.google.com/youtube/answer/9854503?hl=es).

## Difusión de alertas por correo

Un administrador puede publicar avisos sísmicos, volcánicos, de tsunami, meteorológicos o hidrológicos desde **Administración → Difusión de alertas**. Cada aviso requiere confirmación humana y un enlace HTTPS de un sitio oficial de INETER. Al publicarlo aparece en **Alertas** y se envía un correo individual a las direcciones de las cuentas registradas; no se exponen las direcciones entre sí. Esta app no interpreta por sí sola los monitores como alertas oficiales.

Para activar el correo, crea una cuenta de Resend, verifica el dominio remitente y copia `.env.example` como `.env`. Completa `RESEND_API_KEY` y `ALERT_FROM_EMAIL` con el remitente del dominio verificado. No compartas ni subas `.env` al repositorio. Reinicia En Vivo para leer la configuración. Si falta la configuración, el aviso igual se publica en la app y el panel permite reintentar el correo cuando esté listo. El proveedor acepta lotes de hasta 100 mensajes; la app envía mensajes individuales para no revelar otros destinatarios. [API oficial de Resend](https://resend.com/docs/api-reference/emails/send-batch).

## Preparar Firebase

El inicio de sesión de la plataforma usa Firebase Authentication. El backend verifica los ID tokens con Firebase Admin y mantiene una sesión segura para autorizar sus API. Sin sesión, el contenido de la plataforma permanece bloqueado. Firebase Analytics, Firestore en tiempo real para avisos y Firebase Cloud Messaging usan el mismo proyecto. Los avisos aprobados se escriben en `publicAlerts` y se envían a los dispositivos registrados; el correo sigue usando Resend.

1. La configuración web ya apunta a `ineter-streaming`. En **Authentication → Sign-in method**, habilita **Correo electrónico/Contraseña**. En **Authentication → Settings → Authorized domains**, confirma que `localhost` esté autorizado para pruebas locales.
2. Crea la base de datos de **Cloud Firestore** y publica las reglas de `firestore.rules`. La app permite leer `publicAlerts`, pero las escrituras quedan reservadas al backend.
3. La configuración web actual ya apunta al proyecto `ineter-streaming`. Si Firebase muestra valores diferentes para tu app, reemplaza los valores correspondientes en `firebase-client.js` o sobrescríbelos en `.env`: `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_APP_ID` y `FIREBASE_MESSAGING_SENDER_ID`.
4. En **Cloud Messaging → Configuración web**, genera un par de claves Web Push y copia la clave pública a `FIREBASE_VAPID_KEY`.
5. Para que el servidor publique en Firestore, entregue push y cree cuentas administradoras de monitoreo, instala `firebase-admin` con `npm install`. Descarga una clave de cuenta de servicio desde **Configuración del proyecto → Cuentas de servicio** y guárdala fuera del repositorio si puedes. Si la guardas en la raíz como `firebase-service-account.json`, `.gitignore` ya la excluye. En modo local, define `FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-service-account.json`. Para Docker, define `FIREBASE_SERVICE_ACCOUNT_FILE` con la ruta del JSON en el equipo anfitrión; Compose lo monta como solo lectura.
6. Reinicia el backend. La plataforma mostrará el acceso antes de cargar el contenido. Los usuarios nuevos crean su cuenta desde la pantalla inicial. Para vincular una cuenta profesional existente, crea/inicia su cuenta de Firebase con el mismo correo y verifica ese correo; el backend conserva el rol que ya tenía asignado. Los usuarios locales antiguos no pueden entrar con una contraseña local que no exista en Firebase.
7. Configura `INETER_INITIAL_ADMIN_EMAIL` con el correo verificado de la cuenta administradora principal. Se usa para aprobar y crear accesos de monitoreo, también en Docker. Después de entrar, en **Alertas**, pulsa **Activar notificaciones** en cada navegador/dispositivo. Para aplicar cambios en Docker, reconstruye la imagen (`docker compose up --build -d`).

La configuración web Firebase es pública por diseño; la cuenta de servicio y la clave privada de Web Push no se envían al navegador. Las notificaciones web fuera de `localhost` requieren HTTPS y permiso del navegador. Los correos de cuentas locales privilegiadas deben verificarse al vincularlos para evitar que alguien reclame un rol administrativo usando un correo ajeno.

## Monitoreo para administradores

El panel separado `/monitor.html` solicita una sesión de Firebase propia y valida el rol en el backend. La cuenta principal indicada en `INETER_INITIAL_ADMIN_EMAIL` puede crear cuentas de **administrador de monitoreo**; estas cuentas no reciben el rol administrativo general de la plataforma. El dashboard actualiza velocidad agregada de subida y bajada, latencia TCP a Cloudflare, uso de CPU, memoria, sistema operativo, procesador, espacio de grabaciones, conexión OBS y estado de cada destino. En Windows lee los contadores de adaptadores con PowerShell; en Linux/Docker lee `/sys/class/net`. Las velocidades miden el tráfico total del equipo o contenedor que ejecuta el backend, así que pueden incluir otras aplicaciones además de la transmisión. El panel consulta cada 2.5 segundos mientras está abierto.

## StreamYard y acceso externo

La entrada predeterminada queda limitada a este equipo y sirve para OBS local. Para enviar desde StreamYard necesitas desplegar el servidor con una URL pública, DNS y RTMPS con certificado TLS; también debes configurar firewall/router o un servidor público. No expongas el RTMP local sin cifrar a Internet. Este proyecto no configura dominio, TLS ni alojamiento remoto.

## Archivos y privacidad

- `server.js`: API, cifrado de claves, detección de señal, retransmisión y archivo de grabaciones.
- `firebase-client.js`, `firebase-messaging-sw.js`, `firestore.rules`: sincronización de alertas, push y reglas de lectura.
- `mediamtx.yml`: servidor RTMP de entrada y API privada en la red de Docker.
- `docker-compose.yml` y `Dockerfile`: servicios de MediaMTX y backend con FFmpeg.
- `recordings/`: archivos MP4 terminados.
- `data/`: clave de cifrado y configuración local. Está excluida de Git.

El panel web solo escucha en `127.0.0.1:3000`. La entrada RTMP publica el puerto 1935 del equipo y usa una clave aleatoria larga. Las credenciales de las plataformas quedan cifradas en el volumen `data/`; protege ese directorio y conserva una copia de seguridad si la necesitas.
