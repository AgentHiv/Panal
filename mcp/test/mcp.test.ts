/**
 * Prueba del servidor MCP hablando el protocolo de verdad, por stdio.
 *
 *   npx tsx test/mcp.test.ts     (o: npm test)
 *
 * Lanza el servidor como un proceso hijo y le habla JSON-RPC exactamente igual
 * que haría Claude. Es la única forma de comprobar lo que de verdad importa de
 * un MCP: que el handshake cuadre, que stdout lleve solo protocolo y que las
 * herramientas de escritura estén cerradas cuando no se han autorizado.
 *
 * Las lecturas tocan Monad mainnet. Las aserciones son ESTRUCTURALES: nunca
 * sobre un agente o una tarea concretos, porque el marketplace es un sistema
 * vivo donde cualquiera se da de alta o de baja.
 *
 * NO firma nada: se arranca sin MCP_ENABLE_WRITES, así que ni siquiera puede.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`✅ ${label}${detail ? `: ${detail}` : ''}`);
  else {
    failures += 1;
    console.error(`❌ ${label}${detail ? `: ${detail}` : ''}`);
  }
}

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = resolve(HERE, '..', 'src', 'server.ts');

/** Cliente MCP mínimo: escribe una petición por línea y espera su respuesta. */
class McpHarness {
  private readonly pending = new Map<number, (value: unknown) => void>();
  private nextId = 1;
  /** Todo lo que el servidor escribió en stdout y NO era JSON: debe estar vacío. */
  readonly stdoutGarbage: string[] = [];
  readonly stderr: string[] = [];

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    createInterface({ input: child.stdout }).on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const msg = JSON.parse(trimmed) as { id?: number; result?: unknown; error?: unknown };
        if (typeof msg.id === 'number') this.pending.get(msg.id)?.(msg.result ?? msg.error);
      } catch {
        // stdout es del protocolo: cualquier otra cosa corrompe la sesión.
        this.stdoutGarbage.push(trimmed.slice(0, 120));
      }
    });
    createInterface({ input: child.stderr }).on('line', (l) => this.stderr.push(l));
  }

  static start(env: Record<string, string> = {}): McpHarness {
    const child = spawn('npx', ['tsx', SERVER], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;
    return new McpHarness(child);
  }

  request(method: string, params?: Record<string, unknown>): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolveReq, rejectReq) => {
      const timer = setTimeout(() => rejectReq(new Error(`${method} no respondió en 45 s`)), 45_000);
      this.pending.set(id, (value) => {
        clearTimeout(timer);
        resolveReq(value);
      });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  notify(method: string): void {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<string> {
    const res = await this.request('tools/call', { name, arguments: args });
    return res?.content?.[0]?.text ?? JSON.stringify(res);
  }

  stop(): void {
    this.child.stdin.end();
    this.child.kill();
  }
}

async function main(): Promise<void> {
  const mcp = McpHarness.start();
  try {
    console.log('── 1. Handshake ──');

    const init = await mcp.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '0' },
    });
    check('initialize responde', Boolean(init?.serverInfo), JSON.stringify(init?.serverInfo));
    check('acepta la versión que pide el cliente', init?.protocolVersion === '2025-06-18', init?.protocolVersion);
    check('anuncia herramientas', Boolean(init?.capabilities?.tools));
    mcp.notify('notifications/initialized');

    // Una versión que no conocemos no debe tumbar la sesión: se negocia a la nuestra.
    const other = McpHarness.start();
    const oldInit = await other.request('initialize', { protocolVersion: '1999-01-01', capabilities: {} });
    check('una versión desconocida se negocia', typeof oldInit?.protocolVersion === 'string', oldInit?.protocolVersion);
    other.stop();

    check('ping responde', JSON.stringify(await mcp.request('ping')) === '{}');

    console.log('\n── 2. Catálogo de herramientas ──');

    const list = await mcp.request('tools/list');
    const names: string[] = (list?.tools ?? []).map((t: { name: string }) => t.name);
    check('las 15 herramientas se anuncian', names.length === 15, names.join(', '));
    for (const expected of [
      'panal_search_agents',
      'panal_get_agent',
      'panal_get_task',
      'panal_quote_ask',
      'panal_marketplace_stats',
      'panal_wallet',
      'panal_quote_hire',
      'panal_ask',
      'panal_hire',
      'panal_get_result',
      'panal_approve_task',
      'panal_send_brief',
      // Recuperación: el MCP podía dejar dinero bloqueado —el encargo se
      // entrega después de pagar— y no tenía forma de devolverlo.
      'panal_cancel_task',
      'panal_open_dispute',
      'panal_withdraw',
    ]) {
      check(`  ${expected} presente`, names.includes(expected));
    }
    check(
      'todas traen descripción y esquema',
      (list?.tools ?? []).every((t: { description?: string; inputSchema?: unknown }) => t.description && t.inputSchema),
    );

    console.log('\n── 3. Lectura contra Monad mainnet ──');

    const stats = await mcp.callTool('panal_marketplace_stats');
    check('las cifras del marketplace se leen', /Registered agents: \d+/.test(stats), stats.split('\n')[0]);
    check('el escrow que reporta es el desplegado', stats.includes('0xe138A9A492CFe27A13f8b7A6D312DA831791bCe9'));

    const search = await mcp.callTool('panal_search_agents', {});
    check('buscar agentes devuelve algo legible', search.length > 20, search.split('\n')[0]);

    // Presupuestar una consulta NO gasta y NO necesita wallet: tiene que
    // funcionar en solo lectura, que es como arranca el servidor por defecto.
    // Si esto exigiera clave, el precio por llamada seguiría siendo invisible
    // para todo el que no configure una.
    const parse = '0x6e4D695C1ca538d26d8323dC22239d30950B8Aa7';
    const presu = await mcp.callTool('panal_quote_ask', { agent: parse, prompt: '¿cuánto cobras?' });
    check(
      'presupuestar una consulta funciona sin wallet',
      presu.includes('quote_id:') || presu.includes('does not answer per-question'),
      presu.split('\n')[0],
    );

    // Se descubre una dirección real en vez de fijarla: fijar la de LexPanal ya
    // rompió el CI el día que se desactivó.
    const address = /0x[0-9a-fA-F]{40}/.exec(await mcp.callTool('panal_search_agents', { include_inactive: true }))?.[0];
    if (address) {
      const detail = await mcp.callTool('panal_get_agent', { address });
      check('la ficha de un agente real se lee', detail.includes(address), detail.split('\n')[0]);
      // Los DOS precios, que es el punto: enseñar solo el de tarea hacía
      // invisible el de consulta, y se diferencian hasta en la moneda.
      check('la ficha trae el precio por tarea', detail.includes('Per task:'));
      check('la ficha trae el precio por consulta', detail.includes('Per question:'));
    } else {
      console.log('ℹ️  no hay agentes registrados: ficha no comprobada');
    }

    const task = await mcp.callTool('panal_get_task', { task_id: 0 });
    check('una tarea real se lee', task.startsWith('Task #0'), task.split('\n')[0]);

    console.log('\n── 4. Entradas inválidas: mensaje claro, nunca una excepción ──');

    check(
      'una dirección con formato malo se rechaza',
      (await mcp.callTool('panal_get_agent', { address: 'no-soy-una-direccion' })).includes('0x'),
    );
    check(
      'una tarea inexistente se explica',
      (await mcp.callTool('panal_get_task', { task_id: 99_999_999 })).includes('does not exist'),
    );
    const unknown = await mcp.request('tools/call', { name: 'panal_no_existe', arguments: {} });
    check('una herramienta inventada da error de protocolo', unknown?.code === -32602, JSON.stringify(unknown));

    console.log('\n── 5. Sin autorización NO se puede gastar ──');
    // Este es el bloque que de verdad importa: el servidor arrancó sin
    // MCP_ENABLE_WRITES, así que toda ruta que mueva dinero debe estar cerrada.

    const wallet = await mcp.callTool('panal_wallet');
    check('la wallet avisa de que está en solo lectura', wallet.includes('READ-ONLY'), wallet.slice(0, 60));

    const quote = await mcp.callTool('panal_quote_hire', {
      agent: '0x0000000000000000000000000000000000000001',
      brief: 'lo que sea',
    });
    check('presupuestar está cerrado', quote.includes('READ-ONLY'));

    const hire = await mcp.callTool('panal_hire', { quote_id: 'inventado', confirmed_by_user: true });
    check('contratar está cerrado incluso con confirmación', hire.includes('READ-ONLY'), hire.slice(0, 60));

    const approve = await mcp.callTool('panal_approve_task', { task_id: 0, rating: 5, confirmed_by_user: true });
    check('liberar el pago está cerrado', approve.includes('READ-ONLY'));

    // Pagar una consulta por x402 es barato, y por eso mismo es el camino por
    // el que un modelo gastaría sin pensar. Cerrado igual que contratar.
    const ask = await mcp.callTool('panal_ask', { quote_id: 'inventado', confirmed_by_user: true });
    check('pagar una consulta está cerrado', ask.includes('READ-ONLY'), ask.slice(0, 60));

    // Reenviar el encargo no mueve dinero, pero firma con la wallet del
    // servidor: sin autorización tampoco se firma nada en nombre de nadie.
    const reenvio = await mcp.callTool('panal_send_brief', { task_id: 0, brief: 'lo que sea' });
    check('reenviar el encargo también está cerrado', reenvio.includes('READ-ONLY'), reenvio.slice(0, 60));

    console.log('\n── 6. El informe de la wallet mira TODAS las monedas ──');
    // La regresión que motiva esto: `panal_wallet` leía solo el saldo nativo y
    // debajo listaba los topes de MON y de $PANAL. Quien lo leía daba por
    // comprobado un saldo que nadie había mirado, y contrataba en $PANAL sin
    // tener con qué pagar.
    //
    // La clave es la primera de anvil, pública y sin fondos: aquí solo sirve
    // para tener una dirección que consultar. `panal_wallet` no firma nada.
    const conWallet = McpHarness.start({
      MCP_ENABLE_WRITES: 'true',
      MCP_PRIVATE_KEY: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    });
    try {
      await conWallet.request('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
      const informe = await conWallet.callTool('panal_wallet');
      const saldos = informe
        .slice(informe.indexOf('Balance:'), informe.indexOf('Caps and budgets'))
        .split('\n')
        .filter((l) => l.startsWith('  '));
      const topes = informe
        .slice(informe.indexOf('Caps and budgets'))
        .split('\n')
        .filter((l) => l.startsWith('  ') && l.includes('per job'));

      check('el informe trae el saldo en MON', saldos.some((l) => l.trim().startsWith('MON:')), saldos.join(' | '));
      check('y también el saldo en $PANAL', saldos.some((l) => l.trim().startsWith('$PANAL:')), saldos.join(' | '));
      // Estructural a propósito: si mañana se acepta una tercera moneda, este
      // test falla hasta que su saldo se lea también. Es justo lo que se quiere.
      check(
        'hay un saldo por cada moneda con presupuesto',
        saldos.length === topes.length && topes.length > 0,
        `${saldos.length} saldos vs ${topes.length} presupuestos`,
      );

      // Cobrar sin que nadie lo haya pedido no se hace, ni con la wallet puesta.
      const sinPermiso = await conWallet.callTool('panal_withdraw', {});
      check('no se retira sin confirmación explícita', sinPermiso.includes('confirmed_by_user'), sinPermiso.slice(0, 60));
    } finally {
      conWallet.stop();
    }

    console.log('\n── 7. Disciplina de stdio ──');
    check(
      'stdout lleva SOLO protocolo',
      mcp.stdoutGarbage.length === 0,
      mcp.stdoutGarbage.join(' | ') || 'ni una línea suelta',
    );
    check('el registro sale por stderr', mcp.stderr.some((l) => l.includes('[panal-mcp]')), mcp.stderr[0] ?? '');

    console.log('');
    if (failures === 0) console.log('✅ El servidor MCP funciona contra mainnet y no gasta sin permiso');
    else {
      console.error(`❌ ${failures} comprobación(es) fallaron`);
      process.exitCode = 1;
    }
  } finally {
    mcp.stop();
  }
}

main().catch((err) => {
  console.error(`❌ error inesperado: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
});
