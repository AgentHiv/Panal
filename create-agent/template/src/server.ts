/**
 * El motor de tu agente. NO hace falta que toques este archivo.
 *
 * Se ocupa de las tres cosas que un agente de Panal tiene que hacer bien y que
 * son fáciles de hacer mal:
 *
 *   1. RECIBIR el encargo. El brief no viaja on-chain —solo su hash—, así que
 *      el cliente te lo manda firmado a `POST /brief`. Se comprueba que la
 *      firma sea suya de verdad y que la tarea exista y sea para ti.
 *   2. TRABAJAR y ENTREGAR. Llama a tu `handleTask()` y ancla el keccak256 del
 *      resultado con `deliverResult`. A partir de ahí el pago es tuyo salvo
 *      disputa, y a las 72 h se libera solo.
 *   3. SERVIR el resultado. El cliente lo descarga de `GET /result/:id`
 *      firmando, sin gastar gas.
 *
 * Es reactivo a propósito: no vigila la cadena en bucle, reacciona a lo que le
 * llega. Así funciona igual en un servidor de siempre que en un contenedor que
 * arranca y para, y no consume RPC cuando no hay trabajo.
 */

// Carga el .env ANTES que nada: si esto falta, el servidor no ve la clave que
// el generador dejó ahí y muere diciendo que falta, con el fichero delante.
import 'dotenv/config';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  appendFilesManifest,
  assertCanServe,
  buildQuote,
  createPanalClient,
  LoopDetected,
  MAINNET_ADDRESSES,
  parseEnvelope,
  parsePaymentHeader,
  permitNonce,
  readPermitDomain,
  sanitizeFileName,
  TaskStatus,
  verifyAndSettle,
  type CallEnvelope,
  type DeliveredFile,
  type PermitDomain,
} from '@panal/sdk';
import { privateKeyToAccount } from 'viem/accounts';
import { isAddress, keccak256, parseEther, toBytes, verifyMessage } from 'viem';
import type { Address } from 'viem';
import { handleTask } from './agent.js';
import type { TaskContext, TaskFile, TaskResult } from './agent.js';
import { arrancarVigilante } from './vigilante.js';

const PORT = Number(process.env.PORT ?? 8787);
const DATA_DIR = process.env.DATA_DIR ?? './data';
/** Tope del cuerpo de una petición: sin esto, cualquiera te tumba el proceso. */
const MAX_BODY = 256 * 1024;

const key = process.env.AGENT_PRIVATE_KEY?.trim();
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
  console.error('Falta AGENT_PRIVATE_KEY (0x + 64 hex) en el .env. Copia .env.example y rellénalo.');
  process.exit(1);
}
const account = privateKeyToAccount(key as `0x${string}`);
const panal = createPanalClient({ account, rpcUrl: process.env.RPC_URL });

console.log(`Agente ${account.address} escuchando en :${PORT}`);

// ---------------------------------------------------------------------------
// x402: cobrar por llamada, sin escrow.
//
// El escrow es para encargos que valen algo: bloquea el pago, hay plazo y hay
// disputa. Para una consulta de dos milésimas todo eso sobra —el trámite cuesta
// más que el servicio—, y ahí entra x402: el cliente firma una autorización de
// pago (gratis, sin gas), tú cobras y respondes en la misma llamada.
//
// Es OPCIONAL: sin X402_PRICE en el .env, esta ruta no existe y tu agente
// funciona igual solo con encargos del escrow.
//
// Solo se puede cobrar en un ERC-20 con EIP-2612, no en MON: el esquema entero
// se apoya en `permit`, y la moneda nativa no lo tiene.
// ---------------------------------------------------------------------------

const X402_PRICE = (() => {
  const raw = process.env.X402_PRICE?.trim();
  if (!raw) return null;
  try {
    const wei = parseEther(raw);
    return wei > 0n ? wei : null;
  } catch {
    console.error(`X402_PRICE="${raw}" no es un número válido: el cobro por llamada queda desactivado.`);
    return null;
  }
})();
const X402_TOKEN: Address = (() => {
  const raw = process.env.X402_TOKEN?.trim();
  return raw && isAddress(raw) ? (raw as Address) : MAINNET_ADDRESSES.panalToken;
})();
const X402_SYMBOL = process.env.X402_SYMBOL?.trim() || '$PANAL';
// En inglés porque viaja en el 402 y lo lee un desconocido de cualquier parte.
// Cámbialo por lo tuyo con X402_DESCRIPTION en el .env.
const X402_DESCRIPTION = process.env.X402_DESCRIPTION?.trim() || 'One question to the agent, answered on the spot.';

if (X402_PRICE !== null) {
  console.log(`Cobro por llamada activo: ${process.env.X402_PRICE} ${X402_SYMBOL} en POST /x402/ask`);
}

// ---------------------------------------------------------------------------
// SUBCONTRATAR: lo que tu agente puede gastarse en preguntar a otros
// ---------------------------------------------------------------------------
//
// Tu agente puede pagar a otro por lo que no sepa hacer (ver `ctx.consultar` en
// agent.ts). Eso es dinero suyo saliendo, así que necesita un tope, y el tope
// se pone AQUÍ y no en el prompt: un prompt se negocia, un número no.
//
// Va en la moneda del x402 —$PANAL por defecto— y NO se deduce de lo que cobras
// por la tarea. Es tentador decir "que gaste como mucho el 30 % de lo que le
// pagan", pero una tarea se cobra en MON y una consulta se paga en $PANAL: son
// monedas distintas sin tipo de cambio, y convertir una en otra a ojo sería
// inventarse el presupuesto. Si no pones nada, tu agente no delega.
//
//   SUBCONTRATA_MAX=0.5     # como mucho 0,5 $PANAL por encargo
//   SUBCONTRATA_SALTOS=2    # cuántos agentes puede encadenar (tope duro: 8)
//
const SUBCONTRATA_MAX = (() => {
  const raw = process.env.SUBCONTRATA_MAX?.trim();
  if (!raw) return 0n;
  try {
    const wei = parseEther(raw);
    return wei > 0n ? wei : 0n;
  } catch {
    console.error(`SUBCONTRATA_MAX="${raw}" no es un número válido: tu agente no subcontratará.`);
    return 0n;
  }
})();
const SUBCONTRATA_SALTOS = (() => {
  const n = Number(process.env.SUBCONTRATA_SALTOS?.trim() || '2');
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 2;
})();

if (SUBCONTRATA_MAX > 0n) {
  console.log(`Subcontratación activa: hasta ${process.env.SUBCONTRATA_MAX} ${X402_SYMBOL} por encargo`);
}

/**
 * El dominio EIP-712 del token, leído de la cadena una sola vez.
 *
 * Se cachea porque no cambia nunca y leerlo en cada petición añade una llamada
 * al RPC al camino de una respuesta que cobras al momento. Si el RPC falla, se
 * vuelve a intentar en la siguiente: no se cachea el error.
 */
let dominioCache: PermitDomain | null = null;
async function dominioPermit(): Promise<PermitDomain> {
  if (!dominioCache) dominioCache = await readPermitDomain(panal.publicClient, X402_TOKEN);
  return dominioCache;
}

// ---------------------------------------------------------------------------
// Almacén: los resultados en disco, para poder servirlos después.
// ---------------------------------------------------------------------------

mkdirSync(DATA_DIR, { recursive: true });
const resultPath = (taskId: bigint) => join(DATA_DIR, `result-${taskId}.txt`);
/** Carpeta de los archivos de una tarea. Una por tarea, para no mezclarlas. */
const filesDir = (taskId: bigint) => join(DATA_DIR, 'files', taskId.toString());

function saveResult(taskId: bigint, text: string): void {
  writeFileSync(resultPath(taskId), text, 'utf8');
}
function loadResult(taskId: bigint): string | null {
  try {
    return readFileSync(resultPath(taskId), 'utf8');
  } catch {
    return null;
  }
}

/**
 * El encargo recibido, guardado en cuanto llega y antes de trabajar.
 *
 * No es un caché: es lo único que permite retomar una tarea si el proceso se
 * muere a mitad. El escrow guarda `keccak256(encargo)`, no el encargo, así que
 * si no lo guardas tú aquí, un reinicio lo pierde para siempre y la tarea se
 * queda abierta con el dinero del cliente dentro hasta que vence el plazo.
 */
const briefPath = (taskId: bigint) => join(DATA_DIR, `brief-${taskId}.txt`);
function saveBrief(taskId: bigint, text: string): void {
  try {
    writeFileSync(briefPath(taskId), text, 'utf8');
  } catch (err) {
    // No se aborta: perder la copia solo cuesta no poder retomar. Trabajar
    // ahora mismo sigue siendo posible, y es lo que el cliente está esperando.
    console.error(`[panal] #${taskId} no se pudo guardar el encargo: ${err instanceof Error ? err.message : err}`);
  }
}
function loadBrief(taskId: bigint): string | null {
  try {
    return readFileSync(briefPath(taskId), 'utf8');
  } catch {
    return null;
  }
}

/**
 * Guarda en disco los archivos de una entrega y devuelve su manifiesto.
 *
 * El nombre se limpia con `sanitizeFileName` ANTES de tocar el disco: llega en
 * lo que devuelve `handleTask`, y un agente que construya el nombre a partir
 * del encargo del cliente estaría dejando que un desconocido elija dónde
 * escribir. Un `../../.env` acabaría en la raíz del proyecto.
 */
function saveFiles(taskId: bigint, files: TaskFile[]): DeliveredFile[] {
  const dir = filesDir(taskId);
  mkdirSync(dir, { recursive: true });

  return files.map((f) => {
    const name = sanitizeFileName(f.name);
    const bytes = typeof f.data === 'string' ? new TextEncoder().encode(f.data) : new Uint8Array(f.data);
    writeFileSync(join(dir, name), bytes);
    return {
      name,
      size: bytes.byteLength,
      ...(f.mime ? { mime: f.mime } : {}),
      // El hash de los BYTES, no del enlace: es lo único que sobrevive a que
      // alguien cambie el archivo después de haber cobrado.
      hash: keccak256(bytes),
      path: `/files/${taskId}/${encodeURIComponent(name)}`,
    };
  });
}

/**
 * Deja lo que devolvió `handleTask` en una forma sola.
 *
 * Se acepta un string a secas porque es lo que devuelve el 95 % de los agentes
 * y obligarles a envolverlo en un objeto sería cobrarles la complejidad de una
 * función que no usan.
 */
function normalizarSalida(salida: TaskResult): { text: string; files: TaskFile[] } {
  if (typeof salida === 'string') return { text: salida, files: [] };
  return { text: salida.text, files: salida.files ?? [] };
}

/** Tareas que se están procesando ahora mismo: evita trabajar dos veces. */
const inFlight = new Set<string>();

// ---------------------------------------------------------------------------
// Firmas: el cliente demuestra quién es sin gastar gas (EIP-191).
// Los mensajes tienen que coincidir EXACTAMENTE con los del dashboard.
// ---------------------------------------------------------------------------

const briefSignMessage = (taskId: bigint) => `Panal brief #${taskId}`;
/** Formato ANTIGUO, sin caducidad. Se sigue aceptando; ver `credencialValida`. */
const resultSignMessageLegacy = (taskId: bigint) => `Panal resultado #${taskId}`;
/** Formato actual: la firma dice hasta cuándo vale. */
const resultSignMessage = (taskId: bigint, expira: number) => `Panal resultado #${taskId} · ${expira}`;

/**
 * Cuánto puede durar como mucho una firma de descarga.
 *
 * El cliente elige cuándo caduca la suya y este tope acota lo que se acepta:
 * sin él, firmar una válida hasta el año 2100 sería lo mismo que no caducar.
 */
const MAX_VENTANA_S = 15 * 60;

/** Rechaza el formato antiguo (sin caducidad). Pásalo a 1 cuando puedas. */
const AUTH_ESTRICTA = process.env.AUTH_ESTRICTA === '1';

async function signedBy(message: string, signature: string, expected: Address): Promise<boolean> {
  try {
    return await verifyMessage({ address: expected, message, signature: signature as `0x${string}` });
  } catch {
    return false;
  }
}

/**
 * Las credenciales de una descarga: de dónde se leen y si valen.
 *
 * SE LEEN DE LAS CABECERAS, no de la query. La firma abre el resultado y TODOS
 * los archivos de una tarea, así que es un pase de acceso — y en la query
 * acababa escrita en el log de accesos del proxy, en el historial del navegador
 * y en cualquier intermediario del camino. Se encontraron 23 en un log de
 * producción, en claro. Un pase que se registra en un archivo de texto no es
 * un pase.
 *
 * La query se sigue leyendo porque los clientes publicados antes de esto la
 * usan, y romperles la descarga no arregla nada. Pero avisa.
 */
function credencialesDe(
  req: IncomingMessage,
  url: URL,
): { address: string | null; signature: string | null; expira: string | null; porQuery: boolean } {
  const cabecera = (n: string): string | null => {
    const v = req.headers[n];
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  };
  const address = cabecera('x-panal-address');
  const signature = cabecera('x-panal-signature');
  if (address && signature) {
    return { address, signature, expira: cabecera('x-panal-expira'), porQuery: false };
  }
  return {
    address: url.searchParams.get('address'),
    signature: url.searchParams.get('signature'),
    expira: url.searchParams.get('expira'),
    porQuery: true,
  };
}

/**
 * ¿La firma abre esta tarea?
 *
 * La caducidad la MANDA el cliente y va dentro de lo firmado, así que no se
 * puede estirar: cambiar el número invalida la firma. Mandarla en claro no
 * regala nada y ahorra lo que sí sería un problema — adivinarla probando
 * segundo a segundo son cientos de verificaciones de firma por petición, o
 * sea un ataque de denegación montado por uno mismo.
 */
/** Un aviso por tarea: repetirlo en cada archivo llenaría el log de ruido. */
const avisadasPorQuery = new Set<string>();
function avisaQuery(taskId: bigint): void {
  const k = taskId.toString();
  if (avisadasPorQuery.has(k)) return;
  avisadasPorQuery.add(k);
  console.error(
    `[panal] #${taskId} credenciales por QUERY STRING. Acaban en el log de accesos del proxy ` +
      'y en el historial del navegador. Actualiza el cliente: van en cabeceras.',
  );
}

async function credencialValida(
  taskId: bigint,
  signature: string,
  expiraCrudo: string | null,
  cliente: Address,
): Promise<boolean> {
  const ahora = Math.floor(Date.now() / 1000);

  if (expiraCrudo !== null) {
    const expira = Number(expiraCrudo);
    if (!Number.isInteger(expira)) return false;
    // Ni caducada, ni válida durante un año: el tope es lo que impide que una
    // firma filtrada valga para siempre, que es el motivo de todo esto.
    if (expira <= ahora || expira > ahora + MAX_VENTANA_S) return false;
    return signedBy(resultSignMessage(taskId, expira), signature, cliente);
  }

  // Sin caducidad: formato antiguo. Se acepta para no romper a los clientes ya
  // publicados, y se avisa en cada uso.
  if (AUTH_ESTRICTA) return false;
  if (await signedBy(resultSignMessageLegacy(taskId), signature, cliente)) {
    console.error(
      `[panal] #${taskId} descarga con firma SIN CADUCIDAD (formato antiguo). ` +
        'Actualiza el cliente; con AUTH_ESTRICTA=1 esto se rechaza.',
    );
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// El trabajo
// ---------------------------------------------------------------------------

/**
 * Monta el contexto que recibe tu `handleTask`, con la capacidad de delegar.
 *
 * `consultar` es lo que convierte a tu agente en cliente de otro: busca en el
 * mercado quién sabe hacer eso, pide precio a los candidatos —gratis, con el
 * 402—, se queda con el más barato que quepa en el presupuesto, le paga y
 * devuelve su respuesta.
 *
 * Los tres límites se aplican antes de firmar ningún pago:
 *
 *   - PRESUPUESTO. Nunca más de SUBCONTRATA_MAX, y si esta llamada viene de
 *     otro agente, nunca más de lo que quede en el sobre. Heredar una cadena
 *     no puede AMPLIAR lo que autorizó quien la empezó.
 *   - PROFUNDIDAD. Cada salto gasta uno. Al llegar a cero hay que resolver solo.
 *   - CICLOS. Si tu agente ya aparece en el camino, se corta: A→B→C→A daría
 *     vueltas cobrando en cada una.
 *
 * Si algo de eso falta, `consultar` lanza. No lo captures en silencio: que tu
 * agente entregue algo peor porque no pudo delegar es información que el autor
 * necesita ver en los logs.
 */
function contexto(
  base: { taskId: bigint | null; client: string; amount: bigint; deadline: bigint },
  sobre: CallEnvelope | null,
): TaskContext {
  return {
    ...base,
    envelope: sobre,
    presupuesto: SUBCONTRATA_MAX,
    consultar: async (skill: string, pregunta: string) => {
      if (SUBCONTRATA_MAX <= 0n) {
        throw new Error(
          'Este agente no tiene presupuesto para subcontratar: pon SUBCONTRATA_MAX en el .env si quieres que delegue.',
        );
      }
      const res = await panal.ask(skill, pregunta, {
        maxSpend: SUBCONTRATA_MAX,
        depth: SUBCONTRATA_SALTOS,
        // El sobre recibido, si lo hay. Sin él se abre una cadena nueva.
        envelope: sobre,
        // Sin esto un agente que busca su propia skill se contrataría a sí
        // mismo, se pagaría a sí mismo y se quedaría esperando su respuesta.
        exclude: [account.address],
      });
      console.log(
        `[panal] consulta a ${res.agent} por ${res.paid} (${skill}) · trace ${sobre?.trace ?? 'nuevo'}`,
      );
      return res.answer;
    },
  };
}

async function work(taskId: bigint, brief: string, sobre: CallEnvelope | null): Promise<void> {
  const key = taskId.toString();
  if (inFlight.has(key)) return;
  inFlight.add(key);
  try {
    // Lo PRIMERO, antes de trabajar: si el proceso muere a mitad, esto es lo
    // único que permite retomarlo. Guardarlo después sería guardarlo nunca.
    saveBrief(taskId, brief);
    const task = await leerTarea(taskId);
    const salida = await handleTask(
      brief,
      contexto({ taskId, client: task.client, amount: task.amount, deadline: task.deadline }, sobre),
    );

    // Tu handleTask puede devolver un texto a secas —lo normal— o un texto con
    // archivos. Los archivos se escriben en disco y su hash se cuela en el
    // texto: lo que se ancla en la cadena pasa a cubrirlos también.
    const { text: cuerpo, files } = normalizarSalida(salida);
    const text = files.length ? appendFilesManifest(cuerpo, saveFiles(taskId, files)) : cuerpo;

    // Primero se guarda y luego se entrega: si el orden fuera al revés y el
    // proceso muriera entre medias, el hash estaría anclado on-chain y el texto
    // perdido, o sea una entrega imposible de cumplir.
    saveResult(taskId, text);
    const { txHash } = await panal.deliverResult(taskId, text);
    console.log(`[panal] #${taskId} entregada · tx ${txHash}`);
  } catch (err) {
    console.error(`[panal] #${taskId} falló: ${err instanceof Error ? err.message : err}`);
  } finally {
    inFlight.delete(key);
  }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

/**
 * Página de reenvío manual (GET /reenviar?task=<id>).
 *
 * Todo va incrustado: ni CDN ni fuentes ni librerías. Dentro del navegador de
 * una wallet, cada recurso externo es una cosa más que puede no cargar, y esta
 * página existe precisamente para cuando algo ya ha fallado.
 */
const PAGINA_REENVIO = `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reenviar brief · Panal</title>
<style>
:root{color-scheme:dark light}
body{margin:0;padding:24px 18px;font:16px/1.5 system-ui,-apple-system,sans-serif;background:#0f0f11;color:#e8e8ea;max-width:34rem;margin-inline:auto}
h1{font-size:1.25rem;margin:0 0 .25rem}
p.sub{margin:0 0 1.5rem;color:#9a9aa2;font-size:.9rem}
label{display:block;margin:1rem 0 .35rem;font-size:.85rem;color:#b8b8c0}
input,textarea{width:100%;box-sizing:border-box;padding:.7rem .8rem;border-radius:10px;border:1px solid #33333a;background:#17171b;color:inherit;font:inherit}
textarea{min-height:9rem;resize:vertical}
button{width:100%;margin-top:1rem;padding:.85rem;border:0;border-radius:10px;background:#f5c518;color:#1a1a1a;font:600 1rem system-ui;cursor:pointer}
button.sec{background:#26262c;color:#e8e8ea}
#estado{margin-top:1.1rem;padding:.8rem;border-radius:10px;font-size:.9rem;white-space:pre-wrap;word-break:break-word}
#estado.bien{background:#12301c;color:#7ee2a8}
#estado.mal{background:#33161a;color:#ff9d9d}
#estado:empty{display:none}
</style></head><body>
<h1>Reenviar el brief</h1>
<p class="sub">Para cuando el envío automático no llegó. Copia el texto exacto del pedido desde panal.lat (botón "Copiar brief del pedido") y pégalo aquí.</p>
<label for="id">Número de tarea</label>
<input id="id" inputmode="numeric" placeholder="24">
<label for="brief">Texto del pedido</label>
<textarea id="brief" placeholder="Pega aquí el brief, tal cual"></textarea>
<button id="conectar" class="sec">Conectar wallet</button>
<button id="enviar">Firmar y enviar</button>
<div id="estado"></div>
<script>
var q = new URLSearchParams(location.search);
function $(s){ return document.querySelector(s); }
// Solo dígitos, siempre. Un teclado de móvil cuela un punto sin que lo veas y
// la petición se va a /brief/25. → 404, con el usuario mirando un número que
// parece correcto.
function soloDigitos(v){ return String(v || '').replace(/[^0-9]/g, ''); }
$('#id').value = soloDigitos(q.get('task'));
$('#id').addEventListener('input', function(){ this.value = soloDigitos(this.value); });
var cuenta = null;
function estado(msg, mal){ var e = $('#estado'); e.textContent = msg; e.className = mal ? 'mal' : 'bien'; }
$('#conectar').onclick = async function(){
  if (!window.ethereum) { estado('Aquí no hay wallet. Abre esta página desde el navegador de MetaMask, no desde Chrome.', true); return; }
  try {
    var r = await ethereum.request({ method: 'eth_requestAccounts' });
    cuenta = r[0];
    $('#conectar').textContent = cuenta.slice(0,6) + '…' + cuenta.slice(-4);
    estado('Wallet conectada.');
  } catch (e) { estado('Conexión rechazada.', true); }
};
$('#enviar').onclick = async function(){
  var id = soloDigitos($('#id').value);
  var brief = $('#brief').value;
  if (!id || !brief.trim()) { estado('Falta el número de tarea o el texto.', true); return; }
  if (!cuenta) { estado('Conecta la wallet primero: hay que firmar con la misma que pagó.', true); return; }
  try {
    estado('Firma el mensaje en tu wallet. No cuesta gas.');
    var firma = await ethereum.request({ method: 'personal_sign', params: ['Panal brief #' + id, cuenta] });
    estado('Enviando…');
    var res = await fetch('/brief/' + id, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ brief: brief, address: cuenta, signature: firma })
    });
    var txt = await res.text();
    if (res.ok) estado('Aceptado. El agente ya está trabajando en tu pedido.');
    else estado('Rechazado (' + res.status + '):\\n' + txt, true);
  } catch (e) { estado('Falló: ' + (e && e.message ? e.message : e), true); }
};
</script></body></html>`;

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).length;
    if (total > MAX_BODY) throw new Error('cuerpo demasiado grande');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// ---------------------------------------------------------------------------
// Aguantar el ruido: límite de peticiones y caché de la tarea
// ---------------------------------------------------------------------------
//
// Cada petición a /result, /files o /brief cuesta una llamada al RPC ANTES de
// poder verificar nada — hay que leer la tarea para saber quién es su cliente.
// El RPC público limita a ~15 llamadas/s, así que un bucle de curl sin
// autenticar agotaba esa cuota y dejaba al agente sin poder entregar su trabajo
// real, con el dinero de clientes legítimos bloqueado hasta que vencía el plazo.

/** Peticiones por minuto y por IP. 0 lo desactiva. */
const LIMITE_POR_MINUTO = (() => {
  const n = Number(process.env.LIMITE_POR_MINUTO?.trim() || '60');
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 60;
})();

/**
 * Confiar en `x-forwarded-for`. Solo con un proxy delante (Caddy, nginx).
 *
 * Apagado por defecto a propósito: si se confía sin proxy, cualquiera manda esa
 * cabecera con una IP inventada por petición y el límite deja de existir.
 */
const TRAS_PROXY = process.env.TRAS_PROXY === '1';

const cubos = new Map<string, { n: number; hasta: number }>();

/**
 * Se avisa una vez, no en cada petición: esto es una configuración que hay que
 * corregir, no un evento que haya que contar.
 */
let avisadoDelProxy = false;

function ipDe(req: IncomingMessage): string {
  const xff = req.headers['x-forwarded-for'];
  if (TRAS_PROXY) {
    const primera = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
    if (primera) return primera;
  } else if (xff && !avisadoDelProxy) {
    // Llega `x-forwarded-for` y no nos fiamos de él: hay un proxy delante y
    // este agente no lo sabe. No es un detalle — TODAS las peticiones llegan
    // con la IP del proxy, así que el límite «por cliente» pasa a ser uno
    // GLOBAL: el indexador, un navegador y el encargo de un cliente comparten
    // el mismo cubo, y cuando se llena el agente responde 429 a todo el mundo.
    // Un cliente que intenta mandar su brief se lo come, y como el pago ya
    // esta bloqueado, se queda esperando al plazo. Paso de verdad, en mainnet.
    avisadoDelProxy = true;
    console.warn(
      '[panal] llega x-forwarded-for pero TRAS_PROXY no esta a 1: hay un proxy ' +
        'delante y el limite por IP esta contando a TODOS los clientes en el mismo ' +
        'cubo. Pon TRAS_PROXY=1 en el .env y reinicia. Si NO hay proxy delante, ' +
        'dejalo apagado: fiarse de esa cabecera sin proxy deja que cualquiera se ' +
        'invente una IP por peticion y el limite deje de existir.',
    );
  }
  return req.socket.remoteAddress ?? 'desconocida';
}

/** true si hay que rechazar. Ventana fija de un minuto, que sobra aquí. */
function pasaDelLimite(req: IncomingMessage): boolean {
  if (LIMITE_POR_MINUTO === 0) return false;
  const ahora = Date.now();
  const ip = ipDe(req);
  const cubo = cubos.get(ip);
  if (!cubo || cubo.hasta <= ahora) {
    // Se limpia aquí y no con un temporizador: sin esto el mapa crece sin fin
    // con una IP distinta por petición, que es su propia forma de tumbarlo.
    if (cubos.size > 10_000) for (const [k, v] of cubos) if (v.hasta <= ahora) cubos.delete(k);
    cubos.set(ip, { n: 1, hasta: ahora + 60_000 });
    return false;
  }
  cubo.n += 1;
  return cubo.n > LIMITE_POR_MINUTO;
}

/**
 * La tarea, cacheada unos segundos.
 *
 * Solo para las rutas de LECTURA (/result, /files), y solo se usa su `client`,
 * que no cambia nunca. El camino del encargo NO la usa: ahí se mira el estado y
 * el hash, y servir un estado de hace cinco segundos podría aceptar un encargo
 * de una tarea que acaba de cerrarse.
 *
 * Además de aguantar el ruido, ahorra lo obvio: bajarse cuatro archivos de una
 * entrega hacía cuatro lecturas idénticas de la misma tarea.
 */
const CACHE_TAREA_MS = 5_000;
const tareasCache = new Map<string, { cliente: Address; hasta: number }>();

/**
 * La tarea existe en la cadena, pero el nodo que consultamos aún no la ve.
 *
 * NO es un error del agente ni del cliente, y por eso tiene su propio tipo:
 * quien llama necesita poder distinguir «todavía no» de «se rompió algo», que
 * son dos cosas con reacciones opuestas —una se reintenta, la otra no.
 */
class TareaAunNoVisible extends Error {
  constructor(readonly taskId: bigint) {
    super(`la tarea #${taskId} todavía no es visible en este nodo RPC`);
    this.name = 'TareaAunNoVisible';
  }
}

/**
 * ¿Este fallo es «esa tarea no existe (todavía)»?
 *
 * `tasks` es un array público, así que su getter solo puede revertir por
 * índice fuera de rango. Cualquier otro fallo —RPC caído, timeout, red— tiene
 * otra forma y NO se disfraza de esto: tragárselo escondería una avería real.
 */
function pareceInexistente(err: unknown): boolean {
  const m = err instanceof Error ? `${err.message}` : String(err);
  return /revert|out-of-bounds|out of bounds|0x32/i.test(m);
}

/**
 * Lee la tarea aguantando el desfase entre nodos.
 *
 * POR QUÉ EXISTE. El cliente mina `createTask` contra SU RPC y, en cuanto
 * tiene el recibo, nos manda el encargo. Nosotros validamos leyendo la tarea
 * contra el NUESTRO, que es otro nodo y puede ir un bloque por detrás: para él
 * esa tarea aún no existe, el getter revierte y el envío se caía con un 500.
 * El cliente veía «no se pudo enviar el brief» y tenía que reintentar a mano,
 * con su dinero ya bloqueado. Fallaba a la primera y funcionaba a la segunda,
 * que es la firma de una carrera, no de una avería.
 *
 * Cuatro intentos con espera creciente cubren de sobra un bloque de Monad
 * (~800 ms) sin castigar al RPC compartido.
 */
async function leerTarea(taskId: bigint): ReturnType<typeof panal.getTask> {
  for (let intento = 1; intento <= 4; intento++) {
    try {
      return await panal.getTask(taskId);
    } catch (err) {
      if (!pareceInexistente(err)) throw err;
      if (intento === 4) break;
      await new Promise((r) => setTimeout(r, 250 * intento));
    }
  }
  throw new TareaAunNoVisible(taskId);
}

async function clienteDeTarea(taskId: bigint): Promise<Address> {
  const k = taskId.toString();
  const ahora = Date.now();
  const cacheada = tareasCache.get(k);
  if (cacheada && cacheada.hasta > ahora) return cacheada.cliente;
  const task = await leerTarea(taskId);
  if (tareasCache.size > 1_000) for (const [kk, v] of tareasCache) if (v.hasta <= ahora) tareasCache.delete(kk);
  tareasCache.set(k, { cliente: task.client, hasta: ahora + CACHE_TAREA_MS });
  return task.client;
}

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (pasaDelLimite(req)) {
      res.setHeader('retry-after', '60');
      json(res, 429, { error: 'too many requests' });
      return;
    }

    // El dashboard vive en otro dominio: sin CORS el cliente no puede ni
    // mandarte el brief ni descargar su resultado.
    res.setHeader('access-control-allow-origin', 'https://panal.lat');
    res.setHeader('vary', 'origin');
    if (req.method === 'OPTIONS') {
      res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
      // Las credenciales van en cabeceras propias, y esas NO son simples: sin
      // declararlas aquí el navegador bloquea la descarga en el preflight.
      res.setHeader(
        'access-control-allow-headers',
        'content-type, x-panal-address, x-panal-signature, x-panal-expira, x-payment, x-payment-payer',
      );
      res.setHeader('access-control-max-age', '86400');
      res.writeHead(204).end();
      return;
    }

    // Tarjeta de presentación: quién eres y qué sabes hacer.
    //
    // Si cobras por llamada hay que ANUNCIARLO aquí. Durante meses el bot de
    // LexPanal tuvo x402 funcionando y nadie lo usó, sencillamente porque no
    // salía en su tarjeta: un cobro que nadie puede descubrir no existe.
    if (url.pathname === '/agent.json' && req.method === 'GET') {
      json(res, 200, {
        agent: account.address,
        protocol: 'panal',
        network: 'monad-mainnet',
        ...(X402_PRICE !== null
          ? {
              x402Ask: {
                method: 'POST',
                path: '/x402/ask',
                scheme: 'eip2612-permit',
                asset: X402_TOKEN,
                assetSymbol: X402_SYMBOL,
                amount: X402_PRICE.toString(),
                payTo: account.address,
                howTo: 'POST {"prompt":"…"} and you get a 402 with the quote. Sign it and repeat with X-Payment.',
              },
            }
          : {}),
      });
      return;
    }

    // ---- Cobro por llamada: pagas y te respondo en el acto ------------------
    if (url.pathname === '/x402/ask' && req.method === 'POST') {
      if (X402_PRICE === null) {
        json(res, 404, { error: 'this agent does not charge per call; hire it through the escrow' });
        return;
      }
      const body = JSON.parse(await readBody(req)) as { prompt?: string };
      const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
      if (!prompt || prompt.length > 2000) {
        json(res, 400, { error: 'prompt required, max 2000 characters' });
        return;
      }

      // El sobre, antes que nada. Cortar el ciclo aquí importa más que en el
      // escrow: en x402 el cobro va ANTES de trabajar, así que una vuelta de
      // más no es tiempo perdido, es dinero cobrado por dar vueltas. Y va
      // antes del 402 a propósito: si la cadena está viciada, ni se cotiza.
      const sobre = parseEnvelope(req.headers);
      try {
        assertCanServe(sobre, account.address);
      } catch (err) {
        if (err instanceof LoopDetected) {
          console.error(`[x402] ciclo cortado: ${err.message}`);
          json(res, 508, { error: err.message, trace: err.trace });
          return;
        }
        throw err;
      }

      const domain = await dominioPermit();
      const pagoCrudo = req.headers['x-payment'];

      // Sin pago: se responde 402 con el presupuesto. Este es el paso que le da
      // por fin sentido a un código de estado que llevaba desde los noventa
      // reservado y sin usar, porque no había forma de pagar en la web.
      if (typeof pagoCrudo !== 'string' || !pagoCrudo.trim()) {
        // Si el cliente dice quién es, se le regala su nonce y se ahorra una
        // consulta a la cadena antes de poder firmar.
        const quien = req.headers['x-payment-payer'];
        const payer = typeof quien === 'string' && isAddress(quien) ? (quien as Address) : null;
        const nonce = payer ? await permitNonce(panal.publicClient, X402_TOKEN, payer).catch(() => undefined) : undefined;

        res.setHeader('www-authenticate', `eip2612-permit realm="panal", chain="${domain.chainId}"`);
        json(
          res,
          402,
          buildQuote({
            asset: X402_TOKEN,
            assetSymbol: X402_SYMBOL,
            amount: X402_PRICE,
            payTo: account.address,
            resource: '/x402/ask',
            description: X402_DESCRIPTION,
            domain,
            payerNonce: nonce,
          }),
        );
        return;
      }

      const leido = parsePaymentHeader(pagoCrudo);
      if (!leido.ok) {
        json(res, 400, { error: leido.error });
        return;
      }

      // SE COBRA ANTES DE SERVIR. Si se sirviera primero y el cobro fallara, el
      // trabajo estaría regalado y no habría forma de recuperarlo.
      const cobro = await verifyAndSettle(
        { publicClient: panal.publicClient, walletClient: panal.walletClient ?? null, token: X402_TOKEN, domain, payee: account.address },
        leido.payment,
        X402_PRICE,
      );
      if (!cobro.ok) {
        json(res, cobro.status, { error: cobro.error });
        return;
      }
      console.log(`[x402] cobrado ${cobro.amount} de ${leido.payment.payer} · tx ${cobro.txHash}`);

      // Ya está cobrado: pase lo que pase a partir de aquí, hay que responder
      // algo. Si el modelo revienta, se dice; callarse sería quedarse el dinero.
      try {
        const salida = await handleTask(
          prompt,
          contexto({ taskId: null, client: leido.payment.payer, amount: cobro.amount, deadline: 0n }, sobre),
        );
        // En una llamada x402 no hay tarea, así que no hay nada que anclar ni
        // ninguna firma con la que proteger una descarga: los archivos no
        // tienen dónde agarrarse. Se responde el texto y se avisa en el log en
        // vez de callarlo, que si no el autor busca el fallo donde no está.
        const { text: answer, files } = normalizarSalida(salida);
        if (files.length) {
          console.error(
            `[x402] tu handleTask devolvió ${files.length} archivo(s) y una llamada x402 no puede entregarlos: ` +
              'no hay tarea que los ancle ni firma que proteja la descarga. Solo va el texto.',
          );
        }
        res.setHeader('x-payment-tx', cobro.txHash);
        json(res, 200, { answer, paid: { txHash: cobro.txHash, amount: cobro.amount.toString(), asset: X402_TOKEN } });
      } catch (err) {
        console.error(`[x402] cobrado pero falló al responder: ${err instanceof Error ? err.message : err}`);
        json(res, 502, {
          error: 'the payment went through but the agent could not answer',
          paid: { txHash: cobro.txHash, amount: cobro.amount.toString() },
        });
      }
      return;
    }

    // Reenvío manual del brief, para cuando el envío automático del dashboard
    // no llega: móvil, wallet que se traga la firma, pestaña cerrada a medias.
    // Se sirve desde el propio agente a propósito: mismo origen, sin CORS de
    // por medio, y funciona dentro del navegador de una wallet.
    if (url.pathname === '/reenviar' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PAGINA_REENVIO);
      return;
    }

    // ---- El cliente te manda el encargo -------------------------------------
    // La ruta canónica es POST /brief/<taskId>: es la que llama el dashboard de
    // panal.lat y la que documenta el bot de referencia. Se admite también
    // POST /brief con el taskId dentro del cuerpo, porque hay clientes que ya
    // hablaban así y romperlos no arregla nada.
    const rutaBrief = /^\/brief(?:\/(\d+))?$/.exec(url.pathname);
    if (rutaBrief && req.method === 'POST') {
      const body = JSON.parse(await readBody(req)) as {
        taskId?: string | number;
        brief?: string;
        address?: string;
        signature?: string;
      };
      const idCrudo = rutaBrief[1] ?? body.taskId;
      if (idCrudo === undefined || !body.brief || !body.signature) {
        json(res, 400, { error: 'faltan taskId, brief o signature' });
        return;
      }
      const taskId = BigInt(idCrudo);

      // El sobre de la cadena, si este encargo viene de otro agente. Se mira
      // ANTES de leer la tarea: si es un ciclo, hasta el eth_call sobra.
      const sobre = parseEnvelope(req.headers);
      try {
        assertCanServe(sobre, account.address);
      } catch (err) {
        if (err instanceof LoopDetected) {
          // 508 Loop Detected. Existe para esto exactamente, y decirlo con el
          // código correcto deja que quien llama lo distinga de un fallo suyo.
          console.error(`[panal] ciclo cortado en #${taskId}: ${err.message}`);
          json(res, 508, { error: err.message, trace: err.trace });
          return;
        }
        throw err;
      }

      // Con reintentos: el cliente acaba de minar la tarea contra otro nodo y
      // el nuestro puede ir por detrás. Ver `leerTarea`.
      const task = await leerTarea(taskId);

      // Cuatro comprobaciones, y las cuatro importan: que la tarea sea tuya,
      // que siga abierta, que quien dice firmar sea el cliente que pagó, y que
      // la firma lo demuestre.
      if (task.worker.toLowerCase() !== account.address.toLowerCase()) {
        json(res, 403, { error: 'esa tarea no es de este agente' });
        return;
      }
      // El dashboard manda además quién firma; si no cuadra con el cliente de
      // la tarea, se corta antes de gastar una verificación de firma.
      if (body.address && body.address.toLowerCase() !== task.client.toLowerCase()) {
        json(res, 403, { error: 'esa dirección no es el cliente de la tarea' });
        return;
      }
      if (task.status !== TaskStatus.Open) {
        json(res, 409, { error: `la tarea está ${TaskStatus[task.status]}` });
        return;
      }
      if (!(await signedBy(briefSignMessage(taskId), body.signature, task.client))) {
        json(res, 401, { error: 'la firma no es del cliente de esta tarea' });
        return;
      }
      // Y que el texto sea EL que se encargó. Para esto existe el taskHash: sin
      // esta comprobación, un cliente podría pagar por una cosa on-chain y
      // pedirte otra por HTTP, y en una disputa el árbitro no tendría con qué
      // decidir. Un carácter de más y esto salta, que es justo lo que se busca.
      if (keccak256(toBytes(body.brief)) !== task.taskHash) {
        json(res, 409, {
          error: 'ese texto no es el que se registró en la cadena para esta tarea',
          taskHash: task.taskHash,
        });
        return;
      }

      json(res, 202, { ok: true });
      // Sin await: el cliente no debería esperar a que termines de trabajar.
      void work(taskId, body.brief, sobre);
      return;
    }

    // ---- El cliente recoge su resultado -------------------------------------
    const match = /^\/result\/(\d+)$/.exec(url.pathname);
    if (match && req.method === 'GET') {
      const taskId = BigInt(match[1]!);
      const cred = credencialesDe(req, url);
      if (!cred.address || !cred.signature) {
        json(res, 400, { error: 'faltan address y signature (cabeceras x-panal-address / x-panal-signature)' });
        return;
      }
      if (cred.porQuery) avisaQuery(taskId);
      // Cacheado: aquí solo se usa el cliente, que no cambia nunca.
      const cliente = await clienteDeTarea(taskId);
      if (cred.address.toLowerCase() !== cliente.toLowerCase()) {
        json(res, 403, { error: 'solo el cliente de la tarea puede descargar el resultado' });
        return;
      }
      if (!(await credencialValida(taskId, cred.signature, cred.expira, cliente))) {
        json(res, 401, { error: 'firma inválida o caducada' });
        return;
      }
      const text = loadResult(taskId);
      if (!text) {
        json(res, 404, { error: 'todavía no hay resultado para esa tarea' });
        return;
      }
      json(res, 200, { resultText: text });
      return;
    }

    // ---- El cliente se baja los archivos de su entrega ----------------------
    //
    // Se protege igual que el resultado, y con LA MISMA firma: `Panal resultado
    // #<id>` abre el texto y todos sus archivos. Firmar una vez por archivo
    // sería pedirle al cliente cuatro firmas por una entrega de cuatro PDFs.
    const archivo = /^\/files\/(\d+)\/([^/]+)$/.exec(url.pathname);
    if (archivo && req.method === 'GET') {
      const taskId = BigInt(archivo[1]!);
      const cred = credencialesDe(req, url);
      if (!cred.address || !cred.signature) {
        json(res, 400, { error: 'faltan address y signature (cabeceras x-panal-address / x-panal-signature)' });
        return;
      }
      if (cred.porQuery) avisaQuery(taskId);
      // Cacheado: aquí solo se usa el cliente, que no cambia nunca.
      const cliente = await clienteDeTarea(taskId);
      if (cred.address.toLowerCase() !== cliente.toLowerCase()) {
        json(res, 403, { error: 'solo el cliente de la tarea puede descargar sus archivos' });
        return;
      }
      if (!(await credencialValida(taskId, cred.signature, cred.expira, cliente))) {
        json(res, 401, { error: 'firma inválida o caducada' });
        return;
      }

      // El nombre viene de la URL, o sea de fuera: se limpia igual que al
      // escribirlo. Sin esto, `/files/31/..%2F..%2F.env` leería el .env.
      let nombre: string;
      try {
        nombre = sanitizeFileName(decodeURIComponent(archivo[2]!));
      } catch {
        json(res, 400, { error: 'nombre de archivo inválido' });
        return;
      }

      let bytes: Buffer;
      try {
        bytes = readFileSync(join(filesDir(taskId), nombre));
      } catch {
        json(res, 404, { error: 'esa tarea no tiene ese archivo' });
        return;
      }

      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': bytes.byteLength,
        // `attachment` a propósito: lo que hay dentro lo eligió el agente, y no
        // se le deja que el navegador del cliente lo ejecute como una página.
        'content-disposition': `attachment; filename="${nombre}"`,
        'x-content-type-options': 'nosniff',
      });
      res.end(bytes);
      return;
    }

    json(res, 404, { error: 'no existe' });
  })().catch((err) => {
    // «Todavía no la veo» NO es un 500. Con 425 (Too Early) quien llama sabe
    // que reintentar tiene sentido; con 500 parecía una avería del agente y el
    // dashboard se rendía dejando al cliente reenviando a mano. Se responde
    // rápido y sin ruido en el log: no hay nada roto que mirar.
    if (err instanceof TareaAunNoVisible) {
      if (!res.headersSent) {
        json(res, 425, { error: err.message, reintentable: true });
      } else res.end();
      return;
    }
    console.error(`[http] ${err instanceof Error ? err.message : err}`);
    if (!res.headersSent) json(res, 500, { error: 'error interno' });
    else res.end();
  });
});

server.listen(PORT);

// El vigilante. Va DESPUÉS de escuchar: su primer repaso puede tardar unos
// segundos contra el RPC, y durante ese rato el agente ya tiene que estar
// atendiendo peticiones normales.
arrancarVigilante({
  panal,
  yo: account.address,
  dataDir: DATA_DIR,
  briefGuardado: loadBrief,
  // La misma guarda que usa work(): una sola fuente de verdad sobre qué se
  // está trabajando ahora mismo.
  enCurso: (taskId) => inFlight.has(taskId.toString()),
  resultadoGuardado: loadResult,
  // Retomar un trabajo a medias es exactamente lo mismo que hacerlo la primera
  // vez. El sobre va en null: la cadena que lo trajo ya no existe —el proceso
  // que la sostenía murió—, así que esta reanudación no puede seguir gastando
  // en nombre de nadie. Si el encargo necesitaba subcontratar, lo hará con el
  // presupuesto propio de este agente y no con el de quien llamó.
  trabajar: (taskId, brief) => work(taskId, brief, null),
  reentregar: async (taskId, texto) => {
    const { txHash } = await panal.deliverResult(taskId, texto);
    console.log(`[vigilante] #${taskId} entregada al segundo intento · tx ${txHash}`);
  },
  urlPublica: process.env.PUBLIC_URL?.trim(),
});
