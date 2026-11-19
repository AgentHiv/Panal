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
 * CIFRADO. Desde la v2, SIEMPRE: cada pieza es un sobre para todos los del
 * expediente que tengan clave (las dos partes y los jueces), su autor incluido,
 * y lleva dentro el `CuerpoDePieza` del SDK: qué es (mensaje, encargo, entrega,
 * petición), el texto y los archivos con su nombre de verdad (que viajan
 * cifrados y con nombre opaco). Sin clave no se escribe: primero se activa.
 * Las de la v1 que fueron en claro se siguen leyendo.
 *
 * LO ANCLADO. Una pieza de encargo o de entrega se compara con el `taskHash` o
 * el `resultHash` de la tarea (`ancla`), y un archivo solo cuenta si su hash
 * figura en el encargo o la entrega ya comprobados (`marcarAnclados`).
 */

import {
  BUZON_URL,
  anclaDeLaPieza,
  cifrarArchivo,
  cifrarTexto,
  contenidoDePieza,
  cuerpoDePieza,
  destinatariosDe,
  destinatariosDelExpediente,
  esTextoCifrado,
  hashesAnclados,
  leerCuerpoDePieza,
  miembrosDelExpediente,
  nombreEnBuzon,
  piezaSignMessage,
  pruebasSignMessage,
  sinBarraFinal,
  verificarPieza,
  type Acceso,
  type AutorDePieza,
  type Destinatario,
  type ExpedienteDeDisputa,
  type ParteDeLaTarea,
  type PiezaDeDisputa,
  type TipoDePieza,
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
  /**
   * El encargo del tablón con reglas de esta tarea, si es de allí. En el escrow
   * su cliente es el contrato PanalTablon, y el buzón saca de este encargo al de
   * verdad (lo comprueba en la cadena). Viaja como `?job=` en cada petición.
   */
  job?: string;
}

/** ¿Le queda vida a esta firma? Con margen, para que no caduque por el camino. */
export function sigueValiendo(c: CredencialDePruebas | null, ahoraS = Math.floor(Date.now() / 1000)): boolean {
  return !!c && c.expira - 30 > ahoraS;
}

export async function credencialDePruebas(
  taskId: bigint,
  yo: string,
  firmar: Firmar,
  /** Si la tarea es de un encargo del tablón con reglas, su número. */
  jobId?: bigint,
): Promise<CredencialDePruebas> {
  const expira = Math.floor(Date.now() / 1000) + VIDA_FIRMA_S;
  return {
    address: yo,
    firma: await firmar(pruebasSignMessage(taskId, expira)),
    expira,
    ...(jobId !== undefined ? { job: jobId.toString() } : {}),
  };
}

/** La ruta de una tarea en el buzón, con su encargo del tablón si lo tiene. */
function ruta(base: string, que: string, taskId: bigint, cred: CredencialDePruebas, resto = ''): string {
  return `${sinBarraFinal(base)}/${que}/${taskId.toString()}${resto}${cred.job ? `?job=${cred.job}` : ''}`;
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

/** Las huellas de la tarea en el escrow, para comprobar lo anclado. */
export interface HuellasDeLaTarea {
  taskHash: string;
  resultHash: string;
}

export interface ExpedienteCrudo extends ExpedienteDeDisputa {
  archivos: ArchivoDelExpediente[];
}

export async function leerPruebas(base: string, taskId: bigint, cred: CredencialDePruebas): Promise<ExpedienteCrudo> {
  const res = await fetch(ruta(base, 'pruebas', taskId, cred), { headers: cabeceras(cred) });
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
  /** El hash con el que se ancló (dentro del sobre). */
  h?: string;
  /**
   * Si está anclado: su `h` figura en el encargo o la entrega ya comprobados
   * contra la cadena. Uno que no lo está no se ofrece para abrir.
   */
  anclado?: boolean;
}

/** Una pieza para la pantalla. */
export interface PiezaLegible {
  de: AutorDePieza;
  /** Qué es: un mensaje, el encargo, la entrega o una petición de un juez. */
  tipo: TipoDePieza;
  /** A qué parte va un mensaje o una petición de un juez (sin él, a todos). */
  dirigida?: ParteDeLaTarea;
  /** Qué pide una petición. */
  pide?: 'encargo' | 'entrega';
  /** La escribió la IA de un agente, sola. */
  auto: boolean;
  /** Si es el encargo o la entrega: si su texto es el anclado en la cadena. */
  ancla: 'coincide' | 'no-coincide' | null;
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
  /** Las huellas de la tarea: sin ellas, el encargo y la entrega no se comprueban. */
  tarea?: HuellasDeLaTarea,
): Promise<PiezaLegible> {
  const base = {
    de: pieza.de,
    tipo: 'mensaje' as TipoDePieza,
    auto: false,
    ancla: null,
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
  const cuerpo = leerCuerpoDePieza(legible);
  return {
    ...base,
    tipo: cuerpo.k,
    ...(cuerpo.para ? { dirigida: cuerpo.para } : {}),
    ...(cuerpo.pide ? { pide: cuerpo.pide } : {}),
    auto: cuerpo.auto === true,
    ancla: tarea ? anclaDeLaPieza(cuerpo, tarea) : null,
    cifrada: true,
    texto: cuerpo.t,
    // Solo los que el buzón dice que llegaron con ese hash.
    archivos: cuerpo.a.filter((a) => subidos.has(a.hash.toLowerCase())),
    para,
  };
}

/**
 * Marca qué archivos están anclados: los que figuran en el encargo o en la
 * entrega cuyas piezas ya coinciden con la cadena. Se hace con todas las
 * piezas abiertas, porque el archivo puede venir en otra pieza que la del
 * texto que lo nombra.
 */
export function marcarAnclados(piezas: PiezaLegible[]): PiezaLegible[] {
  const comprobado = (tipo: 'encargo' | 'entrega') =>
    piezas.find((p) => p.tipo === tipo && p.ancla === 'coincide' && p.firmaOk && p.texto !== null)?.texto ?? null;
  const anclados = hashesAnclados({ encargo: comprobado('encargo'), entrega: comprobado('entrega') });
  return piezas.map((p) => ({
    ...p,
    archivos: p.archivos.map((a) => ({ ...a, anclado: !!a.h && anclados.has(a.h.toLowerCase()) })),
  }));
}

/**
 * Para quién se cifra (v2): todos los del expediente que tengan clave, las dos
 * partes y los jueces. El buzón no admite una pieza a la que le falte alguno.
 * `sinClave` son los que aún no la tienen: cuando la publiquen, quien pueda
 * abrir lo anterior les da acceso. Quien escribe tiene que estar en `para`:
 * si no, primero activa su clave.
 */
export async function destinatariosDePruebas(
  cliente: Address,
  trabajador: Address,
  jueces: Address[],
  claveDe: (cuenta: Address) => Promise<string | null>,
): Promise<{ para: Destinatario[]; juecesSinClave: Address[]; sinClave: Address[] }> {
  const { para, sinClave } = await destinatariosDelExpediente(miembrosDelExpediente(cliente, trabajador, jueces), claveDe);
  const sin = new Set(sinClave.map((x) => x.toLowerCase()));
  return { para, juecesSinClave: jueces.filter((j) => sin.has(j.toLowerCase())), sinClave };
}

/** ¿Esta cuenta puede escribir? Solo si está entre los destinatarios: tiene clave. */
export function puedeEscribir(para: Destinatario[] | null | undefined, yo: string): boolean {
  return !!para && para.some((d) => d.cuenta.toLowerCase() === yo.toLowerCase());
}

/**
 * Los del expediente con clave que no pueden abrir alguna pieza que quien lee
 * sí abre: los que la activaron después. A esos se les puede dar acceso.
 */
export function faltanPorAcceso(piezas: PiezaLegible[], para: Destinatario[]): Destinatario[] {
  return para.filter((d) => piezas.some((p) => p.cifrada && p.texto !== null && !p.para.includes(d.cuenta.toLowerCase())));
}

async function subirBytes(base: string, taskId: bigint, archivo: { name: string; bytes: Uint8Array; mime?: string }, cred: CredencialDePruebas): Promise<string> {
  const res = await fetch(ruta(base, 'pruebas-archivo', taskId, cred), {
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
 * Aporta una pieza: sube sus archivos cifrados (solo el agente, y solo los
 * anclados), firma el contenido tal como se guardará y la deja en el buzón.
 * Siempre cifrada para `para`, que tiene que incluir a quien escribe: si no
 * tiene clave, lanza `sin-clave` sin firmar nada.
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
  /** Qué es la pieza. Por defecto, un mensaje. */
  tipo?: TipoDePieza;
  /** A qué parte va (un mensaje o una petición de un juez). */
  dirigida?: ParteDeLaTarea;
  /** Qué pide una petición. */
  pide?: 'encargo' | 'entrega';
}): Promise<void> {
  const para = o.para;
  if (!para || !puedeEscribir(para, o.yo)) throw new Error('sin-clave');
  const anunciados: ArchivoDePiezaLegible[] = [];
  const guardados: { hash: string; size: number }[] = [];
  for (const a of o.archivos) {
    const bytes = new Uint8Array(cifrarArchivo(a.bytes, para));
    const subido = { name: nombreEnBuzon(keccak256(bytes)), bytes };
    const hash = await subirBytes(o.base, o.taskId, subido, o.cred);
    guardados.push({ hash, size: bytes.byteLength });
    // `h`: el hash de los bytes como se anclaron, para que quien lee compruebe
    // que el archivo es uno del encargo o de la entrega.
    anunciados.push({ name: a.name, size: bytes.byteLength, hash, h: keccak256(a.bytes), ...(a.mime ? { mime: a.mime } : {}) });
  }
  const cuerpo = cuerpoDePieza({
    tipo: o.tipo ?? 'mensaje',
    texto: o.texto,
    archivos: anunciados,
    ...(o.dirigida ? { para: o.dirigida } : {}),
    ...(o.pide ? { pide: o.pide } : {}),
  });
  const texto = cifrarTexto(JSON.stringify(cuerpo), para);
  const fecha = new Date().toISOString();
  const firma = await o.firmar(piezaSignMessage(o.taskId, contenidoDePieza(texto, guardados), fecha));
  const res = await fetch(ruta(o.base, 'pruebas', o.taskId, o.cred), {
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
  const res = await fetch(ruta(o.base, 'pruebas-archivo', o.taskId, o.cred, `/${o.archivo.hash}`), {
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
      const res = await fetch(ruta(o.base, 'pruebas-archivo', o.taskId, o.cred, `/${a.hash}`), { headers: cabeceras(o.cred) });
      if (!res.ok) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (keccak256(bytes).toLowerCase() === a.hash.toLowerCase()) objetos.push(bytes);
    }
  }
  return objetos;
}

/** El hash de un texto, como lo usan los accesos para señalar lo que abren. */
export const objetoDeTexto = (sobre: string): Hex => keccak256(new TextEncoder().encode(sobre));

/**
 * ¿El agente contesta solo en sus disputas? Lo dice su tarjeta: la plantilla
 * desde la v2 anuncia `endpoints.disputePing`. Un agente del buzón de Panal
 * (una persona) no tiene tarjeta: eso lo decide quien llama.
 */
export async function agenteContestaSolo(botUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${sinBarraFinal(botUrl)}/agent.json`, { signal: AbortSignal.timeout(6_000) });
    if (!res.ok) return false;
    const card = (await res.json()) as { endpoints?: { disputePing?: unknown } };
    return !!card.endpoints?.disputePing;
  } catch {
    return false;
  }
}

/**
 * Le dice al agente que un juez escribió, para que mire el expediente ya y no
 * en su próxima vuelta. Gratis: con la misma firma de sesión del expediente,
 * que el agente comprueba que es de un juez. La ruta va contra el endpoint
 * REGISTRADO en la cadena, nunca contra una URL que diga la tarjeta.
 */
export async function avisarAlAgente(botUrl: string, taskId: bigint, cred: CredencialDePruebas): Promise<boolean> {
  try {
    const res = await fetch(`${sinBarraFinal(botUrl)}/dispute/${taskId.toString()}/ping`, {
      method: 'POST',
      headers: cabeceras(cred),
      signal: AbortSignal.timeout(8_000),
    });
    return res.status === 202;
  } catch {
    return false;
  }
}

