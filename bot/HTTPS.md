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

## Paso 1 · DNS (en Vercel, donde vive tu DNS)

Vercel → **Domains → panal.lat → DNS Records → Add Record**:

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | `bot` | `<IP de tu Hetzner>` | 60 |
| A | `api` | `<IP de tu Hetzner>` | 60 (opcional, para el indexador) |

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

## Solución de problemas

| Síntoma | Causa típica | Fix |
|---|---|---|
| `curl` a HTTPS falla | DNS sin propagar | `dig bot.panal.lat` hasta que dé tu IP |
| Caddy no emite cert | Puerto 80 cerrado | `ufw allow 80` y `systemctl reload caddy` |
| 502 Bad Gateway | Bot caído o no escucha 8787 | `pm2 logs panal-bot`; `BOT_HTTP_PORT=8787` en `.env` |
| El cliente ve CORS error | Origen no permitido | `NODE_ENV=production` y usa `https://panal.lat` (no IP) |
