#!/usr/bin/env bash
#
# Publica mcp/server.json en el registro oficial de MCP
# (registry.modelcontextprotocol.io), con el nombre `lat.panal/panal`.
#
#   MCP_REGISTRY_KEY=/ruta/a/la-clave.pem  mcp/scripts/publicar-en-registro.sh
#
# POR QUÉ ASÍ Y NO CON `mcp-publisher`. El registro demuestra que el nombre es
# nuestro por el dominio: en https://panal.lat/.well-known/mcp-registry-auth
# está la clave PÚBLICA (public/.well-known/ de la web), y aquí se firma la
# hora con la PRIVADA. Eso es una firma Ed25519 y dos peticiones HTTP: OpenSSL
# y curl, sin bajar y ejecutar un binario de fuera.
#
# La clave privada NO está en el repo: vive en la máquina desde la que se
# publica (por defecto /root/.config/panal/mcp-registry-key.pem, permisos 600).
# Quien la tenga puede publicar bajo `lat.panal/*`, así que no se copia a
# ningún sitio. Si se pierde, se genera otra y se cambia el archivo de la web.
#
# CUÁNDO. Cada versión de panal-mcp que se publique en npm: el registro guarda
# una ficha por versión y no deja cambiar una ya publicada. Antes de correrlo,
# esa versión tiene que estar en npm CON `mcpName` en su package.json —el
# registro lo comprueba—, y la de server.json tiene que ser la misma.

set -euo pipefail
cd "$(dirname "$0")/.."

CLAVE="${MCP_REGISTRY_KEY:-/root/.config/panal/mcp-registry-key.pem}"
REGISTRO="${MCP_REGISTRY_URL:-https://registry.modelcontextprotocol.io}"
DOMINIO=panal.lat

[ -r "$CLAVE" ] || { echo "No puedo leer la clave privada en $CLAVE (MCP_REGISTRY_KEY)."; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# 1. La clave pública de la web tiene que ser la de esta clave privada.
esperada="v=MCPv1; k=ed25519; p=$(openssl pkey -in "$CLAVE" -pubout -outform DER | tail -c 32 | base64)"
# A un archivo y no a una tubería con `head`: con `pipefail`, `head` cortando
# a curl termina el script sin decir nada.
curl -fsS -m 15 -o "$tmp/publicada" "https://$DOMINIO/.well-known/mcp-registry-auth" || true
publicada="$(tr -d '\r' < "$tmp/publicada" 2>/dev/null | sed -n 1p)"
if [ "$publicada" != "$esperada" ]; then
  echo "La clave publicada en https://$DOMINIO/.well-known/mcp-registry-auth no es la de $CLAVE."
  echo "  publicada: ${publicada:0:80}"
  echo "  esperada:  $esperada"
  exit 1
fi

# 2. Las versiones cuadran, y la del paquete en npm lleva mcpName.
version="$(node -p "require('./server.json').version")"
nombre="$(node -p "require('./server.json').name")"
[ "$version" = "$(node -p "require('./package.json').version")" ] || {
  echo "server.json dice $version y package.json otra cosa: súbelas juntas."; exit 1; }
en_npm="$(npm view "panal-mcp@$version" mcpName 2>/dev/null || true)"
[ "$en_npm" = "$nombre" ] || {
  echo "panal-mcp@$version no está en npm con mcpName \"$nombre\" (tiene: \"${en_npm:-nada}\"). Publícalo primero."; exit 1; }

# 3. Firmar la hora (el registro acepta ±15 s) y cambiarla por un token.
hora="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '%s' "$hora" > "$tmp/hora"
openssl pkeyutl -sign -inkey "$CLAVE" -rawin -in "$tmp/hora" -out "$tmp/firma"
firma="$(od -An -tx1 -v "$tmp/firma" | tr -d ' \n')"
printf '{"domain":"%s","timestamp":"%s","signed_timestamp":"%s"}' "$DOMINIO" "$hora" "$firma" > "$tmp/auth.json"
curl -fsS -m 30 -X POST "$REGISTRO/v0/auth/http" -H 'content-type: application/json' --data @"$tmp/auth.json" > "$tmp/token.json" || {
  echo "El registro no aceptó la firma."; exit 1; }
token="$(node -p "require('$tmp/token.json').registry_token")"

# 4. Publicar.
codigo="$(curl -sS -m 60 -o "$tmp/respuesta.json" -w '%{http_code}' -X POST "$REGISTRO/v0/publish" \
  -H 'content-type: application/json' -H "authorization: Bearer $token" --data @server.json)"
cat "$tmp/respuesta.json"; echo
if [ "$codigo" != "200" ] && [ "$codigo" != "201" ]; then
  echo "El registro contestó $codigo."; exit 1
fi
echo "Publicado $nombre $version en $REGISTRO."
