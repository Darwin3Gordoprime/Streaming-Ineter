# Despliegue en Azure VM con Debian

Esta carpeta prepara En Vivo para una VM Debian usando Docker Compose. La web se sirve por HTTPS con Caddy; MediaMTX acepta RTMP en 1935 y RTMPS en 1936. La API de MediaMTX y el puerto web de Node no se publican a Internet.

## 0. Opción económica con Azure for Students

La suscripción de estudiante incluye **750 horas al mes (12 meses) de cada uno de estos tamaños** y 100 USD de crédito:

| Tamaño | vCPU | RAM | Precio aprox. (East US, Linux) |
|---|---|---|---|
| `Standard_B1s` | 1 | 1 GiB | ~7.60 USD/mes |
| `Standard_B2ats_v2` | 2 | 1 GiB | ~6.90 USD/mes |
| `Standard_B2pts_v2` (ARM) | 2 | 1 GiB | ~6.90 USD/mes |

Cualquiera de los tres queda cubierto por las 750 horas gratuitas si mantienes **una sola VM** encendida. Recomendación: **`Standard_B2ats_v2`** (2 vCPU para FFmpeg), añadiendo el swap que ya crea `cloud-init.yaml`.

Los 1 GiB de RAM son el límite real de esta app: Node, MediaMTX, Caddy y FFmpeg caben con swap para **una salida RTMP**, pero varias salidas simultáneas pueden agotar la memoria. Si necesitas más margen, usa el crédito de 100 USD para subir a `Standard_B1ms` (2 GiB, ~15 USD/mes) o `Standard_B2s` (4 GiB, ~30 USD/mes).

Costos que **no** cubre la oferta gratuita y salen del crédito: disco del sistema (~5 USD/mes por 64 GB SSD estándar), IP pública estándar (~3.65 USD/mes) y tráfico de salida. Los primeros 100 GB/mes de egreso son gratuitos; a partir de ahí se cobra por GB, así que el número de espectadores del streaming es el factor que más encarece la factura.

Para no gastar crédito cuando no transmites:

```sh
az vm deallocate -g rg-ineter -n vm-ineter   # detiene el cobro de cómputo, conserva discos
az vm start -g rg-ineter -n vm-ineter
```

También puedes programar el apagado automático en el portal: **VM → Operaciones → Apagado automático**.

## 1. Preparar Azure y DNS

1. Crea una VM Debian 12 con IP pública estática y almacenamiento administrado con espacio suficiente para las grabaciones. Reserva un dominio o subdominios y crea registros DNS `A` que apunten a la IP pública: uno para la web (`APP_DOMAIN`) y otro para RTMPS (`STREAM_DOMAIN`). Para que Docker quede instalado desde el primer arranque, pega `deploy/azure/cloud-init.yaml` en **Avanzado → Datos personalizados** al crear la VM (o usa `--custom-data` con Azure CLI).
2. En el grupo de seguridad de red (NSG), permite entrada TCP 22 solo desde tu IP administrativa; TCP 80 y 443 para el sitio y los certificados; y TCP 1935 para la entrada RTMP. Si vas a usar RTMPS, permite también TCP 1936. RTMP plano no cifra el transporte; limita 1935 a la IP pública de OBS cuando sea posible y prefiere RTMPS para redes no confiables. No abras 3000, 3012, 4455, 4458, 8554 ni 9997. Azure documenta el acceso SSH y las reglas de entrada del NSG en su [guía para conectarse a una VM Linux](https://learn.microsoft.com/azure/virtual-machines/linux-vm-connect).
3. Si no usaste `cloud-init.yaml`, instala Docker Engine y el complemento Compose siguiendo la [guía oficial para Debian](https://docs.docker.com/engine/install/debian/) y habilita Docker para iniciar con el sistema (`sudo systemctl enable --now docker`). El override Azure requiere Docker Compose 2.24 o posterior por el reemplazo explícito de puertos. Con cloud-init, verifica al entrar por SSH con `docker --version` y `docker compose version`.

## 2. Copiar y proteger los datos

Coloca el proyecto en `/opt/ineter`. Transfiere la carpeta `data/` para conservar la configuración cifrada, `recordings/` para conservar los videos, el archivo `.env` y la cuenta de servicio de Firebase. Usa SSH/SFTP o un medio privado para los secretos; no los subas al repositorio.

En `/opt/ineter/.env`, configura los valores del proyecto Firebase y correo que uses actualmente, además de:

```dotenv
APP_DOMAIN=app.ejemplo.org
STREAM_DOMAIN=stream.ejemplo.org
CERTBOT_WEBROOT=/var/lib/ineter/acme-challenge
FIREBASE_SERVICE_ACCOUNT_FILE=./firebase-service-account.json
INETER_INITIAL_ADMIN_EMAIL=admin@ejemplo.org
RECORDINGS_PATH=./recordings
```

Reemplaza dominios y correo con los reales. Si vas a montar un disco de datos de Azure para grabaciones, móntalo de forma persistente y cambia `RECORDINGS_PATH` a su directorio, por ejemplo `/srv/ineter/recordings`; crea ese directorio antes de iniciar Compose. Mantén `data/secret.key`: sin esa clave, no se pueden descifrar las claves RTMP que ya estén guardadas.

El Compose de Azure deriva el destino que muestra el panel y configura en OBS de `STREAM_DOMAIN`. Por compatibilidad con la instalación actual usa `rtmp://$STREAM_DOMAIN:1935/live`; para publicar desde OBS, configura esa URL y la clave de entrada que genera INETER. La clave hace que MediaMTX reciba el stream en `live/<clave>`; el backend detecta esa ruta, la entrega por HLS y la usa como fuente para FFmpeg hacia YouTube y otros destinos. También se conserva RTMPS en `rtmps://$STREAM_DOMAIN:1936/live` para clientes que lo admitan. Si usas RTMPS, el dominio debe apuntar a la VM y coincidir con el certificado.

Protege `.env`, la cuenta de servicio y `data/` para que solo personal autorizado tenga acceso. Por ejemplo, desde el servidor:

```sh
sudo chown -R "$USER":"$USER" /opt/ineter
chmod 600 /opt/ineter/.env /opt/ineter/firebase-service-account.json
chmod 700 /opt/ineter/data
```

## 3. Certificado RTMPS y arranque

Antes de iniciar toda la plataforma, prepara el directorio de validación y arranca únicamente Caddy para que publique el reto HTTP de Certbot. El DNS debe apuntar a la VM y el puerto 80 debe estar permitido para la validación. La entrada web de `STREAM_DOMAIN` sirve solo los retos ACME; el tráfico de streaming usa TCP 1935 (RTMP) o 1936 (RTMPS):

```sh
sudo apt update
sudo apt install -y certbot
sudo mkdir -p /var/lib/ineter/acme-challenge
docker compose -f docker-compose.yml -f deploy/azure/docker-compose.azure.yml up -d --no-deps caddy
sudo certbot certonly --webroot -w /var/lib/ineter/acme-challenge -d stream.ejemplo.org
```

Usa para `-d` el mismo valor de `STREAM_DOMAIN` en `.env`. El modo webroot permite que la renovación automática use Caddy mientras el sitio sigue funcionando; el hook de despliegue vuelve a crear MediaMTX después de renovar el certificado.

La configuración de MediaMTX usa `rtmpEncryption: optional`, con `rtmpAddress` en 1935 y `rtmpsAddress` en 1936. El valor debe ser una cadena YAML (`"optional"`, no un booleano); los certificados montados habilitan RTMPS. Para el flujo RTMP plano actual, OBS publica a `rtmp://stream.ejemplo.org:1935/live` con la clave que muestra En Vivo. Consulta [las opciones RTMP/RTMPS de MediaMTX 1.21.2](https://github.com/bluenviron/mediamtx/blob/v1.21.2/mediamtx.yml#L291-L302) y su [guía para OBS](https://github.com/bluenviron/mediamtx/blob/v1.21.2/docs/3-publish/19-obs-studio.md).

Desde `/opt/ineter`, inicia los servicios:

```sh
docker compose -f docker-compose.yml -f deploy/azure/docker-compose.azure.yml up --build -d
```

Caddy solicitará y renovará HTTPS automáticamente para `APP_DOMAIN`. En Firebase Authentication, agrega ese mismo dominio a **Authorized domains**. La aplicación quedará en `https://app.ejemplo.org` y el panel independiente en `https://app.ejemplo.org/admin.html`; no es necesario publicar el puerto 3012.

El backend queda detrás de Caddy y activa cookies `Secure` al reconocer el encabezado HTTPS del proxy. La regla `TRUST_PROXY=1` solo está activada en el Compose de Azure, donde Caddy es el proxy configurado.

## Servicios externos y corte de migración

La migración conserva los servicios externos si se mantienen el proyecto y las credenciales actuales. Antes de copiar, detén una emisión y conserva `data/state.json`, `data/secret.key` y `data/ingest.key`; `data/secret.key` permite descifrar los destinos RTMP y `data/ingest.key` mantiene la clave de entrada que ya usa OBS. Conserva también el mismo `FIREBASE_PROJECT_ID`, la cuenta de servicio, la clave VAPID, `RESEND_API_KEY` y `ALERT_FROM_EMAIL` en el `.env` privado de la VM.

- **Firebase:** se sigue usando el mismo proyecto. Agrega `APP_DOMAIN` a Firebase Authentication → Authorized domains. Las notificaciones del navegador pertenecen al origen del sitio; al pasar de `localhost` al dominio público, cada navegador/usuario debe activar de nuevo las notificaciones en el nuevo dominio.
- **Resend:** conserva la clave y el remitente verificado actuales. El dominio del sitio y el dominio remitente son independientes; no cambies el remitente si no quieres cambiar el servicio de correo.
- **OBS y destinos de streaming:** YouTube, Twitch, Facebook y los demás destinos conservan sus claves si preservas `data/` completo. Para el flujo actual, OBS publica a `rtmp://$STREAM_DOMAIN:1935/live` con la clave de entrada que muestra En Vivo. El botón del panel controla OBS mediante WebSocket, que es independiente del transporte de video. Como OBS está en otra PC, conecta esa PC y Azure mediante una VPN o ruta privada; configura el backend con la IP privada/VPN del equipo OBS y el puerto WebSocket. No habilites `GatewayPorts yes` con un listener `0.0.0.0` ni abras 4455/4458 a Internet. Si utilizas un túnel SSH, limita su listener y firewall a una interfaz/red privada. Sin esa ruta, OBS todavía puede publicar manualmente por RTMP/RTMPS, aunque el panel no pueda controlarlo.

La aplicación, Caddy y MediaMTX se reinician durante el corte; planifica ese cambio cuando no haya transmisión activa. No se modifican reglas, claves ni cuentas de Firebase, Resend o plataformas externas desde este repositorio. Los cambios necesarios en Azure son DNS/NSG y agregar el nuevo dominio autorizado de Firebase.

## 4. Renovación del certificado RTMPS

MediaMTX carga el certificado al iniciar; tras renovarlo hay que recrear su contenedor. Instala el hook incluido:

```sh
sudo install -m 755 deploy/azure/renew-mediamtx-cert.sh /etc/letsencrypt/renewal-hooks/deploy/ineter-mediamtx.sh
```

Certbot ejecutará el hook cuando renueve el certificado. También puedes recrear el contenedor manualmente desde `/opt/ineter` con el mismo comando Compose y `--force-recreate mediamtx`.

## Operación y persistencia

- Estado y credenciales cifradas: `/opt/ineter/data/`.
- Grabaciones: `RECORDINGS_PATH` (por defecto `/opt/ineter/recordings/`). No tienen borrado automático; vigila el espacio del disco.
- Reinicio automático de contenedores: `unless-stopped`.
- Ver logs: `docker compose -f docker-compose.yml -f deploy/azure/docker-compose.azure.yml logs -f app mediamtx caddy`.
- Actualizar el backend puede cortar una transmisión activa; hazlo cuando no haya live.
- Programa copias de seguridad protegidas de `data/`, las grabaciones que deban conservarse y la configuración del dominio/certificado.

El tamaño de la VM debe soportar la carga de FFmpeg para todas las salidas seleccionadas y el ritmo de escritura de las grabaciones. Esta preparación no crea recursos ni cambia reglas en tu suscripción de Azure; eso se hace en el portal de Azure con tu cuenta.
