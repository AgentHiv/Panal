#!/usr/bin/env bash
# Pone la máquina de la API (api.panal.lat y mcp.panal.lat) al día con main, con un solo comando:
#
#   bash bot/deploy/actualizar.sh           trae main y reinicia SOLO los procesos cuyo código cambió
#   bash bot/deploy/actualizar.sh --mirar   dice qué haría, sin tocar nada
#   bash bot/deploy/actualizar.sh --todo    reinicia todos los de Panal que corran aquí, cambien o no
#
# Solo toca los procesos de Panal que YA están en pm2 en esta máquina: no arranca ninguno
# nuevo ni toca los demás. Los reinicia de uno en uno, por nombre, con `startOrReload` y el
# entorno limpio (`env -i`): un pm2 lanzado desde SSH copia la IP de quien se conecta en el
# entorno de los procesos.
#
# Reiniciar solo lo que cambió importa: el indexador tarda ~30 s en rehacer el catálogo y el
# worker puede estar a medias de un encargo. Para saber con qué código arrancó cada proceso,
# apunta el commit en .git/panal-desplegado. Sin apunte (la primera vez), compara la hora de
# arranque del proceso con la del último cambio del repo; si no puede saberlo, lo reinicia.
#
# Lo que no lleva pm2 (Caddy, logrotate) solo lo avisa: se instala a mano.
#
# Salida: 0 bien · 1 algo falló (lo dice) · 2 no empezó (rama, cambios locales, otra en marcha).

set -euo pipefail

# Todo va dentro de main(): bash lee el script a trozos mientras lo ejecuta, y el merge de
# más abajo puede reescribir este mismo archivo a mitad de camino.
main() {
  local modo=normal
  case "${1:-}" in
    '') ;;
    --mirar) modo=mirar ;;
    --todo) modo=todo ;;
    *) echo "No conozco «$1». Usa --mirar, --todo o nada."; return 2 ;;
  esac

  local raiz gitdir apuntes eco
  raiz=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
  cd "$raiz"
  gitdir=$(git rev-parse --absolute-git-dir)
  apuntes="$gitdir/panal-desplegado"
  eco="bot/ecosystem.config.cjs"

  # Una sola a la vez: dos a la par se pisarían el pnpm install y los reinicios.
  exec 9>"$gitdir/panal-actualizar.lock"
  flock -n 9 || { echo "Ya hay otra actualización en marcha."; return 2; }

  local rama
  rama=$(git rev-parse --abbrev-ref HEAD)
  [ "$rama" = main ] || { echo "El repo está en «$rama», no en main. Vuelve a main (git checkout main) y lánzalo otra vez."; return 2; }
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "Hay cambios sin guardar en el repo y no actualizo encima de ellos:"
    git status --short --untracked-files=no
    return 2
  fi

  echo "→ Mirando main en GitHub…"
  git fetch -q origin main
  local antes nuevo
  antes=$(git rev-parse HEAD)
  nuevo=$(git rev-parse FETCH_HEAD)
  if ! git merge-base --is-ancestor "$antes" "$nuevo"; then
    echo "El main de aquí tiene commits que no están en GitHub; no lo piso. Míralo con: git log origin/main..main"
    return 2
  fi

  # Cuándo cambió el repo por última vez (el último apunte del reflog de HEAD), ANTES de traer
  # lo nuevo: un proceso que arrancó después de eso lleva el código de ahora.
  local ultimo_cambio=0
  if [ -s "$gitdir/logs/HEAD" ]; then
    ultimo_cambio=$(tail -n 1 "$gitdir/logs/HEAD" | cut -f1 | awk '{print $(NF-1)}')
  fi

  if [ "$antes" = "$nuevo" ]; then
    echo "  El código ya estaba al día ($(git log -1 --format='%h %s' "$antes"))."
  else
    local cuantos
    cuantos=$(git rev-list --count "$antes..$nuevo")
    if [ "$cuantos" = 1 ]; then echo "  Llega 1 commit:"; else echo "  Llegan $cuantos commits:"; fi
    git log --format='    %h %s' "$antes..$nuevo" | head -n 15
    if [ "$modo" != mirar ]; then
      git merge -q --ff-only "$nuevo"
    fi
  fi

  # Qué código carga cada proceso. El ecosystem va en todos porque cambia cómo arrancan.
  local -A rutas=(
    [panal-mcp-remoto]="mcp/src mcp/package.json sdk/src sdk/package.json pnpm-lock.yaml $eco"
    [panal-buzon]="bot/src bot/package.json bot/pnpm-lock.yaml bot/tsconfig.json $eco"
    [panal-indexer]="bot/src bot/package.json bot/pnpm-lock.yaml bot/tsconfig.json $eco"
    [panal-worker]="bot/src bot/package.json bot/pnpm-lock.yaml bot/tsconfig.json $eco"
  )
  # El worker, el último: es el que cobra, y si algo falla antes no se le toca.
  local orden=(panal-mcp-remoto panal-buzon panal-indexer panal-worker)

  local estado
  estado=$(estado_pm2) || { echo "No pude leer pm2. ¿Está instalado y es este el usuario que lleva los procesos?"; return 2; }

  echo "→ Procesos:"
  local -a reiniciar=()
  local nombre linea apunte desde motivo
  for nombre in "${orden[@]}"; do
    linea=$(awk -v n="$nombre" '$1 == n' <<<"$estado")
    if [ -z "$linea" ]; then
      echo "  $nombre: no corre en esta máquina; no lo toco."
      continue
    fi
    # Uno parado lo está a propósito (o por algo que hay que mirar): no se arranca de rebote.
    if [ "$(awk '{print $2}' <<<"$linea")" != online ]; then
      echo "  $nombre: está «$(awk '{print $2}' <<<"$linea")» en pm2; no lo toco. Míralo con: pm2 logs $nombre --lines 60"
      continue
    fi
    apunte=$(awk -v n="$nombre" '$1 == n {print $2}' "$apuntes" 2>/dev/null || true)
    desde=""
    if [ -n "$apunte" ] && git cat-file -e "$apunte^{commit}" 2>/dev/null; then
      desde=$apunte
    elif [ "$ultimo_cambio" -gt 0 ] && [ "$(awk '{print int($3 / 1000)}' <<<"$linea")" -gt "$ultimo_cambio" ]; then
      desde=$antes
    fi

    if [ "$modo" = todo ]; then
      motivo="--todo"
    elif [ -z "$desde" ]; then
      motivo="no sé con qué código arrancó"
    elif ! git diff --quiet "$desde" "$nuevo" -- ${rutas[$nombre]}; then
      motivo="cambió su código"
    else
      echo "  $nombre: al día."
      # Queda apuntado, para no tener que deducirlo la próxima vez.
      [ "$modo" = mirar ] || apuntar "$apuntes" "$nombre" "$nuevo"
      continue
    fi
    echo "  $nombre: hay que reiniciarlo ($motivo)."
    reiniciar+=("$nombre")
  done

  # Lo que pm2 no recoge: hay que copiarlo a su sitio a mano.
  local manual
  manual=$(git diff --name-only "$antes" "$nuevo" -- bot/deploy/Caddyfile bot/deploy/caddy-resiliencia.conf bot/deploy/logrotate.conf)
  if [ -n "$manual" ]; then
    echo "→ Ojo, cambió y no lo instalo yo (cópialo a su sitio y recarga lo que toque):"
    sed 's/^/    /' <<<"$manual"
  fi

  if [ "$modo" = mirar ]; then
    echo "Solo miraba: no he tocado nada."
    return 0
  fi
  if [ ${#reiniciar[@]} -eq 0 ]; then
    echo "✓ Nada que reiniciar."
    return 0
  fi

  # Dependencias y comprobación de tipos ANTES de reiniciar nada: si fallan, los procesos
  # siguen con el código de antes, que ya tienen cargado.
  local bot=0 mcp=0
  for nombre in "${reiniciar[@]}"; do
    case "$nombre" in
      panal-mcp-remoto) mcp=1 ;;
      *) bot=1 ;;
    esac
  done
  if [ $bot = 1 ]; then
    echo "→ Bot: dependencias y tipos…"
    if ! (cd bot && pnpm install --frozen-lockfile && pnpm exec tsc --noEmit); then
      no_reinicio "$antes" "$nuevo"
      return 1
    fi
  fi
  if [ $mcp = 1 ]; then
    echo "→ MCP: dependencias, SDK y tipos…"
    if ! (pnpm install --frozen-lockfile && pnpm --filter @panal/sdk build && pnpm --filter panal-mcp typecheck); then
      no_reinicio "$antes" "$nuevo"
      return 1
    fi
  fi

  for nombre in "${reiniciar[@]}"; do
    echo "→ Reiniciando $nombre…"
    pm2_limpio startOrReload "$eco" --only "$nombre" --update-env >/dev/null
    # Ocho segundos y tiene que seguir en marcha y sin haberse vuelto a reiniciar solo.
    sleep 8
    linea=$(awk -v n="$nombre" '$1 == n' <<<"$(estado_pm2 || true)")
    if awk -v ahora="$(date +%s)" '$2 == "online" && ahora - int($3 / 1000) >= 5 {ok = 1} END {exit !ok}' <<<"$linea"; then
      apuntar "$apuntes" "$nombre" "$nuevo"
      echo "  ✓ $nombre en marcha."
    else
      echo "  ✗ $nombre no ha quedado en marcha. Mira: pm2 logs $nombre --lines 60"
      echo "    No sigo con los demás para no tirar nada más."
      pm2_limpio save >/dev/null
      return 1
    fi
  done

  pm2_limpio save >/dev/null
  echo "✓ Al día con $(git log -1 --format='%h %s' "$nuevo")."
}

# pm2 sin el entorno de la sesión (SSH_CLIENT, SSH_CONNECTION…), que acabaría en los procesos.
pm2_limpio() {
  env -i HOME="$HOME" PATH="$PATH" LANG=C.UTF-8 pm2 "$@"
}

# Una línea por proceso: nombre, estado, arranque (ms desde 1970).
estado_pm2() {
  pm2_limpio jlist 2>/dev/null | node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      // pm2 puede escribir avisos antes; el JSON es la última línea que empieza por «[».
      const json = s.split("\n").filter((l) => l.startsWith("[")).pop() || "[]";
      for (const p of JSON.parse(json)) console.log(p.name, p.pm2_env.status, p.pm2_env.pm_uptime || 0);
    });'
}

# Guarda «nombre commit» en el archivo de apuntes, sustituyendo el anterior.
apuntar() {
  local archivo=$1 nombre=$2 commit=$3
  { grep -v "^$nombre " "$archivo" 2>/dev/null || true; echo "$nombre $commit"; } >"$archivo.tmp"
  mv "$archivo.tmp" "$archivo"
}

no_reinicio() {
  local antes=$1 nuevo=$2
  echo "✗ No reinicio nada: los procesos siguen con el código que ya tenían cargado."
  if [ "$antes" != "$nuevo" ]; then
    echo "  Pero el código nuevo ya está en disco, y si pm2 reiniciara alguno por su cuenta cargaría ese."
    echo "  Para dejar el disco como estaba: git reset --hard $antes"
  fi
}

# En la misma línea que la llamada: bash ya la ha leído entera, y no vuelve a leer del archivo
# (que el merge puede haber cambiado) después de main.
main "$@"; exit $?
