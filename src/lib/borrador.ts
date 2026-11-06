/**
 * Panal — el borrador de una contratación que preparó un asistente.
 *
 * Quien habla con claude.ai, la app de Claude o ChatGPT y tiene conectado el
 * MCP remoto de Panal (mcp.panal.lat) no puede pagar desde ahí: ese servidor
 * no tiene claves. Lo que hace es preparar el encargo y darle un enlace,
 * `panal.lat/contratar/<id>#<clave>`. Esa página lee el borrador de aquí y
 * abre la ficha del agente con la ventana de contratar ya rellena: el texto,
 * el tamaño y el plazo. La persona lo revisa y firma con su wallet.
 *
 * El borrador llega CERRADO (AES-128-GCM) y se abre aquí, en el navegador, con
 * la clave que va detrás de la `#`. Esa parte del enlace no sale nunca del
 * navegador: el servidor guarda la caja y no la llave. Ver
 * `mcp/src/borrador-cifrado.ts`, que es quien la cierra.
 */

import { sinBarraFinal } from '@panal/sdk';

export const MCP_URL: string = sinBarraFinal(
  // Con `?.` porque las pruebas cargan esto con Node, donde no hay import.meta.env.
  (import.meta.env as Record<string, string | undefined> | undefined)?.VITE_MCP_URL ?? 'https://mcp.panal.lat',
);

export interface BorradorDeContratacion {
  /** La dirección del agente o de la persona. */
  agente: string;
  encargo: string;
  /** El nombre del tamaño que eligió el asistente, si el agente vende varios. */
  nivel: string | null;
  /** Su precio en unidades mínimas: el nombre se traduce y el precio no. */
  nivelWei: string | null;
  horas: number;
}

function deBase64url(s: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  try {
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** Lo que tiene que haber dentro para que valga; null si falta algo. */
function comoBorrador(d: unknown): BorradorDeContratacion | null {
  const b = d as Partial<BorradorDeContratacion> | null;
  if (
    !b ||
    typeof b.agente !== 'string' ||
    !/^0x[0-9a-fA-F]{40}$/.test(b.agente) ||
    typeof b.encargo !== 'string' ||
    typeof b.horas !== 'number'
  ) {
    return null;
  }
  return {
    agente: b.agente,
    encargo: b.encargo,
    nivel: typeof b.nivel === 'string' ? b.nivel : null,
    nivelWei: typeof b.nivelWei === 'string' && /^\d+$/.test(b.nivelWei) ? b.nivelWei : null,
    horas: b.horas,
  };
}

/**
 * Abre una caja con su clave y su id. null si la clave no es la suya, la caja
 * está tocada o es de otro borrador: AES-GCM no abre nada de eso.
 */
export async function abrirBorrador(cifrado: string, clave: string, id: string): Promise<BorradorDeContratacion | null> {
  const datos = deBase64url(cifrado);
  const k = deBase64url(clave);
  if (!datos || !k || k.length !== 16 || datos.length < 12 + 16) return null;
  try {
    const llave = await crypto.subtle.importKey('raw', k, 'AES-GCM', false, ['decrypt']);
    const plano = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: datos.slice(0, 12), additionalData: new TextEncoder().encode(id) },
      llave,
      datos.slice(12),
    );
    return comoBorrador(JSON.parse(new TextDecoder().decode(plano)));
  } catch {
    return null;
  }
}

/**
 * El borrador de ese id, abierto con la clave del enlace.
 *
 *   - null          no existe o ya caducó;
 *   - 'incompleto'  existe, pero falta la clave o no es la suya: el enlace se
 *                   copió a medias, sin lo que va detrás de la `#`;
 *   - 'error'       el MCP no contesta, y entonces no se sabe.
 *
 * Un borrador sin cerrar —el de un MCP anterior a esto, mientras se despliega—
 * se acepta tal cual.
 */
export async function leerBorrador(
  id: string,
  clave: string,
): Promise<BorradorDeContratacion | null | 'incompleto' | 'error'> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(id)) return null;
  let d: Record<string, unknown>;
  try {
    const res = await fetch(`${MCP_URL}/borrador/${id}`, { signal: AbortSignal.timeout(10_000), cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) return 'error';
    d = (await res.json()) as Record<string, unknown>;
  } catch {
    return 'error';
  }
  if (typeof d.cifrado === 'string') {
    if (!clave) return 'incompleto';
    return (await abrirBorrador(d.cifrado, clave, id)) ?? 'incompleto';
  }
  return comoBorrador(d) ?? 'error';
}
