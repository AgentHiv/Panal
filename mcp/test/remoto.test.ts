/**
 * Prueba del MCP remoto (src/remoto.ts) hablando HTTP de verdad.
 *
 *   npx tsx test/remoto.test.ts     (o: npm test)
 *
 * Lo que tiene que quedar demostrado:
 *   - que NO PAGA: no ofrece ninguna herramienta que mueva dinero y se niega a
 *     arrancar si le ponen una clave;
 *   - que habla el transporte HTTP del protocolo como lo esperan los clientes:
 *     JSON a un POST, 202 a una notificación, 405 a un GET, la cabecera de
 *     versión, CORS;
 *   - que los límites están: cuerpo grande, tipo de contenido, JSON roto;
 *   - y que una contratación preparada deja un borrador que solo la web puede
 *     leer, con el texto tal cual.
 *
 * Las lecturas tocan Monad mainnet, como las del MCP local. Las aserciones son
 * estructurales: el mercado es un sistema vivo.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUERTO = 18_000 + Math.floor(Math.random() * 1_000);
const BASE = `http://127.0.0.1:${PUERTO}`;

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

function arrancar(env: Record<string, string>): ChildProcess {
  return spawn(resolve(RAIZ, 'node_modules/.bin/tsx'), ['src/remoto.ts'], {
    cwd: RAIZ,
    env: { ...process.env, MCP_PRIVATE_KEY: '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function rpc(cuerpo: unknown, cabeceras: Record<string, string> = {}): Promise<{ status: number; json: any; texto: string }> {
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...cabeceras },
    body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
  });
  const texto = await res.text();
  let json: any = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    /* no era JSON */
  }
  return { status: res.status, json, texto };
}

const llamar = async (name: string, args: Record<string, unknown>) =>
  (await rpc({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args } })).json;
const textoDe = (r: any): string => r?.result?.content?.[0]?.text ?? '';

// ---------------------------------------------------------------------------
console.log('\n─── no arranca con una clave ───');
{
  const p = arrancar({ PORT: String(PUERTO + 1), MCP_PRIVATE_KEY: `0x${'11'.repeat(32)}` });
  let salida = '';
  p.stderr!.on('data', (d) => (salida += String(d)));
  const codigo = await new Promise<number | null>((r) => p.on('exit', r));
  check('con MCP_PRIVATE_KEY se niega y sale con error', codigo === 1, `código ${codigo}`);
  check('y dice por qué', salida.includes('no paga nunca'), salida.slice(0, 200));
}

// ---------------------------------------------------------------------------
const servidor = arrancar({ PORT: String(PUERTO), ORIGENES_BORRADOR: 'https://panal.lat' });
servidor.stdout!.on('data', () => {});
servidor.stderr!.on('data', (d) => process.stderr.write(`  [remoto] ${String(d)}`));
let listo = false;
for (let i = 0; i < 60 && !listo; i++) {
  try {
    listo = (await fetch(`${BASE}/health`)).ok;
  } catch {
    await new Promise((r) => setTimeout(r, 500));
  }
}
check('arranca y contesta en /health', listo);

try {
  console.log('\n─── el protocolo ───');
  const ini = await rpc({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'prueba', version: '1' } },
  });
  check('initialize contesta con JSON', ini.status === 200 && ini.json?.result?.protocolVersion === '2025-06-18', ini.texto.slice(0, 200));
  check('y trae instrucciones para el modelo', typeof ini.json?.result?.instructions === 'string' && ini.json.result.instructions.includes('cannot pay'));
  const versionRara = await rpc(
    { jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2099-01-01', capabilities: {}, clientInfo: { name: 'x', version: '1' } } },
    { 'mcp-protocol-version': '2099-01-01' },
  );
  check('en initialize, una versión desconocida se negocia, no se rechaza', versionRara.status === 200 && versionRara.json?.result?.protocolVersion === '2025-06-18');
  const noti = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
  check('una notificación es 202 sin cuerpo', noti.status === 202 && noti.texto === '');
  const fuera = await rpc({ jsonrpc: '2.0', id: 3, method: 'ping' }, { 'mcp-protocol-version': '1999-01-01' });
  check('después, una versión que no hablamos es 400', fuera.status === 400);
  const lote = await rpc([
    { jsonrpc: '2.0', id: 'a', method: 'ping' },
    { jsonrpc: '2.0', id: 'b', method: 'ping' },
  ]);
  check('un lote se contesta con un lote', Array.isArray(lote.json) && lote.json.length === 2);
  const get = await fetch(`${BASE}/mcp`);
  check('GET /mcp es 405: no hay stream del servidor', get.status === 405);
  const pre = await fetch(`${BASE}/mcp`, { method: 'OPTIONS', headers: { origin: 'https://example.com' } });
  check('el preflight deja llamar desde un navegador', pre.status === 204 && pre.headers.get('access-control-allow-origin') === '*');
  const desconocido = await rpc({ jsonrpc: '2.0', id: 4, method: 'resources/list' });
  check('un método que no existe es un error JSON-RPC', desconocido.json?.error?.code === -32601);

  console.log('\n─── no paga ───');
  const lista = await rpc({ jsonrpc: '2.0', id: 5, method: 'tools/list' });
  const nombres: string[] = (lista.json?.result?.tools ?? []).map((t: { name: string }) => t.name);
  const esperadas = [
    'panal_search_agents',
    'panal_get_agent',
    'panal_get_task',
    'panal_marketplace_stats',
    'panal_board',
    'panal_board_job',
    'panal_prepare_hire',
  ];
  check('ofrece exactamente las de lectura y la del enlace', JSON.stringify([...nombres].sort()) === JSON.stringify([...esperadas].sort()), nombres.join(', '));
  for (const peligrosa of ['panal_hire', 'panal_quote_hire', 'panal_ask', 'panal_wallet', 'panal_withdraw', 'panal_approve_task', 'panal_board_mine']) {
    check(`no ofrece ${peligrosa}`, !nombres.includes(peligrosa));
  }
  const conPistas = (lista.json?.result?.tools ?? []).every((t: { annotations?: { readOnlyHint?: boolean } }) => typeof t.annotations?.readOnlyHint === 'boolean');
  check('todas llevan sus anotaciones (las piden los directorios)', conPistas);
  const pagar = await llamar('panal_hire', { quote_id: 'x', confirmed_by_user: true });
  check('llamar a panal_hire es un error: aquí no existe', pagar?.error?.code === -32602);

  console.log('\n─── límites ───');
  const tipo = await fetch(`${BASE}/mcp`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
  check('sin application/json es 415', tipo.status === 415);
  const roto = await rpc('{"jsonrpc":');
  check('un JSON roto es 400 con -32700', roto.status === 400 && roto.json?.error?.code === -32700);
  const grande = await rpc({ jsonrpc: '2.0', id: 6, method: 'ping', relleno: 'x'.repeat(300_000) }).catch(() => ({ status: 413 }));
  check('un cuerpo de más de 256 KB es 413', grande.status === 413, String(grande.status));
  check('una dirección mala no prepara nada', textoDe(await llamar('panal_prepare_hire', { agent: 'hola', brief: 'algo' })).includes('valid 0x address'));
  check(
    'un plazo que la web no ofrece tampoco',
    textoDe(await llamar('panal_prepare_hire', { agent: '0x8E9c1Cf58c1F510e22022ebE1Bfd65c4cd6C0308', brief: 'algo', deadline_hours: 5 })).includes('deadline'),
  );
  const inventado = await fetch(`${BASE}/borrador/AAAAAAAAAAAAAAAAAAAAAA`, { headers: { origin: 'https://panal.lat' } });
  check('un borrador que no existe es 404', inventado.status === 404);

  console.log('\n─── contra mainnet ───');
  const busqueda = textoDe(await llamar('panal_search_agents', {}));
  check('la búsqueda trae agentes', /\d+ agent\(s\)/.test(busqueda), busqueda.slice(0, 200));
  check('y dice si es una persona o un programa', busqueda.includes('Who:'));
  check('sin mencionar herramientas que aquí no hay', !busqueda.includes('panal_quote_hire'));

  // El primero que conteste. El mercado cambia: si ninguno contesta, se dice y
  // no se cuenta como fallo del servidor.
  const direcciones = [...busqueda.matchAll(/— (0x[0-9a-fA-F]{40})/g)].map((m) => m[1]!);
  const encargo = 'Prueba automática del MCP remoto: este encargo no se contrata nunca.';
  let enlace: string | null = null;
  for (const a of direcciones.slice(0, 6)) {
    const t = textoDe(await llamar('panal_prepare_hire', { agent: a, brief: encargo, deadline_hours: 24 }));
    const m = /Link: (https:\/\/panal\.lat\/contratar\/[A-Za-z0-9_-]+)/.exec(t);
    if (m) {
      enlace = m[1]!;
      check('la contratación preparada dice el precio', t.includes('Price:'));
      check('y que aquí no se paga nada', t.includes('nothing is paid until they do'));
      break;
    }
    check(`${a.slice(0, 10)}… no da enlace, y lo explica`, t.includes('No link was made') || t.includes('delisted') || t.includes('does not fit'), t.slice(0, 160));
  }
  if (!enlace) {
    console.log('ℹ️  ningún agente de los primeros contestó: no se comprueba el borrador');
  } else {
    const id = enlace.split('/').pop()!;
    const desdeLaWeb = await fetch(`${BASE}/borrador/${id}`, { headers: { origin: 'https://panal.lat' } });
    const b = (await desdeLaWeb.json()) as { encargo?: string; horas?: number; agente?: string };
    check('la web lee el borrador', desdeLaWeb.status === 200 && desdeLaWeb.headers.get('access-control-allow-origin') === 'https://panal.lat');
    check('con el encargo tal cual y el plazo pedido', b.encargo === encargo && b.horas === 24);
    const desdeOtra = await fetch(`${BASE}/borrador/${id}`, { headers: { origin: 'https://otra.example' } });
    check('otra página no recibe permiso para leerlo', desdeOtra.headers.get('access-control-allow-origin') === null);
  }
} finally {
  servidor.kill('SIGTERM');
}

console.log(fallos === 0 ? '\n✅ El MCP remoto no paga, habla el protocolo y deja el borrador solo a la web\n' : `\n❌ ${fallos} comprobación(es) fallidas\n`);
process.exit(fallos === 0 ? 0 : 1);
