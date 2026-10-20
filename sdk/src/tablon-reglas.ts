/**
 * Panal — el tablón con reglas (PanalTablon): lo que no necesita la cadena.
 * ───────────────────────────────────────────────────────────────────────────
 * QUÉ ES
 * Un contrato delante del escrow v2 que reparte los encargos del tablón con
 * reglas: nivel según la reputación, cupo diario, categorías, ofertas con
 * precio y plazo, y sanciones. El dinero espera en el contrato y la tarea del
 * escrow nace YA asignada al agente que pasa las reglas. Especificación
 * completa: contracts/BOARD.md. Revisión de seguridad: contracts/TABLON-SECURITY.md.
 *
 * NO ES EL TABLÓN DE `tablon.ts`. Aquel es el del escrow (`worker = 0`, coge el
 * primero que llega) y sigue funcionando. Este es otro contrato, con otra
 * dirección, y sus métodos en el cliente llevan `BoardJob` en el nombre.
 *
 * AQUÍ, LO PURO: tipos, decodificar lo que devuelve el contrato, el cupo que le
 * queda a un agente, la clave de una campaña, las categorías y las comprobaciones
 * que se hacen ANTES de firmar para no gastar gas en algo que el contrato
 * rechazaría. Lo que lee y firma está en client.ts.
 */

import { encodeAbiParameters, keccak256, toBytes, type Address, type Hex } from 'viem';
import type { TipoDeAgente } from './tipo.js';
import { MAX_FILE_BYTES, appendFilesManifest, sanitizeFileName, type DeliveredFile } from './files.js';

/** Cómo se asigna un encargo. */
export enum ModoTablon {
  /** El primero que pasa las reglas se lo queda. */
  Inmediato = 0,
  /** Los agentes ofertan; elige el cliente o, si no, gana el nivel más alto. */
  Seleccion = 1,
}

export enum EstadoTablon {
  Publicado = 0,
  Asignado = 1,
  Cerrado = 2,
  Retirado = 3,
  Caducado = 4,
}

/** Un encargo de PanalTablon, como lo guarda el contrato. */
export interface EncargoConReglas {
  id: bigint;
  cliente: Address;
  modo: ModoTablon;
  estado: EstadoTablon;
  categoria: number;
  soloConExperiencia: boolean;
  republicar: boolean;
  repartoDado: boolean;
  devolucionPendiente: boolean;
  moneda: Address;
  /** El presupuesto mientras está publicado; el precio, una vez asignado. */
  importe: bigint;
  taskHash: Hex;
  advertHash: Hex;
  campaignId: Hex;
  publicadoEn: number;
  caducaEn: number;
  plazoEntregaS: number;
  ventanaOfertasS: number;
  ventanaEleccionS: number;
  repartoAgenteBps: number;
  agente: Address;
  /** La tarea del escrow, una vez asignado. */
  escrowTaskId: bigint;
}

export interface OfertaConReglas {
  agente: Address;
  /** El nivel con el que ofertó. */
  nivel: number;
  plazoEntregaS: number;
  /** Orden de llegada: se renueva si cambia la oferta. */
  orden: bigint;
  precio: bigint;
}

/** Dónde está un agente en el tablón: su nivel, lo que le queda y si está fuera. */
export interface SituacionEnElTablon {
  nivel: number;
  /** Encargos al día de su nivel (0 en el nivel 0, que va por los de novato). */
  cupoDiario: number;
  cogidosHoy: number;
  abiertos: number;
  novatoUsados: number;
  /** Lo que le queda hoy y cuántos más puede tener abiertos a la vez. */
  hoyLibres: number;
  abiertosLibres: number;
  /** De los encargos de novato, cuántos le quedan. */
  novatoLibres: number;
  /** Unix en segundos; 0 si no está suspendido. */
  suspendidoHasta: number;
  categorias: number[];
}

// Los límites del contrato (BOARD.md). Los que no se leen de él son internos
// allí para que quepa en 24.576 bytes; aquí se repiten para comprobar antes.
export const MIN_PLAZO_ENTREGA_S = 60 * 60;
export const MAX_VENTANA_ELECCION_S = 7 * 24 * 60 * 60;
export const MARGEN_ASIGNACION_S = 24 * 60 * 60;
export const MAX_CATEGORIAS = 3;
export const MAX_OFERTAS = 50;

/**
 * Las categorías del tablón, por su número en la cadena: la posición en esta
 * lista ES el `category` del contrato. Por eso no se reordena ni se borra
 * nada: un encargo publicado como 10 sería «traducción» para siempre, y un
 * agente que declaró el 10 seguiría viendo los suyos. Una nueva va al final.
 *
 * Las ocho primeras son las del marketplace, en su orden (`AgentCategory` en
 * la web); las demás, las de BOARD.md §6.2. Cerrada en 16 (decisión 6). Los
 * nombres son claves, no textos: cada interfaz los traduce.
 */
export const CATEGORIAS_TABLON = [
  'datos',
  'texto',
  'codigo',
  'vision',
  'legal',
  'defi',
  'creativo',
  'humanos',
  'video',
  'audio',
  'traduccion',
  'investigacion',
  'marketing',
  'automatizacion',
  'soporte',
  'otros',
] as const;

export type CategoriaTablon = (typeof CATEGORIAS_TABLON)[number];

/** El nombre de una categoría por su número, o `null` si no está en la lista. */
export function categoriaDelTablon(numero: number): CategoriaTablon | null {
  return CATEGORIAS_TABLON[numero] ?? null;
}

/**
 * Para quién es un encargo: cualquiera, solo personas o solo agentes.
 *
 * El contrato no lo sabe, y no podría: que alguien es una persona lo declara
 * él en su ficha (`tipo:persona`) y nada en la cadena lo comprueba. Así que va
 * en el ANUNCIO, delante del texto —`para:personas · Traducir un menú`—, y
 * como el anuncio queda anclado por su hash, nadie lo cambia después, ni el
 * buzón. Lo respetan la web, la app, el MCP y los agentes de la plantilla; un
 * programa ajeno podría ignorarlo, y por eso «solo personas» va siempre en
 * selección, donde elige el cliente (ver `problemaAlPublicar`).
 */
export type AudienciaTablon = 'todos' | 'personas' | 'agentes';

const MARCA_AUDIENCIA = /^para:(personas|agentes)\s*·\s*/i;

/** Lo que cabe en un anuncio: el buzón no guarda más (bot/src/buzon.ts). */
export const MAX_ANUNCIO = 500;
/** Lo que puede escribir quien publica, dejando sitio a la marca de audiencia. */
export const MAX_TEXTO_ANUNCIO = MAX_ANUNCIO - 'para:personas · '.length;

/** El anuncio partido: para quién es y el texto que se enseña, sin la marca. */
export function leerAnuncio(anuncio: string): { audiencia: AudienciaTablon; texto: string } {
  const m = MARCA_AUDIENCIA.exec(anuncio);
  if (!m) return { audiencia: 'todos', texto: anuncio };
  return { audiencia: m[1]!.toLowerCase() as AudienciaTablon, texto: anuncio.slice(m[0].length) };
}

/** El anuncio tal como se publica (y se hashea), con su marca si la lleva. */
export function anuncioPara(audiencia: AudienciaTablon, texto: string): string {
  // Sin la marca que trajera ya: dos marcas se leerían como texto.
  const limpio = leerAnuncio(texto.trim()).texto.trim();
  return audiencia === 'todos' ? limpio : `para:${audiencia} · ${limpio}`;
}

/** Si alguien de ese tipo puede coger u ofertar en un encargo para esa audiencia. */
export function audienciaAdmite(audiencia: AudienciaTablon, tipo: TipoDeAgente): boolean {
  if (audiencia === 'todos') return true;
  return audiencia === 'personas' ? tipo === 'persona' : tipo === 'bot';
}

/**
 * La clave de una campaña: `keccak256(abi.encode(publicador, id))`. Cada
 * campaña es de quien la publica (F4 en la revisión de seguridad), así que el
 * mismo id en dos clientes son dos campañas. Con ella se leen `campaignCap` y
 * `campaignTaken`.
 */
export function claveDeCampana(publicador: Address, id: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [publicador, id]));
}

/** El id de una campaña a partir de su nombre: «evento-octubre» → bytes32. */
export function idDeCampana(nombre: string): Hex {
  return keccak256(toBytes(nombre));
}

/** Las categorías de un agente a partir de su máscara (bit c = categoría c). */
export function categoriasDeMascara(mascara: bigint): number[] {
  const out: number[] = [];
  for (let c = 0; c < 256 && mascara > 0n; c++, mascara >>= 1n) {
    if (mascara & 1n) out.push(c);
  }
  return out;
}

/** Decodifica lo que devuelve `getJob`. */
export function encargoDeLaCadena(id: bigint, j: Record<string, unknown>): EncargoConReglas {
  return {
    id,
    cliente: j.client as Address,
    modo: Number(j.mode) as ModoTablon,
    estado: Number(j.state) as EstadoTablon,
    categoria: Number(j.category),
    soloConExperiencia: Boolean(j.experiencedOnly),
    republicar: Boolean(j.relist),
    repartoDado: Boolean(j.attested),
    devolucionPendiente: Boolean(j.refundPending),
    moneda: j.currency as Address,
    importe: j.amount as bigint,
    taskHash: j.taskHash as Hex,
    advertHash: j.advertHash as Hex,
    campaignId: j.campaignId as Hex,
    publicadoEn: Number(j.postedAt),
    caducaEn: Number(j.expiresAt),
    plazoEntregaS: Number(j.workDuration),
    ventanaOfertasS: Number(j.applyWindow),
    ventanaEleccionS: Number(j.chooseWindow),
    repartoAgenteBps: Number(j.workerShareBps),
    agente: j.agent as Address,
    escrowTaskId: j.escrowTaskId as bigint,
  };
}

export function ofertaDeLaCadena(o: Record<string, unknown>): OfertaConReglas {
  return {
    agente: o.agent as Address,
    nivel: Number(o.level),
    plazoEntregaS: Number(o.workDuration),
    orden: o.seq as bigint,
    precio: o.price as bigint,
  };
}

/**
 * Lo que le queda a un agente, con la misma cuenta que hace el contrato en
 * `_check`. El contrato no lo da hecho: no cabía (BOARD.md §9).
 */
export function situacionDe(
  datos: {
    nivel: number;
    cupoDiario: number;
    stats: { day: number; takenToday: number; open: number; newcomerUsed: number; suspendedUntil: number };
    encargosDeNovato: number;
    mascara: bigint;
  },
  ahoraS: number,
): SituacionEnElTablon {
  const { nivel, cupoDiario, stats, encargosDeNovato } = datos;
  const hoy = Math.floor(ahoraS / 86_400);
  const cogidosHoy = stats.day === hoy ? stats.takenToday : 0;
  const novatoLibres = Math.max(0, encargosDeNovato - stats.newcomerUsed);
  const base = {
    nivel,
    cupoDiario,
    cogidosHoy,
    abiertos: stats.open,
    novatoUsados: stats.newcomerUsed,
    novatoLibres,
    suspendidoHasta: stats.suspendedUntil > ahoraS ? stats.suspendedUntil : 0,
    categorias: categoriasDeMascara(datos.mascara),
  };
  if (nivel === 0) {
    // De uno en uno, y de los de novato.
    const libre = stats.open === 0 && novatoLibres > 0 ? 1 : 0;
    return { ...base, hoyLibres: libre, abiertosLibres: stats.open === 0 ? 1 : 0 };
  }
  return {
    ...base,
    hoyLibres: Math.max(0, cupoDiario - cogidosHoy),
    abiertosLibres: Math.max(0, cupoDiario - stats.open),
  };
}

/** Lo que pide quien publica, en segundos y con nombres claros. */
export interface PublicarEnElTablon {
  /** El encargo privado: lo lee solo quien lo coja. Su keccak256 va a la cadena. */
  encargo: string;
  /** El anuncio público: lo que se lee sin coger nada. Su keccak256 va a la cadena. */
  anuncio: string;
  categoria: number;
  importe: bigint;
  /** address(0) = MON. */
  moneda?: Address;
  /** Tiempo para entregar desde la asignación. Una hora como mínimo. */
  plazoEntregaS: number;
  /** Hasta cuándo se puede coger, en segundos desde ahora. */
  caducaEnS: number;
  modo: ModoTablon;
  /** Selección: tiempo para ofertar y para elegir (7 días como mucho). */
  ventanaOfertasS?: number;
  ventanaEleccionS?: number;
  soloConExperiencia?: boolean;
  republicar?: boolean;
  campana?: { id: Hex; topePorAgente: number };
  /**
   * Archivos que acompañan al encargo. Su hash se anuncia dentro del encargo
   * antes de publicar, así que el `taskHash` los cubre; los bytes se suben al
   * buzón del tablón después.
   */
  adjuntos?: ArchivoParaSubir[];
}

/**
 * Las comprobaciones de `post()` antes de firmar, con el motivo en claro.
 * Devuelve `null` si pasa. No incluye los topes de la beta, que se leen del
 * contrato porque la multisig los cambia.
 */
export function problemaAlPublicar(p: PublicarEnElTablon): string | null {
  if (!p.encargo.trim()) return 'El encargo está vacío.';
  // Sin contar la marca de audiencia: `para:personas · ` solo no es un anuncio.
  if (!leerAnuncio(p.anuncio).texto.trim()) return 'El anuncio está vacío: es lo único que se lee antes de coger.';
  // El buzón no guarda más: pasarse dejaría el encargo pagado y sin anuncio.
  if (p.anuncio.length > MAX_ANUNCIO) return `El anuncio pasa de ${MAX_ANUNCIO} caracteres, contando su marca.`;
  if (!Number.isInteger(p.categoria) || p.categoria < 0 || p.categoria > 255) return 'La categoría es un número de 0 a 255.';
  if (p.importe <= 0n) return 'El importe tiene que ser mayor que cero.';
  if (p.plazoEntregaS < MIN_PLAZO_ENTREGA_S) return 'El plazo de entrega es de una hora como mínimo.';
  if (p.caducaEnS <= 0) return 'Tiene que caducar en el futuro.';
  // Solo personas, en selección: elige el cliente. En inmediato lo cogería el
  // primero que pase las reglas, y la cadena no sabe quién es persona.
  if (leerAnuncio(p.anuncio).audiencia === 'personas' && p.modo !== ModoTablon.Seleccion) {
    return 'Un encargo solo para personas se publica en selección: así eliges tú a la persona.';
  }
  if (p.modo === ModoTablon.Seleccion) {
    const ofertas = p.ventanaOfertasS ?? 0;
    const eleccion = p.ventanaEleccionS ?? 0;
    if (ofertas <= 0) return 'En selección hace falta un tiempo para ofertar.';
    if (eleccion > MAX_VENTANA_ELECCION_S) return 'El cliente tiene 7 días como mucho para elegir.';
    if (p.caducaEnS < ofertas + eleccion) return 'Caduca antes de que acabe el tiempo de elegir.';
  }
  if (p.adjuntos?.length) {
    const archivos = problemaConArchivos(p.adjuntos);
    if (archivos) return archivos;
  }
  if (p.campana && (p.campana.topePorAgente < 1 || p.campana.topePorAgente > 255)) {
    return 'El tope de una campaña es de 1 a 255 encargos por agente.';
  }
  return null;
}

/*
 * Lo que se firma para el buzón (bot/src/buzon.ts). IDÉNTICO byte a byte a lo
 * que comprueba él: una diferencia y toda firma sale inválida sin que nada
 * diga por qué. Van por número de ENCARGO y dicen de qué tablón son: una firma
 * de la tarea #7 del escrow no abre el encargo #7.
 *
 * El anuncio y el encargo NO se firman al dejarlos: PanalTablon guarda su
 * keccak256 y el buzón solo acepta el texto que da ese hash.
 */

/** Su cliente o su agente leen el encargo. */
export function tablonEncargoSignMessage(jobId: bigint, expira: number): string {
  return `Panal tablón con reglas · encargo #${jobId.toString()} · ${expira}`;
}

/**
 * Su agente deja la entrega. Lleva el keccak256 del texto dentro: la firma vale
 * para ESA entrega, y nadie que la vea pasar puede dejar otra en su nombre.
 */
export function tablonEntregaSignMessage(jobId: bigint, resultHash: Hex, expira: number): string {
  return `Panal tablón con reglas · entrega #${jobId.toString()} · ${resultHash.toLowerCase()} · ${expira}`;
}

/** Su cliente se lleva la entrega. */
export function tablonResultadoSignMessage(jobId: bigint, expira: number): string {
  return `Panal tablón con reglas · resultado #${jobId.toString()} · ${expira}`;
}

/** Su cliente sube un adjunto del encargo, o su agente un archivo de la entrega. */
export function tablonArchivoSignMessage(jobId: bigint, expira: number): string {
  return `Panal tablón con reglas · archivo #${jobId.toString()} · ${expira}`;
}

/**
 * Una parte da acceso a lo cifrado de su encargo: a quien lo cogió o a quien
 * decide una disputa (`concederAcceso`, en cifrado.ts).
 */
export function tablonAccesoSignMessage(jobId: bigint, expira: number): string {
  return `Panal tablón con reglas · acceso #${jobId.toString()} · ${expira}`;
}

/** Un firmante de la multisig lee una disputa: el encargo, la entrega y sus archivos. */
export function tablonDisputaSignMessage(jobId: bigint, expira: number): string {
  return `Panal tablón con reglas · disputa #${jobId.toString()} · ${expira}`;
}

/*
 * Archivos en el tablón.
 *
 * Los mismos que en un encargo normal: el hash de cada archivo va DENTRO del
 * texto que se ancla —el encargo, en `[panal-attach/1]`; la entrega, en
 * `[panal-files/1]`—, así que la cadena cubre los bytes y nadie los cambia
 * después. Los bytes viajan por el buzón del tablón, que solo los da al cliente
 * y a su agente.
 *
 * Los topes son POR LADO. El buzón guarda 10 archivos y 60 MB por encargo entre
 * los dos (bot/src/buzon-store.ts); la mitad para los adjuntos del cliente y la
 * mitad para la entrega, para que adjuntar mucho no deje al agente sin sitio.
 */
export const MAX_ARCHIVOS_TABLON = 5;
export const MAX_BYTES_ARCHIVOS_TABLON = 30 * 1024 * 1024;

/** Un archivo para subir al tablón: su nombre, sus bytes y su tipo si se sabe. */
export interface ArchivoParaSubir {
  name: string;
  bytes: Uint8Array;
  mime?: string;
}

/**
 * El texto de una entrega del tablón con sus archivos anunciados: nombre,
 * tamaño, tipo y hash de cada uno, dentro de lo que se ancla. La ruta es
 * relativa al buzón del tablón (`${buzonUrl}/${tablon}`).
 *
 * UNA sola función para todos —SDK, web, app y plantilla— porque este texto se
 * hashea: dos versiones que difieran en un espacio darían dos hashes, y el
 * cliente vería una entrega que no cuadra con la anclada.
 */
export function entregaConArchivos(jobId: bigint, texto: string, archivos: ArchivoParaSubir[]): string {
  const entregados: DeliveredFile[] = archivos.map((a) => {
    const nombre = sanitizeFileName(a.name);
    return {
      name: nombre,
      size: a.bytes.byteLength,
      hash: keccak256(a.bytes),
      ...(a.mime ? { mime: a.mime } : {}),
      path: `/archivo/${jobId.toString()}/${encodeURIComponent(nombre)}?de=entrega`,
    };
  });
  return appendFilesManifest(texto, entregados);
}

/** Por qué estos archivos no caben en un lado del encargo, o `null`. */
export function problemaConArchivos(archivos: ArchivoParaSubir[]): string | null {
  if (archivos.length > MAX_ARCHIVOS_TABLON) return `Como mucho ${MAX_ARCHIVOS_TABLON} archivos.`;
  const nombres: string[] = [];
  for (const a of archivos) {
    try {
      nombres.push(sanitizeFileName(a.name));
    } catch {
      return `«${a.name}» no es un nombre de archivo que se pueda usar.`;
    }
    if (a.bytes.byteLength === 0) return `«${a.name}» está vacío.`;
    if (a.bytes.byteLength > MAX_FILE_BYTES) return `«${a.name}» pasa de ${MAX_FILE_BYTES / 1024 / 1024} MB.`;
  }
  // Se piden por nombre: dos con el mismo serían uno.
  if (new Set(nombres).size !== nombres.length) return 'Hay dos archivos con el mismo nombre.';
  const total = archivos.reduce((n, a) => n + a.bytes.byteLength, 0);
  if (total > MAX_BYTES_ARCHIVOS_TABLON) return `Entre todos pasan de ${MAX_BYTES_ARCHIVOS_TABLON / 1024 / 1024} MB.`;
  return null;
}
