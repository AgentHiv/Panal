/**
 * Prueba del servidor MCP (`src/mcp.ts`) — solo lectura contra Monad mainnet.
 *
 *   npx tsx scripts/test-mcp.ts     (o: pnpm test:mcp)
 *
 * Levanta el servidor como subproceso, habla JSON-RPC 2.0 por stdio igual que
 * lo haría Claude Desktop, y comprueba el handshake, el catálogo de
 * herramientas y las respuestas.
 *
 * TOCA MAINNET, Y ESO ES DELIBERADO: el servidor es de solo lectura, así que
 * las llamadas no cuestan gas ni mueven fondos, y probar contra la cadena real
 * es la única forma de detectar que un ABI o una dirección dejó de cuadrar.
 * Las aserciones son estructurales (formato, invariantes) y no dependen de
 * cuántos agentes haya registrados hoy, para que la prueba no se rompa sola
 * cuando el marketplace crezca.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createPublicClient, http, type Address } from 'viem';
import { monad, registryAbi } from '../src/chain.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = resolve(HERE, '..', 'src', 'mcp.ts');
const TIMEOUT_MS = 45_000;

/**
 * Los agentes de las comprobaciones se DESCUBREN del registry en tiempo real.
 *
 * La primera versión traía dos direcciones fijas de mainnet y se rompió sola en
 * cuanto el operador desactivó una de ellas para mudar su agente a otra wallet:
 * el registry es estado vivo, no un fixture. Ahora se busca cada vez, así que
 * la prueba sobrevive a cualquier cambio del marketplace. Si no existe alguno
 * de los tres, esa comprobación se omite en vez de fallar: que hoy no haya
 * agentes inactivos no es un fallo del código.
 *
 * SON TRES Y NO DOS, y la diferencia es la que rompió esta prueba.
 *
 * Buscar «un agente activo» no bastaba: la cotización necesita además que ese
 * agente publique `bot:<url>` en su metadata, porque sin endpoint no hay a
 * quién pedirle precio y `quote_hire` se para ANTES de mirar el saldo. En
 * cuanto se registró un agente activo sin endpoint y le tocó salir el primero,
 * la comprobación del saldo empezó a recibir «no publica endpoint» y a fallar
 * — sin que nada del código hubiera cambiado.
 *
 * Así que se busca por la propiedad que la prueba necesita de verdad:
 * cotizable = activo Y con endpoint.
 */
async function findAgents(): Promise<{
  active?: Address;
  quotable?: Address;
  inactive?: Address;
}> {
  const client = createPublicClient({ chain: monad, transport: http(RPC_URL) });
  const addresses = (await client.readContract({
    address: REGISTRY,
    abi: registryAbi,
    functionName: 'getAgents',
    args: [0n, 50n],
  })) as readonly Address[];

  const found: { active?: Address; quotable?: Address; inactive?: Address } = {};
  for (const address of addresses) {
    const a = (await client.readContract({
      address: REGISTRY,
      abi: registryAbi,
      functionName: 'getAgent',
      args: [address],
    })) as { active: boolean; metadataURI: string };
    if (a.active && !found.active) found.active = address;
    if (a.active && !found.quotable && tieneEndpoint(a.metadataURI)) found.quotable = address;
    if (!a.active && !found.inactive) found.inactive = address;
    if (found.active && found.quotable && found.inactive) break;
  }
  return found;
}

/**
 * Si la metadata declara un `bot:<url>` utilizable.
 *
 * Se repite aquí en lugar de importar `parseMetadata` de `mcp.ts` a propósito:
 * ese archivo arranca el servidor MCP al importarse, y una prueba que lo
 * importe para preguntar dos cosas dejaría un servidor de más corriendo. Son
 * cuatro líneas y esta es su única condición.
 */
function tieneEndpoint(metadataURI: string): boolean {
  return metadataURI
    .split('·')
    .map((s) => s.trim())
    .some((s) => s.toLowerCase().startsWith('bot:') && /^https?:\/\//i.test(s.slice(4).trim()));
}

const RPC_URL = process.env.RPC_URL?.trim() || 'https://rpc.monad.xyz';
const REGISTRY = '0x89a812BFb1c35fc814ef25a3E6Ca75068B16Ac51' as Address;

let failures = 0;

function ok(label: string, detail = ''): void {
  console.log(`✅ ${label}${detail ? `: ${detail}` : ''}`);
}

function fail(label: string, detail: string): void {
  failures += 1;
  console.error(`❌ ${label}: ${detail}`);
}

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) ok(label, detail);
  else fail(label, detail || 'no se cumplió la condición');
}

// ---------------------------------------------------------------------------
// Cliente MCP mínimo sobre el subproceso.
// ---------------------------------------------------------------------------

interface RpcResponse {
  id?: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

class McpClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private buffer = '';
  private nextId = 1;
  private readonly pending = new Map<number, (res: RpcResponse) => void>();

  constructor(env: Record<string, string> = {}) {
    this.child = spawn('npx', ['tsx', SERVER], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => {
      this.buffer += chunk;
      let nl: number;
      while ((nl = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        if (!line) continue;
        let msg: RpcResponse;
        try {
          msg = JSON.parse(line) as RpcResponse;
        } catch {
          fail('stdout del servidor', `línea no es JSON — ¿algún console.log se coló? ${line.slice(0, 120)}`);
          continue;
        }
        if (typeof msg.id === 'number') this.pending.get(msg.id)?.(msg);
      }
    });
    // stderr es el canal de trazas del servidor: se ignora salvo depuración.
    this.child.stderr.on('data', () => {});
  }

  request(method: string, params?: Record<string, unknown>): Promise<RpcResponse> {
    const id = this.nextId++;
    return new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectPromise(new Error(`timeout esperando respuesta a ${method}`));
      }, TIMEOUT_MS);
      this.pending.set(id, (res) => {
        clearTimeout(timer);
        this.pending.delete(id);
        resolvePromise(res);
      });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  notify(method: string): void {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<{ text: string; isError: boolean }> {
    const res = await this.request('tools/call', { name, arguments: args });
    if (res.error) return { text: res.error.message, isError: true };
    const content = (res.result?.content ?? []) as { type: string; text?: string }[];
    return { text: content.map((c) => c.text ?? '').join('\n'), isError: res.result?.isError === true };
  }

  close(): void {
    this.child.stdin.end();
    this.child.kill();
  }
}

// ---------------------------------------------------------------------------
// Pruebas.
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const agents = await findAgents();
  console.log(
    `agentes descubiertos → activo: ${agents.active ?? 'ninguno'} · cotizable: ${
      agents.quotable ?? 'ninguno'
    } · inactivo: ${agents.inactive ?? 'ninguno'}\n`,
  );

  const client = new McpClient();

  try {
    // --- Handshake -----------------------------------------------------------
    const init = await client.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test-mcp', version: '1' },
    });
    check('initialize responde', !init.error, init.error?.message ?? '');
    check(
      'protocolVersion negociada',
      init.result?.protocolVersion === '2025-06-18',
      String(init.result?.protocolVersion),
    );
    check(
      'serverInfo correcto',
      (init.result?.serverInfo as { name?: string })?.name === 'panal',
      JSON.stringify(init.result?.serverInfo),
    );
    client.notify('notifications/initialized');

    // Una versión que no conocemos debe caer a la nuestra, no romper.
    const initOld = await client.request('initialize', { protocolVersion: '1999-01-01', capabilities: {} });
    check(
      'versión desconocida degrada a la soportada',
      initOld.result?.protocolVersion === '2025-06-18',
      String(initOld.result?.protocolVersion),
    );

    // --- Catálogo ------------------------------------------------------------
    const list = await client.request('tools/list');
    const tools = (list.result?.tools ?? []) as { name: string; description: string; inputSchema: unknown }[];
    check('tools/list devuelve el catálogo', tools.length === 9, `${tools.length} herramientas`);
    const names = tools.map((t) => t.name).sort();
    check(
      'las 9 herramientas esperadas',
      names.join(',') ===
        'panal_approve_task,panal_get_agent,panal_get_result,panal_get_task,panal_hire,' +
          'panal_marketplace_stats,panal_quote_hire,panal_search_agents,panal_wallet',
      names.join(','),
    );
    check(
      'todas llevan descripción y esquema',
      tools.every((t) => t.description.length > 20 && typeof t.inputSchema === 'object'),
    );

    // --- Búsqueda de agentes (mainnet real) ----------------------------------
    const all = await client.callTool('panal_search_agents');
    check('search_agents responde sin error', !all.isError, all.text.slice(0, 120));
    check('search_agents dice que los datos son de mainnet', all.text.includes('Monad mainnet'));
    check('search_agents devuelve al menos un agente activo', all.text.includes('ACTIVO'), all.text.split('\n')[0]);

    const filtered = await client.callTool('panal_search_agents', { skill: 'translation' });
    check('filtro por skill funciona', !filtered.isError && filtered.text.includes('translation'));

    const nonsense = await client.callTool('panal_search_agents', { skill: 'zzz-no-existe-esta-skill' });
    check(
      'skill inexistente da respuesta útil, no error',
      !nonsense.isError && nonsense.text.includes('No hay agentes'),
      nonsense.text.slice(0, 80),
    );

    const inactive = await client.callTool('panal_search_agents', { include_inactive: true });
    check(
      'include_inactive muestra más agentes que el default',
      inactive.text.length > all.text.length,
      `${inactive.text.length} vs ${all.text.length} chars`,
    );

    // --- Ficha de agente -----------------------------------------------------
    const badAddr = await client.callTool('panal_get_agent', { address: 'no-soy-una-direccion' });
    check(
      'dirección inválida se explica sin reventar',
      !badAddr.isError && badAddr.text.includes('no es una dirección válida'),
      badAddr.text.slice(0, 80),
    );

    const unknown = await client.callTool('panal_get_agent', {
      address: '0x000000000000000000000000000000000000dEaD',
    });
    check(
      'dirección no registrada se informa',
      unknown.text.includes('no está registrada'),
      unknown.text.slice(0, 80),
    );

    // --- Tareas (lectura directa de cadena) -----------------------------------
    const task0 = await client.callTool('panal_get_task', { task_id: 0 });
    check('get_task lee la tarea 0 de mainnet', !task0.isError && task0.text.includes('Tarea #0'));
    check('get_task incluye estado e importe', task0.text.includes('Estado:') && task0.text.includes('Importe'));

    const future = await client.callTool('panal_get_task', { task_id: 999_999 });
    check(
      'tarea inexistente se explica con el total real',
      future.text.includes('no existe todavía'),
      future.text.slice(0, 90),
    );

    const negative = await client.callTool('panal_get_task', { task_id: -3 });
    check('task_id negativo se rechaza', negative.text.includes('mayor o igual que 0'));

    // --- Estadísticas --------------------------------------------------------
    const stats = await client.callTool('panal_marketplace_stats');
    check('marketplace_stats responde', !stats.isError, stats.text.slice(0, 100));
    check('stats leen el escrow en directo', stats.text.includes('leído del escrow, bloque'));

    // --- Errores de protocolo -------------------------------------------------
    const missing = await client.request('tools/call', { name: 'panal_no_existe', arguments: {} });
    check('herramienta desconocida da error JSON-RPC', missing.error?.code === -32602, JSON.stringify(missing.error));

    const badMethod = await client.request('metodo/inventado');
    check('método no soportado da -32601', badMethod.error?.code === -32601, JSON.stringify(badMethod.error));

    const ping = await client.request('ping');
    check('ping responde', !ping.error);

    // --- Escritura APAGADA: debe negarse, no fallar --------------------------
    console.log('');
    for (const [tool, args] of [
      ['panal_wallet', {}],
      [
        'panal_quote_hire',
        {
          agent_address: agents.active ?? '0x000000000000000000000000000000000000dEaD',
          brief: 'un encargo de prueba suficientemente largo',
        },
      ],
      ['panal_hire', { quote_id: 'inventado', confirmed_by_user: true }],
      ['panal_approve_task', { task_id: 0, rating: 5, confirmed_by_user: true }],
    ] as const) {
      const res = await client.callTool(tool, args as Record<string, unknown>);
      check(
        `sin MCP_ENABLE_WRITES, ${tool} se niega`,
        /solo lectura|SOLO LECTURA/i.test(res.text),
        res.text.slice(0, 70),
      );
    }
  } finally {
    client.close();
  }

  // -------------------------------------------------------------------------
  // Escritura HABILITADA con una wallet nueva y SIN FONDOS.
  //
  // Recorre la ruta real de contratación contra mainnet —registry, estado del
  // agente, endpoint, precio, topes— y se detiene en la comprobación de saldo.
  // No gasta nada porque no hay nada que gastar, así que puede correr en CI.
  // -------------------------------------------------------------------------
  console.log('\n── escritura habilitada, wallet sin fondos (ruta real, gasto cero) ──');
  const poorKey = `0x${randomBytes(32).toString('hex')}`;
  const writer = new McpClient({
    MCP_ENABLE_WRITES: 'true',
    MCP_PRIVATE_KEY: poorKey,
    MCP_SPEND_FILE: resolve(tmpdir(), `panal-mcp-spend-${randomBytes(6).toString('hex')}.json`),
  });

  try {
    await writer.request('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
    writer.notify('notifications/initialized');

    const wallet = await writer.callTool('panal_wallet');
    check('wallet informa de que la contratación está habilitada', wallet.text.includes('HABILITADA'));
    check('wallet lee saldos reales de mainnet', /0 MON/.test(wallet.text), wallet.text.split('\n')[3] ?? '');

    if (agents.quotable) {
      const quote = await writer.callTool('panal_quote_hire', {
        agent_address: agents.quotable,
        brief: 'Resume este contrato de arrendamiento en lenguaje llano, en español.',
      });
      check(
        'la cotización recorre la ruta real y se detiene en el saldo',
        quote.text.includes('Saldo insuficiente'),
        quote.text.split('\n')[0],
      );
    } else {
      console.log(
        '⏭️  ningún agente activo publica endpoint: se omite la cotización completa',
      );
    }

    // Y que un activo SIN endpoint se pare antes, que es el otro lado de lo
    // mismo: contratarlo dejaría los fondos bloqueados sin nada a cambio.
    const sinEndpoint = agents.active && agents.active !== agents.quotable ? agents.active : null;
    if (sinEndpoint) {
      const quote = await writer.callTool('panal_quote_hire', {
        agent_address: sinEndpoint,
        brief: 'Resume este contrato de arrendamiento en lenguaje llano, en español.',
      });
      check(
        'un agente activo sin endpoint se rechaza antes de cotizar',
        /no publica endpoint/.test(quote.text),
        quote.text.split('\n')[0].slice(0, 70),
      );
    }

    if (agents.inactive) {
      const inactive = await writer.callTool('panal_quote_hire', {
        agent_address: agents.inactive,
        brief: 'Un encargo cualquiera con longitud suficiente.',
      });
      check('un agente inactivo se rechaza antes de nada', /INACTIVO/.test(inactive.text), inactive.text.slice(0, 70));
    } else {
      console.log('⏭️  sin agentes inactivos en el registry: se omite esa comprobación');
    }

    const shortBrief = await writer.callTool('panal_quote_hire', {
      agent_address: agents.active ?? '0x000000000000000000000000000000000000dEaD',
      brief: 'hola',
    });
    check('brief demasiado corto se rechaza', shortBrief.text.includes('demasiado corto'));

    const badAgent = await writer.callTool('panal_quote_hire', {
      agent_address: '0x000000000000000000000000000000000000dEaD',
      brief: 'Un encargo cualquiera con longitud suficiente.',
    });
    check('agente no registrado se rechaza', badAgent.text.includes('no está registrada'));

    const noConfirm = await writer.callTool('panal_hire', { quote_id: 'x', confirmed_by_user: false });
    check('sin confirmación del usuario no se contrata', noConfirm.text.includes('confirmación'));

    const badQuote = await writer.callTool('panal_hire', { quote_id: 'no-existe', confirmed_by_user: true });
    check('un quote_id inventado no contrata', badQuote.text.includes('no existe o ha caducado'));

    const badRating = await writer.callTool('panal_approve_task', {
      task_id: 0,
      rating: 9,
      confirmed_by_user: true,
    });
    check('valoración fuera de 1-5 se rechaza', badRating.text.includes('de 1 a 5'));

    const notMine = await writer.callTool('panal_get_result', { task_id: 0 });
    check(
      'no se puede recoger el resultado de una tarea ajena',
      notMine.text.includes('no esta wallet'),
      notMine.text.slice(0, 70),
    );
  } finally {
    writer.close();
  }

  console.log('');
  if (failures === 0) {
    console.log('✅ Todas las comprobaciones MCP pasaron');
  } else {
    console.error(`❌ ${failures} comprobación(es) fallaron`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`❌ error inesperado: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
});
