/**
 * Panal — la conversación de un encargo, entre su cliente y quien lo hace.
 *
 * Vive en el buzón (`bot/src/buzon.ts`, rutas `conversacion/…`) y solo existe
 * con el dinero ya bloqueado en el escrow: es lo contrario de un chat donde un
 * desconocido escribe gratis antes de pagar. Compartido con la app por el
 * alias `@`.
 *
 * UNA FIRMA PARA TODO, MIENTRAS NO CADUCA. Leer, escribir y mandar archivos
 * piden la misma («Panal conversación #<id> · <caducidad>»), y vale unos
 * minutos: firmar cada frase sería una ventana de wallet por mensaje.
 *
 * CIFRADO, SI LAS DOS PARTES TIENEN CLAVE. Entonces cada mensaje es un sobre
 * para los dos que el buzón no puede abrir, y lleva DENTRO el texto y los
 * nombres de sus archivos (que viajan cifrados y con nombre opaco). Si a una
 * de las dos le falta, va en claro, y la pantalla lo dice.
 */

import { cifrarTexto, esTextoCifrado, sinBarraFinal, type Destinatario } from '@panal/sdk';
import { keccak256, type Address } from 'viem';
import { abrirBytes, abrirTexto, cifrarArchivos, clavePublicaDe, type Firmar } from '@/lib/cifrado';

/** Debe coincidir con `conversacionSignMessage` del buzón. */
export function conversacionSignMessage(taskId: bigint, expira: number): string {
  return `Panal conversación #${taskId.toString()} · ${expira}`;
}

/** Lo que dura una firma de la conversación: por debajo de los 15 minutos que admite el buzón. */
const VIDA_FIRMA_S = 14 * 60;

export interface CredencialDeConversacion {
  address: string;
  firma: string;
  expira: number;
}

/** ¿Le queda vida a esta firma? Con un margen, para que no caduque por el camino. */
export function sigueValiendo(c: CredencialDeConversacion | null, ahoraS = Math.floor(Date.now() / 1000)): boolean {
  return !!c && c.expira - 30 > ahoraS;
}

export async function credencialDeConversacion(taskId: bigint, yo: string, firmar: Firmar): Promise<CredencialDeConversacion> {
  const expira = Math.floor(Date.now() / 1000) + VIDA_FIRMA_S;
  return { address: yo, firma: await firmar(conversacionSignMessage(taskId, expira)), expira };
}

const cabeceras = (c: CredencialDeConversacion): Record<string, string> => ({
  'x-panal-address': c.address,
  'x-panal-signature': c.firma,
  'x-panal-expira': String(c.expira),
});

async function fallo(res: Response): Promise<Error> {
  const detalle = await res
    .json()
    .then((b: { error?: string }) => b.error ?? '')
    .catch(() => '');
  return new Error(detalle || `HTTP ${res.status}`);
}

export interface ArchivoDelChat {
  name: string;
  size: number;
  hash: string;
  mime?: string;
}

/** Un mensaje tal y como lo guarda el buzón: el texto puede ser un sobre. */
export interface MensajeCrudo {
  de: 'cliente' | 'trabajador';
  texto: string;
  ts: number;
  archivos?: ArchivoDelChat[];
}

/** Un mensaje para la pantalla: abierto si se pudo, con los nombres de verdad de sus archivos. */
export interface MensajeLegible {
  de: 'cliente' | 'trabajador';
  ts: number;
  cifrado: boolean;
  /** null si va cifrado y esta cuenta no lo puede abrir. */
  texto: string | null;
  archivos: ArchivoDelChat[];
}

export async function leerConversacion(
  base: string,
  taskId: bigint,
  cred: CredencialDeConversacion,
): Promise<{ mensajes: MensajeCrudo[]; abierta: boolean }> {
  const res = await fetch(`${sinBarraFinal(base)}/conversacion/${taskId.toString()}`, { headers: cabeceras(cred) });
  if (!res.ok) throw await fallo(res);
  return (await res.json()) as { mensajes: MensajeCrudo[]; abierta: boolean };
}

/**
 * Abre un mensaje. Si va cifrado, dentro viaja `{ t, a }`: el texto y los
 * archivos con su nombre de verdad (el buzón solo ve nombres opacos).
 */
export async function abrirMensaje(m: MensajeCrudo, yo: Address, firmar: Firmar): Promise<MensajeLegible> {
  if (!esTextoCifrado(m.texto)) {
    return { de: m.de, ts: m.ts, cifrado: false, texto: m.texto, archivos: m.archivos ?? [] };
  }
  const { legible } = await abrirTexto(m.texto, yo, firmar);
  if (legible === null) return { de: m.de, ts: m.ts, cifrado: true, texto: null, archivos: [] };
  try {
    const dentro = JSON.parse(legible) as { t?: unknown; a?: unknown };
    const anunciados = Array.isArray(dentro.a) ? (dentro.a as ArchivoDelChat[]) : [];
    // Solo los que el buzón dice que llegaron con ese hash: un nombre que nadie subió no se enseña.
    const subidos = new Set((m.archivos ?? []).map((a) => a.hash.toLowerCase()));
    return {
      de: m.de,
      ts: m.ts,
      cifrado: true,
      texto: typeof dentro.t === 'string' ? dentro.t : '',
      archivos: anunciados.filter((a) => typeof a?.hash === 'string' && subidos.has(a.hash.toLowerCase())),
    };
  } catch {
    return { de: m.de, ts: m.ts, cifrado: true, texto: legible, archivos: [] };
  }
}

/** Para quién se cifra: las dos partes si las dos publicaron su clave; si no, null y va en claro. */
export async function cifradoDeLaConversacion(cliente: Address, trabajador: Address): Promise<Destinatario[] | null> {
  const [a, b] = await Promise.all([clavePublicaDe(cliente), clavePublicaDe(trabajador)]);
  return a && b ? [{ cuenta: cliente, clave: a }, { cuenta: trabajador, clave: b }] : null;
}

async function subirBytes(
  base: string,
  taskId: bigint,
  archivo: { name: string; bytes: Uint8Array; mime?: string },
  cred: CredencialDeConversacion,
): Promise<string> {
  const res = await fetch(`${sinBarraFinal(base)}/conversacion-archivo/${taskId.toString()}`, {
    method: 'POST',
    headers: {
      ...cabeceras(cred),
      'content-type': archivo.mime || 'application/octet-stream',
      'x-panal-filename': encodeURIComponent(archivo.name),
    },
    body: new Blob([archivo.bytes as BlobPart]),
  });
  if (!res.ok) throw await fallo(res);
  return ((await res.json()) as { hash: string }).hash;
}

/**
 * Manda un mensaje con sus archivos. Si `para` trae a las dos partes, el texto
 * y los archivos van cifrados para las dos; si no, en claro.
 */
export async function enviarMensaje(o: {
  base: string;
  taskId: bigint;
  texto: string;
  archivos: { name: string; bytes: Uint8Array; mime?: string }[];
  para: Destinatario[] | null;
  cred: CredencialDeConversacion;
}): Promise<void> {
  const anunciados: ArchivoDelChat[] = [];
  if (o.para) {
    const { anunciar, subir } = cifrarArchivos(o.archivos, o.para);
    for (const [i, a] of subir.entries()) {
      const hash = await subirBytes(o.base, o.taskId, a, o.cred);
      const real = anunciar[i]!;
      anunciados.push({ name: real.name, size: real.bytes.byteLength, hash, ...(real.mime ? { mime: real.mime } : {}) });
    }
  } else {
    for (const a of o.archivos) {
      const hash = await subirBytes(o.base, o.taskId, a, o.cred);
      anunciados.push({ name: a.name, size: a.bytes.byteLength, hash, ...(a.mime ? { mime: a.mime } : {}) });
    }
  }
  const texto = o.para ? cifrarTexto(JSON.stringify({ t: o.texto, a: anunciados }), o.para) : o.texto;
  const res = await fetch(`${sinBarraFinal(o.base)}/conversacion/${o.taskId.toString()}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      texto,
      archivos: anunciados.map((a) => ({ hash: a.hash })),
      address: o.cred.address,
      signature: o.cred.firma,
      expira: o.cred.expira,
    }),
  });
  if (!res.ok) throw await fallo(res);
}

/** Baja un archivo de la conversación, comprueba que es el que se subió y lo abre si va cifrado. */
export async function bajarArchivoDelChat(o: {
  base: string;
  taskId: bigint;
  archivo: ArchivoDelChat;
  cred: CredencialDeConversacion;
  yo: Address;
  firmar: Firmar;
}): Promise<Uint8Array> {
  const res = await fetch(`${sinBarraFinal(o.base)}/conversacion-archivo/${o.taskId.toString()}/${o.archivo.hash}`, {
    headers: cabeceras(o.cred),
  });
  if (!res.ok) throw await fallo(res);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (keccak256(bytes).toLowerCase() !== o.archivo.hash.toLowerCase()) throw new Error('hash');
  return abrirBytes(bytes, o.yo, o.firmar);
}
