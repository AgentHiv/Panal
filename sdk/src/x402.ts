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
import { estimateGas, waitForTransactionReceipt } from 'viem/actions';
import type { Account, Address, Hex, WalletClient } from 'viem';
import { assertPublicUrl, fetchLimited, type UrlGuardOptions } from './net.js';
import { envelopeHeaders, type CallEnvelope } from './envelope.js';
import { networkOfChain, x402Currency, type X402Currency } from './currencies.js';

/** El esquema de las monedas con `permit`. Debe coincidir con el servidor. */
export const X402_SCHEME = 'eip2612-permit';
/** El de MON, que no tiene `permit`: se manda una transferencia y se presenta. */
const ESQUEMA_MON = 'native-transfer';

/** Lo más que puede valer una cotización: una hora. Ver `payAndAsk`. */
const PLAZO_MAX_S = 60 * 60;

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
  /** Solo en las de `permit`: el dominio con el que firmar. */
  domain?: PermitDomain;
  /** Solo en MON: el código de esta cotización, que se presenta con el pago. */
  paymentId?: Hex;
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
  const accept = quote.accepts?.find((a) => a.scheme === X402_SCHEME || a.scheme === ESQUEMA_MON);
  if (!accept) {
    const vistos = quote.accepts?.map((a) => a.scheme).join(', ') || 'ninguno';
    throw new X402Error(`Ese agente no cobra con un esquema que sepamos pagar. Esquemas que ofrece: ${vistos}.`);
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
  /** En qué, con su nombre y decimales de la lista de Panal (no de la cotización). */
  currency: X402Currency;
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
  // Solo en las monedas de la lista de Panal. El nombre y los decimales que
  // trae la cotización los escribe el agente, y fiarse de ellos permitía
  // cobrar 1.000 USDC enseñando «0,000000001 $PANAL». Ver currencies.ts.
  const moneda = x402Currency(accept.asset, networkOfChain(accept.chainId) ?? 'mainnet');
  if (!moneda) {
    throw new X402Error(`La cotización pide pagar en ${accept.asset}, que no es una moneda que Panal acepte: no se firma.`);
  }
  if (accept.scheme !== moneda.scheme) {
    throw new X402Error(`${moneda.symbol} se paga con "${moneda.scheme}" y la cotización pide "${accept.scheme}".`);
  }
  const ahora = Math.floor(Date.now() / 1000);
  if (accept.deadline <= ahora + 30) {
    throw new X402Error('La cotización caduca de inmediato: pide otra.');
  }
  // Y tampoco una que valga demasiado. El plazo lo pone el agente, y un permiso
  // firmado con un plazo de años se puede cobrar cuando él quiera mientras no
  // se use otro antes. Las cotizaciones de Panal duran 5 minutos.
  if (accept.deadline > ahora + PLAZO_MAX_S) {
    throw new X402Error(
      `La cotización vale hasta dentro de ${Math.round((accept.deadline - ahora) / 60)} minutos, y el máximo es una hora: no se firma.`,
    );
  }

  const header =
    moneda.scheme === ESQUEMA_MON
      ? await pagarEnMon(wallet, account, accept, amount)
      : await firmarPermit(wallet, account, accept, amount);

  // ---- Segunda llamada: se cobra y se responde en la misma ----------------

  const res = await fetchLimited(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-payment': header.value,
      ...(options.envelope ? envelopeHeaders(options.envelope) : {}),
    },
    body: JSON.stringify({ prompt }),
    timeoutMs: options.timeoutMs ?? (accept.maxTimeoutSeconds ?? 120) * 1000,
  });

  // `paid` es como lo devuelve la plantilla de agentes; `payment`, como lo
  // devolvía el bot de LexPanal. Se leen los dos para no perder el hash.
  let body: { answer?: string; error?: string; payment?: { txHash?: Hex }; paid?: { txHash?: Hex }; paymentTx?: Hex };
  try {
    body = JSON.parse(res.text) as typeof body;
  } catch {
    throw new X402Error(
      `Respuesta ilegible del agente (HTTP ${res.status}).${header.txHash ? ` Tu pago: tx ${header.txHash}.` : ''}`,
      res.status,
    );
  }

  if (res.status !== 200) {
    // El 502 con `paymentTx` es el caso feo y hay que distinguirlo: te han
    // cobrado y no han respondido, así que el hash es tu prueba para reclamar.
    // En MON el pago ya salió de tu wallet al mandarlo: el hash es el tuyo.
    const pagado = body.paymentTx ?? header.txHash;
    if (pagado) {
      throw new X402Error(
        `Pagaste (tx ${pagado}) y el agente no entregó respuesta: ${body.error ?? `HTTP ${res.status}`}`,
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
    currency: moneda,
    payee: getAddress(accept.payTo),
    txHash: body.payment?.txHash ?? body.paid?.txHash ?? header.txHash,
    endpoint: url.toString(),
  };
}

/**
 * Las de `permit`: una firma, sin gas ni transacción. Quien cobra la ejecuta.
 */
async function firmarPermit(
  wallet: WalletClient,
  account: Account,
  accept: X402Accept,
  amount: bigint,
): Promise<{ value: string; txHash?: Hex }> {
  if (!accept.domain || getAddress(accept.domain.verifyingContract) !== getAddress(accept.asset)) {
    // El dominio EIP-712 tiene que ser el del propio token: si apunta a otro
    // contrato, la firma valdría para algo distinto de lo que crees.
    throw new X402Error('El dominio de firma no corresponde al token que se va a pagar.');
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

  return {
    value: toBase64(
      JSON.stringify({
        scheme: X402_SCHEME,
        payer: account.address,
        value: amount.toString(),
        deadline: accept.deadline.toString(),
        signature,
      }),
    ),
  };
}

/**
 * MON: se MANDA la transferencia y se presenta su hash.
 *
 * El importe es exactamente el de la cotización —lleva unas unidades al azar
 * que la hacen única— y el código de pago no va a la cadena: es lo que impide
 * que otro presente esta transferencia como suya. Ver x402-server.ts.
 *
 * Aquí sí pagas tú el gas, una fracción de céntimo en Monad, y se espera a que
 * entre en un bloque: el agente lo va a comprobar en la cadena.
 */
async function pagarEnMon(
  wallet: WalletClient,
  account: Account,
  accept: X402Accept,
  amount: bigint,
): Promise<{ value: string; txHash: Hex }> {
  if (!accept.paymentId || !/^0x[0-9a-fA-F]{64}$/.test(accept.paymentId)) {
    throw new X402Error('La cotización en MON no trae su código de pago: pide otra.');
  }
  const to = getAddress(accept.payTo);
  // Monad cobra el límite de gas entero, no el gastado: se pide lo justo. Una
  // transferencia a una wallet normal son 21.000 exactos; solo se deja margen
  // si la estimación dice que el destino ejecuta código.
  const estimado = await estimateGas(wallet, { account, to, value: amount });
  const gas = estimado > 21_000n ? (estimado * 11n) / 10n : estimado;
  const txHash = await wallet.sendTransaction({ account, chain: wallet.chain ?? null, to, value: amount, gas });
  const recibo = await waitForTransactionReceipt(wallet, { hash: txHash, timeout: 90_000 });
  if (recibo.status !== 'success') {
    throw new X402Error(`La transferencia de MON se revirtió (tx ${txHash}): no se ha preguntado nada.`);
  }
  return {
    txHash,
    value: toBase64(
      JSON.stringify({
        scheme: ESQUEMA_MON,
        payer: account.address,
        value: amount.toString(),
        deadline: accept.deadline.toString(),
        paymentId: accept.paymentId,
        txHash,
      }),
    ),
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
