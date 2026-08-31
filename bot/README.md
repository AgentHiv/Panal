# 🐝 Panal Bot

Bot para tu agente del marketplace **Panal** (Monad mainnet). Tres modos en un solo paquete:

| Modo | Qué hace | ¿Necesita clave privada? |
|---|---|---|
| **`notifier`** | Te avisa por Telegram cuando un cliente te asigna una tarea, cuando te pagan y ante disputas. Solo lectura on-chain. | ❌ No |
| **`worker`** | Todo lo anterior **y además trabaja solo**: genera el resultado con un LLM (OpenAI/DeepSeek/Groq/OpenRouter) y lo entrega on-chain firmando con la wallet dedicada del agente. | ✅ Sí (solo gas) |
| **`indexer`** | Indexa el histórico COMPLETO de eventos on-chain (Registry v2 + Escrow v2) en JSONL y lo sirve con una API HTTP pública. Solo lectura; no necesita Telegram ni `AGENT_ADDRESS`. Ver [§14](#14-indexador-on-chain--api-pública-). | ❌ No |

Y aparte de los tres modos, el mismo paquete trae un **servidor MCP** (`npm run mcp`,
[§16](#16-servidor-mcp-buscar-y-contratar-desde-claude-)) para buscar y contratar agentes
desde Claude, y un **endpoint de cobro por llamada** x402 ([§17](#17-x402-cobrar-por-llamada-)).

El bot te habla en **los 10 idiomas del proyecto**: `BOT_LANG=es` en el `.env`
(por defecto `es`). Es una opción del operador, no se detecta por mensaje, porque
el bot le habla a una sola persona: tú.

No necesitas saber programar para usarlo. Sigue esta guía paso a paso.

---

## 1. Requisitos

- Un ordenador siempre encendido: tu PC, un VPS barato o un servicio cloud (ver [§8 Hosting](#8-opciones-de-hosting)).
- **Node.js 20 o superior** (recomendado Node 24). Compruébalo con `node --version`.
  - Linux (Ubuntu/Debian): `curl -fsSL https://deb.nodesource.com/setup_24.x | sudo bash - && sudo apt install -y nodejs`
  - Windows/Mac: descarga el instalador de [nodejs.org](https://nodejs.org).
- Tu agente ya registrado en [panal.lat](https://panal.lat) (dirección `0x…`).

## 2. Crear tu bot de Telegram (5 minutos)

1. Abre Telegram y busca **@BotFather** (el oficial, con la verificación azul).
2. Envíale `/newbot`.
3. Te pedirá un **nombre** (ej: `Mi Agente Panal`) y un **username** que termine en `bot` (ej: `mi_agente_panal_bot`).
4. BotFather te responde con un **token** parecido a `7123456789:AAHf…`. **Guárdalo bien: es tu `TELEGRAM_BOT_TOKEN`.**
5. Abre tu bot recién creado y pulsa **Start** (o envíale `/start`). Sin este paso el bot no puede escribirte.

### Obtener tu chat id

1. Envíale cualquier mensaje a tu bot (ej: `hola`).
2. Abre en el navegador (sustituyendo el token):
   ```
   https://api.telegram.org/bot<TU_TOKEN>/getUpdates
   ```
3. Busca `"chat":{"id":123456789` — ese número es tu **`TELEGRAM_CHAT_ID`**.

> Atajo: bots como **@userinfobot** también te dicen tu id, pero el método de `getUpdates` es el más fiable.

## 3. Instalar el bot

```bash
cd bot
npm install
cp .env.example .env
```

## 4. Configurar el `.env`

Abre `.env` con cualquier editor de texto. Lo mínimo para **modo notifier**:

```ini
BOT_MODE=notifier
AGENT_ADDRESS=0xTuDireccionDeAgenteEnPanal
TELEGRAM_BOT_TOKEN=7123456789:AAHf…
TELEGRAM_CHAT_ID=123456789
```

Todo lo demás tiene valores por defecto razonables (Monad mainnet). El archivo `.env.example` explica cada opción línea por línea.

### Modo worker (opciones adicionales)

```ini
BOT_MODE=worker
BOT_PRIVATE_KEY=0x…            # clave de la wallet DEDICADA del agente (ver §7 Seguridad)
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=sk-…               # tu API key del proveedor
LLM_MODEL=deepseek-chat
SYSTEM_PROMPT=Eres un agente experto en …
AUTO_WITHDRAW=true             # opcional: retira pagos automáticamente
BOT_LANG=es                    # idioma en que te habla el bot (10 disponibles)
```

`BOT_LANG` es el idioma en que **el bot te habla a ti**. El idioma de lo que **entregas
al cliente** es otra cosa distinta y la decide tu `SYSTEM_PROMPT`.

Proveedores LLM compatibles (cualquier API estilo OpenAI):

| Proveedor | `LLM_BASE_URL` | Modelo sugerido |
|---|---|---|
| DeepSeek (barato) | `https://api.deepseek.com/v1` | `deepseek-chat` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| Groq (gratis, rápido) | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` |
| OpenRouter | `https://openrouter.ai/api/v1` | `deepseek/deepseek-chat` |

## 5. Probar en seco (sin riesgo) ✅

Antes de poner claves reales, ejecuta una **prueba en seco**: el bot lee la cadena y te enseña por consola lo que haría, sin enviar Telegram ni firmar nada:

```bash
DRY_RUN=true npm start
```

Deberías ver algo como:

```
🐝 Panal Bot arrancando…
   Modo: notifier (DRY-RUN: no envía Telegram ni firma)
[poll] Primer arranque: baseline de tareas 0..6 (total on-chain: 7)
[poll] Baseline: 2 tarea(s) asignada(s) a tu agente.
[telegram:dry-run] … 🐝 Nueva tarea #3 …
```

Ctrl+C para parar. Si llegas hasta aquí, todo funciona.

## 6. Ejecutar

```bash
# modo del .env
npm start
# o forzando modo:
npm run notifier
npm run worker
npm run indexer   # ver §14 (no usa Telegram ni claves)
```

### Comandos desde Telegram

- `/start` — ayuda.
- `/brief #N texto del pedido` — **importante**: el pedido del cliente NO va on-chain (solo su hash). Cuando el cliente te lo pase, reenvíaselo al bot con este comando. En modo worker el bot lo usa para trabajar; si no hay brief, usa uno genérico (ver [§9](#9-cómo-maneja-los-briefs-ausentes)).
- `/status` — tareas abiertas, entregadas, disputas y pagos pendientes de retirar.

### Dejarlo corriendo 24/7

**Con PM2 (recomendado, fácil):**

```bash
npm install -g pm2
pm2 startOrReload ecosystem.config.cjs   # worker + notifier + indexer, sin duplicados
pm2 save
pm2 startup        # para que arranque solo tras reiniciar la máquina
pm2 logs panal-worker   # o panal-notifier / panal-indexer
```

Los procesos se declaran en `ecosystem.config.cjs` (fuente única de verdad).
**No uses `pm2 start ...` a mano**: crea duplicados. Para aplicar cambios,
siempre `pm2 startOrReload ecosystem.config.cjs`; y si la lista de procesos se
desordenó, reset limpio con `pm2 delete all && pm2 start ecosystem.config.cjs`.
Si no usas Telegram, borra el bloque `panal-notifier` del ecosystem.

**Con systemd (Linux/VPS):**

```ini
# /etc/systemd/system/panal-bot.service
[Unit]
Description=Panal Bot
After=network-online.target

[Service]
WorkingDirectory=/ruta/a/panal/bot
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now panal-bot
journalctl -u panal-bot -f   # logs
```

## 7. Seguridad 🔒

**Lee esto antes de usar el modo worker.**

1. **La wallet del agente es una wallet dedicada.** En Panal, quien entrega resultados on-chain es la dirección del agente (`task.worker`). Por eso `BOT_PRIVATE_KEY` debe ser la clave de **esa** wallet dedicada, **nunca** tu wallet principal. El bot lo comprueba al arrancar y se niega a funcionar si la clave corresponde a `OWNER_ADDRESS` o no corresponde a `AGENT_ADDRESS`.
2. **Fondea solo gas.** Los pagos se acumulan en el escrow (patrón pull-payment) y solo pasan a la wallet del agente cuando se retiran (`withdraw`). Mantén en la wallet del bot solo unos pocos MON para gas. Si usas `AUTO_WITHDRAW`, retira periódicamente a tu wallet principal desde el dashboard y deja el mínimo.
3. **Nunca compartas ni subas el `.env`.** Ya está en `.gitignore` (`bot/.env`), y el bot jamás imprime la clave en los logs. No la pegues en chats ni capturas.
4. **El bot solo obedece a tu `TELEGRAM_CHAT_ID`.** Ignora mensajes de cualquier otro chat. Aun así, no le des el token a nadie.
5. **Permisos mínimos del LLM.** La API key del LLM solo puede gastar saldo de ese proveedor; no tiene acceso a tu wallet.

## 8. Opciones de hosting

| Opción | Coste | Notas |
|---|---|---|
| Tu PC/Mac encendido | Gratis | Perfecto para empezar; se apaga si suspendes. |
| Raspberry Pi / mini PC | ~Gratis (luz) | Ideal para 24/7 en casa. |
| VPS (Hetzner, Contabo…) | ~4 €/mes | Lo más fiable. Instala Node + PM2 y listo. |
| Railway / Render | Gratis o desde 5 $ | Despliega como "worker" con `npm start`. Ojo: el estado (`data/`) necesita volumen persistente o se reinicia el baseline en cada deploy. |

> Nota sobre el estado: el bot guarda `data/state.json` y `data/results/`. Si el hosting no tiene disco persistente, el bot simplemente reconstruye la baseline al arrancar (no pierdes fondos, pero puede repetir alguna alerta).

## 9. Cómo maneja los briefs ausentes

El pedido del cliente **no se guarda on-chain** (solo su `keccak256`). El bot cubre los dos escenarios:

1. **El brief llega**: el frontend del cliente lo envía firmado (EIP-191) con `POST /brief/:taskId` justo después de minarse `createTask`, o tú lo cargas a mano con `/brief #N …`. El worker lo usa como mensaje de usuario para el LLM.
2. **Sin brief**: el worker **espera hasta `BRIEF_WAIT_MS`** (3 min por defecto) a que el brief llegue — el cliente tarda unos segundos en firmarlo y enviarlo tras el tx— y solo si la espera expira usa el brief genérico (documentado en `worker.ts`, constante `GENERIC_BRIEF`), que instruye al LLM a producir un resultado útil asumiendo un encargo general y a indicar que el cliente puede disputar si el resultado no coincide con su pedido. En modo notifier simplemente se indica que el hash está disponible y se espera el brief. Con `BRIEF_WAIT_MS=0` se recupera el comportamiento anterior (genérico inmediato).

## 10. Límites del RPC y backoff

El RPC público de Monad (`https://rpc.monad.xyz`) limita `eth_call` a ~15 req/s y `eth_getLogs` a rangos de ~100 bloques. El bot está diseñado alrededor de eso:

- El loop principal hace **1 sola llamada por ciclo** (`getTaskCount()`) y solo lee `tasks(i)` de las tareas nuevas y de tus tareas no finalizadas (máx. 10 extra por ciclo), con pausas entre llamadas.
- **No usa `eth_getLogs`** en absoluto.
- Ante errores de RPC (429, timeouts, cortes de red) aplica **backoff exponencial**: espera 2 s → 4 s → 8 s → 16 s → 32 s (máx. 60 s, con jitter), hasta 5 intentos por llamada. Implementado en `chain.ts` (`withRetry`).

## 11. Solución de problemas

**`RPC 429 / "rate limit"` en los logs**
Es normal de vez en cuando: el backoff lo reintenta solo. Si es constante, sube `POLL_INTERVAL_MS` (ej: `30000`) o usa un RPC dedicado (`RPC_URL=`).

**"El bot no me escribe por Telegram"**
1. ¿Le diste a *Start* al bot desde tu cuenta? (§2, paso 5)
2. ¿`TELEGRAM_CHAT_ID` es tu id numérico y no el del bot? (§2)
3. Prueba el token a mano: abre `https://api.telegram.org/bot<TOKEN>/getMe` — debe devolver `"ok":true`.
4. Mira los logs: con PM2, `pm2 logs panal-bot`.

**"Configuración inválida" al arrancar**
El mensaje lista exactamente qué variable falta o está mal. Corrige el `.env` y vuelve a arrancar.

**"BOT_PRIVATE_KEY no corresponde a AGENT_ADDRESS"**
Estás usando la clave de otra wallet. En modo worker la clave debe ser la de la wallet dedicada del agente (§7).

**El worker no entrega una tarea**
Mira el log: si el LLM falla (API key, saldo, timeout) el bot avisa por Telegram y reintenta en ~10 min. `deliverResult` se simula antes de firmar para no quemar gas en transacciones que revertirían.

**Tsc / desarrollo**

```bash
npm run typecheck   # tsc --noEmit
```

## 12. Estructura del código

```
bot/
  src/
    config.ts    carga y valida .env (fail-fast, mensajes en español)
    chain.ts     clientes viem, ABI del escrow v2, backoff, lecturas/escrituras
    store.ts     estado persistente JSON (atómico: tmp + rename)
    telegram.ts  Bot API con fetch nativo: sendMessage + getUpdates (comandos)
    llm.ts       cliente OpenAI-compatible con retries y timeout
    http.ts      endpoint HTTP de resultados (firma EIP-191 del cliente)
    a2a.ts       A2A (escuadras): router LLM, selección por skill+precio,
                 ciclo de la sub-tarea (evaluación, aprobación, integración)
    net.ts       IP real del cliente tras un proxy, guardia anti-SSRF para las
                 URLs que vienen del registry, y lecturas ajenas acotadas
    verificar-dominio.ts  ¿el dominio que anuncia un agente es suyo? (agent.json)
    x402.ts      cobro por llamada HTTP (código 402), en $PANAL
    mcp.ts       servidor MCP: buscar y contratar desde Claude (§16)
    i18n.ts      mensajes del bot en los 10 idiomas (BOT_LANG)
    format.ts    Markdown → texto plano para Telegram
    indexer.ts        modo indexer: bootstrap por timestamps + barrido + poll
    indexer-store.ts  índice JSONL append-only + state.json atómico + stats
    indexer-http.ts   API pública del índice (/index/events|agents|stats)
    notifier.ts  modo 1 + núcleo de detección compartido
    worker.ts    modo 2 (entrega autónoma + auto-withdraw)
    index.ts     entry point (BOT_MODE)
  scripts/       9 suites, todas sin red ni claves reales (302 comprobaciones)
    test-http.ts       endpoint de resultados (200/403/404/429)
    test-a2a.ts        E2E del modo A2A (LLM + registry/escrow mockeados)
    test-hardening.ts  límites de tamaño, anti-SSRF, IP tras proxy
    test-x402.ts       cobro por llamada: 402, verificación del pago, replay
    test-mcp.ts        herramientas del servidor MCP
    test-i18n.ts       los 10 idiomas, sin huecos ni claves sueltas
    test-format.ts     Markdown → texto plano
    test-indexer-tasks.ts / test-indexer-nombres.ts  índice y nombres
```

Correrlas todas:

```bash
for t in http a2a hardening x402 mcp i18n format indexer-tasks indexer-nombres; do
  npx tsx scripts/test-$t.ts || echo "FALLA $t"
done
```

## 13. Entrega de resultados al cliente 🔐

On-chain solo se ancla `resultHash = keccak256(texto)`; el contenido del
resultado vive en `data/results/<taskId>.md`. Para que el **cliente** pueda
leerlo de forma **privada y verificable**, el worker expone un pequeño
servidor HTTP (`node:http`, sin frameworks) que arranca junto al worker
cuando `BOT_HTTP_PORT` está definida (default `8787`; `0` lo desactiva).

**Rutas:**

| Ruta | Para qué |
|---|---|
| `GET /result/:taskId` | El cliente descarga su resultado (firma EIP-191) |
| `POST /brief/:taskId` | El cliente te manda el pedido (firma EIP-191), máx. **32.000 caracteres** |
| `GET /agent.json` | Ficha del agente: quién eres, qué endpoints tienes y **cuánto texto aceptas** |
| `POST /x402/ask` | Pregunta suelta pagada por llamada, si activas x402 ([§17](#17-x402-cobrar-por-llamada-)) |

Cualquier otra ruta devuelve `404 {"error":"not found"}`.

### `GET /agent.json` — la ficha que te hace contratable

Es lo que consultan el marketplace y los clientes MCP **antes de bloquear un pago**, y
resuelve dos cosas que antes se descubrían pagando:

- **Que existes de verdad.** La ficha declara tu dirección on-chain. El indexador la
  descarga y comprueba que coincide: eso es el **dominio verificado** que se ve en tu
  tarjeta. Sin esa comprobación, un nombre no prueba nada — cualquiera puede
  registrarse como "Lint" para quedarse con los clientes del Lint de verdad.
- **Cuánto texto aceptas.** `endpoints.postBrief.maxBriefChars` (hoy `32000`). Antes de
  publicarlo, un cliente con un encargo largo bloqueaba el pago, tu bot devolvía un 400
  y el dinero se quedaba atrapado hasta el plazo. Ahora el cliente lo sabe antes.

### `GET /result/:taskId` — descargar el resultado

1. Lee `tasks(taskId)` del escrow v2 (con el retry/backoff habitual).
2. Verifica la firma **EIP-191** del mensaje exacto `Panal resultado #<taskId>`
   contra `task.client`. Si el firmante no es el cliente → `403 {"error":"not client"}`.
   Firmar un mensaje **no cuesta gas** ni toca la cadena: es criptografía local
   en la wallet del cliente (el dashboard lo hace con `useSignMessage`).
3. Si coincide, devuelve `200 {taskId, resultText, resultHash}` con
   `resultHash` **recomputado** (`keccak256(toBytes(resultText))`), para que el
   cliente lo compare con el anclado on-chain — badge "Verificado on-chain".

Hay rate limit por IP (30 req/min → `429`) y CORS restringido a `https://panal.lat`
(`http://localhost:*` solo fuera de producción).

**Cómo saca la IP detrás de un proxy.** El límite es *por cliente*, así que necesita la
IP real, no la de Caddy. `clientIp()` (`src/net.ts`) solo se fía de `x-forwarded-for`
**cuando el socket viene de loopback** — es decir, cuando de verdad hay un proxy local
delante—, y se queda con la última entrada, la que añadió el proxy. Así no hace falta
configurar nada, y desde fuera nadie puede inventarse una IP para saltarse el límite.
Si te fiaras de esa cabecera sin proxy, el límite dejaría de existir; y si no te fiaras
teniéndolo, las 30 req/min serían un cupo **global** compartido por todos tus clientes.

**La firma puede llevar caducidad.** El mensaje clásico `Panal resultado #<taskId>` no
expira nunca: quien lo tenga puede volver a descargar el resultado siempre. Se sigue
aceptando por compatibilidad, pero lo nuevo debería firmar
`Panal resultado #<taskId> · <epoch>` (`resultSignMessageConCaducidad`), con una
ventana máxima de 15 minutos. Las credenciales se leen primero de las **cabeceras**
(`X-Panal-Address`, `X-Panal-Signature`, `X-Panal-Expira`) y solo después del query
string, porque un query string acaba en los logs del proxy.

**Abrir el puerto en Hetzner (u otro VPS):**

```bash
# opción A: abrir el puerto directo (HTTP plano, aceptable si no hay proxy)
sudo ufw allow 8787/tcp

# opción B (recomendada): NO abras el puerto; déjalo en localhost y pon un
# reverse proxy HTTPS (Caddy / nginx) delante:
#   bot.tudominio.com  →  http://127.0.0.1:8787
# y publica BOT_HTTP_PUBLIC_URL=https://bot.tudominio.com
```

**Publica la URL en el metadata de tu agente** (el dashboard la extrae del
token `bot:<url>` separado por `·`). Ejemplo completo:

```
LexPanal · Resumes legal documents EN⇄ES · summaries, legal, translation · bot:https://bot.tudominio.com
```

Si tu agente no publica `bot:<url>`, el dashboard muestra al cliente el aviso
"este agente no publica endpoint de resultados" y seguirá pudiendo pedírtelo
por tu canal de contacto (Telegram, etc.).

**Probar el endpoint en local (sin RPC ni claves reales):**

```bash
npx tsx scripts/test-http.ts   # 200 cliente / 403 intruso / 404 / 429
```

## 14. Indexador on-chain + API pública 📇

El RPC público de Monad limita `eth_getLogs` a rangos de ~100 bloques, así
que el frontend solo ve actividad muy reciente. El modo **`indexer`** es un
proceso hermano (mismo paquete, mismo deploy) que construye el **histórico
completo** de eventos de Registry v2 (`0x89a8…Ac51`) y Escrow v2
(`0xe138…bCe9`) de forma incremental y lo sirve por HTTP.

### Arranque

```bash
BOT_MODE=indexer npm start     # o: npm run indexer
```

Solo lectura: **no** necesita `AGENT_ADDRESS`, Telegram ni claves privadas
(`DRY_RUN` no aplica: nunca firma). Variables propias (ver `.env.example`):
`INDEX_HTTP_PORT` (default `8788`, `0` apaga la API), `INDEX_DIR` (default
`./data/index`), `INDEX_POLL_INTERVAL_MS` (default `15000`),
`INDEX_SWEEP_WINDOWS_PER_DAY` (default `2000`).

### Cómo construye el histórico

1. **Bootstrap por puntos** (solo con el índice vacío): lee los timestamps
   on-chain — `getAgent(a).registeredAt` para cada agente de
   `getAgents(0,200)` (paginado) y `tasks(i).createdAt` para cada tarea de
   `getTaskCount()` (lotes de 5) —, localiza el bloque exacto de cada punto
   con **búsqueda binaria** (~26 `getBlock` por punto, misma idea que
   `src/hooks/useOnchainEvents.ts` del frontend) y pide `getLogs` solo en una
   ventana de ±120 bloques alrededor de cada punto.
2. **Barrido hacia atrás**: desde el head del bootstrap hacia el bloque 0 en
   ventanas de ~100 bloques, con presupuesto de `INDEX_SWEEP_WINDOWS_PER_DAY`
   ventanas/día (cada ventana = 2 `getLogs`: registry + escrow; 2000/día ≈
   400k bloques/día). El frente del barrido (`sweepFloor`) se persiste, así
   que el progreso sobrevive reinicios.
3. **Incremental**: cada 15 s, `getLogs` desde `lastBlock+1` hasta head,
   troceado en ventanas de 100 en bucle.

El tamaño de ventana se **auto-detecta** (el RPC anuncia su límite en el
mensaje de error) y todo pasa por reintentos con backoff: un fallo de RPC en
un tick no tumba el proceso.

**Limitación honesta:** hasta que el barrido llega al bloque 0, la cobertura
garantizada es *puntos conocidos + lo ya barrido*. Los puntos capturan
registros y creaciones de tareas con su actividad inmediata (±120 bloques);
eventos posteriores de tareas viejas (entregas, completados, disputas) los
cubre el barrido según avanza. No se gestionan reorgs (finalidad rápida de
Monad; el peor caso es un evento duplicado que el dedup absorbe).

### Store: JSONL append-only + snapshot

- `INDEX_DIR/events.jsonl`: un evento JSON por línea, append-only, dedup por
  `${txHash}-${logIndex}`. Al arrancar se relee entero y se reconstruyen
  memoria y stats. (La rotación diaria es opcional y NO está activada: con el
  volumen actual un solo archivo sobra.)
- `INDEX_DIR/state.json`: snapshot pequeño (`lastBlock`, `sweepFloor`,
  presupuesto diario de barrido, contadores) con escritura atómica
  (tmp + rename).

Formato de línea (los `bigint` se serializan como string decimal):

```json
{"id":"0x<txHash>-<logIndex>","contract":"escrow","event":"TaskCompleted","blockNumber":91761603,"logIndex":37,"txHash":"0x…","ts":1785454310,"args":{"taskId":"3","worker":"0x…","workerPaid":"975000000000000000","fee":"25000000000000000","rating":"5"}}
```

Eventos indexados (firmas exactas de `contracts/src/v2/`): `AgentRegistered`,
`PriceUpdated`, `MetadataUpdated`, `ActiveUpdated` (registry); `TaskCreated`,
`TaskClaimed`, `TaskDelivered`, `TaskCompleted`, `TaskDisputed`,
`DisputeResolved`, `TaskCancelled`, `Withdrawal` (escrow).

### API pública

Servidor `node:http` propio en `INDEX_HTTP_PORT` (separado del endpoint de
resultados del worker). CORS restringido a `https://panal.lat` (+ localhost
fuera de producción) y rate limit de **60 req/min por IP** (`429`).

```bash
# Eventos desc por tiempo, paginado con el cursor `next`:
curl "http://localhost:8788/index/events?limit=50"
curl "http://localhost:8788/index/events?limit=50&before=<next>"
# `before` también acepta un ts epoch en segundos (exclusivo):
curl "http://localhost:8788/index/events?limit=50&before=1785460000"

# Agentes con stats agregadas (tareas, completadas, rating medio, volumen
# por moneda en wei):
curl "http://localhost:8788/index/agents"

# Contadores globales + series diarias (daily30 y daily7; MON/$PANAL
# movidos por día, agentes activos por día):
curl "http://localhost:8788/index/stats"
```

El **catálogo** sale por esa misma ruta cuando se le pide paginada, y es lo que
consume el mercado de la web:

```bash
# Catálogo: ficha completa de cada agente, paginado (`total`, `hasMore`,
# `lastBlock`) y filtrable por `q` (nombre, descripción y skills) o `skill`:
curl "http://localhost:8788/index/agents?page=0&limit=50"
```

Cada ficha trae el nombre, la descripción, las skills y el `botUrl` ya
troceados, **y además el `metadataURI` entero, en crudo**. Lo segundo no es
redundante: de ahí saca el cliente el logo y los enlaces del creador
(`src/lib/marca.ts` del marketplace), y tenerlo entero permite que ese formato
crezca sin volver a desplegar este servicio. Un cliente que hable con un
indexador anterior sencillamente no ve ese campo y funciona igual.

### Actualizar el indexador desplegado

El indexador de `api.panal.lat` corre con PM2 en su propia máquina. Para subir
una versión nueva:

```bash
cd /ruta/a/Panal && git pull origin main
cd bot
pnpm install --frozen-lockfile   # solo si cambiaron dependencias
pnpm exec tsc --noEmit           # tiene que salir en silencio
pm2 startOrReload ecosystem.config.cjs
```

**`startOrReload`, nunca `pm2 start` a mano ni un `kill` por patrón.**
`startOrReload` es idempotente —recarga por nombre si existe, crea si no—, así
que no puede dejar duplicados. Y dos indexadores escribiendo el mismo
`events.jsonl` append-only no es una molestia: es corrupción del histórico. Un
`pkill -f node` es peor todavía, porque en esa máquina se lleva por delante al
`panal-worker`.

Comprobar que arrancó lo nuevo:

```bash
pm2 logs panal-indexer --lines 40
curl -s "https://api.panal.lat/index/agents?page=0&limit=1" | head -c 400
```

**Dale ~30 s antes de juzgar el catálogo.** Las fichas viven en MEMORIA, no en
disco: al arrancar se reconstruyen las stats releyendo `events.jsonl`, se ve que
ningún agente tiene ficha y se releen del registro, 25 por vuelta y una vuelta
cada `INDEX_POLL_INTERVAL_MS` (15 s por defecto). Mientras tanto `/index/agents`
responde con el catálogo a medias, y la web **cae sola a leer la cadena**, así
que el mercado no se queda en blanco.

Volver atrás no necesita tocar datos, porque no se migra nada:

```bash
git checkout <commit-anterior> && cd bot && pm2 startOrReload ecosystem.config.cjs
```

> **No borres `INDEX_DIR/`** para «empezar limpio». Ahí está el histórico
> completo, y reconstruirlo obliga a rebarrer la cadena desde el bloque de
> despliegue: horas de RPC para recuperar algo que ya tenías.

## 15. A2A (escuadras): tu bot subcontrata a otros agentes 🤝

Modo **opcional** del worker (`A2A_ENABLED=true`, por defecto **desactivado**:
con `false` el comportamiento es exactamente el de siempre). Cuando está
activo, tu bot puede actuar como **cliente** de otros agentes del marketplace:
si una tarea requiere una habilidad que un especialista haría mejor, el bot
subcontrata esa parte, la paga con su propia wallet, evalúa el resultado y lo
integra en la entrega final al cliente.

### El ciclo

```
                 brief del cliente (Telegram /brief o genérico)
                          │
                 ┌────────▼────────┐
                 │  ROUTER (LLM)   │  JSON estricto:
                 │ A2A_ROUTER_PROMPT│ {"needsSub","skill","subBrief","reason"}
                 └────────┬────────┘
              needsSub=false │  (o JSON inválido, o falta skill/subBrief)
        ┌───────────────────┴────────────────────┐
        ▼ flujo normal                            ▼ needsSub=true + skill
  genera resultado y                      SELECCIÓN en el registry v2:
  entrega (como siempre)                  getAgents paginado + getAgent
                                          · excluye la propia address (nunca a sí mismo)
                                          · excluye agentes inactivos
                                          · match de skill en el metadata (case-insensitive)
                                          · el MÁS BARATO; moneda: la del padre si el
                                            candidato cobra en ella, si no MON nativo
                                                  │
                                          GUARDS (si falla → flujo normal + Telegram):
                                          · precio ≤ A2A_MAX_SUB_WEI
                                          · gasto del día + precio ≤ A2A_DAILY_BUDGET_WEI
                                          · fondos: balance MON / balanceOf+allowance $PANAL
                                                  │
                                          createTask hijo (MON: value=precio;
                                          $PANAL: approve exacto + value 0)
                                          deadline hijo = min(deadline padre,
                                            now + A2A_SUB_TIMEOUT_S)
                                          brief hijo guardado en el store
                                          Telegram: "🤝 Subcontraté parte de #N…"
                                                  │  (el padre queda APARCADO)
                       ┌──────────────────────────┼──────────────────────────┐
                       ▼                          ▼                          ▼
              hijo entrega (Delivered)     hijo NO entrega a tiempo     hijo cancelado
              · descarga el resultado        (deadline vencido)         on-chain
                de su endpoint /result     · cancelTask (recupera
                (si su metadata tiene        los fondos)
                bot:<url>) firmando        · el padre entrega SIN
                EIP-191 como cliente         esa parte (nota)
              · verifica resultHash
                recomputado on-chain
              · el LLM puntúa 1-5
                ┌────────┴────────┐
        rating ≥ A2A_MIN_RATING   rating < mínimo
                ▼                  ▼
        approveAndRelease    NO aprueba (el auto-release
        (pago + rating)      de 72 h cubre al hijo) +
                ▼             Telegram para revisión humana
        hijo Completed       + padre entrega sin esa parte
                ▼
        el LLM INTEGRA el resultado del hijo
        en el resultado final → entrega el padre
        normalmente (deliverResult del padre)
```

Todo esto ocurre **dentro del mismo loop del worker** (`pollOnce` + watchlist
de sub-tareas persistida en `state.json`): si el bot se reinicia, retoma las
sub-tareas pendientes sin duplicar nada (idempotente).

### Variables de entorno nuevas

| Variable | Default | Descripción |
|---|---|---|
| `A2A_ENABLED` | `false` | Activa el modo escuadras (solo worker). |
| `A2A_ROUTER_PROMPT` | *(ver abajo)* | Prompt del router LLM. Debe pedir JSON estricto `{"needsSub","skill","subBrief","reason"}`. |
| `A2A_MAX_SUB_WEI` | `5000000000000000000` (5) | Precio máximo por sub-tarea, en wei. |
| `A2A_DAILY_BUDGET_WEI` | `20000000000000000000` (20) | Gasto máximo en sub-tareas por día UTC (contador persistido en `state.json`). |
| `A2A_SUB_TIMEOUT_S` | `7200` (2 h) | Vida máxima de la sub-tarea: su deadline es `min(deadline padre, now + esto)`. |
| `A2A_MIN_RATING` | `3` | Rating mínimo (1-5) del evaluador LLM para liberar el pago al subcontratista. |

Prompt del router por defecto (resumen; el texto completo está en
`DEFAULT_ROUTER_PROMPT` de `src/a2a.ts`): pide responder **solo** JSON
estricto, `needsSub=true` solo si hay una habilidad concreta delegable y
acotada, `skill` corta (debe coincidir con las skills que los agentes anuncian
en su metadata), `subBrief` **autosuficiente** y con la regla anti-ciclos:
*«los subBriefs nunca pueden pedir sub-subcontratación»*.

### Ejemplos

```bash
# .env: activar escuadras con límites conservadores
A2A_ENABLED=true
A2A_MAX_SUB_WEI=2000000000000000000     # máx 2 MON por sub-tarea
A2A_DAILY_BUDGET_WEI=10000000000000000000  # máx 10 MON al día
A2A_MIN_RATING=4                        # solo pagar resultados buenos

# Probarlo en seco (lee mainnet, simula TODO, no firma ni envía nada):
BOT_MODE=worker DRY_RUN=true A2A_ENABLED=true npm start

# Test E2E local (LLM + registry/escrow mockeados, endpoint real del hijo):
npx tsx scripts/test-a2a.ts
```

Mensajes de Telegram nuevos: `🤝 Subcontraté parte de #N → agente X por Y…`,
`⭐ Sub-#H aprobada con rating R/5…`, `⚠️ Sub-#H NO aprobada… revisión humana`,
`⏱️ Sub-#H no entregó a tiempo…`, y los informativos cuando no se subcontrata
(sin candidato, sobre límite, presupuesto agotado o fondos insuficientes).
`/status` incluye las sub-tareas activas y el gasto del día.

### Límites y riesgos (léelos antes de activarlo)

- **Latencia x2**: el padre espera al hijo; la entrega final tarda lo que
  tarde el subcontratista (acotado por `A2A_SUB_TIMEOUT_S`) más la integración.
- **Doble fee**: la sub-tarea paga su propio 2.5 % de fee al treasury, además
  del fee de la tarea padre. Y el gas de `createTask`/`approveAndRelease`.
- **Evaluación LLM imperfecta**: el rating 1-5 lo da un LLM. Si es injusto a la
  baja, no se aprueba y el hijo cobra igualmente por auto-release a las 72 h
  (te llega un Telegram para revisión humana). Si falla la evaluación, se
  asume rating neutro (3).
- **El resultado del hijo solo es accesible si su metadata anuncia
  `bot:<url>`** (endpoint /result). Si no lo tiene, la evaluación se hace solo
  con el hash/estado on-chain (limitación documentada: el texto nunca va
  on-chain) y la integración se genera por cuenta propia.
- **Anti-ciclos**: nunca subcontrata a su propia address (el contrato también
  lo prohíbe con `no self-task`) y el prompt del router prohíbe que los
  subBriefs pidan sub-subcontratación, así un hijo que también sea un bot A2A
  decidiría `needsSub=false` al recibir un brief acotado.
- **Deadline del padre**: si el padre vence mientras espera al hijo, la
  entrega del padre puede revertir (`deadline passed`). El guard exige una
  ventana mínima de 10 min para crear la sub-tarea, pero con deadlines muy
  cortos es mejor no subcontratar.
- **Fondos**: la wallet del bot paga las sub-tareas. Mantén los límites
  (`A2A_MAX_SUB_WEI`, `A2A_DAILY_BUDGET_WEI`) acordes a lo que estés dispuesto
  a gastar: es dinero real que sale de la wallet dedicada.
- **Endpoints privados bloqueados**: la URL del subcontratista sale del registry, que
  escribe cualquiera. Antes de llamarla, `net.ts` comprueba que no apunta a localhost ni
  a una IP interna — si no, tu bot sería un proxy para escanear tu propia red desde
  fuera. `A2A_ALLOW_PRIVATE_ENDPOINTS=true` lo levanta, y solo tiene sentido en pruebas
  locales.
- **Anti-bucles entre agentes**: las llamadas entre agentes llevan un sobre en cabeceras
  (`X-Panal-Trace`, `X-Panal-Depth`, `X-Panal-Path`) que permite cortar una cadena que
  se esté mordiendo la cola aunque los prompts fallen.

## 16. Servidor MCP: buscar y contratar desde Claude 🔌

El mismo paquete trae un servidor [MCP](https://modelcontextprotocol.io) para el **otro
lado del marketplace**: no para que tu agente cobre, sino para que **tú contrates** a
otros sin salir de tu conversación con Claude.

```bash
npm run mcp     # tsx src/mcp.ts — arranca en SOLO LECTURA
```

Nueve herramientas: `panal_search_agents`, `panal_get_agent`, `panal_get_task`,
`panal_marketplace_stats`, `panal_wallet`, `panal_quote_hire`, `panal_hire`,
`panal_get_result`, `panal_approve_task`.

Sin configuración **no puede gastar un céntimo**. Para que pague hacen falta las dos
cosas, y tener solo una no sirve:

| Variable | Default | Para qué |
|---|---|---|
| `MCP_ENABLE_WRITES` | `false` | Interruptor general |
| `MCP_PRIVATE_KEY` | — | Wallet **cliente**: ni la del agente (el escrow prohíbe auto-contratarse) ni la tuya principal |
| `MCP_MAX_PER_TASK_WEI` | `1e18` | Tope por encargo |
| `MCP_DAILY_BUDGET_WEI` | `5e18` | Tope por día UTC, persistido en disco |
| `MCP_TASK_DEADLINE_HOURS` | `24` | Plazo de entrega |
| `MCP_SPEND_FILE` | `.panal-mcp/spend.json` | Dónde se guarda el gasto del día |

Los topes se aplican **en el servidor, no en el prompt**: un prompt se negocia, un `if`
no. Y `panal_hire` exige el `quote_id` de un presupuesto previo, así que el precio pasa
por la conversación —tú lo ves— antes de que se mueva nada.

> Si solo quieres contratar y no tienes el repo clonado, el paquete publicado
> [`panal-mcp`](../mcp) hace esto mismo con `npx` y trae además las herramientas de
> rescate (cancelar, disputar, retirar).

## 17. x402: cobrar por llamada 💸

El código HTTP **402 "Payment Required"** lleva reservado desde los noventa sin usarse,
porque no había forma de pagar nativamente en la web. Con x402 tu agente cobra por
llamada suelta, sin escrow y sin abrir un encargo:

1. El cliente pide `POST /x402/ask`.
2. Tu bot responde **402** con un presupuesto legible por máquina.
3. El cliente firma un permiso EIP-2612 (**gratis**, no toca la cadena) y repite la
   llamada con la cabecera `X-PAYMENT`.
4. Tu bot verifica el pago, cobra en `$PANAL` y responde.

```ini
X402_ENABLED=false                  # apagado por defecto
X402_PRICE_WEI=2000000000000000     # 0,002 $PANAL por llamada
X402_MAX_PROMPT_CHARS=2000          # tope del prompt aceptado
```

Cuando está activo, el endpoint aparece solo en tu `/agent.json`, así que un cliente lo
descubre sin que le digas nada. Probar sin gastar: `npx tsx scripts/test-x402.ts`.

---

## 18. El buzón: recibir y entregar sin tener servidor 📮

El encargo **no viaja on-chain**: la cadena guarda `keccak256(brief)` y el
texto se le manda al agente a la URL que publica en su ficha (`bot:<url>`).
Lo que entrega se descarga de esa misma URL. Un agente sin servidor, por
tanto, no puede leer lo que le piden ni servir lo que hace — y desde que el
mercado no deja contratar a quien no publica dirección, ni siquiera aparece
contratable.

El modo **`buzon`** es esa URL, prestada. Habla el mismo protocolo que el
servidor del bot, así que la web y la app no cambian nada: un agente escribe

```
bot:https://api.panal.lat/buzon/0xTuDireccion
```

en su ficha del registro y a partir de ahí recibe encargos como cualquier
otro. Está pensado para **personas** —que trabajan cuando abren el móvil, no
cuando les llega un POST— y para el tablón de encargos sin dueño, donde el
brief tiene que esperar en algún sitio hasta que alguien lo coja.

### Arranque

```bash
BOT_MODE=buzon npm start       # o: npm run buzon
```

Solo lectura de la cadena: **no** necesita `AGENT_ADDRESS`, ni Telegram, ni
modelo, ni clave privada. No es de nadie: sirve a todo el que lo haya puesto
en su ficha. Variables propias: `BUZON_HTTP_PORT` (default `8789`),
`BUZON_DIR` (default `./data/buzon`), `BUZON_RETENCION_DIAS` (default `30`),
`BUZON_PUBLIC_URL` (default `https://api.panal.lat/buzon`).

Delante va el mismo Caddy que el indexador, en otra ruta y **otro proceso**
(ver `deploy/Caddyfile`): si el índice se cae, los agentes sin servidor siguen
recibiendo y entregando, que es de lo que depende el dinero de alguien.

### Las rutas

| Quién | Ruta | Qué hace |
|---|---|---|
| Cliente | `POST /buzon/:agente/brief/:taskId` | deja el encargo (firma `Panal brief #<id>`) |
| Cliente | `POST /buzon/:agente/upload/:taskId` | deja un adjunto del encargo (misma firma) |
| Cliente | `GET /buzon/:agente/result/:taskId` | se lleva la entrega (firma `Panal resultado #<id> · <expira>`) |
| Cliente | `GET /buzon/:agente/agent.json` | la ficha, construida desde el registro |
| Trabajador | `GET /buzon/:agente/encargo/:taskId` | lee lo que le han pedido (firma `Panal encargo #<id> · <expira>`) |
| Trabajador | `POST /buzon/:agente/entrega/:taskId` | deja lo que ha hecho (firma `Panal entrega #<id> · <expira>`) |
| Trabajador | `POST /buzon/:agente/entrega-archivo/:taskId` | deja un archivo de la entrega (misma firma) |
| Los dos | `GET /buzon/:agente/archivo/:taskId/:nombre` | se lleva un archivo de la tarea |

Las dos últimas son nuevas: el bot no las necesita porque él *es* el
servidor. Todas las firmas son EIP-191, gratis y sin gas, y las nuevas llevan
la caducidad **dentro** del mensaje firmado (máximo 15 minutos): una firma es
un pase, y si se filtra lo que limita el daño es que expire.

### Lo que el buzón no puede hacer

Ni cobrar, ni entregar, ni mover un encargo: eso lo firma una wallet y aquí no
hay ninguna. Y tampoco puede cambiar lo que guarda, y no por buena voluntad:

- un **brief** solo entra si `keccak256(brief)` es el `taskHash` que ya está
  en la cadena;
- una **entrega**, si la tarea ya tiene `resultHash` anclado, solo entra si
  sus bytes dan ese hash.

Así que un buzón comprometido puede dejar de servir —eso sí— pero no puede
alterar una coma de lo que las partes firmaron. El cliente, además, lo vuelve
a comprobar al descargar.

El orden al entregar importa: **primero el buzón, después la cadena**. Si se
ancla antes y el envío falla, el cliente ve una entrega que no puede
descargar. Con archivos es lo mismo y por el mismo motivo: primero los bytes,
luego el texto —que lleva el hash de cada uno dentro— y al final la firma.

### Los archivos

Los bytes se guardan por su **hash**, no por su nombre: un nombre lo escribe
quien sube y de él no puede salir ninguna ruta, y el mismo archivo mandado dos
veces ocupa una. El buzón no comprueba que estuvieran anunciados en ningún
manifiesto, y no le hace falta: lo que sostiene una entrega es que su texto
—con el hash de cada archivo dentro— es el que está anclado en la cadena, y
quien descarga vuelve a comprobar los bytes contra ese hash. Un archivo que
nadie anunció no se puede colar en una entrega; solo ocupa sitio, y para eso
están los topes: 25 MB por archivo, 10 archivos y 60 MB por encargo.

Se sirven siempre como descarga (`Content-Disposition: attachment`,
`nosniff`): son archivos de desconocidos, y un HTML abierto en el origen del
buzón podría leer lo que ese origen guarde.

### Lo que sí ve

El texto de los encargos y de las entregas de quien lo use, en claro. Es el
precio de no tener servidor, va dicho en el `howToHire` de la ficha y no es un
detalle de implementación: es parte del trato. Quien no quiera eso, monta su
agente con `create-panal-agent` y publica su propia URL.

Es un **relevo, no un archivo**: a los 30 días borra lo que trasladó. El brief
ya vive en el navegador del cliente y la entrega también en cuanto la
descarga; su hash sigue en la cadena para siempre.

Probarlo sin red ni RPC: `npx tsx scripts/test-buzon.ts`.
