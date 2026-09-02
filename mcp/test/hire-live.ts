/**
 * Prueba VIVA: contratar desde el MCP, como lo haría un modelo.
 *
 *   MCP_PRIVATE_KEY=0x… npx tsx test/hire-live.ts
 *
 * NO forma parte de `npm test`. GASTA DINERO DE VERDAD en Monad mainnet: el
 * precio del agente más el gas de dos transacciones. Está aquí porque el arreglo
 * que verifica —que al contratar el encargo LLEGUE al agente— no se puede
 * comprobar en seco: o se ve trabajar al agente, o no se sabe.
 *
 * Lo que se demuestra: un modelo, con solo llamar a herramientas del MCP,
 * contrata un agente y recibe su trabajo. Sin que ningún humano copie un texto
 * de un sitio a otro.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = resolve(HERE, '..', 'src', 'server.ts');

/** A quién se contrata. Parse: barato y su trabajo se verifica de un vistazo. */
const AGENTE = '0x6e4D695C1ca538d26d8323dC22239d30950B8Aa7';
const ENCARGO =
  'Convierte esto en JSON con las claves agente, puerto y moneda:\n' +
  'lint escucha en 8789 y cobra en MON, parse en 8790 en MON, spec en 8791 en PANAL';

/**
 * Lo que resuelve `request`: el `result` de la respuesta, o su `error`.
 *
 * Se escribe a mano en vez de `any` porque `any` apaga la comprobación entera
 * de quien lo lee: un `res.contenido[0]` mal escrito compilaba y fallaba en
 * ejecución. El índice al final deja pasar los campos que esta prueba no mira
 * sin tener que enumerar el protocolo entero.
 */
interface RespuestaMcp {
  content?: { text?: string }[];
  protocolVersion?: string;
  serverInfo?: { name?: string; version?: string };
  capabilities?: { tools?: unknown };
  tools?: { name: string; description?: string; inputSchema?: unknown }[];
  isError?: boolean;
  message?: string;
  [campo: string]: unknown;
}

class Mcp {
  private readonly pending = new Map<number, (v: RespuestaMcp) => void>();
  private nextId = 1;
  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    createInterface({ input: child.stdout }).on('line', (line) => {
      try {
        const m = JSON.parse(line.trim()) as { id?: number; result?: RespuestaMcp; error?: RespuestaMcp };
        if (typeof m.id === 'number') this.pending.get(m.id)?.(m.result ?? m.error ?? {});
      } catch {
        /* stdout es del protocolo */
      }
    });
    createInterface({ input: child.stderr }).on('line', (l) => console.log(`  ${l}`));
  }
  static start(env: Record<string, string>): Mcp {
    return new Mcp(
      spawn('npx', ['tsx', SERVER], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] }) as ChildProcessWithoutNullStreams,
    );
  }
  request(method: string, params?: Record<string, unknown>): Promise<RespuestaMcp> {
    const id = this.nextId++;
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(`${method} no respondió en 90 s`)), 90_000);
      this.pending.set(id, (v) => {
        clearTimeout(t);
        res(v);
      });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }
  async tool(name: string, args: Record<string, unknown> = {}): Promise<string> {
    const r = await this.request('tools/call', { name, arguments: args });
    return r?.content?.[0]?.text ?? JSON.stringify(r);
  }
  stop(): void {
    this.child.stdin.end();
    this.child.kill();
  }
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  if (!process.env.MCP_PRIVATE_KEY) {
    console.error('Falta MCP_PRIVATE_KEY: esta prueba paga de verdad.');
    process.exit(1);
  }
  const mcp = Mcp.start({ MCP_ENABLE_WRITES: 'true', MCP_PRIVATE_KEY: process.env.MCP_PRIVATE_KEY });
  try {
    await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'prueba', version: '0' } });

    console.log('\n── 1. La wallet del servidor ──');
    console.log(await mcp.tool('panal_wallet'));

    console.log('\n── 2. Presupuesto ──');
    const quote = await mcp.tool('panal_quote_hire', { agent: AGENTE, brief: ENCARGO });
    console.log(quote);
    const quoteId = /quote_id[^\w]*([\w-]+)/i.exec(quote)?.[1] ?? /`([\w-]{6,})`/.exec(quote)?.[1];
    if (!quoteId) {
      console.error('\nNo pude sacar el id del presupuesto de la respuesta.');
      process.exit(1);
    }

    console.log(`\n── 3. Contratar (quote ${quoteId}) ──`);
    const hire = await mcp.tool('panal_hire', { quote_id: quoteId, confirmed_by_user: true });
    console.log(hire);
    const taskId = /#(\d+)/.exec(hire)?.[1];
    if (!taskId) process.exit(1);
    // Esta línea es TODO el arreglo: antes aquí ponía "hazle llegar el texto tú".
    console.log(hire.includes('Encargo entregado') ? '\n✅ el encargo se entregó solo' : '\n❌ el encargo NO llegó');

    console.log('\n── 4. Esperando a que el agente entregue ──');
    for (let i = 0; i < 24; i++) {
      await dormir(5000);
      const estado = await mcp.tool('panal_get_task', { task_id: Number(taskId) });
      const linea = estado.split('\n')[0] ?? '';
      process.stdout.write(`\r  ${(i + 1) * 5}s · ${linea}   `);
      if (!linea.includes('Open')) break;
    }
    console.log('');

    console.log('\n── 5. Recoger el resultado (hash verificado) ──');
    console.log(await mcp.tool('panal_get_result', { task_id: Number(taskId) }));

    console.log('\n── 6. Aprobar y pagar ──');
    console.log(await mcp.tool('panal_approve_task', { task_id: Number(taskId), rating: 5, confirmed_by_user: true }));
  } finally {
    mcp.stop();
  }
}

void main();
