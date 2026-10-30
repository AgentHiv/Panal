/**
 * ¿Está bien montado tu agente?
 *
 *   npm run doctor
 *
 * Solo mira, no firma ni gasta nada. Repásalo al desplegar y cuando algo no vaya:
 * cada fallo dice qué falta, en vez de tener que adivinarlo cuando un cliente ya
 * ha pagado. Sale con 1 si algo está mal, así que también sirve en un script.
 */

import { pathToFileURL } from 'node:url';
import { createPanalClient } from '@panal/sdk';
import { formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { plazoX402Ms } from './operacion.js';

export type Estado = 'ok' | 'aviso' | 'fallo';
export interface Fila {
  estado: Estado;
  que: string;
  detalle?: string;
}

/** Por debajo de esto una entrega puede no poder pagar su gas: Monad reserva el límite entero. */
const MON_MINIMO = 0.1;
const ORIGEN_DEL_PANEL = 'https://panal.lat';

/** Lo que se puede decir solo con el `.env`, sin red. */
export function revisarEntorno(env: NodeJS.ProcessEnv): Fila[] {
  const filas: Fila[] = [];
  const clave = env.AGENT_PRIVATE_KEY?.trim();
  filas.push(
    clave && /^0x[0-9a-fA-F]{64}$/.test(clave)
      ? { estado: 'ok', que: 'Clave de la wallet' }
      : { estado: 'fallo', que: 'Clave de la wallet', detalle: 'AGENT_PRIVATE_KEY falta o no es 0x + 64 hex' },
  );
  if (!env.LLM_API_KEY?.trim() && env.LLM_PROVIDER?.trim() !== 'ollama') {
    filas.push({
      estado: 'aviso',
      que: 'Clave del modelo',
      detalle: 'LLM_API_KEY está vacía: si tu agente usa un modelo, fallará al trabajar',
    });
  }
  const local = env.HOST?.trim() === '127.0.0.1' || env.HOST?.trim() === 'localhost';
  if (local && env.TRAS_PROXY !== '1') {
    filas.push({
      estado: 'aviso',
      que: 'Proxy',
      detalle: 'HOST es local pero TRAS_PROXY no es 1: el límite por IP contaría a todos tus clientes como uno',
    });
  }
  if (env.X402_PRICE?.trim()) {
    filas.push({ estado: 'ok', que: 'Plazo de las preguntas de pago', detalle: `${plazoX402Ms(env) / 1000} s (detrás de Cloudflare, 85)` });
  }
  return filas;
}

/** Que tu agente esté en marcha en esta máquina. */
export async function revisarLocal(puerto: number): Promise<Fila> {
  try {
    const res = await fetch(`http://127.0.0.1:${puerto}/health`, { signal: AbortSignal.timeout(5_000) });
    if (res.ok) return { estado: 'ok', que: 'Agente en marcha', detalle: `puerto ${puerto}` };
    return { estado: 'fallo', que: 'Agente en marcha', detalle: `/health respondió ${res.status}` };
  } catch {
    return { estado: 'aviso', que: 'Agente en marcha', detalle: `nada responde en el puerto ${puerto}; ¿lo tienes arrancado aquí?` };
  }
}

/** Lo que ve el mundo: https, que la dirección sea tuya, y que un navegador pueda cotizar y pagar. */
export async function revisarEndpoint(base: string, yo: string, cobraPorPregunta: boolean): Promise<Fila[]> {
  const filas: Fila[] = [];
  const url = base.replace(/\/+$/, '');
  if (!url.startsWith('https://')) {
    filas.push({ estado: 'fallo', que: 'Endpoint https', detalle: `${url} no es https: el encargo viajaría en claro` });
  }
  try {
    const res = await fetch(`${url}/agent.json`, { signal: AbortSignal.timeout(10_000) });
    const card = (await res.json()) as { agent?: string };
    if (!res.ok) filas.push({ estado: 'fallo', que: 'Endpoint público', detalle: `${url}/agent.json respondió ${res.status}` });
    else if (card.agent?.toLowerCase() !== yo.toLowerCase()) {
      filas.push({ estado: 'fallo', que: 'Endpoint público', detalle: `${url} anuncia ${card.agent ?? 'ninguna dirección'}, y tu wallet es ${yo}` });
    } else filas.push({ estado: 'ok', que: 'Endpoint público', detalle: url });
  } catch (err) {
    filas.push({ estado: 'fallo', que: 'Endpoint público', detalle: `${url} no responde: ${err instanceof Error ? err.message : err}` });
    return filas;
  }
  // El MCP y curl no pasan por CORS: este fallo solo lo ve un navegador, y sin
  // decir nada en el servidor. Hay que preguntarlo como lo hace uno.
  try {
    const res = await fetch(`${url}/x402/ask`, {
      method: 'OPTIONS',
      headers: {
        origin: ORIGEN_DEL_PANEL,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,x-payment,x-payment-payer',
      },
      signal: AbortSignal.timeout(10_000),
    });
    const permitidas = (res.headers.get('access-control-allow-headers') ?? '').toLowerCase();
    const origen = res.headers.get('access-control-allow-origin');
    const bien = (origen === ORIGEN_DEL_PANEL || origen === '*') && permitidas.includes('x-payment-payer') && permitidas.includes('x-payment');
    filas.push(
      bien
        ? { estado: 'ok', que: 'CORS para la web' }
        : { estado: 'fallo', que: 'CORS para la web', detalle: 'panal.lat no podría cotizar ni pagar desde un navegador; ¿qué hay entre tu agente y el mundo?' },
    );
  } catch (err) {
    filas.push({ estado: 'aviso', que: 'CORS para la web', detalle: `no pude comprobarlo: ${err instanceof Error ? err.message : err}` });
  }
  if (cobraPorPregunta) {
    try {
      const res = await fetch(`${url}/x402/ask`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'doctor' }),
        signal: AbortSignal.timeout(20_000),
      });
      filas.push(
        res.status === 402
          ? { estado: 'ok', que: 'Cotización x402' }
          : { estado: 'fallo', que: 'Cotización x402', detalle: `debería responder 402 y respondió ${res.status}` },
      );
    } catch (err) {
      filas.push({ estado: 'fallo', que: 'Cotización x402', detalle: `${err instanceof Error ? err.message : err}` });
    }
  }
  return filas;
}

/** Lo que dice la cadena: si se llega, si hay gas y si estás dado de alta. */
export async function revisarCadena(clave: `0x${string}`, env: NodeJS.ProcessEnv): Promise<{ filas: Fila[]; botUrl: string | null }> {
  const filas: Fila[] = [];
  const account = privateKeyToAccount(clave);
  const panal = createPanalClient({ account, rpcUrl: env.RPC_URL });
  try {
    const saldo = await panal.publicClient.getBalance({ address: account.address });
    const mon = Number(formatEther(saldo));
    filas.push(
      mon >= MON_MINIMO
        ? { estado: 'ok', que: 'Gas', detalle: `${mon.toFixed(4)} MON` }
        : mon > 0
          ? { estado: 'aviso', que: 'Gas', detalle: `${mon.toFixed(4)} MON: puede no alcanzar para entregar, manda más a ${account.address}` }
          : { estado: 'fallo', que: 'Gas', detalle: `0 MON: no podrías entregar nada. Manda MON a ${account.address}` },
    );
  } catch (err) {
    filas.push({ estado: 'fallo', que: 'RPC', detalle: `no llego a la cadena: ${err instanceof Error ? err.message : err}` });
    return { filas, botUrl: null };
  }
  const agente = await panal.getAgent(account.address).catch(() => null);
  if (!agente || agente.registeredAt === 0n) {
    filas.push({ estado: 'aviso', que: 'Registro', detalle: 'aún no estás dado de alta: cuando el endpoint responda, npm run register' });
    return { filas, botUrl: null };
  }
  filas.push(
    agente.active
      ? { estado: 'ok', que: 'Registro', detalle: `«${agente.metadataURI.split('·')[0]?.trim() ?? ''}», activo` }
      : { estado: 'aviso', que: 'Registro', detalle: 'estás dado de alta pero inactivo: nadie te puede contratar' },
  );
  const bot = /\bbot:(\S+)/.exec(agente.metadataURI)?.[1] ?? null;
  return { filas, botUrl: bot };
}

const MARCA: Record<Estado, string> = { ok: '✓', aviso: '!', fallo: '✗' };

/** Las filas para leerlas, y si hay alguna que impida trabajar. */
export function informe(filas: Fila[]): { texto: string; mal: boolean } {
  const texto = filas.map((f) => `  ${MARCA[f.estado]} ${f.que}${f.detalle ? `: ${f.detalle}` : ''}`).join('\n');
  return { texto, mal: filas.some((f) => f.estado === 'fallo') };
}

async function main(): Promise<void> {
  // Aquí y no arriba: importar las funciones no debe leer ningún .env.
  await import('dotenv/config');
  const env = process.env;
  const filas = revisarEntorno(env);
  const clave = env.AGENT_PRIVATE_KEY?.trim();
  filas.push(await revisarLocal(Number(env.PORT ?? 8787)));
  if (clave && /^0x[0-9a-fA-F]{64}$/.test(clave)) {
    const yo = privateKeyToAccount(clave as `0x${string}`).address;
    const { filas: deLaCadena, botUrl } = await revisarCadena(clave as `0x${string}`, env);
    filas.push(...deLaCadena);
    const base = env.PUBLIC_URL?.trim() || botUrl;
    if (base) filas.push(...(await revisarEndpoint(base, yo, !!env.X402_PRICE?.trim())));
    else filas.push({ estado: 'aviso', que: 'Endpoint público', detalle: 'no hay PUBLIC_URL en el .env ni botUrl en la cadena: nadie puede encargarte nada' });
  }
  const { texto, mal } = informe(filas);
  console.log(`\nEl estado de tu agente:\n\n${texto}\n`);
  console.log(mal ? 'Hay algo que arreglar antes de cobrar.\n' : 'Nada impide trabajar.\n');
  process.exitCode = mal ? 1 : 0;
}

// Solo al ejecutarlo: las pruebas importan las funciones sin lanzar el informe.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
