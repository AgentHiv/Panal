/**
 * Panal SDK — el sobre que viaja con una llamada entre agentes.
 *
 * Cuando un agente puede llamar a otro, y ese a otro, aparecen tres problemas
 * que no existen en una llamada suelta:
 *
 *   1. CICLOS. A llama a B, B a C y C a A. Bucle infinito, y aquí cada vuelta
 *      cuesta dinero de verdad.
 *   2. PROFUNDIDAD. Sin tope, una cadena se alarga sola y el que empezó paga
 *      saltos que nunca autorizó.
 *   3. PRESUPUESTO. Si A tiene 0.01 para gastar y B subcontrata por 0.05, ¿quién
 *      lo paga? Sin un límite que viaje con la llamada, nadie sabe cuánto queda.
 *
 * El sobre resuelve los tres con cuatro cabeceras que se propagan hop a hop,
 * como un trace distribuido pero con dinero dentro:
 *
 *   X-Panal-Trace:  id de la cadena entera, para poder seguirla en los logs
 *   X-Panal-Depth:  saltos que QUEDAN. Cada agente lo decrementa al delegar
 *   X-Panal-Budget: wei disponibles para sub-llamadas, menos lo ya gastado
 *   X-Panal-Path:   por dónde ha pasado ya, para detectar el ciclo
 *
 * Es deliberadamente sin estado: todo va en la petición. Un agente que se
 * reinicia no pierde la protección, y no hace falta coordinar nada entre ellos.
 *
 * Sobre la confianza: un intermediario malicioso podría borrarse del `path` para
 * provocar un bucle. Puede, pero el bucle lo paga él —cada salto lo abona quien
 * llama—, así que el incentivo va en contra. El sobre protege de cadenas
 * accidentales y de agentes mal escritos, que es de lo que hay que protegerse.
 */

import { getAddress, isAddress } from 'viem';
import type { Address } from 'viem';

export const ENVELOPE_HEADERS = {
  trace: 'x-panal-trace',
  depth: 'x-panal-depth',
  budget: 'x-panal-budget',
  path: 'x-panal-path',
} as const;

/** Saltos por defecto si quien empieza la cadena no dice otra cosa. */
export const DEFAULT_DEPTH = 3;
/** Tope duro: ni aunque lo pidan. Acota el coste máximo de una cadena. */
export const MAX_DEPTH = 8;
/** Tope de direcciones en el path, por si llega una cabecera enorme. */
const MAX_PATH = 16;

export interface CallEnvelope {
  /** Identifica la cadena entera. Solo sirve para seguirla en los logs. */
  trace: string;
  /** Saltos que quedan. 0 = este agente resuelve solo, sin delegar. */
  depth: number;
  /** Unidades mínimas disponibles para sub-llamadas. */
  budget: bigint;
  /** Agentes que ya han atendido esta cadena, en orden. */
  path: Address[];
}

export class LoopDetected extends Error {
  constructor(readonly me: Address, readonly trace: string) {
    super(`Ciclo detectado: ${me} ya atendió la cadena ${trace}. Se rechaza para no pagarla dos veces.`);
    this.name = 'LoopDetected';
  }
}

export class DepthExhausted extends Error {
  constructor(readonly trace: string) {
    super(`Sin saltos disponibles en la cadena ${trace}: hay que resolver sin delegar.`);
    this.name = 'DepthExhausted';
  }
}

export class BudgetExhausted extends Error {
  constructor(readonly available: bigint, readonly needed: bigint) {
    super(`El presupuesto que queda (${available}) no cubre ${needed}.`);
    this.name = 'BudgetExhausted';
  }
}

/** Abre una cadena nueva. Lo llama quien la empieza, no un intermediario. */
export function newEnvelope(params: { budget: bigint; depth?: number; trace?: string }): CallEnvelope {
  return {
    trace: params.trace ?? randomTrace(),
    depth: clampDepth(params.depth ?? DEFAULT_DEPTH),
    budget: params.budget < 0n ? 0n : params.budget,
    path: [],
  };
}

/** Las cabeceras a poner en la petición saliente. */
export function envelopeHeaders(env: CallEnvelope): Record<string, string> {
  return {
    [ENVELOPE_HEADERS.trace]: env.trace,
    [ENVELOPE_HEADERS.depth]: String(env.depth),
    [ENVELOPE_HEADERS.budget]: env.budget.toString(),
    [ENVELOPE_HEADERS.path]: env.path.join(','),
  };
}

/**
 * Lee el sobre de una petición entrante. Devuelve null si no viene ninguno —una
 * llamada suelta de un humano, por ejemplo—, que es un caso legítimo.
 *
 * Nunca lanza: las cabeceras las escribe quien llama, o sea un desconocido, así
 * que todo se sanea en vez de confiar. Un `depth` de un millón se recorta al
 * tope y un path descomunal se trunca.
 */
export function parseEnvelope(
  headers: Record<string, string | string[] | undefined> | Headers,
): CallEnvelope | null {
  const get = (name: string): string | undefined => {
    if (typeof (headers as Headers).get === 'function') return (headers as Headers).get(name) ?? undefined;
    const raw = (headers as Record<string, string | string[] | undefined>)[name];
    return Array.isArray(raw) ? raw[0] : raw;
  };

  const trace = get(ENVELOPE_HEADERS.trace)?.trim();
  if (!trace) return null;

  let depth = Number.parseInt(get(ENVELOPE_HEADERS.depth) ?? '', 10);
  if (!Number.isFinite(depth)) depth = 0;

  let budget = 0n;
  try {
    const raw = get(ENVELOPE_HEADERS.budget)?.trim();
    if (raw) budget = BigInt(raw);
  } catch {
    budget = 0n; // ilegible = sin presupuesto, que es el lado seguro
  }

  const path = (get(ENVELOPE_HEADERS.path) ?? '')
    .split(',')
    .map((s) => s.trim())
    // `strict: false`: sin esto viem exige checksum y una direccion en
    // minusculas —perfectamente valida, y lo que manda cualquier otra
    // implementacion— se descartaria en silencio. El ciclo dejaria de
    // detectarse justo con los agentes que no son nuestros.
    .filter((s) => isAddress(s, { strict: false }))
    .slice(0, MAX_PATH)
    .map((s) => getAddress(s));

  return {
    trace: trace.slice(0, 128),
    depth: clampDepth(depth),
    budget: budget < 0n ? 0n : budget,
    path,
  };
}

/**
 * Comprueba, del lado del SERVIDOR, que se puede atender esta llamada.
 *
 * Se llama nada más recibir la petición y antes de trabajar: si es un ciclo,
 * responder costaría dinero a alguien para nada. El código HTTP correcto para
 * rechazarla es 508 Loop Detected.
 */
export function assertCanServe(env: CallEnvelope | null, me: Address): void {
  if (!env) return; // sin sobre no hay cadena que vigilar
  const yo = getAddress(me);
  if (env.path.some((a) => getAddress(a) === yo)) throw new LoopDetected(yo, env.trace);
}

/**
 * Prepara el sobre para el SIGUIENTE salto, del lado del CLIENTE.
 *
 * Lo llama un agente justo antes de delegar: se añade al path, gasta un salto y
 * descuenta lo que va a pagar. Lanza si no queda profundidad o presupuesto, así
 * que el límite se aplica antes de firmar nada.
 */
export function descend(env: CallEnvelope, me: Address, willSpend: bigint): CallEnvelope {
  if (env.depth <= 0) throw new DepthExhausted(env.trace);
  if (willSpend > env.budget) throw new BudgetExhausted(env.budget, willSpend);
  const yo = getAddress(me);
  if (env.path.some((a) => getAddress(a) === yo)) throw new LoopDetected(yo, env.trace);

  return {
    trace: env.trace,
    depth: env.depth - 1,
    budget: env.budget - willSpend,
    path: [...env.path, yo].slice(-MAX_PATH),
  };
}

/** Cuánto puede gastar este agente en sub-llamadas, según el sobre. */
export function remainingBudget(env: CallEnvelope | null, fallback: bigint): bigint {
  if (!env) return fallback;
  return env.budget < fallback ? env.budget : fallback;
}

function clampDepth(depth: number): number {
  if (!Number.isFinite(depth) || depth < 0) return 0;
  return Math.min(Math.floor(depth), MAX_DEPTH);
}

function randomTrace(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (typeof g.crypto?.randomUUID === 'function') return g.crypto.randomUUID();
  return `panal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
