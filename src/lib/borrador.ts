/**
 * Panal — el borrador de una contratación que preparó un asistente.
 *
 * Quien habla con claude.ai, la app de Claude o ChatGPT y tiene conectado el
 * MCP remoto de Panal (mcp.panal.lat) no puede pagar desde ahí: ese servidor
 * no tiene claves. Lo que hace es preparar el encargo y darle un enlace,
 * `panal.lat/contratar/<id>`. Esa página lee el borrador de aquí y abre la
 * ficha del agente con la ventana de contratar ya rellena: el texto, el tamaño
 * y el plazo. La persona lo revisa y firma con su wallet, como siempre.
 *
 * El borrador vive dos horas en la memoria del MCP remoto y solo lo puede leer
 * esta web (CORS). Ver `mcp/src/remoto.ts`.
 */

import { sinBarraFinal } from '@panal/sdk';

export const MCP_URL: string = sinBarraFinal(import.meta.env.VITE_MCP_URL ?? 'https://mcp.panal.lat');

export interface BorradorDeContratacion {
  /** La dirección del agente o de la persona. */
  agente: string;
  encargo: string;
  /** El nombre del tamaño que eligió el asistente, si el agente vende varios. */
  nivel: string | null;
  /** Su precio en unidades mínimas: el nombre se traduce y el precio no. */
  nivelWei: string | null;
  horas: number;
  /** ISO: hasta cuándo vale el enlace. */
  caduca: string;
}

/**
 * El borrador de ese id; null si no existe o ya caducó, y 'error' si el MCP
 * no contesta (y entonces no se sabe).
 */
export async function leerBorrador(id: string): Promise<BorradorDeContratacion | null | 'error'> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(id)) return null;
  try {
    const res = await fetch(`${MCP_URL}/borrador/${id}`, { signal: AbortSignal.timeout(10_000), cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) return 'error';
    const d = (await res.json()) as Partial<BorradorDeContratacion>;
    if (
      typeof d.agente !== 'string' ||
      !/^0x[0-9a-fA-F]{40}$/.test(d.agente) ||
      typeof d.encargo !== 'string' ||
      typeof d.horas !== 'number'
    ) {
      return 'error';
    }
    return {
      agente: d.agente,
      encargo: d.encargo,
      nivel: typeof d.nivel === 'string' ? d.nivel : null,
      nivelWei: typeof d.nivelWei === 'string' && /^\d+$/.test(d.nivelWei) ? d.nivelWei : null,
      horas: d.horas,
      caduca: typeof d.caduca === 'string' ? d.caduca : '',
    };
  } catch {
    return 'error';
  }
}
