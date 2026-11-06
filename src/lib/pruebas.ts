/**
 * Panal — las pruebas de una disputa, del lado de quien las aporta o las lee.
 *
 * El expediente vive en el buzón de Panal (`bot/src/buzon.ts`, rutas
 * `pruebas/…`) y su protocolo en el SDK (`sdk/src/pruebas.ts`). Aquí está lo
 * que hacen la web y la app: firmar la sesión, cifrar, subir los archivos,
 * firmar cada pieza, y leerlas y abrirlas después.
 *
 * Este archivo solo usa el SDK y viem —nada de la wallet ni de la configuración
 * de la web— para poder probarlo en Node contra un buzón de verdad
 * (`scripts/test-pruebas-web.ts`). Lo que depende de quién lee (su clave, los
 * accesos que tiene, la lista de jueces) se le pasa.
 *
 * DOS FIRMAS. La de la sesión («Panal pruebas #id · caducidad») sirve unos
 * minutos para leer y subir archivos. Cada pieza lleva ADEMÁS la suya, sobre
 * su contenido y su fecha: es la que demuestra después quién dijo qué y cuándo.
 *
 * CIFRADO. Si las dos partes publicaron su clave, cada pieza es un sobre para
 * las dos y para los jueces que tengan la suya, y lleva dentro `{ t, a }`: el
 * texto y los archivos con su nombre de verdad (que viajan cifrados y con
 * nombre opaco). Si a una parte le falta, va en claro y la pantalla lo dice.
 */

import {
  BUZON_URL,
  cifrarArchivo,
  cifrarTexto,
  contenidoDePieza,
  destinatariosDe,
  esTextoCifrado,
  nombreEnBuzon,
  piezaSignMessage,
  pruebasSignMessage,
  sinBarraFinal,
  verificarPieza,
  type Acceso,
  type Destinatario,
  type ExpedienteDeDisputa,
  type PiezaDeDisputa,
} from '@panal/sdk';
import { getAddress, keccak256, type Address, type Hex } from 'viem';

export type Firmar = (mensaje: string) => Promise<string>;
/** Abre un sobre con lo que tenga quien lee (su clave o un acceso); null si no puede. */
export type AbrirTexto = (sobre: string, accesos: Acceso[]) => Promise<string | null>;
/** Abre unos bytes cifrados con lo que tenga quien lee; tal cual si van en claro. */
export type AbrirBytes = (bytes: Uint8Array, accesos: Acceso[]) => Promise<Uint8Array>;

/**
 * Dónde está el expediente de una tarea: en el buzón de Panal, bajo quien hace
 * el trabajo. Da igual que ese agente reciba en el buzón o en su servidor: las
 * pruebas de una disputa las guarda siempre Panal.
 */
export function buzonDePruebas(trabajador: string, base: string = BUZON_URL): string {
  return `${sinBarraFinal(base)}/${getAddress(trabajador)}`;
}

/** Lo que dura la firma de sesión: por debajo de los 15 minutos que admite el buzón. */
const VIDA_FIRMA_S = 14 * 60;

export interface CredencialDePruebas {
  address: string;
  firma: string;
  expira: number;
}

/** ¿Le queda vida a esta firma? Con margen, para que no caduque por el camino. */
export function sigueValiendo(c: CredencialDePruebas | null, ahoraS = Math.floor(Date.now() / 1000)): boolean {
  return !!c && c.expira - 30 > ahoraS;
}

export async function credencialDePruebas(taskId: bigint, yo: string, firmar: Firmar): Promise<CredencialDePruebas> {
  const expira = Math.floor(Date.now() / 1000) + VIDA_FIRMA_S;
  return { address: yo, firma: await firmar(pruebasSignMessage(taskId, expira)), expira };
}

const cabeceras = (c: CredencialDePruebas): Record<string, string> => ({
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

/** Un archivo del expediente tal como lo guarda el buzón (con nombre opaco si va cifrado). */
export interface ArchivoDelExpediente {
  hash: string;
  name: string;
  size: number;
  mime?: string;
  de: 'cliente' | 'trabajador';
}

export interface ExpedienteCrudo extends ExpedienteDeDisputa {
  archivos: ArchivoDelExpediente[];
}

export async function leerPruebas(base: string, taskId: bigint, cred: CredencialDePruebas): Promise<ExpedienteCrudo> {
  const res = await fetch(`${sinBarraFinal(base)}/pruebas/${taskId.toString()}`, { headers: cabeceras(cred) });
  if (!res.ok) throw await fallo(res);
  const r = (await res.json()) as Partial<ExpedienteCrudo>;
  return {
    piezas: r.piezas ?? [],
    plazo: r.plazo ?? 0,
    abierto: r.abierto === true,
    accesos: r.accesos ?? [],
    archivos: r.archivos ?? [],
  };
}

/** Un archivo de una pieza, para la pantalla: con su nombre de verdad si se pudo leer. */
export interface ArchivoDePiezaLegible {
  hash: string;
  name: string;
  size: number;
  mime?: string;
}

/** Una pieza para la pantalla. */
export interface PiezaLegible {
  de: 'cliente' | 'trabajador';
  autor: Address;
  fecha: string;
  recibida: number;
  /** Si la firma de su autor cuadra con lo que hay guardado. Se comprueba aquí, sin fiarse del buzón. */
  firmaOk: boolean;
  cifrada: boolean;
  /** null si va cifrada y quien lee no la puede abrir. */
  texto: string | null;
  archivos: ArchivoDePiezaLegible[];
  /** Para quién se cifró (cuentas en minúsculas); vacío si va en claro. */
  para: string[];
  /** Tal como está en el buzón: para dar acceso a ella. */
  cruda: PiezaDeDisputa;
}

/**
 * Abre una pieza. En claro, los nombres de sus archivos salen del índice del
 * buzón; cifrada, de dentro del sobre (el buzón solo ve nombres opacos), y
 * solo los que el buzón dice que llegaron con ese hash.
 */
export async function abrirPieza(
  taskId: bigint,
  pieza: PiezaDeDisputa,
  indice: ArchivoDelExpediente[],
  accesos: Acceso[],
  abrir: AbrirTexto,
): Promise<PiezaLegible> {
  const base = {
    de: pieza.de,
    autor: getAddress(pieza.autor),
    fecha: pieza.fecha,
    recibida: pieza.recibida,
    firmaOk: await verificarPieza(taskId, pieza),
    cruda: pieza,
  };
  const subidos = new Set(pieza.archivos.map((a) => a.hash.toLowerCase()));
  if (!esTextoCifrado(pieza.texto)) {
    const archivos = pieza.archivos.map((a) => {
      const i = indice.find((x) => x.hash.toLowerCase() === a.hash.toLowerCase());
      return { hash: a.hash, size: a.size, name: i?.name ?? a.hash.slice(0, 10), ...(i?.mime ? { mime: i.mime } : {}) };
    });
    return { ...base, cifrada: false, texto: pieza.texto, archivos, para: [] };
  }
  const para = destinatariosDe(pieza.texto).map((x) => x.toLowerCase());
  const legible = await abrir(pieza.texto, accesos).catch(() => null);
  if (legible === null) return { ...base, cifrada: true, texto: null, archivos: [], para };
  try {
    const dentro = JSON.parse(legible) as { t?: unknown; a?: unknown };
    const anunciados = Array.isArray(dentro.a) ? (dentro.a as ArchivoDePiezaLegible[]) : [];
    return {
      ...base,
      cifrada: true,
      texto: typeof dentro.t === 'string' ? dentro.t : '',
      archivos: anunciados.filter((a) => typeof a?.hash === 'string' && subidos.has(a.hash.toLowerCase())),
      para,
    };
  } catch {
    return { ...base, cifrada: true, texto: legible, archivos: [], para };
  }
}

/**
 * Para quién se cifra: las dos partes y los jueces que tengan clave, si las
 * dos partes la tienen. Si a una le falta, null: irá en claro.
 */
export async function destinatariosDePruebas(
  cliente: Address,
  trabajador: Address,
  jueces: Address[],
  claveDe: (cuenta: Address) => Promise<string | null>,
): Promise<{ para: Destinatario[] | null; juecesSinClave: Address[] }> {
  const [a, b, ...deJueces] = await Promise.all([claveDe(cliente), claveDe(trabajador), ...jueces.map((j) => claveDe(j))]);
  const juecesSinClave = jueces.filter((_, i) => !deJueces[i]);
  if (!a || !b) return { para: null, juecesSinClave };
  const conClave = jueces
    .map((j, i) => (deJueces[i] ? { cuenta: j, clave: deJueces[i]! } : null))
    .filter((d): d is Destinatario => d !== null)
    // Un juez que además fuera parte no va dos veces.
    .filter((d) => d.cuenta.toLowerCase() !== cliente.toLowerCase() && d.cuenta.toLowerCase() !== trabajador.toLowerCase());
  return { para: [{ cuenta: cliente, clave: a }, { cuenta: trabajador, clave: b }, ...conClave], juecesSinClave };
}

async function subirBytes(base: string, taskId: bigint, archivo: { name: string; bytes: Uint8Array; mime?: string }, cred: CredencialDePruebas): Promise<string> {
  const res = await fetch(`${sinBarraFinal(base)}/pruebas-archivo/${taskId.toString()}`, {
    method: 'POST',
    headers: {
      ...cabeceras(cred),
      'content-type': archivo.mime || 'application/octet-stream',
      'x-panal-filename': encodeURIComponent(archivo.name),
    },
    body: archivo.bytes.slice() as unknown as RequestInit['body'],
  });
  if (!res.ok) throw await fallo(res);
  return ((await res.json()) as { hash: string }).hash;
}

/**
 * Aporta una pieza: sube sus archivos (cifrados si `para` trae destinatarios),
 * firma el contenido tal como se guardará y la deja en el buzón.
 */
export async function aportarPieza(o: {
  base: string;
  taskId: bigint;
  texto: string;
  archivos: { name: string; bytes: Uint8Array; mime?: string }[];
  para: Destinatario[] | null;
  cred: CredencialDePruebas;
  yo: Address;
  firmar: Firmar;
}): Promise<void> {
  const anunciados: ArchivoDePiezaLegible[] = [];
  const guardados: { hash: string; size: number }[] = [];
  for (const a of o.archivos) {
    const bytes = o.para ? new Uint8Array(cifrarArchivo(a.bytes, o.para)) : a.bytes;
    const subido = { name: o.para ? nombreEnBuzon(keccak256(bytes)) : a.name, bytes, ...(o.para ? {} : a.mime ? { mime: a.mime } : {}) };
    const hash = await subirBytes(o.base, o.taskId, subido, o.cred);
    guardados.push({ hash, size: bytes.byteLength });
    anunciados.push({ name: a.name, size: bytes.byteLength, hash, ...(a.mime ? { mime: a.mime } : {}) });
  }
  const texto = o.para ? cifrarTexto(JSON.stringify({ t: o.texto, a: anunciados }), o.para) : o.texto;
  const fecha = new Date().toISOString();
  const firma = await o.firmar(piezaSignMessage(o.taskId, contenidoDePieza(texto, guardados), fecha));
  const res = await fetch(`${sinBarraFinal(o.base)}/pruebas/${o.taskId.toString()}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address: o.yo, texto, archivos: guardados.map((g) => ({ hash: g.hash })), fecha, firma }),
  });
  if (!res.ok) throw await fallo(res);
}

/** Baja un archivo del expediente, comprueba que es el que se subió y lo abre si va cifrado. */
export async function bajarArchivoDePruebas(o: {
  base: string;
  taskId: bigint;
  archivo: { hash: string };
  cred: CredencialDePruebas;
  accesos: Acceso[];
  abrir: AbrirBytes;
}): Promise<Uint8Array> {
  const res = await fetch(`${sinBarraFinal(o.base)}/pruebas-archivo/${o.taskId.toString()}/${o.archivo.hash}`, {
    headers: cabeceras(o.cred),
  });
  if (!res.ok) throw await fallo(res);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (keccak256(bytes).toLowerCase() !== o.archivo.hash.toLowerCase()) throw new Error('hash');
  return o.abrir(bytes, o.accesos);
}

/**
 * Los objetos cifrados de las piezas que esta cuenta puede abrir, para darles
 * acceso a los jueces que activaron su clave después: los sobres y los bytes
 * de sus archivos. Los archivos se bajan (por eso pide la credencial).
 */
export async function objetosParaDarAcceso(o: {
  base: string;
  taskId: bigint;
  piezas: PiezaLegible[];
  cred: CredencialDePruebas;
}): Promise<(string | Uint8Array)[]> {
  const objetos: (string | Uint8Array)[] = [];
  for (const p of o.piezas) {
    if (!p.cifrada || p.texto === null) continue;
    objetos.push(p.cruda.texto);
    for (const a of p.cruda.archivos) {
      const res = await fetch(`${sinBarraFinal(o.base)}/pruebas-archivo/${o.taskId.toString()}/${a.hash}`, { headers: cabeceras(o.cred) });
      if (!res.ok) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (keccak256(bytes).toLowerCase() === a.hash.toLowerCase()) objetos.push(bytes);
    }
  }
  return objetos;
}

/** El hash de un texto, como lo usan los accesos para señalar lo que abren. */
export const objetoDeTexto = (sobre: string): Hex => keccak256(new TextEncoder().encode(sobre));
