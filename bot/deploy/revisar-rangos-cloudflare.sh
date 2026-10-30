#!/usr/bin/env bash
# ¿Sigue el firewall al día con los rangos de Cloudflare?
#
# La máquina de la API solo acepta 80 y 443 desde Cloudflare, y Caddy solo se fía
# de esos rangos para saber la IP real (ver HTTPS.md). Si Cloudflare añade uno, sus
# nodos no llegan y hay errores intermitentes, sin nada que lo explique en el log.
# Rara vez cambian, así que nadie se acordaría de mirarlo: esto se ejecuta a diario.
#
# Solo mira y avisa: no toca ufw. Abrir el firewall por lo que diga una descarga
# sería dejar que esa descarga decida quién entra.
#
# Salida: 0 todo cuadra · 1 hay diferencias · 2 no se pudo comprobar.
set -uo pipefail

CADDYFILE="${CADDYFILE:-/etc/caddy/Caddyfile}"
ENV_BOT="${ENV_BOT:-/root/Panal/bot/.env}"
URL_V4="${URL_V4:-https://www.cloudflare.com/ips-v4}"
URL_V6="${URL_V6:-https://www.cloudflare.com/ips-v6}"

avisar() {
  echo "$1"
  [ -r "$ENV_BOT" ] || return 0
  # Sin imprimir nada del .env, y el token por stdin: en la línea de comandos lo
  # vería cualquiera con `ps`.
  local token chat
  token=$(sed -n 's/^TELEGRAM_BOT_TOKEN=//p' "$ENV_BOT" | head -1)
  chat=$(sed -n 's/^TELEGRAM_CHAT_ID=//p' "$ENV_BOT" | head -1)
  [ -n "$token" ] && [ -n "$chat" ] || return 0
  printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "$token" |
    curl -s -m 20 -o /dev/null --config - --data-urlencode "chat_id=$chat" --data-urlencode "text=$1" || true
}

# Una descarga fallida o rara no es un cambio de rangos: se dice otra cosa.
oficiales=$( { curl -fsS -m 20 "$URL_V4"; echo; curl -fsS -m 20 "$URL_V6"; echo; } 2>/dev/null | sed '/^$/d' | sort -u)
total=$(printf '%s\n' "$oficiales" | grep -c . || true)
if [ "$total" -lt 15 ] || printf '%s\n' "$oficiales" | grep -qvE '^[0-9a-fA-F:.]+/[0-9]{1,3}$'; then
  avisar "Panal: no pude comprobar los rangos de Cloudflare (la lista no parece válida: $total líneas)."
  exit 2
fi

en_ufw=$(ufw status | awk '$1 ~ /^80,443/ && $2 == "ALLOW" {print $3}' | sort -u)
en_caddy=$(grep -E '^[[:space:]]*trusted_proxies[[:space:]]+static' "$CADDYFILE" | tr -s ' \t' '\n' | grep -E '^[0-9a-fA-F:.]+/[0-9]{1,3}$' | sort -u)

faltan_ufw=$(comm -23 <(printf '%s\n' "$oficiales") <(printf '%s\n' "$en_ufw"))
sobran_ufw=$(comm -13 <(printf '%s\n' "$oficiales") <(printf '%s\n' "$en_ufw"))
faltan_caddy=$(comm -23 <(printf '%s\n' "$oficiales") <(printf '%s\n' "$en_caddy"))
sobran_caddy=$(comm -13 <(printf '%s\n' "$oficiales") <(printf '%s\n' "$en_caddy"))

if [ -z "$faltan_ufw$sobran_ufw$faltan_caddy$sobran_caddy" ]; then
  echo "Rangos de Cloudflare al día ($total)."
  exit 0
fi

lista() { printf '%s' "$1" | tr '\n' ' '; }
avisar "Panal: los rangos de Cloudflare han cambiado. Actualiza ufw y trusted_proxies (bot/HTTPS.md).
Faltan en ufw: $(lista "$faltan_ufw")
Sobran en ufw: $(lista "$sobran_ufw")
Faltan en Caddy: $(lista "$faltan_caddy")
Sobran en Caddy: $(lista "$sobran_caddy")"
exit 1
