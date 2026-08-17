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
  skills?: string[];
  price?: { amountWei?: string; currency?: Address; symbol?: string } | null;
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
