/**
 * x402 — la mitad SERVIDOR: cobrar por llamada HTTP.
 *
 * El otro archivo, `x402.ts`, es la mitad cliente: pide presupuesto y paga.
 * Este es el lado del que cobra.
 *
 *   1. Llega una petición sin pagar.                     POST /x402/ask
 *   2. Se responde 402 con un presupuesto legible por máquina.  (buildQuote)
 *   3. El cliente FIRMA una autorización de pago, sin gas ni transacción.
 *   4. Repite la petición con la firma en la cabecera X-Payment.
 *   5. Se cobra on-chain y se sirve el recurso en esa misma llamada. (verifyAndSettle)
 *
 * Sin alta, sin API key, sin tarjeta: **el pago es la autenticación**. Un
 * desconocido puede usar tu servicio y pagarlo sin que ninguno de los dos sepa
 * quién es el otro.
 *
 * POR QUÉ EXIGE UNA CADENA
 * Cobrar dos milésimas por llamada es imposible con tarjeta: la comisión fija
 * (~0,30 $) multiplica por cien el importe. En Monad la comisión es una
 * fracción de céntimo, así que el micropago sale. Es la única pieza de Panal
 * donde la cadena es requisito y no decoración.
 *
 * ESQUEMA: eip2612-permit
 * El cliente autoriza el cobro con una firma off-chain —gratis e instantánea— y
 * el agente paga el gas de ejecutarla. Sin `permit` harían falta dos
 * transacciones del cliente y el modelo entero se cae. Por eso este raíl solo
 * funciona con un ERC-20 que implemente EIP-2612, no con la moneda nativa.
 *
 * SE COBRA ANTES DE SERVIR. El orden es deliberado: si se sirviera primero y el
 * cobro fallara, el recurso se habría regalado.
 *
 * Los textos que salen por la red van en inglés a propósito: los lee un
 * desconocido de cualquier parte, no el operador del agente.
 *
 * Portado del bot de LexPanal, donde llevaba meses cobrando en producción.
 */

import {
  encodeAbiParameters,
  getAddress,
  hashDomain,
  hexToNumber,
  isAddress,
  isAddressEqual,
  isHex,
  keccak256,
  slice,
  toHex,
  verifyTypedData,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { chainFor, type PanalNetwork } from './chains.js';
import { erc20Abi } from './abis.js';
// El dominio EIP-712 lo define la mitad cliente y es el MISMO objeto: si cada
// lado tuviera su tipo, un cambio en uno compilaría dejando al otro firmando
// sobre un dominio distinto, y eso solo se ve fallando en producción.
import type { PermitDomain } from './x402.js';

export type { PermitDomain };

export const X402_VERSION = 1;
export const X402_SERVER_SCHEME = 'eip2612-permit';
/** El esquema de MON: quien paga manda una transferencia y la presenta. */
export const X402_NATIVE_SCHEME = 'native-transfer';

/** Margen mínimo de vigencia que se exige a la firma al llegar. */
const MIN_DEADLINE_MARGIN_S = 30;
/** Vigencia que se sugiere en el presupuesto. */
const QUOTE_TTL_S = 300;

// ---------------------------------------------------------------------------
// EIP-2612: datos tipados de `permit`.
// ---------------------------------------------------------------------------

const PERMIT_TYPES = {
  Permit: [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

export function permitTypedData(
  domain: PermitDomain,
  message: { owner: Address; spender: Address; value: bigint; nonce: bigint; deadline: bigint },
) {
  return { domain, types: PERMIT_TYPES, primaryType: 'Permit' as const, message };
}

/**
 * Lee el dominio EIP-712 del token en cadena.
 *
 * Se lee de la cadena en vez de escribirlo a mano porque un dominio mal
 * construido produce firmas que verifican en local y revierten al llegar al
 * contrato: el fallo aparecería solo en producción y con dinero de por medio.
 *
 * Y no basta con una sola fuente. ERC-5267 (`eip712Domain()`) lo tienen
 * $PANAL y AUSD, pero no GHO ni USDC; y la versión no es siempre "1": USDC usa
 * "2". Antes se suponía "1" si faltaba `eip712Domain()`, y TODAS las firmas de
 * USDC salían inválidas. Ahora se reúnen los candidatos —ERC-5267, `name()`
 * con `version()`, con "1" y con "2"— y se elige el que da exactamente el
 * `DOMAIN_SEPARATOR()` del token. Si el token no lo expone, se usa el primero.
 */
export async function readPermitDomain(
  publicClient: PublicClient,
  token: Address,
  network: PanalNetwork = 'mainnet',
): Promise<PermitDomain> {
  const leer = <T>(functionName: string): Promise<T | null> =>
    publicClient
      .readContract({ address: token, abi: dominioAbi, functionName: functionName as never })
      .then((v) => v as T, () => null);

  const [erc5267, nombre, version, separador] = await Promise.all([
    leer<readonly [Hex, string, string, bigint, Address, Hex, readonly bigint[]]>('eip712Domain'),
    leer<string>('name'),
    leer<string>('version'),
    leer<Hex>('DOMAIN_SEPARATOR'),
  ]);
  const chainId = chainFor(network).id;
  const verifyingContract = getAddress(token);

  const candidatos: PermitDomain[] = [];
  if (erc5267) {
    candidatos.push({ name: erc5267[1], version: erc5267[2], chainId: Number(erc5267[3]), verifyingContract: getAddress(erc5267[4]) });
  }
  if (nombre !== null) {
    for (const v of [version, '1', '2']) {
      if (v !== null) candidatos.push({ name: nombre, version: v, chainId, verifyingContract });
    }
  }
  if (!candidatos.length) throw new Error(`no se pudo leer el dominio EIP-712 de ${token}`);
  if (!separador) return candidatos[0]!;

  const bueno = candidatos.find(
    (d) =>
      hashDomain({
        domain: { ...d, chainId: BigInt(d.chainId) },
        types: {
          EIP712Domain: [
            { name: 'name', type: 'string' },
            { name: 'version', type: 'string' },
            { name: 'chainId', type: 'uint256' },
            { name: 'verifyingContract', type: 'address' },
          ],
        },
      }) === separador,
  );
  if (!bueno) {
    throw new Error(`ningún dominio candidato de ${token} coincide con su DOMAIN_SEPARATOR: no se puede firmar con seguridad`);
  }
  return bueno;
}

const dominioAbi = [
  {
    type: 'function',
    name: 'eip712Domain',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'fields', type: 'bytes1' },
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
      { name: 'salt', type: 'bytes32' },
      { name: 'extensions', type: 'uint256[]' },
    ],
  },
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'string' }] },
  { type: 'function', name: 'version', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'string' }] },
  { type: 'function', name: 'DOMAIN_SEPARATOR', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'bytes32' }] },
] as const;

/** Nonce de permit actual del pagador. Cambia con cada pago consumido. */
export async function permitNonce(publicClient: PublicClient, token: Address, owner: Address): Promise<bigint> {
  return publicClient.readContract({
    address: token,
    abi: [
      {
        type: 'function',
        name: 'nonces',
        stateMutability: 'view',
        inputs: [{ name: 'owner', type: 'address' }],
        outputs: [{ name: '', type: 'uint256' }],
      },
    ] as const,
    functionName: 'nonces',
    args: [owner],
  }) as Promise<bigint>;
}

// ---------------------------------------------------------------------------
// El presupuesto que viaja en el 402.
// ---------------------------------------------------------------------------

export interface X402ServerAccept {
  scheme: typeof X402_SERVER_SCHEME;
  network: string;
  chainId: number;
  asset: Address;
  assetSymbol: string;
  amount: string;
  payTo: Address;
  resource: string;
  description: string;
  deadline: number;
  maxTimeoutSeconds: number;
  /** Nonce del pagador, si dijo quién era con la cabecera X-Payment-Payer. */
  payerNonce?: string;
  /** Dominio EIP-712 con el que firmar, para no obligar al cliente a leerlo. */
  domain: PermitDomain;
}

export interface X402ServerQuote {
  x402Version: typeof X402_VERSION;
  accepts: X402ServerAccept[];
  /** Ayuda para quien lo lea a mano; los clientes usan `accepts`. */
  hint: string;
}

export function buildQuote(params: {
  asset: Address;
  assetSymbol: string;
  amount: bigint;
  payTo: Address;
  resource: string;
  description: string;
  domain: PermitDomain;
  payerNonce?: bigint;
  network?: PanalNetwork;
  nowS?: number;
}): X402ServerQuote {
  const now = params.nowS ?? Math.floor(Date.now() / 1000);
  return {
    x402Version: X402_VERSION,
    accepts: [
      {
        scheme: X402_SERVER_SCHEME,
        network: 'monad',
        chainId: chainFor(params.network ?? 'mainnet').id,
        asset: params.asset,
        assetSymbol: params.assetSymbol,
        amount: params.amount.toString(),
        payTo: params.payTo,
        resource: params.resource,
        description: params.description,
        deadline: now + QUOTE_TTL_S,
        maxTimeoutSeconds: 120,
        payerNonce: params.payerNonce?.toString(),
        domain: params.domain,
      },
    ],
    hint:
      'Sign an EIP-2612 permit with the domain and fields of accepts[0] (spender = payTo, ' +
      'value = amount, nonce = your current token nonce, deadline <= the one given) and repeat the ' +
      'request with the header X-Payment: base64({scheme,payer,value,deadline,signature}).',
  };
}

// ---------------------------------------------------------------------------
// La cabecera X-Payment.
// ---------------------------------------------------------------------------

export interface X402Payment {
  scheme: typeof X402_SERVER_SCHEME;
  payer: Address;
  value: bigint;
  deadline: bigint;
  signature: Hex;
}

/** Descodifica y valida la forma de X-Payment. Nunca lanza: devuelve el motivo. */
export function parsePaymentHeader(
  header: string,
): { ok: true; payment: X402Payment } | { ok: false; error: string } {
  // Validación explícita: Buffer.from(…, 'base64') NO lanza con entrada
  // inválida, se limita a ignorar los caracteres que no reconoce. Sin esta
  // comprobación, una cabecera basura llegaba al JSON.parse y el error que se
  // devolvía culpaba al JSON en vez de al base64.
  const encoded = header.trim();
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(encoded)) {
    return { ok: false, error: 'the X-Payment header is not base64' };
  }
  const json = Buffer.from(encoded, 'base64').toString('utf8');
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return { ok: false, error: 'the contents of X-Payment are not JSON' };
  }

  const { scheme, payer, value, deadline, signature } = raw;
  if (typeof scheme !== 'string' || scheme !== X402_SERVER_SCHEME) {
    return { ok: false, error: `unsupported scheme (expected "${X402_SERVER_SCHEME}")` };
  }
  if (typeof payer !== 'string' || !isAddress(payer)) return { ok: false, error: 'payer is not an address' };
  if (typeof signature !== 'string' || !isHex(signature) || signature.length !== 132) {
    return { ok: false, error: 'signature must be a 65-byte hex signature' };
  }
  let valueBig: bigint;
  let deadlineBig: bigint;
  try {
    valueBig = BigInt(String(value));
    deadlineBig = BigInt(String(deadline));
  } catch {
    return { ok: false, error: 'value and deadline must be integers' };
  }
  if (valueBig <= 0n) return { ok: false, error: 'value must be greater than zero' };

  return {
    ok: true,
    payment: { scheme, payer: getAddress(payer), value: valueBig, deadline: deadlineBig, signature },
  };
}

/** Parte la firma de 65 bytes en (v, r, s) para pasársela a `permit`. */
export function splitSignature(signature: Hex): { v: number; r: Hex; s: Hex } {
  const r = slice(signature, 0, 32);
  const s = slice(signature, 32, 64);
  let v = hexToNumber(slice(signature, 64, 65));
  if (v < 27) v += 27; // algunas wallets firman con 0/1
  return { v, r, s };
}

// ---------------------------------------------------------------------------
// Verificación y cobro.
// ---------------------------------------------------------------------------

export interface SettleDeps {
  publicClient: PublicClient;
  walletClient: WalletClient | null;
  token: Address;
  domain: PermitDomain;
  /** Quien cobra: la wallet del agente, que es también el spender del permit. */
  payee: Address;
  network?: PanalNetwork;
}

export type SettleResult =
  | { ok: true; txHash: Hex; amount: bigint }
  | { ok: false; status: number; error: string };

/**
 * Cola por pagador.
 *
 * ESTA ES LA TRAMPA DEL ESQUEMA. El nonce de EIP-2612 es SECUENCIAL por
 * dirección: si el mismo cliente lanza dos llamadas en paralelo, ambas firman
 * con el nonce N y solo una puede consumirse; la otra revierte en cadena —y
 * para entonces ya le habríamos servido el recurso—. Serializando por pagador,
 * cada cobro lee el nonce actualizado y firma sobre él.
 *
 * Los pagadores distintos siguen yendo en paralelo: la cola es por dirección.
 */
const payerQueues = new Map<string, Promise<unknown>>();

/** Exportada para poder probar la serialización directamente. */
export function enqueueByPayer<T>(payer: Address, fn: () => Promise<T>): Promise<T> {
  const key = payer.toLowerCase();
  const prev = payerQueues.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  // La cola guarda la promesa "apagada" para que un fallo no la rompa.
  payerQueues.set(
    key,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  void next.catch(() => undefined);
  return next;
}

/**
 * Verifica la firma y cobra on-chain. Devuelve el hash de la transacción.
 * El recurso NO debe servirse hasta que esto salga bien.
 */
export async function verifyAndSettle(
  deps: SettleDeps,
  payment: X402Payment,
  price: bigint,
): Promise<SettleResult> {
  if (payment.value < price) {
    return { ok: false, status: 402, error: `the payment (${payment.value}) is less than the price (${price})` };
  }
  const nowS = BigInt(Math.floor(Date.now() / 1000));
  if (payment.deadline < nowS + BigInt(MIN_DEADLINE_MARGIN_S)) {
    return { ok: false, status: 402, error: 'the payment authorization has expired or has too little margin left' };
  }
  if (!deps.walletClient) {
    return { ok: false, status: 503, error: 'the agent has no wallet to execute the charge' };
  }

  const chain = chainFor(deps.network ?? 'mainnet');

  return enqueueByPayer(payment.payer, async () => {
    // El nonce se lee DENTRO de la cola: si otro pago del mismo pagador acaba
    // de consumirse, aquí ya se ve el valor nuevo.
    const nonce = await permitNonce(deps.publicClient, deps.token, payment.payer);

    const valid = await verifyTypedData({
      address: payment.payer,
      ...permitTypedData(deps.domain, {
        owner: payment.payer,
        spender: deps.payee,
        value: payment.value,
        nonce,
        deadline: payment.deadline,
      }),
      signature: payment.signature,
    }).catch(() => false);

    if (!valid) {
      return {
        ok: false as const,
        status: 402,
        error:
          `the signature is not a valid permit from ${payment.payer} ` +
          `(current nonce ${nonce}; if you signed with another, ask for a new quote)`,
      };
    }

    const balance = (await deps.publicClient.readContract({
      address: deps.token,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [payment.payer],
    })) as bigint;
    if (balance < payment.value) {
      return {
        ok: false as const,
        status: 402,
        error: `payer balance is not enough (${balance} < ${payment.value})`,
      };
    }

    const { v, r, s } = splitSignature(payment.signature);
    const wallet = deps.walletClient!;

    // permit + transferFrom. Se simula antes para no quemar gas en una
    // transacción condenada (firma consumida, deadline pasado, saldo movido).
    await deps.publicClient.simulateContract({
      address: deps.token,
      abi: permitAbi,
      functionName: 'permit',
      args: [payment.payer, deps.payee, payment.value, payment.deadline, v, r, s],
      account: wallet.account!,
    });
    const permitTx = await wallet.writeContract({
      address: deps.token,
      abi: permitAbi,
      functionName: 'permit',
      args: [payment.payer, deps.payee, payment.value, payment.deadline, v, r, s],
      account: wallet.account!,
      chain,
    });
    await deps.publicClient.waitForTransactionReceipt({ hash: permitTx });

    const transferTx = await wallet.writeContract({
      address: deps.token,
      abi: tokenExtraAbi,
      functionName: 'transferFrom',
      args: [payment.payer, deps.payee, payment.value],
      account: wallet.account!,
      chain,
    });
    const receipt = await deps.publicClient.waitForTransactionReceipt({ hash: transferTx });
    if (receipt.status !== 'success') {
      return { ok: false as const, status: 502, error: 'the transfer reverted on chain' };
    }

    return { ok: true as const, txHash: transferTx, amount: payment.value };
  });
}

/** Trozos del ERC-20 que no están en el `erc20Abi` del SDK. */
const tokenExtraAbi = [
  {
    type: 'function',
    name: 'name',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    name: 'transferFrom',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

const permitAbi = [
  {
    type: 'function',
    name: 'permit',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    outputs: [],
  },
] as const;

/** Identificador estable del recurso pagado, para trazas y recibos. */
export function resourceId(method: string, path: string, body: string): Hex {
  return keccak256(toHex(`${method} ${path}\n${body}`));
}

// ---------------------------------------------------------------------------
// MON: el esquema `native-transfer`.
//
// La moneda nativa no tiene `permit`, así que no se puede cobrar con una firma.
// Quien paga MANDA el MON al agente (paga él su gas: una fracción de céntimo
// en Monad) y repite la petición con el hash de esa transacción.
//
// Lo difícil es que una transferencia es pública: cualquiera la ve en la
// cadena en cuanto entra. Sin cuidado, otro podría presentarla como suya y
// llevarse la respuesta que pagó un tercero. Lo impiden dos cosas:
//
//   1. EL IMPORTE ES ÚNICO. La cotización pide el precio más unas pocas
//      unidades al azar (menos de una millonésima de céntimo). La transferencia
//      tiene que ser EXACTAMENTE de ese importe, así que solo vale para la
//      cotización que lo pidió: quien pida otra recibe otro importe.
//   2. EL CÓDIGO DE PAGO ES SECRETO. La cotización lleva un `paymentId` que
//      solo conoce quien la pidió (va por HTTPS, no por la cadena) y que ata
//      pagador, agente, importe, caducidad y la pregunta exacta. Sin él, una
//      transferencia vista en la cadena no se puede presentar.
//
// El `paymentId` es un keccak256 de un secreto del agente con esos datos: el
// agente no tiene que guardar las cotizaciones que da, solo rehacer la cuenta.
// Y cada transacción se acepta UNA vez.
// ---------------------------------------------------------------------------

/** Un secreto nuevo para firmar cotizaciones. Uno por arranque basta. */
export function newQuoteSecret(): Hex {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

/** Margen tras la caducidad para que la transferencia llegue a minarse. */
const NATIVE_GRACE_S = 120;

function nativePaymentId(
  secret: Hex,
  q: { payer: Address; payTo: Address; amount: bigint; deadline: number; resource: Hex },
): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'bytes32' },
        { type: 'address' },
        { type: 'address' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'bytes32' },
      ],
      [secret, getAddress(q.payer), getAddress(q.payTo), q.amount, BigInt(q.deadline), q.resource],
    ),
  );
}

export interface X402NativeAccept {
  scheme: typeof X402_NATIVE_SCHEME;
  network: string;
  chainId: number;
  asset: Address;
  assetSymbol: 'MON';
  /** El precio más unas unidades al azar: la transferencia tiene que ser de ESTO exactamente. */
  amount: string;
  payTo: Address;
  resource: string;
  description: string;
  deadline: number;
  maxTimeoutSeconds: number;
  /** Secreto de esta cotización: se presenta con el pago, nunca va a la cadena. */
  paymentId: Hex;
}

/**
 * La cotización de una pregunta en MON.
 *
 * @param resource `resourceId()` de la petición: ata el pago a ESTA pregunta.
 * @param payer    Quien dijo que iba a pagar (cabecera X-Payment-Payer). Sin
 *                 él, la cotización vale para cualquier pagador, y lo que la
 *                 protege es el importe único y el secreto.
 */
export function buildNativeQuote(params: {
  secret: Hex;
  price: bigint;
  payTo: Address;
  resource: Hex;
  description: string;
  payer?: Address | null;
  network?: PanalNetwork;
  nowS?: number;
}): { x402Version: typeof X402_VERSION; accepts: X402NativeAccept[]; hint: string } {
  const now = params.nowS ?? Math.floor(Date.now() / 1000);
  const deadline = now + QUOTE_TTL_S;
  // De 1 a 1.048.576 unidades (2²⁰): menos de una millonésima de céntimo, y
  // basta para que dos cotizaciones no pidan el mismo importe.
  //
  // Con una máscara y no con `%`: el rango es una potencia de dos, así que
  // cada valor sale con la misma probabilidad. Con `% 999999` unos salían un
  // poco más que otros (lo marcó CodeQL); aquí no importaba, porque solo hace
  // falta que no se repita ni se adivine, pero sin sesgo no hay que pensarlo.
  const azar = BigInt(1 + (crypto.getRandomValues(new Uint32Array(1))[0]! & 0xfffff));
  const amount = params.price + azar;
  const payer = params.payer ? getAddress(params.payer) : ZERO;
  return {
    x402Version: X402_VERSION,
    accepts: [
      {
        scheme: X402_NATIVE_SCHEME,
        network: 'monad',
        chainId: chainFor(params.network ?? 'mainnet').id,
        asset: ZERO,
        assetSymbol: 'MON',
        amount: amount.toString(),
        payTo: getAddress(params.payTo),
        resource: params.resource,
        description: params.description,
        deadline,
        maxTimeoutSeconds: 120,
        paymentId: nativePaymentId(params.secret, { payer, payTo: params.payTo, amount, deadline, resource: params.resource }),
      },
    ],
    hint:
      'Send EXACTLY `amount` MON to `payTo` before `deadline`, then repeat the request with the header ' +
      'X-Payment: base64({scheme:"native-transfer",payer,value,deadline,paymentId,txHash}).',
  };
}

const ZERO = '0x0000000000000000000000000000000000000000' as Address;

export interface X402NativePayment {
  scheme: typeof X402_NATIVE_SCHEME;
  payer: Address;
  value: bigint;
  deadline: bigint;
  paymentId: Hex;
  txHash: Hex;
}

/**
 * Lee X-Payment de los dos esquemas. Nunca lanza: devuelve el motivo.
 *
 * `parsePaymentHeader` sigue aceptando solo el permit, como antes, para que un
 * agente que no sabe cobrar en MON no reciba un pago que no sabe comprobar.
 */
export function parseX402Header(
  header: string,
): { ok: true; payment: X402Payment | X402NativePayment } | { ok: false; error: string } {
  const encoded = header.trim();
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(encoded)) return { ok: false, error: 'the X-Payment header is not base64' };
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as Record<string, unknown>;
  } catch {
    return { ok: false, error: 'the contents of X-Payment are not JSON' };
  }
  if (raw.scheme !== X402_NATIVE_SCHEME) return parsePaymentHeader(header);

  const { payer, value, deadline, paymentId, txHash } = raw;
  if (typeof payer !== 'string' || !isAddress(payer)) return { ok: false, error: 'payer is not an address' };
  const es32 = (x: unknown): x is Hex => typeof x === 'string' && isHex(x) && x.length === 66;
  if (!es32(paymentId)) return { ok: false, error: 'paymentId must be the 32-byte hex from the quote' };
  if (!es32(txHash)) return { ok: false, error: 'txHash must be a 32-byte transaction hash' };
  let valueBig: bigint;
  let deadlineBig: bigint;
  try {
    valueBig = BigInt(String(value));
    deadlineBig = BigInt(String(deadline));
  } catch {
    return { ok: false, error: 'value and deadline must be integers' };
  }
  if (valueBig <= 0n) return { ok: false, error: 'value must be greater than zero' };
  return {
    ok: true,
    payment: {
      scheme: X402_NATIVE_SCHEME,
      payer: getAddress(payer),
      value: valueBig,
      deadline: deadlineBig,
      paymentId: paymentId.toLowerCase() as Hex,
      txHash: txHash.toLowerCase() as Hex,
    },
  };
}

/** Las transacciones ya cobradas. Basta en memoria: una cotización caduca a los 5 minutos. */
export interface NativeReplayGuard {
  has(txHash: string): boolean;
  add(txHash: string): void;
}

/**
 * Comprueba en la cadena un pago en MON. El recurso NO debe servirse hasta
 * que esto salga bien. No hace falta wallet: el pago ya lo mandó el cliente.
 */
export async function verifyNativePayment(
  deps: {
    publicClient: PublicClient;
    payee: Address;
    secret: Hex;
    used: NativeReplayGuard;
    /** Para las pruebas. */
    nowS?: number;
    /** Cuánto esperar a que el nodo vea la transacción. */
    waitMs?: number;
  },
  payment: X402NativePayment,
  params: { price: bigint; resource: Hex },
): Promise<SettleResult> {
  if (payment.value < params.price) {
    return { ok: false, status: 402, error: `the payment (${payment.value}) is less than the price (${params.price})` };
  }
  // El código de pago se rehace con lo que dice el pago. Si alguien cambia el
  // importe, la caducidad o el pagador, o presenta una cotización de otra
  // pregunta, no cuadra. Se prueba también sin pagador: la cotización se pudo
  // pedir sin decir quién pagaría.
  const datos = { payTo: deps.payee, amount: payment.value, deadline: Number(payment.deadline), resource: params.resource };
  const esperado = [payment.payer, ZERO].map((payer) => nativePaymentId(deps.secret, { ...datos, payer }));
  if (!esperado.includes(payment.paymentId.toLowerCase() as Hex)) {
    return { ok: false, status: 402, error: 'unknown or altered quote: ask for a new one and pay exactly what it says' };
  }
  const nowS = deps.nowS ?? Math.floor(Date.now() / 1000);
  if (BigInt(nowS) > payment.deadline + BigInt(NATIVE_GRACE_S)) {
    return { ok: false, status: 402, error: 'the quote has expired' };
  }
  if (deps.used.has(payment.txHash)) {
    return { ok: false, status: 409, error: 'this payment was already used' };
  }

  // El nodo puede tardar un instante en ver una transacción recién minada.
  const hasta = Date.now() + (deps.waitMs ?? 6_000);
  let recibo: Awaited<ReturnType<PublicClient['getTransactionReceipt']>> | null = null;
  for (;;) {
    recibo = await deps.publicClient.getTransactionReceipt({ hash: payment.txHash }).catch(() => null);
    if (recibo || Date.now() >= hasta) break;
    await new Promise((r) => setTimeout(r, 750));
  }
  if (!recibo) return { ok: false, status: 402, error: 'the payment transaction is not on chain yet' };
  if (recibo.status !== 'success') return { ok: false, status: 402, error: 'the payment transaction reverted' };

  const tx = await deps.publicClient.getTransaction({ hash: payment.txHash });
  if (!isAddressEqual(tx.from, payment.payer)) {
    return { ok: false, status: 402, error: 'the payment was sent by someone else' };
  }
  if (!tx.to || !isAddressEqual(tx.to, deps.payee)) {
    return { ok: false, status: 402, error: 'the payment was not sent to this agent' };
  }
  if (tx.value !== payment.value) {
    return { ok: false, status: 402, error: `the payment sent ${tx.value}, and the quote asked for exactly ${payment.value}` };
  }
  const bloque = await deps.publicClient.getBlock({ blockNumber: recibo.blockNumber });
  if (bloque.timestamp > payment.deadline) {
    return { ok: false, status: 402, error: 'the payment arrived after the quote expired' };
  }
  if (bloque.timestamp + BigInt(QUOTE_TTL_S + 60) < payment.deadline) {
    return { ok: false, status: 402, error: 'the payment is older than the quote' };
  }

  // Se marca ANTES de servir: dos peticiones con la misma transacción a la
  // vez no pueden pasar las dos.
  if (deps.used.has(payment.txHash)) return { ok: false, status: 409, error: 'this payment was already used' };
  deps.used.add(payment.txHash);
  return { ok: true, txHash: payment.txHash, amount: tx.value };
}
