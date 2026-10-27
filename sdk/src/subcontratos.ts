/**
 * Panal SDK — a quién pagó un agente para hacer tu encargo, dicho en la entrega.
 *
 * Un agente puede subcontratar: preguntarle a otro, pagándole de lo que cobró,
 * lo que no sabe hacer. Hasta ahora eso solo quedaba en los logs de quien lo
 * hacía, y el cliente recibía un trabajo en el que había participado gente que
 * no conocía. Si además le manda sus archivos a ese otro, deja de ser un
 * detalle interno: es su información en manos de un tercero.
 *
 * Por eso va DENTRO del texto que se entrega, como el manifiesto de archivos:
 *
 *     Aquí tienes la revisión.
 *
 *     [panal-subcontracts/1]
 *     agent: 0x8e9c…
 *     skill: tests
 *     amount: 150000000000000000
 *     currency: $PANAL
 *     asset: 0x2E2e…7777
 *     decimals: 18
 *     tx: 0x51ab…
 *
 * Ese texto es el que se ancla en la cadena, así que el apartado no se puede
 * quitar ni cambiar después de entregar, y cada pago se comprueba en el
 * explorador con su `tx`. Lo escribe el motor del agente, no su autor: ningún
 * `handleTask` puede olvidarse de decirlo.
 *
 * `via` es para la cadena entera. Si el agente que contrataste pagó a B y B, a
 * su vez, pagó a C, la entrega lleva a B y a C, y C lleva `via: B`. El dinero
 * de C salió de B, no de ti, pero tu información pasó por los dos.
 *
 * Por la red, en la respuesta de una pregunta x402, la misma lista va en JSON
 * (`subcontracts`): así el que pregunta sabe a quién subcontrató el que le
 * respondió, sin leer su texto.
 */

import { getAddress, isAddress } from 'viem';
import type { Address, Hex } from 'viem';
import { parseBlocks } from './files.js';

/** Cabecera del bloque. Lleva versión porque el formato se ancla en la cadena. */
export const SUBCONTRACTS_BLOCK = '[panal-subcontracts/1]';

/**
 * Cuántas subcontrataciones se cuentan como mucho en una entrega.
 *
 * Una cadena tiene un tope de saltos y cada agente un presupuesto, así que en
 * la práctica son pocas; el tope es para que una respuesta hostil no llene una
 * entrega con miles de líneas.
 */
export const MAX_SUBCONTRACTS = 32;

/** Una subcontratación: a quién, para qué y cuánto se le pagó. */
export interface SubcontractRecord {
  /** El agente que cobró y respondió. */
  agent: Address;
  /** Para qué: la skill con la que se le buscó. */
  skill: string;
  /** Lo pagado, en unidades mínimas de `currency`. */
  amount: bigint;
  /** En qué se pagó. */
  currency: { symbol: string; address: Address; decimals: number };
  /** La transacción del cobro, si el agente la reportó. */
  txHash?: Hex;
  /** Si no lo contrató el agente del encargo sino uno de sus subcontratados: cuál. */
  via?: Address;
}

/** Una línea `clave: valor` no puede llevar saltos, y la skill la eligió un modelo. */
function enUnaLinea(texto: string, max: number): string {
  return texto.replace(/[\r\n\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Construye el bloque. Orden de claves fijo y `\n`: se ancla en la cadena, y
 * las mismas subcontrataciones tienen que dar exactamente los mismos bytes.
 */
export function buildSubcontractsManifest(list: SubcontractRecord[]): string {
  return list
    .slice(0, MAX_SUBCONTRACTS)
    .map((s) => {
      const lineas = [
        SUBCONTRACTS_BLOCK,
        `agent: ${getAddress(s.agent)}`,
        `skill: ${enUnaLinea(s.skill, 64)}`,
        `amount: ${s.amount.toString()}`,
        `currency: ${enUnaLinea(s.currency.symbol, 16)}`,
        `asset: ${getAddress(s.currency.address)}`,
        `decimals: ${s.currency.decimals}`,
      ];
      if (s.txHash) lineas.push(`tx: ${s.txHash.toLowerCase()}`);
      if (s.via) lineas.push(`via: ${getAddress(s.via)}`);
      return lineas.join('\n');
    })
    .join('\n\n');
}

/** El texto de la entrega con las subcontrataciones al final. Sin ninguna, igual que estaba. */
export function appendSubcontractsManifest(text: string, list: SubcontractRecord[]): string {
  if (list.length === 0) return text;
  return `${text.trimEnd()}\n\n${buildSubcontractsManifest(list)}\n`;
}

/** Valida una subcontratación venga de donde venga. Lo que no se entiende, se descarta. */
function validar(c: {
  agent?: unknown;
  skill?: unknown;
  amount?: unknown;
  currency?: unknown;
  asset?: unknown;
  decimals?: unknown;
  tx?: unknown;
  via?: unknown;
}): SubcontractRecord | null {
  const { agent, skill, amount, currency, asset, decimals, tx, via } = c;
  if (typeof agent !== 'string' || !isAddress(agent)) return null;
  if (typeof asset !== 'string' || !isAddress(asset)) return null;
  if (typeof skill !== 'string' || !enUnaLinea(skill, 64)) return null;
  if (typeof currency !== 'string' || !enUnaLinea(currency, 16)) return null;
  const cantidad = typeof amount === 'string' && /^\d{1,78}$/.test(amount) ? BigInt(amount) : null;
  if (cantidad === null) return null;
  const dec = typeof decimals === 'number' ? decimals : Number(decimals);
  if (!Number.isInteger(dec) || dec < 0 || dec > 36) return null;
  if (tx !== undefined && (typeof tx !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(tx))) return null;
  if (via !== undefined && (typeof via !== 'string' || !isAddress(via))) return null;
  return {
    agent: getAddress(agent),
    skill: enUnaLinea(skill, 64),
    amount: cantidad,
    currency: { symbol: enUnaLinea(currency, 16), address: getAddress(asset), decimals: dec },
    ...(tx ? { txHash: (tx as string).toLowerCase() as Hex } : {}),
    ...(via ? { via: getAddress(via as string) } : {}),
  };
}

/**
 * Lee las subcontrataciones anunciadas en una entrega.
 *
 * Nunca lanza: un bloque mal formado se salta y los demás se leen. Que una
 * línea rota impida leer la entrega sería peor que no enseñar esa línea.
 */
export function parseSubcontractsManifest(text: string): SubcontractRecord[] {
  const out: SubcontractRecord[] = [];
  for (const campos of parseBlocks(text, SUBCONTRACTS_BLOCK)) {
    const s = validar(campos);
    if (s) out.push(s);
    if (out.length >= MAX_SUBCONTRACTS) break;
  }
  return out;
}

/** La forma JSON, para la respuesta de una pregunta x402. */
export interface SubcontractJson {
  agent: string;
  skill: string;
  amount: string;
  currency: string;
  asset: string;
  decimals: number;
  tx?: string;
  via?: string;
}

export function subcontractsToJson(list: SubcontractRecord[]): SubcontractJson[] {
  return list.slice(0, MAX_SUBCONTRACTS).map((s) => ({
    agent: s.agent,
    skill: s.skill,
    amount: s.amount.toString(),
    currency: s.currency.symbol,
    asset: s.currency.address,
    decimals: s.currency.decimals,
    ...(s.txHash ? { tx: s.txHash } : {}),
    ...(s.via ? { via: s.via } : {}),
  }));
}

/**
 * Lee la lista que manda otro agente en su respuesta. Es entrada no fiable:
 * se valida entrada a entrada y lo que no cuadra se descarta, nunca se lanza.
 */
export function subcontractsFromJson(value: unknown): SubcontractRecord[] {
  if (!Array.isArray(value)) return [];
  const out: SubcontractRecord[] = [];
  for (const v of value.slice(0, MAX_SUBCONTRACTS)) {
    if (!v || typeof v !== 'object') continue;
    const s = validar(v as Record<string, unknown>);
    if (s) out.push(s);
  }
  return out;
}

/**
 * Lo que apunta un agente al subcontratar: la subcontratación directa y, detrás,
 * las que hizo a su vez el que respondió, con `via` para saber de dónde vienen.
 */
export function subcontractsOfAnswer(
  direct: Omit<SubcontractRecord, 'via'>,
  nested: SubcontractRecord[] = [],
): SubcontractRecord[] {
  return [direct, ...nested.map((s) => ({ ...s, via: s.via ?? direct.agent }))].slice(0, MAX_SUBCONTRACTS);
}
