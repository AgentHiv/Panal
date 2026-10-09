/**
 * Panal — hablar con un agente y pagarle por mensaje.
 *
 * Un chat con un agente NO es un encargo del escrow. Un encargo bloquea el
 * pago, tiene plazo, se entrega una vez y admite disputa: eso es contratar a
 * alguien. Una conversación es otra cosa, y por eso va por **x402**:
 *
 *   1. Se pregunta el precio sin pagar. El agente responde 402 con su
 *      cotización. Es gratis y no compromete a nada — se puede preguntar a
 *      varios antes de decidir.
 *   2. Se firma un permiso EIP-2612 y se repite la llamada. El agente cobra,
 *      trabaja y responde en la MISMA llamada.
 *
 * Lo que esto compra frente al escrow: sin gas para el cliente, sin esperar
 * bloques y sin botón de aprobar. Una firma y ya.
 *
 * Lo que NO compra, y conviene decirlo en la interfaz: una conversación no
 * deja constancia del contenido en la cadena —sólo del pago—, así que no hay
 * entrega verificable ni derecho a disputa. Para eso está el encargo.
 *
 * Las comprobaciones que protegen el dinero viven en el SDK (`payAndAsk`) y
 * ocurren TODAS antes de firmar: importe, tope, cadena, a quién se paga, qué
 * token, el dominio EIP-712 y la caducidad. Aquí no se reimplementa ninguna
 * —una firma de permit es una autorización para llevarse tu saldo, y validarla
 * en dos sitios es garantizar que un día se validen distinto.
 */

import { payAndAsk, quoteAsk, x402Currency, X402Error, type X402Accept, type X402Currency } from '@panal/sdk';
import { isAddress, isAddressEqual } from 'viem';
import type { Account, Address, WalletClient } from 'viem';

/** Lo que el agente publica en su tarjeta sobre el cobro por llamada. */
export interface CobroPorLlamada {
  /** URL absoluta a la que se pregunta. */
  endpoint: string;
  /** Importe por mensaje, en unidades mínimas. */
  amount: bigint;
  /** El token en el que cobra. */
  asset: Address;
  /**
   * Cómo llamarlo en la interfaz: `$PANAL`, `GHO`, `USDC`, `AUSD`. Sale de la
   * lista de Panal, NUNCA de la tarjeta: la tarjeta la escribe el agente, y
   * con un nombre y unos decimales a su gusto 1.000 USDC se pintaban
   * «0,000000001 $PANAL».
   */
  simbolo: string;
  /** Sus decimales, de la misma lista: 18 en $PANAL y GHO, 6 en USDC y AUSD. */
  decimales: number;
  moneda: X402Currency;
  /** Quién cobra. Se compara con la cotización antes de firmar. */
  payTo: Address;
}

/**
 * Lee de la tarjeta del agente si cobra por llamada y cuánto.
 *
 * Devuelve `null` cuando no lo hace: hay agentes que sólo aceptan encargos del
 * escrow, y para esos no se puede abrir un chat. Falla cerrado por lo mismo
 * que `leerCapacidades`: ofrecer un chat que no se puede pagar es peor que no
 * ofrecerlo.
 */
export async function leerCobroPorLlamada(
  botUrl: string,
  /**
   * La dirección del agente EN LA CADENA. Quien cobra tiene que ser él: la
   * tarjeta la sirve su servidor, y quien tomara ese servidor podía poner su
   * propia wallet en `payTo` y cobrar en nombre —y con la reputación— de otro.
   */
  agente: Address,
  timeoutMs = 6_000,
): Promise<CobroPorLlamada | null> {
  try {
    const res = await fetch(`${botUrl.replace(/\/+$/, '')}/agent.json`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const card = (await res.json()) as {
      endpoints?: {
        x402Ask?: { url?: string; path?: string; asset?: string; assetSymbol?: string; amount?: string; payTo?: string };
      };
    };
    const x = card.endpoints?.x402Ask;
    if (!x?.amount || !x.asset || !x.payTo) return null;

    // La URL absoluta que publica el agente, y si no la trae, su ruta contra
    // el endpoint que tiene REGISTRADO en la cadena. Nunca contra otra cosa:
    // así una tarjeta manipulada no puede mandar el pago a un tercero.
    const endpoint = x.url ?? (x.path ? `${botUrl.replace(/\/+$/, '')}${x.path}` : null);
    if (!endpoint) return null;

    const amount = BigInt(x.amount);
    if (amount <= 0n) return null;

    // Solo en una moneda que Panal acepta. Un token que no está en la lista no
    // se ofrece: no hay forma honrada de enseñar su precio.
    const moneda = x402Currency(x.asset);
    if (!moneda) return null;

    // Se cobra a la dirección del agente registrado o no se ofrece el chat.
    if (!isAddress(x.payTo) || !isAddressEqual(x.payTo, agente)) return null;

    return {
      endpoint,
      amount,
      asset: moneda.address,
      simbolo: moneda.symbol,
      decimales: moneda.decimals,
      moneda,
      payTo: x.payTo as Address,
    };
  } catch {
    return null;
  }
}

/**
 * El precio de este mensaje, sin pagar nada.
 *
 * Se pide ANTES de enseñar la hoja de firma para que el número que ve la
 * persona sea el que va a firmar, y no el que decía la tarjeta hace una hora.
 * Un agente puede subir su precio entre una cosa y la otra.
 */
export async function cotizar(
  cobro: CobroPorLlamada,
  mensaje: string,
  pagador: Address,
): Promise<X402Accept> {
  return quoteAsk(cobro.endpoint, mensaje, { payer: pagador, timeoutMs: 20_000 });
}

export interface EnviarOpciones {
  cobro: CobroPorLlamada;
  mensaje: string;
  wallet: WalletClient;
  account: Account;
  /**
   * Lo máximo que se autoriza en este mensaje.
   *
   * Es un tope del CLIENTE, no del agente: si la cotización pide más, el SDK
   * no firma. Sin él, un agente que sube su precio entre la cotización y la
   * firma cobraría lo que quisiera.
   */
  topeMaximo: bigint;
  /** La cotización ya pedida, para no volver a pedirla y arriesgar otro precio. */
  cotizacion?: X402Accept;
  /**
   * La cadena en la que se paga.
   *
   * Va como parámetro y no leyendo la configuración de la web a propósito:
   * este archivo decide sobre dinero y tiene que poder probarse fuera de un
   * navegador. En cuanto importaba `@/contracts/config` dejaba de arrancar en
   * Node, porque esa configuración vive de `import.meta.env`.
   */
  chainId: number;
}

export interface Respuesta {
  texto: string;
  /** Lo que se ha pagado de verdad, en unidades mínimas. */
  pagado: bigint;
  /** La transacción del cobro, si el agente la reporta. */
  txHash?: string;
}

/**
 * Manda el mensaje, paga y devuelve la respuesta.
 *
 * `expectedPayee` y `asset` van puestos a lo que dijo la TARJETA del agente,
 * no a lo que diga la cotización: es lo que convierte las comprobaciones del
 * SDK en algo útil. Comparar la cotización consigo misma no protege de nada.
 */
export async function enviarMensaje(opciones: EnviarOpciones): Promise<Respuesta> {
  const { cobro, mensaje, wallet, account, topeMaximo, cotizacion, chainId } = opciones;

  const res = await payAndAsk(wallet, account, cobro.endpoint, mensaje, {
    maxSpend: topeMaximo,
    chainId,
    expectedPayee: cobro.payTo,
    asset: cobro.asset,
    ...(cotizacion ? { quote: cotizacion } : {}),
    timeoutMs: 120_000,
  });

  return {
    texto: res.answer,
    pagado: res.paid,
    ...(res.txHash ? { txHash: res.txHash } : {}),
  };
}

/**
 * Traduce un fallo de x402 a algo que una persona pueda leer.
 *
 * El mensaje crudo del SDK está escrito para quien programa un agente. Aquí
 * lo lee alguien que acaba de perder un mensaje y quiere saber si le han
 * cobrado —que es siempre la primera pregunta.
 */
export function motivoLegible(err: unknown): string {
  if (err instanceof X402Error) return err.message;
  const msg = err instanceof Error ? err.message : String(err);
  if (/user rejected|rechaz/i.test(msg)) return 'Has cancelado la firma. No se ha cobrado nada.';
  if (/fetch|network|failed to fetch/i.test(msg)) {
    return 'No se pudo hablar con el agente. Si no llegó a responder, no se ha cobrado nada.';
  }
  return msg;
}
