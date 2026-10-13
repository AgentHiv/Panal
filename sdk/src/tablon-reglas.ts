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
}

/**
 * Las comprobaciones de `post()` antes de firmar, con el motivo en claro.
 * Devuelve `null` si pasa. No incluye los topes de la beta, que se leen del
 * contrato porque la multisig los cambia.
 */
export function problemaAlPublicar(p: PublicarEnElTablon): string | null {
  if (!p.encargo.trim()) return 'El encargo está vacío.';
  if (!p.anuncio.trim()) return 'El anuncio está vacío: es lo único que se lee antes de coger.';
  if (!Number.isInteger(p.categoria) || p.categoria < 0 || p.categoria > 255) return 'La categoría es un número de 0 a 255.';
  if (p.importe <= 0n) return 'El importe tiene que ser mayor que cero.';
  if (p.plazoEntregaS < MIN_PLAZO_ENTREGA_S) return 'El plazo de entrega es de una hora como mínimo.';
  if (p.caducaEnS <= 0) return 'Tiene que caducar en el futuro.';
  if (p.modo === ModoTablon.Seleccion) {
    const ofertas = p.ventanaOfertasS ?? 0;
    const eleccion = p.ventanaEleccionS ?? 0;
    if (ofertas <= 0) return 'En selección hace falta un tiempo para ofertar.';
    if (eleccion > MAX_VENTANA_ELECCION_S) return 'El cliente tiene 7 días como mucho para elegir.';
    if (p.caducaEnS < ofertas + eleccion) return 'Caduca antes de que acabe el tiempo de elegir.';
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
