/**
 * Lo anclado que una parte puede aportar al expediente de una disputa: el
 * encargo o la entrega, con su texto EXACTO —el que se ancló en el escrow— y
 * solo si su keccak256 es el de la cadena. Quien lo lee lo vuelve a comprobar.
 *
 * De dónde sale, por orden:
 *   - el cliente: la copia que guardó este dispositivo al contratar (el
 *     encargo) o al recibir (la entrega). La entrega también se puede pedir al
 *     agente, firmando como cliente: la sirve igual un agente del buzón que
 *     uno con servidor propio;
 *   - quien trabaja desde el buzón (una persona): el buzón le enseña su
 *     encargo y su entrega, firmando.
 * El encargo no se le puede pedir a nadie si el cliente no lo guardó: el
 * buzón se lo enseña al trabajador, no a él.
 *
 * Solo para tareas directas. Las del tablón con reglas tienen su propio buzón
 * y su propio camino de acceso para los jueces.
 */

import { keccak256, toBytes, type Address, type Hex } from 'viem';
import {
  buildResultUrl,
  cabecerasFirma,
  credencialDeEncargo,
  esBuzon,
  expiraEn,
  leerEncargoDelBuzon,
  resultSignMessage,
} from '@/lib/botEndpoint';
import type { Firmar } from '@/lib/cifrado';
import { leerEntrega } from '@/lib/expedientes';
import { getTaskBrief, getTaskSobre } from '@/lib/taskBriefs';

const HASH_CERO = `0x${'0'.repeat(64)}`;

export type QueAnclado = 'encargo' | 'entrega';
export type ParteQueAporta = 'cliente' | 'trabajador';

/** El texto, si cuadra con la huella anclada; si no, null. */
export function siCuadra(texto: string | null | undefined, ancla: string | undefined): string | null {
  if (!texto || !ancla || ancla.toLowerCase() === HASH_CERO) return null;
  return keccak256(toBytes(texto)).toLowerCase() === ancla.toLowerCase() ? texto : null;
}

/** La copia que guarda este dispositivo, sin firmar nada. Solo la tiene el cliente. */
export function copiaLocalAnclada(
  que: QueAnclado,
  rol: ParteQueAporta,
  taskId: bigint,
  huellas: { taskHash: Hex; resultHash: Hex },
): string | null {
  if (rol !== 'cliente') return null;
  return que === 'encargo'
    ? siCuadra(getTaskSobre(huellas.taskHash) ?? getTaskBrief(huellas.taskHash), huellas.taskHash)
    : siCuadra(leerEntrega(taskId.toString())?.texto, huellas.resultHash);
}

/**
 * ¿Se puede ofrecer el botón? Sin firmar nada: lo dice si hay copia local o si
 * hay a quién pedírsela. Pedirla puede fallar después (y entonces se dice).
 */
export function puedeAportar(o: {
  que: QueAnclado;
  rol: ParteQueAporta;
  taskId: bigint;
  huellas: { taskHash: Hex; resultHash: Hex } | undefined;
  botUrl: string | null | undefined;
  delTablon: boolean;
}): boolean {
  if (!o.huellas) return false;
  const ancla = o.que === 'encargo' ? o.huellas.taskHash : o.huellas.resultHash;
  if (ancla.toLowerCase() === HASH_CERO) return false;
  if (copiaLocalAnclada(o.que, o.rol, o.taskId, o.huellas)) return true;
  if (o.delTablon || !o.botUrl) return false;
  if (o.rol === 'cliente') return o.que === 'entrega';
  return esBuzon(o.botUrl);
}

/**
 * El texto anclado para aportarlo: la copia local o, si no, pedido firmando.
 * null si no hay o si lo que llega no cuadra con la cadena.
 */
export async function textoAncladoParaAportar(o: {
  que: QueAnclado;
  rol: ParteQueAporta;
  taskId: bigint;
  huellas: { taskHash: Hex; resultHash: Hex };
  botUrl: string | null | undefined;
  delTablon: boolean;
  yo: Address;
  firmar: Firmar;
}): Promise<string | null> {
  const local = copiaLocalAnclada(o.que, o.rol, o.taskId, o.huellas);
  if (local) return local;
  if (o.delTablon || !o.botUrl) return null;

  if (o.que === 'encargo') {
    if (o.rol !== 'trabajador' || !esBuzon(o.botUrl)) return null;
    const cred = await credencialDeEncargo(o.taskId, o.firmar);
    return siCuadra(await leerEncargoDelBuzon(o.botUrl, o.taskId, o.yo, cred), o.huellas.taskHash);
  }

  // La entrega: con la firma de «resultado», que vale para las dos partes.
  if (o.rol === 'trabajador' && !esBuzon(o.botUrl)) return null;
  const expira = expiraEn();
  const firma = await o.firmar(resultSignMessage(o.taskId, expira));
  const res = await fetch(buildResultUrl(o.botUrl, o.taskId), {
    headers: cabecerasFirma(o.yo, firma, expira),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  const { resultText } = (await res.json()) as { resultText?: unknown };
  return siCuadra(typeof resultText === 'string' ? resultText : null, o.huellas.resultHash);
}
