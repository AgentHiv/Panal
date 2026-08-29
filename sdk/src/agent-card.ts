/**
 * La ficha que un agente sirve en `GET /agent.json`.
 *
 * POR QUÉ ESTE ARCHIVO EXISTE
 *
 * Había dos formatos. El bot colocaba el cobro por llamada en
 * `endpoints.x402Ask`; la plantilla lo ponía en la raíz, como `x402Ask`. Los
 * dos servían la misma información y ningún lector veía las dos, porque cada
 * uno parseaba con un tipo escrito a mano allí donde hacía falta.
 *
 * No fue un descuido de nadie: el tipo `AgentJson` vivía dentro del bot, así
 * que la plantilla —que no depende del bot— no tenía de dónde copiarlo y
 * escribió su propio objeto. Dos implementaciones honestas de una idea que
 * nunca se escribió en un sitio común divergen solas.
 *
 * Aquí está esa idea, en el paquete del que ya dependen la plantilla y el MCP.
 * Quien sirva una ficha, que la sirva con esta forma; quien la lea, que la lea
 * con `leerX402` y `leerMaxBriefChars`, que entienden también la forma vieja.
 *
 * COMPATIBILIDAD
 *
 * Hay agentes desplegados sirviendo el formato antiguo, y no se les puede
 * pedir que se actualicen para seguir siendo contratables. Los lectores
 * aceptan las dos formas y lo seguirán haciendo: quien escribe se moderniza,
 * quien lee perdona. Es la misma regla que ya seguía `agentAddress`.
 */

import type { Address } from 'viem';

/** Cobro por llamada (x402), tal y como lo anuncia un agente. */
export interface FichaX402 {
  method?: 'POST';
  /** Ruta relativa. `url` gana si están las dos. */
  path?: string;
  url?: string;
  scheme?: string;
  /** Token ERC-20 en el que cobra. */
  asset?: Address;
  assetSymbol?: string;
  /** Precio por llamada, en wei del token, como cadena decimal. */
  amount?: string;
  payTo?: Address;
  howTo?: string;
}

/** Cómo mandarle el encargo a un agente, y cuánto texto acepta. */
export interface FichaPostBrief {
  method?: 'POST';
  path?: string;
  signMessage?: string;
  body?: string;
  /**
   * Tope de caracteres del encargo.
   *
   * Publicarlo es lo que evita que un cliente bloquee el pago con un encargo
   * que el agente va a rechazar. Ausente significa NO LO DICE, que no es lo
   * mismo que «no hay tope»: tratarlo como ilimitado es volver a averiguarlo
   * pagando.
   */
  maxBriefChars?: number;
}

/** Cómo descargar el resultado ya entregado. */
export interface FichaGetResult {
  method?: 'GET';
  path?: string;
  signMessage?: string;
}

/**
 * La ficha completa. Casi todo es opcional a propósito: los dos motores tienen
 * capacidades distintas —el de la plantilla no lee el registry al servirla, y
 * el del bot sí— y un esquema que obligue a rellenar lo que no se sabe termina
 * rellenándose con mentiras.
 */
/**
 * Un nivel de servicio: cuánto cobra y cuánto acepta a cambio.
 *
 * El registro guarda UN `pricePerTask` por agente y no va a guardar más, así
 * que este es el único sitio donde un agente puede anunciar que hace el mismo
 * trabajo en varios tamaños. Lo publica quien lo va a cumplir, que es la
 * diferencia entre un nivel y un multiplicador inventado por el escaparate.
 *
 * Los topes se declaran EN CARACTERES a propósito. Son lo que el cliente puede
 * contar antes de pagar y lo que cualquiera puede recontar después, porque el
 * encargo se ancla en la cadena y el tamaño de cada adjunto viaja dentro de su
 * manifiesto. Un nivel que prometiera «más esfuerzo» no se podría comprobar.
 */
export interface FichaNivel {
  /** Nombre corto para enseñar. El cliente elige por aquí. */
  name?: string;
  /** Una línea de qué compra. */
  description?: string;
  /**
   * Lo que hay que bloquear para tener este nivel, en unidades mínimas de la
   * moneda del agente y como cadena decimal, igual que `price.amountWei`.
   */
  amountWei?: string;
  /** Tope de caracteres del encargo en este nivel. */
  maxBriefChars?: number;
  /** Tope de caracteres que aporta CADA adjunto. */
  maxAttachChars?: number;
  /** Y el de todos los adjuntos juntos. */
  maxAttachCharsTotal?: number;
}

export interface AgentCard {
  /** La dirección on-chain que este dominio declara suya. Es lo que verifica. */
  agent?: Address;
  /** Alias antiguo de `agent`. Se sigue leyendo; no lo escribas en fichas nuevas. */
  agentAddress?: Address;
  protocol?: 'panal';
  network?: string;
  chainId?: number;
  name?: string;
  description?: string;
  /**
   * El idioma en el que va este `description` y estos `tiers`, si se pidió con
   * `?lang=` y el agente pudo traducirlos.
   *
   * AUSENTE NO ES «está en inglés»: es que va en el idioma en que su dueño lo
   * escribió, aunque hayas pedido otro. Hay que mirarlo antes de guardar una
   * ficha como si fuera una traducción, porque la traducción se encarga por
   * detrás: pedirla antes de que esté lista devuelve la ficha original con un
   * 200 impecable. Un indexador que no lo mirara guardaría el texto original
   * como las diez traducciones y no volvería a por ellas nunca.
   */
  lang?: string;
  skills?: string[];
  price?: { amountWei?: string; currency?: Address; symbol?: string } | null;
  /**
   * Los niveles que ofrece, de menor a mayor. Opcional y casi siempre ausente.
   *
   * AUSENTE NO ES «tiene un nivel»: es que este agente no los ofrece, y hay
   * que tratarlo exactamente como se le trataba antes de que esto existiera.
   * Quien lee no debe inventarle niveles a partir de `price`, que es
   * justamente lo que hacía el escaparate y por lo que enseñaba precios que
   * luego no se cobraban.
   */
  tiers?: FichaNivel[];
  active?: boolean | null;
  contracts?: { escrow?: Address; registry?: Address; token?: Address };
  endpoints?: {
    base?: string | null;
    postBrief?: FichaPostBrief;
    getResult?: FichaGetResult;
    x402Ask?: FichaX402;
    indexer?: string | null;
  };
  /** Alias ANTIGUO de `endpoints.x402Ask`. Se lee; no se escribe. */
  x402Ask?: FichaX402;
  howToHire?: string[];
}

/** La dirección que la ficha declara suya, mirando también el alias viejo. */
export function leerDireccion(card: unknown): string | null {
  const c = card as AgentCard | null;
  const dir = typeof c?.agent === 'string' ? c.agent : typeof c?.agentAddress === 'string' ? c.agentAddress : '';
  return dir || null;
}

/**
 * El bloque de cobro por llamada, venga en el sitio nuevo o en el viejo.
 *
 * El sitio canónico gana si están los dos: un agente que sirva ambos está en
 * mitad de una migración, y el nuevo es el que va a seguir manteniendo.
 */
export function leerX402(card: unknown): FichaX402 | null {
  const c = card as AgentCard | null;
  return c?.endpoints?.x402Ask ?? c?.x402Ask ?? null;
}

/**
 * El tope de caracteres del encargo, o `null` si la ficha no lo dice.
 *
 * `null` es NO LO SÉ y hay que tratarlo así. La ficha la sirve un desconocido,
 * así que solo cuenta un entero positivo: un 0 o un negativo harían imposible
 * cualquier encargo, y eso lo decide el agente bajando su tope, no mandando
 * basura en un campo.
 */
export function leerMaxBriefChars(card: unknown): number | null {
  const max = (card as AgentCard | null)?.endpoints?.postBrief?.maxBriefChars;
  return typeof max === 'number' && Number.isInteger(max) && max > 0 ? max : null;
}

/** Un nivel ya validado: precio en bigint y `null` en todo lo que la ficha no diga. */
export interface Nivel {
  name: string | null;
  description: string | null;
  /** Lo que hay que bloquear, en unidades mínimas de la moneda del agente. */
  wei: bigint;
  maxBriefChars: number | null;
  maxAttachChars: number | null;
  maxAttachCharsTotal: number | null;
}

/** Tope de niveles que se leen de una ficha ajena. Ocho ya son demasiados para elegir. */
const MAX_NIVELES = 8;

/**
 * Cuántas entradas se miran para sacar esos ocho.
 *
 * El recorte va DESPUÉS de filtrar, no antes: recortando primero, un nivel
 * bueno colocado detrás de ocho mal escritos desaparecía sin que nadie lo
 * notara. Y aun así se mira un número fijo, porque la lista la escribe un
 * desconocido y nadie tiene ocho niveles buenos detrás de doscientos malos.
 */
const MAX_MIRADOS = 200;

/** Un entero positivo, o `null`. Misma regla que `leerMaxBriefChars`. */
function tope(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null;
}

/** Texto de una ficha ajena: recortado, porque va a un escaparate. */
function letrero(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const limpio = v.replace(/\s+/g, ' ').trim().slice(0, max);
  return limpio || null;
}

/**
 * Los niveles que ofrece un agente, de menor a mayor precio.
 *
 * Devuelve `[]` cuando la ficha no los declara, y eso significa que el agente
 * NO ofrece niveles: quien llama tiene que seguir tratándolo como siempre, no
 * fabricarle uno a partir de `price`.
 *
 * La ficha la sirve un desconocido, así que un nivel sin precio legible se cae
 * de la lista en vez de tumbarla entera: un campo mal escrito no puede dejar
 * incontratable a un agente que sí tiene otros niveles buenos.
 */
export function leerNiveles(card: unknown): Nivel[] {
  const crudos = (card as AgentCard | null)?.tiers;
  if (!Array.isArray(crudos)) return [];

  const out: Nivel[] = [];
  for (const n of crudos.slice(0, MAX_MIRADOS)) {
    if (out.length >= MAX_NIVELES) break;
    if (!n || typeof n !== 'object') continue;
    const wei = enteroWei((n as FichaNivel).amountWei);
    if (wei === null) continue;
    out.push({
      name: letrero((n as FichaNivel).name, 60),
      description: letrero((n as FichaNivel).description, 200),
      wei,
      maxBriefChars: tope((n as FichaNivel).maxBriefChars),
      maxAttachChars: tope((n as FichaNivel).maxAttachChars),
      maxAttachCharsTotal: tope((n as FichaNivel).maxAttachCharsTotal),
    });
  }
  // De menor a mayor: es el orden en que se enseñan y el que hace que
  // `nivelPara` pueda quedarse con el último que entra en lo pagado.
  return out.sort((a, b) => (a.wei < b.wei ? -1 : a.wei > b.wei ? 1 : 0));
}

/** `amountWei` como bigint. Solo dígitos: `BigInt('0x10')` valdría 16 y no es eso. */
function enteroWei(v: unknown): bigint | null {
  if (typeof v !== 'string' || !/^\d+$/.test(v.trim())) return null;
  const n = BigInt(v.trim());
  return n > 0n ? n : null;
}

/**
 * Qué nivel compró quien bloqueó `pagado`.
 *
 * EL NIVEL LO DECIDE LA CADENA, NO EL ENCARGO. El brief lo escribe el cliente
 * y podría afirmar que compró el más caro; el importe bloqueado no se puede
 * discutir. Por eso esta función toma un `bigint` del escrow y nada más.
 *
 * Se queda con el nivel más alto que quepa en lo pagado. Pagar de más da el
 * nivel pagado, no el siguiente: quien bloquea 10 veces el precio del mayor
 * sigue comprando el mayor, y el resto es cosa del agente y su cliente.
 *
 * `null` significa que lo bloqueado no llega ni al nivel más barato. Qué hacer
 * entonces —trabajar igual, devolver, no empezar— lo decide el agente; el SDK
 * no lo va a decidir por él.
 */
export function nivelPara(niveles: Nivel[], pagado: bigint): Nivel | null {
  let elegido: Nivel | null = null;
  for (const n of niveles) {
    if (n.wei <= pagado) elegido = n;
  }
  return elegido;
}
