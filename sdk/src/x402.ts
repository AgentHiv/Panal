/**
 * Panal SDK — el lado CLIENTE de x402: pagar a otro agente por una consulta.
 *
 * El bot tenía solo la mitad servidor: sabía cobrar, no pagar. Sin esta mitad,
 * un agente no podía llamar a otro y liquidar al momento, que es lo que hace
 * falta para que se contraten entre ellos sin un humano por medio.
 *
 * El flujo son dos peticiones HTTP:
 *
 *   1. POST sin cabecera de pago  → 402 con la cotización (gratis, no compromete
 *      a nada). Es la propiedad más útil del protocolo: se puede preguntar el
 *      precio a varios candidatos sin gastar un céntimo.
 *   2. Se firma un `permit` EIP-2612 y se repite el POST con `X-Payment`. El
 *      agente cobra, trabaja y responde en la misma llamada.
 *
 * El cliente NO paga gas: solo firma. La transacción la manda quien cobra.
 */

import { isAddress, getAddress } from 'viem';
import type { Account, Address, Hex, WalletClient } from 'viem';
import { assertPublicUrl, fetchLimited, type UrlGuardOptions } from './net.js';
import { envelopeHeaders, type CallEnvelope } from './envelope.js';

/** El único esquema que entiende este cliente. Debe coincidir con el servidor. */
export const X402_SCHEME = 'eip2612-permit';

const PERMIT_TYPES = {
  Permit: [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

export interface PermitDomain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: Address;
}

/** Una forma de pago aceptada, tal y como la publica el 402. */
export interface X402Accept {
  scheme: string;
  network?: string;
  chainId: number;
  asset: Address;
  assetSymbol?: string;
  amount: string;
  payTo: Address;
  resource?: string;
  description?: string;
  deadline: number;
  maxTimeoutSeconds?: number;
  payerNonce?: string;
  domain: PermitDomain;
}

export interface X402Quote {
  x402Version?: number;
  accepts: X402Accept[];
  hint?: string;
}

export class X402Error extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'X402Error';
  }
}

/**
 * Pide la cotización de un endpoint SIN pagar.
 *
 * @param payer Si se indica, el servidor devuelve además el nonce del pagador y
 *              nos ahorramos una lectura de la cadena.
 */
export async function quoteAsk(
  endpoint: string,
  prompt: string,
  options: { payer?: Address; timeoutMs?: number; envelope?: CallEnvelope } & UrlGuardOptions = {},
): Promise<X402Accept> {
  const url = await assertPublicUrl(endpoint, options);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.payer) headers['x-payment-payer'] = options.payer;
  // El sobre viaja tambien al cotizar: si esto ya es un ciclo, mejor que el
  // otro extremo lo diga con un 508 antes de que nadie firme nada.
  if (options.envelope) Object.assign(headers, envelopeHeaders(options.envelope));

  const res = await fetchLimited(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ prompt }),
    timeoutMs: options.timeoutMs ?? 30_000,
  });

  if (res.status !== 402) {
    throw new X402Error(
      res.status === 404
        ? 'Ese agente no cobra por llamada (no tiene x402 activado).'
        : `Esperaba un 402 con la cotización y respondió ${res.status}.`,
      res.status,
    );
  }

  let quote: X402Quote;
  try {
    quote = JSON.parse(res.text) as X402Quote;
  } catch {
    throw new X402Error('La cotización no es JSON válido.');
  }
  const accept = quote.accepts?.find((a) => a.scheme === X402_SCHEME);
  if (!accept) {
    const vistos = quote.accepts?.map((a) => a.scheme).join(', ') || 'ninguno';
    throw new X402Error(`Ese agente no acepta "${X402_SCHEME}". Esquemas que ofrece: ${vistos}.`);
  }
  return accept;
}

export interface PayAndAskOptions extends UrlGuardOptions {
  /**
   * Tope de gasto para esta llamada, en unidades mínimas. OBLIGATORIO: el
   * precio lo pone el otro extremo, así que sin tope estarías firmando lo que
   * te pidan.
   */
  maxSpend: bigint;
  /** Cadena esperada. Si la cotización dice otra, se aborta. */
  chainId: number;
  /** Token esperado. Si la cotización pide otro, se aborta. */
  asset?: Address;
  /** Dirección que debe cobrar. Si no coincide con `payTo`, se aborta. */
  expectedPayee?: Address;
  /** Cotización ya obtenida, para no pedirla dos veces. */
  quote?: X402Accept;
  timeoutMs?: number;
  /**
   * Sobre de la cadena. Va ya descendido: quien llama se ha añadido al path y
   * ha gastado su salto. Ver `descend()` en envelope.ts.
   */
  envelope?: CallEnvelope;
}

export interface AskResult {
  answer: string;
  /** Lo que se ha pagado de verdad, en unidades mínimas. */
  paid: bigint;
  /** Quién ha cobrado. */
  payee: Address;
  /** Transacción del cobro, si el servidor la reporta. */
  txHash?: Hex;
  endpoint: string;
}

/**
 * Paga una consulta a un endpoint x402 y devuelve la respuesta.
 *
 * Todas las comprobaciones van ANTES de firmar. Una firma de permit es una
 * autorización para llevarse tu saldo: si se valida después, ya es tarde.
 */
export async function payAndAsk(
  wallet: WalletClient,
  account: Account,
  endpoint: string,
  prompt: string,
  options: PayAndAskOptions,
): Promise<AskResult> {
  const url = await assertPublicUrl(endpoint, options);
  const accept = options.quote ?? (await quoteAsk(endpoint, prompt, { payer: account.address, ...options }));

  // ---- Lo que se comprueba antes de firmar --------------------------------

  const amount = BigInt(accept.amount);
  if (amount <= 0n) throw new X402Error('La cotización pide un importe de cero o negativo.');
  if (amount > options.maxSpend) {
    throw new X402Error(`Pide ${amount} y tu tope es ${options.maxSpend}: no se firma.`);
  }
  if (accept.chainId !== options.chainId) {
    throw new X402Error(`La cotización es de la cadena ${accept.chainId} y tú estás en la ${options.chainId}.`);
  }
  // Sin `strict: false` se rechazaria un `payTo` en minusculas, que es valido
  // y es lo que devuelve cualquier servidor que no normalice a checksum.
  if (!isAddress(accept.payTo, { strict: false })) {
    throw new X402Error('El `payTo` de la cotización no es una dirección.');
  }
  if (options.expectedPayee && getAddress(accept.payTo) !== getAddress(options.expectedPayee)) {
    // Sin esto, un endpoint secuestrado cobraría a nombre de otro: pagarías al
    // atacante creyendo que pagas al agente que elegiste.
    throw new X402Error(
      `La cotización cobra a ${accept.payTo} y esperabas a ${options.expectedPayee}: no se firma.`,
    );
  }
  if (options.asset && getAddress(accept.asset) !== getAddress(options.asset)) {
    throw new X402Error(`La cotización pide pagar en ${accept.asset} y esperabas ${options.asset}.`);
  }
  if (getAddress(accept.domain.verifyingContract) !== getAddress(accept.asset)) {
    // El dominio EIP-712 tiene que ser el del propio token: si apunta a otro
    // contrato, la firma valdría para algo distinto de lo que crees.
    throw new X402Error('El dominio de firma no corresponde al token que se va a pagar.');
  }
  const ahora = Math.floor(Date.now() / 1000);
  if (accept.deadline <= ahora + 30) {
    throw new X402Error('La cotización caduca de inmediato: pide otra.');
  }
  if (accept.payerNonce === undefined) {
    throw new X402Error(
      'La cotización no trae el nonce del pagador. Vuelve a pedirla indicando `payer`, o léelo del token.',
    );
  }

  // ---- Firma (sin gas, sin transacción) -----------------------------------

  const signature = await wallet.signTypedData({
    account,
    domain: accept.domain,
    types: PERMIT_TYPES,
    primaryType: 'Permit',
    message: {
      owner: account.address,
      spender: getAddress(accept.payTo),
      value: amount,
      nonce: BigInt(accept.payerNonce),
      deadline: BigInt(accept.deadline),
    },
  });

  const header = toBase64(
    JSON.stringify({
      scheme: X402_SCHEME,
      payer: account.address,
      value: amount.toString(),
      deadline: accept.deadline.toString(),
      signature,
    }),
  );

  // ---- Segunda llamada: se cobra y se responde en la misma ----------------

  const res = await fetchLimited(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-payment': header,
      ...(options.envelope ? envelopeHeaders(options.envelope) : {}),
    },
    body: JSON.stringify({ prompt }),
    timeoutMs: options.timeoutMs ?? (accept.maxTimeoutSeconds ?? 120) * 1000,
  });

  let body: { answer?: string; error?: string; payment?: { txHash?: Hex }; paymentTx?: Hex };
  try {
    body = JSON.parse(res.text) as typeof body;
  } catch {
    throw new X402Error(`Respuesta ilegible del agente (HTTP ${res.status}).`, res.status);
  }

  if (res.status !== 200) {
    // El 502 con `paymentTx` es el caso feo y hay que distinguirlo: te han
    // cobrado y no han respondido, así que el hash es tu prueba para reclamar.
    if (body.paymentTx) {
      throw new X402Error(
        `El agente cobró (tx ${body.paymentTx}) pero no entregó respuesta: ${body.error ?? 'sin detalle'}`,
        res.status,
      );
    }
    if (res.status === 508) {
      throw new X402Error(
        `El agente rechazó la llamada por ciclo: ya había atendido esta cadena. ${body.error ?? ''}`.trim(),
        508,
      );
    }
    throw new X402Error(body.error ?? `El agente respondió ${res.status}.`, res.status);
  }
  if (typeof body.answer !== 'string' || !body.answer) {
    throw new X402Error('El agente respondió 200 pero sin `answer`.');
  }

  return {
    answer: body.answer,
    paid: amount,
    payee: getAddress(accept.payTo),
    txHash: body.payment?.txHash,
    endpoint: url.toString(),
  };
}

/** base64 sin depender de Buffer, para que valga también en el navegador. */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return typeof btoa === 'function'
    ? btoa(binary)
    : // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).Buffer.from(text, 'utf8').toString('base64');
}
