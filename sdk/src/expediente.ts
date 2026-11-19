/**
 * Panal — el expediente de una disputa, desde un programa.
 *
 * Lo mismo que hace la web (`src/lib/pruebas.ts`) pero sin pantalla: para que
 * un AGENTE AUTÓNOMO pueda leer el expediente de su disputa y aportar a él.
 * Antes no podía: las pruebas solo se escribían desde la web o la app, con una
 * persona delante, y un agente con servidor propio llegaba a la disputa sin
 * poder enseñar ni el encargo que le hicieron ni lo que entregó.
 *
 * Las reglas son las de la v2 (`pruebas.ts`):
 *   - todo va cifrado para TODOS los del expediente que tengan clave (las dos
 *     partes y los jueces), el autor incluido; el buzón rechaza lo demás;
 *   - el encargo y la entrega se aportan con su texto EXACTO, y quien lee los
 *     compara con la cadena;
 *   - archivos, solo los anclados, y solo de quien hizo el trabajo.
 *
 * Este archivo no sabe de wallets: recibe con qué firmar, con qué abrir y a
 * quién preguntar por las claves (`DepsDelExpediente`). `PanalClient` le da lo
 * suyo (`readDisputeFile`, `writeToDisputeFile`, `shareDisputeFileAccess`).
 */

import { getAddress, keccak256, type Address, type Hex } from 'viem';
import {
  accesoSignMessage,
  cifrarArchivo,
  cifrarTexto,
  concederAcceso,
  descifrarTexto,
  destinatariosDe,
  esTextoCifrado,
  nombreEnBuzon,
  puedeAbrir,
  type Acceso,
  type Destinatario,
} from './cifrado.js';
import { fetchBytesLimited, fetchLimited, sinBarraFinal } from './net.js';
import {
  anclaDeLaPieza,
  contenidoDePieza,
  cuerpoDePieza,
  destinatariosDelExpediente,
  leerCuerpoDePieza,
  miembrosDelExpediente,
  piezaSignMessage,
  pruebasSignMessage,
  verificarPieza,
  type ArchivoDeCuerpo,
  type AutorDePieza,
  type ParteDeLaTarea,
  type PiezaDeDisputa,
  type TipoDePieza,
} from './pruebas.js';

/** Lo que dura la firma de sesión: por debajo de los 15 minutos que admite el buzón. */
const VIDA_FIRMA_S = 14 * 60;

/** Lo que el expediente necesita de quien lo usa. */
export interface DepsDelExpediente {
  /** El buzón de Panal (`https://api.panal.lat/buzon`). */
  buzonUrl: string;
  /** La cuenta que lee o escribe. */
  yo: Address;
  /** Firma un mensaje EIP-191 con esa cuenta. */
  firmar: (mensaje: string) => Promise<Hex>;
  /** La clave secreta de cifrado de esa cuenta (`encryptionKey().secreta`). */
  secreta: () => Promise<Uint8Array>;
  /** La clave pública publicada de una cuenta, comprobada; null si no tiene. */
  claveDe: (cuenta: Address) => Promise<string | null>;
}

/** La tarea, como la necesita el expediente. */
export interface TareaDelExpediente {
  id: bigint;
  /** El cliente DE VERDAD (en una del tablón con reglas, el de su encargo). */
  cliente: Address;
  trabajador: Address;
  taskHash: Hex | string;
  resultHash: Hex | string;
  /** Los jueces: los firmantes de la multisig que arbitra. */
  jueces: Address[];
  /** Su encargo del tablón con reglas, si lo es: viaja como `?job=`. */
  job?: bigint;
}

/** Una pieza, abierta para quien lee. */
export interface PiezaAbierta {
  /** Su posición en el expediente: no cambia, el expediente solo crece. */
  indice: number;
  de: AutorDePieza;
  autor: Address;
  fecha: string;
  recibida: number;
  /** Si la firma de su autor cuadra con lo guardado, comprobado aquí. */
  firmaOk: boolean;
  tipo: TipoDePieza;
  /** null si va cifrada y quien lee no la puede abrir (todavía). */
  texto: string | null;
  dirigida?: ParteDeLaTarea;
  pide?: 'encargo' | 'entrega';
  auto: boolean;
  /** Si es el encargo o la entrega: si su texto es el anclado. */
  ancla: 'coincide' | 'no-coincide' | null;
  archivos: ArchivoDeCuerpo[];
  /** Para quién va cifrada (cuentas en minúsculas). */
  destinatarios: string[];
  /** Tal como está en el buzón. */
  cruda: PiezaDeDisputa;
}

export interface ExpedienteAbierto {
  piezas: PiezaAbierta[];
  /** Hasta cuándo se puede escribir (segundos). */
  plazo: number;
  /** Si ahora se puede escribir: en disputa y dentro del plazo. */
  abierto: boolean;
  accesos: Acceso[];
}

interface Credencial {
  address: Address;
  firma: Hex;
  expira: number;
}

/** El buzón de una tarea: bajo quien hace el trabajo, como en la web. */
const baseDe = (d: DepsDelExpediente, t: TareaDelExpediente) => `${sinBarraFinal(d.buzonUrl)}/${getAddress(t.trabajador)}`;
const conJob = (t: TareaDelExpediente) => (t.job !== undefined ? `?job=${t.job.toString()}` : '');
const cabeceras = (c: Credencial): Record<string, string> => ({
  'x-panal-address': c.address,
  'x-panal-signature': c.firma,
  'x-panal-expira': String(c.expira),
});

async function credencial(d: DepsDelExpediente, taskId: bigint): Promise<Credencial> {
  const expira = Math.floor(Date.now() / 1000) + VIDA_FIRMA_S;
  return { address: d.yo, firma: await d.firmar(pruebasSignMessage(taskId, expira)), expira };
}

function errorDelBuzon(status: number, text: string): Error {
  let detalle = '';
  try {
    detalle = String((JSON.parse(text) as { error?: unknown }).error ?? '');
  } catch {
    detalle = text.slice(0, 160);
  }
  return new Error(detalle || `HTTP ${status}`);
}

/**
 * Lee el expediente y lo abre con la clave de quien lee. Lo que no puede abrir
 * sale con `texto: null` (no tiene acceso, todavía). Cada firma y cada encargo
 * o entrega se comprueban aquí, sin fiarse del buzón.
 */
export async function leerExpediente(d: DepsDelExpediente, t: TareaDelExpediente, cred?: Credencial): Promise<ExpedienteAbierto> {
  const c = cred ?? (await credencial(d, t.id));
  const { status, text } = await fetchLimited(`${baseDe(d, t)}/pruebas/${t.id}${conJob(t)}`, {
    headers: cabeceras(c),
    timeoutMs: 20_000,
    maxBytes: 32 * 1024 * 1024,
  });
  if (status !== 200) throw errorDelBuzon(status, text);
  const crudo = JSON.parse(text) as { piezas?: PiezaDeDisputa[]; plazo?: number; abierto?: boolean; accesos?: Acceso[] };
  const accesos = crudo.accesos ?? [];
  const piezas: PiezaAbierta[] = [];
  for (const [indice, p] of (crudo.piezas ?? []).entries()) {
    const firmaOk = await verificarPieza(t.id, p);
    const base = {
      indice,
      de: p.de,
      autor: getAddress(p.autor),
      fecha: p.fecha,
      recibida: p.recibida,
      firmaOk,
      cruda: p,
    };
    if (!esTextoCifrado(p.texto)) {
      // Las de la v1 que fueron en claro.
      piezas.push({ ...base, tipo: 'mensaje', texto: p.texto, auto: false, ancla: null, archivos: [], destinatarios: [] });
      continue;
    }
    const destinatarios = destinatariosDe(p.texto).map((x) => x.toLowerCase());
    if (!puedeAbrir(p.texto, d.yo, accesos)) {
      piezas.push({ ...base, tipo: 'mensaje', texto: null, auto: false, ancla: null, archivos: [], destinatarios });
      continue;
    }
    let legible: string;
    try {
      legible = descifrarTexto(p.texto, d.yo, await d.secreta(), accesos);
    } catch {
      piezas.push({ ...base, tipo: 'mensaje', texto: null, auto: false, ancla: null, archivos: [], destinatarios });
      continue;
    }
    const cuerpo = leerCuerpoDePieza(legible);
    const subidos = new Set(p.archivos.map((a) => a.hash.toLowerCase()));
    piezas.push({
      ...base,
      tipo: cuerpo.k,
      texto: cuerpo.t,
      ...(cuerpo.para ? { dirigida: cuerpo.para } : {}),
      ...(cuerpo.pide ? { pide: cuerpo.pide } : {}),
      auto: cuerpo.auto === true,
      ancla: anclaDeLaPieza(cuerpo, t),
      archivos: cuerpo.a.filter((a) => subidos.has(a.hash.toLowerCase())),
      destinatarios,
    });
  }
  return { piezas, plazo: crudo.plazo ?? 0, abierto: crudo.abierto === true, accesos };
}

/** Lo que se escribe en el expediente. */
export interface PiezaNueva {
  tipo?: TipoDePieza;
  texto: string;
  /** A qué parte va (un mensaje o una petición de un juez). */
  para?: ParteDeLaTarea;
  pide?: 'encargo' | 'entrega';
  /** La escribe la IA de un agente, sola. */
  auto?: boolean;
  /**
   * Archivos, solo de quien hizo el trabajo y solo los ANCLADOS: los adjuntos
   * de su encargo y los de su entrega, con sus bytes tal como se anclaron (su
   * keccak256 tiene que figurar en el encargo o en la entrega). El buzón no
   * puede comprobarlo; quien lee, sí, y el que no cuadra no se abre.
   */
  archivos?: { name: string; bytes: Uint8Array; mime?: string }[];
}

/**
 * Escribe una pieza: cifrada para todos los del expediente que tengan clave
 * (quien escribe tiene que tener la suya publicada), firmada sobre su
 * contenido y su fecha. Si entretanto alguien publicó su clave y el buzón dice
 * que falta, rehace la lista y lo intenta una vez más.
 */
export async function escribirEnExpediente(d: DepsDelExpediente, t: TareaDelExpediente, pieza: PiezaNueva): Promise<void> {
  const miembros = miembrosDelExpediente(t.cliente, t.trabajador, t.jueces);
  const c = await credencial(d, t.id);
  const base = baseDe(d, t);
  const intentar = async (): Promise<void> => {
    const { para } = await destinatariosDelExpediente(miembros, d.claveDe);
    if (!para.some((x) => x.cuenta.toLowerCase() === d.yo.toLowerCase())) {
      throw new Error('Esta cuenta no tiene su clave de cifrado publicada: publícala antes de escribir (publishEncryptionKey).');
    }
    const anunciados: ArchivoDeCuerpo[] = [];
    const guardados: { hash: string; size: number }[] = [];
    for (const a of pieza.archivos ?? []) {
      const bytes = new Uint8Array(cifrarArchivo(a.bytes, para));
      const r = await fetchLimited(`${base}/pruebas-archivo/${t.id}${conJob(t)}`, {
        method: 'POST',
        headers: { ...cabeceras(c), 'content-type': 'application/octet-stream', 'x-panal-filename': encodeURIComponent(nombreEnBuzon(keccak256(bytes))) },
        body: bytes as unknown as RequestInit['body'],
        timeoutMs: 180_000,
        maxBytes: 10_000,
      });
      if (r.status !== 200) throw errorDelBuzon(r.status, r.text);
      const hash = (JSON.parse(r.text) as { hash: string }).hash;
      guardados.push({ hash, size: bytes.byteLength });
      anunciados.push({ name: a.name, size: bytes.byteLength, hash, h: keccak256(a.bytes), ...(a.mime ? { mime: a.mime } : {}) });
    }
    const cuerpo = cuerpoDePieza({
      tipo: pieza.tipo ?? 'mensaje',
      texto: pieza.texto,
      archivos: anunciados,
      ...(pieza.para ? { para: pieza.para } : {}),
      ...(pieza.pide ? { pide: pieza.pide } : {}),
      ...(pieza.auto ? { auto: true } : {}),
    });
    const texto = cifrarTexto(JSON.stringify(cuerpo), para);
    const fecha = new Date().toISOString();
    const firma = await d.firmar(piezaSignMessage(t.id, contenidoDePieza(texto, guardados), fecha));
    const r = await fetchLimited(`${base}/pruebas/${t.id}${conJob(t)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: d.yo, texto, archivos: guardados.map((g) => ({ hash: g.hash })), fecha, firma }),
      timeoutMs: 30_000,
      maxBytes: 10_000,
    });
    if (r.status !== 200) throw errorDelBuzon(r.status, r.text);
  };
  try {
    await intentar();
  } catch (err) {
    if (!(err instanceof Error) || err.message !== 'missing recipients') throw err;
    await intentar();
  }
}

/**
 * Da acceso a lo que quien lee puede abrir a los del expediente que tienen
 * clave y aún no lo abren (los que la publicaron tarde). Devuelve cuántos
 * accesos dejó. Una parte o un juez (este, mientras dure la disputa).
 */
export async function darAccesosDelExpediente(d: DepsDelExpediente, t: TareaDelExpediente): Promise<number> {
  const c = await credencial(d, t.id);
  const exp = await leerExpediente(d, t, c);
  const { para } = await destinatariosDelExpediente(miembrosDelExpediente(t.cliente, t.trabajador, t.jueces), d.claveDe);
  const otros: Destinatario[] = para.filter((x) => x.cuenta.toLowerCase() !== d.yo.toLowerCase());
  const secreta = await d.secreta();
  const nuevos: Acceso[] = [];
  for (const p of exp.piezas) {
    if (p.texto === null || !esTextoCifrado(p.cruda.texto)) continue;
    const faltan = otros.filter((x) => !p.destinatarios.includes(x.cuenta.toLowerCase()));
    for (const x of faltan) {
      try {
        nuevos.push(concederAcceso(p.cruda.texto, d.yo, secreta, x, exp.accesos));
      } catch {
        /* no es de los suyos */
      }
      for (const a of p.cruda.archivos) {
        const r = await fetchBytesLimited(`${baseDe(d, t)}/pruebas-archivo/${t.id}/${a.hash}${conJob(t)}`, {
          headers: cabeceras(c),
          timeoutMs: 120_000,
          maxBytes: 30 * 1024 * 1024,
        });
        if (r.status !== 200 || keccak256(r.bytes).toLowerCase() !== a.hash.toLowerCase()) continue;
        try {
          nuevos.push(concederAcceso(r.bytes, d.yo, secreta, x, exp.accesos));
        } catch {
          /* no es de los suyos */
        }
      }
    }
  }
  if (nuevos.length === 0) return 0;
  const expira = Math.floor(Date.now() / 1000) + VIDA_FIRMA_S;
  const signature = await d.firmar(accesoSignMessage(t.id, expira));
  for (let i = 0; i < nuevos.length; i += 40) {
    const r = await fetchLimited(`${baseDe(d, t)}/access/${t.id}${conJob(t)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accesos: nuevos.slice(i, i + 40), address: d.yo, signature, expira }),
      timeoutMs: 15_000,
      maxBytes: 10_000,
    });
    if (r.status !== 200) throw errorDelBuzon(r.status, r.text);
  }
  return nuevos.length;
}

/**
 * ¿Esta credencial es de un juez? Lo que comprueba el servidor de un agente
 * cuando un juez le avisa de que hay algo nuevo en el expediente: la firma de
 * sesión del expediente (`pruebasSignMessage`), sin caducar ni con caducidad
 * de más de 15 minutos, y de una cuenta que está entre los jueces.
 */
export async function esCredencialDeJuez(
  o: { address: string; firma: string; expira: number | string; taskId: bigint },
  jueces: readonly Address[],
  verificar: (a: { address: Address; message: string; signature: Hex }) => Promise<boolean>,
): Promise<boolean> {
  const expira = Number(o.expira);
  const ahora = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(expira) || expira < ahora || expira > ahora + 15 * 60) return false;
  if (!/^0x[0-9a-fA-F]{40}$/.test(o.address) || !/^0x[0-9a-fA-F]+$/.test(o.firma)) return false;
  if (!jueces.some((j) => j.toLowerCase() === o.address.toLowerCase())) return false;
  try {
    return await verificar({ address: getAddress(o.address), message: pruebasSignMessage(o.taskId, expira), signature: o.firma as Hex });
  } catch {
    return false;
  }
}
