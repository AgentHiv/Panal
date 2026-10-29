/**
 * Panal — a quién pagó el agente para hacer tu encargo.
 *
 * Si un agente subcontrata, su motor lo dice dentro de la entrega, en un bloque
 * que se ancla en la cadena con el resto del texto:
 *
 *     [panal-subcontracts/1]
 *     agent: 0x8e9c…
 *     skill: tests
 *     amount: 150000000000000000
 *     currency: $PANAL
 *     asset: 0x2E2e…7777
 *     decimals: 18
 *     tx: 0x51ab…
 *     via: 0x…            (solo si lo contrató uno de sus subcontratados)
 *     files: 2            (si se le mandaron archivos con la pregunta)
 *
 * ─────────────────────────────────────────────────────────────────────────
 * El formato lo define `sdk/src/subcontratos.ts`, que es la fuente de la
 * verdad. Aquí solo se lee, por lo mismo que `deliveredFiles.ts`: el SDK trae
 * cliente y red que no pintan nada en el navegador. Si cambias el formato,
 * cámbialo en los dos sitios.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { getAddress, isAddress } from 'viem';
import type { Address, Hex } from 'viem';

export const SUBCONTRACTS_BLOCK = '[panal-subcontracts/1]';

/** Tope de lo que se enseña: el mismo que escribe el motor. */
const MAX_SUBCONTRACTS = 32;

export interface Subcontrato {
  agente: Address;
  skill: string;
  importe: bigint;
  moneda: { simbolo: string; direccion: Address; decimales: number };
  tx?: Hex;
  /** Si lo contrató uno de los subcontratados, cuál. */
  via?: Address;
  /** Cuántos archivos se le mandaron con la pregunta. */
  archivos?: number;
}

/**
 * Una subcontratación, venga del bloque de una entrega o del JSON de una
 * respuesta. Lo que no cuadra, `null`: se descarta y lo demás se enseña.
 */
function validar(c: Record<string, string | undefined>): Subcontrato | null {
  const { agent, skill, amount, currency, asset, decimals, tx, via, files } = c;
  if (!agent || !isAddress(agent) || !asset || !isAddress(asset)) return null;
  if (!skill || !currency || !amount || !/^\d{1,78}$/.test(amount)) return null;
  const dec = Number(decimals);
  if (!Number.isInteger(dec) || dec < 0 || dec > 36) return null;
  if (tx && !/^0x[0-9a-fA-F]{64}$/.test(tx)) return null;
  if (via && !isAddress(via)) return null;

  return {
    agente: getAddress(agent),
    skill: skill.slice(0, 64),
    importe: BigInt(amount),
    moneda: { simbolo: currency.slice(0, 16), direccion: getAddress(asset), decimales: dec },
    ...(tx ? { tx: tx.toLowerCase() as Hex } : {}),
    ...(via ? { via: getAddress(via) } : {}),
    ...(files && /^\d{1,4}$/.test(files) && Number(files) > 0 ? { archivos: Number(files) } : {}),
  };
}

/**
 * Lee las subcontrataciones de una entrega. Nunca lanza: lo que no se entiende
 * se descarta y lo demás se enseña, que el texto de la entrega es lo primero.
 */
export function leerSubcontratos(texto: string): Subcontrato[] {
  const out: Subcontrato[] = [];
  const lineas = texto.split(/\r?\n/);

  for (let i = 0; i < lineas.length && out.length < MAX_SUBCONTRACTS; i++) {
    if (lineas[i]!.trim() !== SUBCONTRACTS_BLOCK) continue;

    const c: Record<string, string> = {};
    for (let j = i + 1; j < lineas.length; j++) {
      const linea = lineas[j]!;
      if (!linea.trim()) break;
      const sep = linea.indexOf(':');
      if (sep === -1) break;
      c[linea.slice(0, sep).trim().toLowerCase()] = linea.slice(sep + 1).trim();
    }

    const s = validar(c);
    if (s) out.push(s);
  }
  return out;
}

/**
 * Las de la respuesta a un mensaje del chat (x402): el agente las manda en JSON
 * (`subcontracts`, la forma `SubcontractJson` del SDK) y el historial las guarda
 * tal cual. Viene del agente y luego del almacenamiento del navegador, así que
 * se valida igual que el bloque. Un mensaje no se ancla en la cadena: lo que
 * diga es la palabra del agente, y así lo cuenta la pantalla.
 */
export function subcontratosDeJson(valor: unknown): Subcontrato[] {
  if (!Array.isArray(valor)) return [];
  const out: Subcontrato[] = [];
  for (const v of valor.slice(0, MAX_SUBCONTRACTS)) {
    if (!v || typeof v !== 'object') continue;
    const c: Record<string, string | undefined> = {};
    for (const k of ['agent', 'skill', 'amount', 'currency', 'asset', 'decimals', 'tx', 'via', 'files']) {
      const x = (v as Record<string, unknown>)[k];
      if (typeof x === 'string' || typeof x === 'number') c[k] = String(x).trim();
    }
    const s = validar(c);
    if (s) out.push(s);
  }
  return out;
}
