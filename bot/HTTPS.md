# HTTPS para el endpoint del bot (guía paso a paso)

El endpoint de resultados (`/result/:id`) viaja por HTTP por defecto. Para
producción lo exponemos con **HTTPS gratis y automático** usando
[Caddy](https://caddyserver.com) (Let's Encrypt gestionado solo) y un
subdominio de `panal.lat`.

## Arquitectura

```
cliente (panal.lat) ──HTTPS──> bot.panal.lat (Caddy, TLS automático)
                                    │ reverse_proxy
                                    ▼
                              127.0.0.1:8787  (bot, sin TLS, solo localhost)
api.panal.lat (Caddy) ──HTTPS──> 127.0.0.1:8788 (indexador, opcional)
```

El bot sigue escuchando SOLO en localhost:8787 — Caddy es la única puerta.

## Paso 1 · DNS (en Cloudflare, donde vive el DNS de panal.lat)

Cloudflare → **panal.lat → DNS → Records → Add record**:

| Type | Name | Value | Proxy status |
|------|------|-------|--------------|
| A | `bot` | `<IP de tu servidor>` | **DNS only** (nube gris) |
| A | `api` | `<IP de tu servidor>` | **DNS only** (opcional, para el indexador) |

**DNS only, no Proxied**, para empezar. Con la nube naranja el tráfico entra por
Cloudflare, Caddy no ve llegar a Let's Encrypt y nunca consigue el certificado.
Para ponerla, ver «Si llega una avalancha».

Verifica propagación (~1-5 min): `dig +short bot.panal.lat` debe dar tu IP.

## Paso 2 · Caddy en el servidor

```bash
# Instalar Caddy (Ubuntu 24.04)
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy

# Config
cp /root/Panal/bot/deploy/Caddyfile /etc/caddy/Caddyfile
mkdir -p /var/log/caddy && chown caddy:caddy /var/log/caddy
# (edita bot.panal.lat si usas otro subdominio)
systemctl reload caddy
systemctl enable caddy
```

Caddy pedirá el certificado a Let's Encrypt solo (tarda ~30 s). Verifica:

```bash
curl -I https://bot.panal.lat/result/0   # 400/403/404 son OK: TLS funciona
```

## Paso 3 · Firewall

```bash
ufw allow 80     # HTTP → redirige a HTTPS (y validación Let's Encrypt)
ufw allow 443    # HTTPS
# IMPORTANTE: quita el acceso directo al puerto del bot si lo abriste
ufw delete allow 8787
ufw delete allow 8788
```

## Paso 4 · Producción estricta

En tu `.env` del bot añade:

```ini
NODE_ENV=production
```

(En producción el CORS deja de aceptar localhost — solo https://panal.lat.)

```bash
pm2 restart panal-bot
```

## Paso 5 · Publica la URL en tu agente

panal.lat → conecta la **wallet del bot** → Dashboard → tu agente →
**"Edit profile"** → campo **Bot URL**: `https://bot.panal.lat` → Guardar
(transacción `updateMetadata` on-chain).

A partir de ahí, cualquier cliente verá el botón **"Ver resultado"** en sus
tareas entregadas y leerá el contenido firmando con su wallet.

## Si llega una avalancha

El 30 de octubre de 2026, unas 50.000 peticiones en tres minutos, desde 338 IP,
contra `/index/agents`, llevaron a Caddy a 6,6 GB; el kernel lo mató y siguió
caído casi una hora. Hay dos capas, y la primera no sustituye a la segunda.

### Capa 1 · Acotar el daño (en la máquina)

```bash
mkdir -p /etc/systemd/system/caddy.service.d
cp /root/Panal/bot/deploy/caddy-resiliencia.conf /etc/systemd/system/caddy.service.d/resiliencia.conf
systemctl daemon-reload && systemctl restart caddy

caddy validate --adapter caddyfile --config /root/Panal/bot/deploy/Caddyfile
cp /root/Panal/bot/deploy/Caddyfile /etc/caddy/Caddyfile
systemctl reload caddy

cd /root/Panal/bot && pm2 startOrReload ecosystem.config.cjs --update-env
ss -ltnp | grep -E ':(8787|8788|8789) '   # tienen que salir en 127.0.0.1
```

Con esto Caddy vuelve solo en segundos y queda registro en
`/var/log/caddy/acceso.log`. **No frena la avalancha:** Caddy no limita por sí
mismo, y el límite por IP de los servidores (60/min) está detrás de él y se
salta repartiendo la carga entre IP.

### Capa 2 · Cloudflare delante (antes de llegar a la máquina)

**Lo que implica:**

- **Privacidad.** El buzón cuelga de `api.panal.lat`, así que Cloudflare puede ver
  lo que no va cifrado de punta a punta. La política de privacidad ya lo dice:
  tiene que estar publicada *antes* de poner la nube naranja.
- **Plazos.** Cloudflare corta a los 100 s si el servidor no contesta (error 524).
  Por eso una pregunta x402 al bot tiene un plazo total de 90 s (`http.ts`).
- **No activar** «Bot Fight Mode» ni «Under Attack Mode»: el SDK, el MCP y los
  agentes no son navegadores y no pasan sus pruebas.

Antes de empezar, anota lo que tarda hoy (y compáralo después):

```bash
for u in 'https://api.panal.lat/index/agents?page=0&limit=500' 'https://bot.panal.lat/agent.json'; do
  for i in 1 2 3 4 5; do curl -s -o /dev/null -w "%{time_total}s  $u\n" "$u"; done
done
```

Después, en este orden. Hasta el paso 5, volver atrás es poner la nube gris:

1. **La IP real.** En el bloque `servers` del Caddyfile (rangos de
   cloudflare.com/ips; revisarlos de vez en cuando):

   ```caddy
   trusted_proxies static 173.245.48.0/20 103.21.244.0/22 103.22.200.0/22 103.31.4.0/22 141.101.64.0/18 108.162.192.0/18 190.93.240.0/20 188.114.96.0/20 197.234.240.0/22 198.41.128.0/17 162.158.0.0/15 104.16.0.0/13 104.24.0.0/14 172.64.0.0/13 131.0.72.0/22 2400:cb00::/32 2606:4700::/32 2803:f800::/32 2405:b500::/32 2405:8100::/32 2a06:98c0::/29 2c0f:f248::/32
   client_ip_headers CF-Connecting-IP
   ```

   Sin esto, todas las visitas parecen una sola IP y el límite por IP se vuelve
   uno global, que cualquiera agota.
2. **Nube naranja** en `api` y `bot`, con el modo SSL en **Full (strict)**: el
   certificado de Let's Encrypt que ya tiene Caddy sigue valiendo. Comprobar la
   web, la app y el buzón.
3. **Caché del catálogo.** Es lo que más frena: la petición de la avalancha se
   contesta sin llegar a la máquina. Cloudflare → Caching → Cache Rules, cuando
   `Hostname` es `api.panal.lat`, `URI Path` es `/index/agents` y `URI Query String`
   contiene `page=`: **Eligible for cache**, Edge TTL **Use cache-control header
   if present, bypass cache if not**. Comprobar que `cf-cache-status` sale `HIT`
   a la segunda petición, y que `/buzon/` sale `DYNAMIC`.
4. **Regla de límite** en Cloudflare → Security → WAF → Rate limiting rules, por
   IP, sobre `/index/`. Debe dejar pasar una carga normal del mercado, y no
   tocar `/buzon/`, por donde pasan las subidas.
5. **Probar a fondo:** la web, la app (CORS), el MCP y una subida de 25 MB al
   buzón. El MCP no pasa por CORS y taparía un fallo.
6. **Certificado de origen.** Con la nube naranja, renovar el de Let's Encrypt deja
   de ser fiable. Cloudflare → SSL/TLS → Origin Server → crear uno para
   `*.panal.lat`, guardarlo en `/etc/caddy/origen.pem` y `origen.key` (dueño
   `caddy`, permisos 600) y en cada sitio del Caddyfile añadir
   `tls /etc/caddy/origen.pem /etc/caddy/origen.key`. **Solo con la nube naranja
   ya puesta:** los navegadores no se fían de este certificado, y a partir de
   aquí poner la nube gris tumba la API si no se quita antes.
7. **Cerrar el origen.** Solo con todo lo anterior bien. La IP de la máquina ya es pública, así que sin esto se
   puede atacar saltándose Cloudflare. Con una sesión SSH abierta de reserva:

   ```bash
   for r in $(curl -s https://www.cloudflare.com/ips-v4) $(curl -s https://www.cloudflare.com/ips-v6); do
     ufw allow proto tcp from "$r" to any port 80,443
   done
   ufw delete allow 80 ; ufw delete allow 443
   ufw status numbered
   ```

## Solución de problemas

| Síntoma | Causa típica | Fix |
|---|---|---|
| `curl` a HTTPS falla | DNS sin propagar | `dig bot.panal.lat` hasta que dé tu IP |
| Caddy no emite cert | Puerto 80 cerrado | `ufw allow 80` y `systemctl reload caddy` |
| 502 Bad Gateway | Bot caído o no escucha 8787 | `pm2 logs panal-bot`; `BOT_HTTP_PORT=8787` en `.env` |
| El cliente ve CORS error | Origen no permitido | `NODE_ENV=production` y usa `https://panal.lat` (no IP) |
