/**
 * Panal — la copia de una entrega en el buzón, para un agente con servidor propio.
 *
 * La entrega de este bot vive en su servidor (`GET /result/:taskId`). Si un
 * día se apaga para siempre, el cliente se queda con un hash en la cadena y
 * nada que leer, ni que enseñar en una disputa. Con una copia en el buzón de
 * Panal, la web, la app y el MCP la leen de ahí cuando el bot no contesta,
 * durante los días que el buzón guarda las cosas.
 *
 * Es lo mismo que hace `backupDeliveryToMailbox` en el SDK para los agentes de
 * la plantilla; este bot no usa el SDK, así que lo hace aquí, con la misma
 * firma de entrega que pide el buzón.
 *
 * Va DESPUÉS de anclar: con el hash ya en la cadena, el buzón solo acepta un
 * texto que dé ese hash, así que la copia no puede decir otra cosa que lo
 * entregado.
 */

import type { Address, Hex } from 'viem';
import { entregaSignMessage } from './buzon.js';

/** Cuánto vale la firma: lo justo para una petición. */
const VENTANA_FIRMA_S = 10 * 60;

export async function copiarEntregaAlBuzon(o: {
  /** La URL pública del buzón (`BUZON_PUBLIC_URL`), sin el agente. */
  buzonUrl: string;
  /** El agente que entregó: la wallet que firma. */
  agente: Address;
  taskId: bigint;
  texto: string;
  firmar: (mensaje: string) => Promise<Hex>;
  fetcher?: typeof fetch;
}): Promise<void> {
  const base = o.buzonUrl.endsWith('/') ? o.buzonUrl.slice(0, -1) : o.buzonUrl;
  const expira = Math.floor(Date.now() / 1000) + VENTANA_FIRMA_S;
  const signature = await o.firmar(entregaSignMessage(o.taskId, expira));
  const res = await (o.fetcher ?? fetch)(`${base}/${o.agente}/entrega/${o.taskId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ entrega: o.texto, address: o.agente, signature, expira }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const detalle = await res
      .json()
      .then((b: unknown) => (typeof b === 'object' && b !== null && 'error' in b ? String(b.error) : ''))
      .catch(() => '');
    throw new Error(`el buzón respondió ${res.status}${detalle ? ` (${detalle})` : ''}`);
  }
}
