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
  getAddress,
  hexToNumber,
  isAddress,
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
 * Lee el dominio EIP-712 del token en cadena (ERC-5267), con respaldo a
 * `name()` + version "1", que es lo que usan las implementaciones habituales.
 *
 * Se lee de la cadena en vez de escribirlo a mano porque un dominio mal
 * construido produce firmas que verifican en local y revierten al llegar al
 * contrato: el fallo aparecería solo en producción y con dinero de por medio.
 */
export async function readPermitDomain(
  publicClient: PublicClient,
  token: Address,
  network: PanalNetwork = 'mainnet',
): Promise<PermitDomain> {
  try {
    const d = (await publicClient.readContract({
      address: token,
      abi: [
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
      ] as const,
      functionName: 'eip712Domain',
    })) as readonly [Hex, string, string, bigint, Address, Hex, readonly bigint[]];
    return { name: d[1], version: d[2], chainId: Number(d[3]), verifyingContract: getAddress(d[4]) };
  } catch {
    const name = (await publicClient.readContract({
      address: token,
      abi: tokenExtraAbi,
      functionName: 'name',
    })) as string;
    return { name, version: '1', chainId: chainFor(network).id, verifyingContract: getAddress(token) };
  }
}

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
  scheme: string;
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
