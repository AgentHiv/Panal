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
  buildQuote,
  createPanalClient,
  MAINNET_ADDRESSES,
  parsePaymentHeader,
  permitNonce,
  readPermitDomain,
  TaskStatus,
  verifyAndSettle,
  type PermitDomain,
} from '@panal/sdk';
import { privateKeyToAccount } from 'viem/accounts';
import { isAddress, keccak256, parseEther, toBytes, verifyMessage } from 'viem';
import type { Address } from 'viem';
import { handleTask } from './agent.js';

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

/** Tareas que se están procesando ahora mismo: evita trabajar dos veces. */
const inFlight = new Set<string>();

// ---------------------------------------------------------------------------
// Firmas: el cliente demuestra quién es sin gastar gas (EIP-191).
// Los mensajes tienen que coincidir EXACTAMENTE con los del dashboard.
// ---------------------------------------------------------------------------

const briefSignMessage = (taskId: bigint) => `Panal brief #${taskId}`;
const resultSignMessage = (taskId: bigint) => `Panal resultado #${taskId}`;

async function signedBy(message: string, signature: string, expected: Address): Promise<boolean> {
  try {
    return await verifyMessage({ address: expected, message, signature: signature as `0x${string}` });
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// El trabajo
// ---------------------------------------------------------------------------

async function work(taskId: bigint, brief: string): Promise<void> {
  const key = taskId.toString();
  if (inFlight.has(key)) return;
  inFlight.add(key);
  try {
    const task = await panal.getTask(taskId);
    const text = await handleTask(brief, {
      taskId,
      client: task.client,
      amount: task.amount,
      deadline: task.deadline,
    });

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

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    // El dashboard vive en otro dominio: sin CORS el cliente no puede ni
    // mandarte el brief ni descargar su resultado.
    res.setHeader('access-control-allow-origin', 'https://panal.lat');
    res.setHeader('vary', 'origin');
    if (req.method === 'OPTIONS') {
      res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
      res.setHeader('access-control-allow-headers', 'content-type');
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
        const answer = await handleTask(prompt, {
          taskId: null,
          client: leido.payment.payer,
          amount: cobro.amount,
          deadline: 0n,
        });
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
      const task = await panal.getTask(taskId);

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
      void work(taskId, body.brief);
      return;
    }

    // ---- El cliente recoge su resultado -------------------------------------
    const match = /^\/result\/(\d+)$/.exec(url.pathname);
    if (match && req.method === 'GET') {
      const taskId = BigInt(match[1]!);
      const address = url.searchParams.get('address');
      const signature = url.searchParams.get('signature');
      if (!address || !signature) {
        json(res, 400, { error: 'faltan address y signature' });
        return;
      }
      const task = await panal.getTask(taskId);
      if (address.toLowerCase() !== task.client.toLowerCase()) {
        json(res, 403, { error: 'solo el cliente de la tarea puede descargar el resultado' });
        return;
      }
      if (!(await signedBy(resultSignMessage(taskId), signature, task.client))) {
        json(res, 401, { error: 'firma inválida' });
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

    json(res, 404, { error: 'no existe' });
  })().catch((err) => {
    console.error(`[http] ${err instanceof Error ? err.message : err}`);
    if (!res.headersSent) json(res, 500, { error: 'error interno' });
    else res.end();
  });
});

server.listen(PORT);
