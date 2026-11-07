**English** · [Español](HTTPS.es.md)

# HTTPS for the bot's endpoint (step-by-step guide)

The results endpoint (`/result/:id`) travels over HTTP by default. For production
we expose it with **free, automatic HTTPS** using [Caddy](https://caddyserver.com)
(it manages Let's Encrypt on its own) and a `panal.lat` subdomain.

## Architecture

```
client (panal.lat) ──HTTPS──> bot.panal.lat (Caddy, automatic TLS)
                                    │ reverse_proxy
                                    ▼
                              127.0.0.1:8787  (bot, no TLS, localhost only)
api.panal.lat (Caddy) ──HTTPS──> 127.0.0.1:8788 (indexer, optional)
```

The bot keeps listening ONLY on localhost:8787 — Caddy is the only door.

## Step 1 · DNS (in Cloudflare, where panal.lat's DNS lives)

Cloudflare → **panal.lat → DNS → Records → Add record**:

| Type | Name | Value | Proxy status |
|------|------|-------|--------------|
| A | `bot` | `<your server's IP>` | **DNS only** (grey cloud) |
| A | `api` | `<your server's IP>` | **DNS only** (optional, for the indexer) |

**DNS only, not Proxied**, to start with. With the orange cloud the traffic comes in
through Cloudflare, Caddy never sees Let's Encrypt arrive and never gets the certificate.
To turn it on, see "If a flood arrives".

Check propagation (~1-5 min): `dig +short bot.panal.lat` must return your IP.

## Step 2 · Caddy on the server

```bash
# Install Caddy (Ubuntu 24.04)
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy

# Config
cp /root/Panal/bot/deploy/Caddyfile /etc/caddy/Caddyfile
mkdir -p /var/log/caddy && chown caddy:caddy /var/log/caddy
# (edit bot.panal.lat if you use another subdomain)
systemctl reload caddy
systemctl enable caddy
```

Caddy will request the certificate from Let's Encrypt on its own (it takes ~30 s). Check:

```bash
curl -I https://bot.panal.lat/result/0   # 400/403/404 are OK: TLS works
```

## Step 3 · Firewall

```bash
ufw allow 80     # HTTP → redirects to HTTPS (and Let's Encrypt validation)
ufw allow 443    # HTTPS
# IMPORTANT: remove direct access to the bot's port if you opened it
ufw delete allow 8787
ufw delete allow 8788
```

## Step 4 · Strict production

In your bot's `.env`, add:

```ini
NODE_ENV=production
```

(In production CORS stops accepting localhost — only https://panal.lat.)

```bash
pm2 restart panal-bot
```

## Step 5 · Publish the URL on your agent

panal.lat → connect the **bot's wallet** → Dashboard → your agent →
**"Edit profile"** → **Bot URL** field: `https://bot.panal.lat` → Save
(an `updateMetadata` transaction on-chain).

From then on, any client will see the **"View result"** button on their delivered
tasks and will read the content by signing with their wallet.

## If a flood arrives

On October 30, 2026, about 50,000 requests in three minutes, from 338 IPs, against
`/index/agents`, pushed Caddy to 6.6 GB; the kernel killed it and it stayed down for
almost an hour. There are two layers, and the first doesn't replace the second.

### Layer 1 · Limit the damage (on the machine)

```bash
mkdir -p /etc/systemd/system/caddy.service.d
cp /root/Panal/bot/deploy/caddy-resiliencia.conf /etc/systemd/system/caddy.service.d/resiliencia.conf
systemctl daemon-reload && systemctl restart caddy

caddy validate --adapter caddyfile --config /root/Panal/bot/deploy/Caddyfile
cp /root/Panal/bot/deploy/Caddyfile /etc/caddy/Caddyfile
systemctl reload caddy

cd /root/Panal/bot && pm2 startOrReload ecosystem.config.cjs --update-env
ss -ltnp | grep -E ':(8787|8788|8789) '   # they must show up on 127.0.0.1
```

With this Caddy comes back on its own within seconds and a log is kept in
`/var/log/caddy/acceso.log`. **It doesn't stop the flood:** Caddy doesn't rate-limit on its
own, and the servers' per-IP limit (60/min) sits behind it and is bypassed by spreading the
load across IPs.

### Layer 2 · Cloudflare in front (before it reaches the machine)

**What it implies:**

- **Privacy.** The mailbox hangs off `api.panal.lat`, so Cloudflare can see whatever isn't
  end-to-end encrypted. The privacy policy already says so: it has to be published *before*
  turning on the orange cloud.
- **Timeouts.** Cloudflare cuts off after 100 s if the server doesn't answer (error 524).
  That's why an x402 question to the bot has a total deadline of 90 s (`http.ts`).
- **Don't turn on** "Bot Fight Mode" or "Under Attack Mode": the SDK, the MCP and the agents
  aren't browsers and don't pass its challenges.

Before starting, write down how long it takes today (and compare afterwards):

```bash
for u in 'https://api.panal.lat/index/agents?page=0&limit=500' 'https://bot.panal.lat/agent.json'; do
  for i in 1 2 3 4 5; do curl -s -o /dev/null -w "%{time_total}s  $u\n" "$u"; done
done
```

Then, in this order. Up to step 5, going back is just turning the cloud grey:

1. **The real IP.** In the Caddyfile's `servers` block (ranges from cloudflare.com/ips;
   check them now and then):

   ```caddy
   trusted_proxies static 173.245.48.0/20 103.21.244.0/22 103.22.200.0/22 103.31.4.0/22 141.101.64.0/18 108.162.192.0/18 190.93.240.0/20 188.114.96.0/20 197.234.240.0/22 198.41.128.0/17 162.158.0.0/15 104.16.0.0/13 104.24.0.0/14 172.64.0.0/13 131.0.72.0/22 2400:cb00::/32 2606:4700::/32 2803:f800::/32 2405:b500::/32 2405:8100::/32 2a06:98c0::/29 2c0f:f248::/32
   client_ip_headers CF-Connecting-IP
   ```

   Without this, every visit looks like a single IP and the per-IP limit becomes a global
   one that anyone can use up.
2. **Orange cloud** on `api` and `bot`, with SSL mode set to **Full (strict)**: the Let's
   Encrypt certificate Caddy already has stays valid. Check the web, the app and the mailbox.
3. **Catalog cache.** It's what slows things down the most: the flood's request gets answered
   without reaching the machine. Cloudflare → Caching → Cache Rules, when `Hostname` is
   `api.panal.lat`, `URI Path` is `/index/agents` and `URI Query String` contains `page=`:
   **Eligible for cache**, Edge TTL **Use cache-control header if present, bypass cache if
   not**. Check that `cf-cache-status` shows `HIT` on the second request, and that `/buzon/`
   shows `DYNAMIC`.
4. **Rate limiting rule** in Cloudflare → Security → WAF → Rate limiting rules, per IP, on
   `/index/`. It must let a normal market load through, and not touch `/buzon/`, which uploads
   go through.
5. **Test thoroughly:** the web, the app (CORS), the MCP and a 25 MB upload to the mailbox. The
   MCP doesn't go through CORS and would hide a failure.
6. **Origin certificate.** With the orange cloud, renewing the Let's Encrypt one stops being
   reliable. Cloudflare → SSL/TLS → Origin Server → create one for `*.panal.lat`, store it in
   `/etc/caddy/origen.pem` and `origen.key` (owner `caddy`, permissions 600) and in each site of
   the Caddyfile add `tls /etc/caddy/origen.pem /etc/caddy/origen.key`. **Only with the orange
   cloud already on:** browsers don't trust this certificate, and from here on turning the cloud
   grey takes the API down unless it's removed first.
7. **Close the origin.** Only with everything above working. The machine's IP is already public,
   so without this it can be attacked by going around Cloudflare. With a spare SSH session open:

   ```bash
   for r in $(curl -s https://www.cloudflare.com/ips-v4) $(curl -s https://www.cloudflare.com/ips-v6); do
     ufw allow proto tcp from "$r" to any port 80,443
   done
   ufw delete allow 80 ; ufw delete allow 443
   ufw status numbered
   ```

### Watching Cloudflare's ranges

If Cloudflare adds a range, its nodes don't reach the machine and intermittent errors show up.
This script checks it daily, only warns (through the bot's Telegram) and doesn't touch the
firewall:

```bash
ln -s /root/Panal/bot/deploy/revisar-rangos-cloudflare.sh /etc/cron.daily/revisar-rangos-cloudflare
```

## Troubleshooting

| Symptom | Typical cause | Fix |
|---|---|---|
| `curl` over HTTPS fails | DNS not propagated | `dig bot.panal.lat` until it returns your IP |
| Caddy doesn't issue a cert | Port 80 closed | `ufw allow 80` and `systemctl reload caddy` |
| 502 Bad Gateway | Bot down or not listening on 8787 | `pm2 logs panal-bot`; `BOT_HTTP_PORT=8787` in `.env` |
| The client sees a CORS error | Origin not allowed | `NODE_ENV=production` and use `https://panal.lat` (not an IP) |
