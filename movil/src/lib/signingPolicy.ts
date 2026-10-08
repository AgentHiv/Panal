/**
 * Panal — lo que la wallet del teléfono acepta firmar.
 *
 * POR QUÉ EXISTE
 *
 * La wallet del teléfono firma sin pantalla propia: con el PIN puesto, lo que
 * llega al conector se firma. Las hojas de Panal hacen de esa pantalla, pero
 * el conector no sabía si lo que le pedían venía de una hoja o de cualquier
 * otro sitio. Un fallo, o código colado en la app, podía pedirle un `transfer`
 * a un desconocido o un permit por todo el saldo, y salía firmado.
 *
 * Esto es la lista de lo que SÍ firma. Todo lo demás se para aquí, antes de
 * tocar la clave:
 *
 *   - Transacciones al escrow (cualquiera de sus funciones), al registro (dar
 *     de alta y editar el agente propio) y a $PANAL solo `approve` con el
 *     escrow de beneficiario. Ni contratos nuevos, ni MON suelto, ni
 *     `transfer`: mandar a otra wallet va por `lib/enviar.ts`, con su propia
 *     pantalla de confirmar, y no pasa por el conector.
 *   - `createTask`, además, solo el que la persona acaba de confirmar en la
 *     hoja de encargar: mismo agente, mismo importe, misma moneda. Es la única
 *     llamada al escrow que pone dinero a favor de un tercero; uno hacia un
 *     desconocido le bloquearía el saldo, y si nadie disputa, a los tres días
 *     de «entregar» lo cobra.
 *   - Mensajes, solo los de Panal: `Panal brief #12`, `Panal resultado #12 · …`.
 *   - Datos tipados, solo el permit de x402 en $PANAL, al agente y por el
 *     importe que enseñó la hoja del chat, y que caduque pronto.
 *
 * Lo que una hoja confirma se ARMA aquí justo antes de firmar y se GASTA al
 * firmar: vale para una firma y caduca a los pocos minutos.
 *
 * Solo cubre la wallet del teléfono. Con una wallet de fuera (WalletConnect)
 * firma ella, con su pantalla, y lo armado aquí caduca sin usarse.
 */

import { decodeFunctionData, hexToString, isAddressEqual, isHex } from 'viem';
import type { Abi, Address, Hex, TypedDataDefinition } from 'viem';
import { panalEscrowV2Abi, panalRegistryV2Abi, panalTokenAbi } from '@/contracts/abis';
import {
  NATIVE_CURRENCY,
  PANAL_ESCROW_V2_ADDRESS,
  PANAL_REGISTRY_V2_ADDRESS,
  PANAL_TOKEN_ADDRESS,
  activeChain,
} from '@/contracts/config';
import { textos } from '~/i18n/idiomas';

/** Cuánto vale lo armado por una hoja. Da para minar un `approve` y volver. */
export const VIDA_PERMISO_MS = 5 * 60_000;

/**
 * El plazo más largo que se acepta en un permit. Las cotizaciones de x402
 * caducan a los 5 minutos (`QUOTE_TTL_S` del SDK); esto deja margen sin
 * firmar algo que siga valiendo mañana.
 */
export const PLAZO_MAX_PERMIT_S = 15 * 60;

/** Los mensajes de Panal, enteros. Los arman `src/lib/botEndpoint.ts`. */
const MENSAJES_DE_PANAL = /^Panal (brief #\d+|(resultado|encargo|entrega) #\d+ · \d+)$/;

/** La forma de EIP-2612. Con otros campos, la misma firma significaría otra cosa. */
const CAMPOS_PERMIT = [
  ['owner', 'address'],
  ['spender', 'address'],
  ['value', 'uint256'],
  ['nonce', 'uint256'],
  ['deadline', 'uint256'],
];

/** Una firma que la wallet del teléfono se niega a hacer. */
export class FirmaBloqueada extends Error {
  /** Qué se pidió, para el registro; a la persona le llega el texto traducido. */
  readonly detalle: string;

  constructor(detalle: string) {
    super(textos().comun.firmaBloqueada);
    this.name = 'FirmaBloqueada';
    this.detalle = detalle;
  }
}

function bloquear(detalle: string): never {
  console.warn('[panal] firma bloqueada:', detalle);
  throw new FirmaBloqueada(detalle);
}

/* ── lo que arman las hojas ─────────────────────────────────────────────── */

interface EncargoArmado {
  worker: Address;
  amount: bigint;
  currency: Address;
  vence: number;
}

interface PagoArmado {
  spender: Address;
  value: bigint;
  vence: number;
}

let encargo: EncargoArmado | null = null;
let pago: PagoArmado | null = null;

/** La hoja de encargar, justo antes de pedir el `createTask`. */
export function permitirEncargo(e: { worker: Address; amount: bigint; currency: Address }, ahora = Date.now()): void {
  encargo = { ...e, vence: ahora + VIDA_PERMISO_MS };
}

/** La hoja del chat, justo antes de firmar el permit de x402. */
export function permitirPago(p: { spender: Address; value: bigint }, ahora = Date.now()): void {
  pago = { ...p, vence: ahora + VIDA_PERMISO_MS };
}

/** Al cerrar la sesión no queda nada armado para la siguiente. */
export function olvidarPermisos(): void {
  encargo = null;
  pago = null;
}

/* ── las comprobaciones ─────────────────────────────────────────────────── */

function decodificar(abi: Abi, datos: Hex, contrato: string) {
  try {
    return decodeFunctionData({ abi, data: datos });
  } catch {
    return bloquear(`una llamada que ${contrato} no tiene (${datos.slice(0, 10)})`);
  }
}

/** Una transacción. Lanza `FirmaBloqueada` si no es de las que se firman. */
export function revisarTransaccion(t: { to?: Address; data?: Hex; value?: bigint }, ahora = Date.now()): void {
  if (!t.to) bloquear('crear un contrato');
  const valor = t.value ?? 0n;
  const datos = t.data ?? '0x';

  if (isAddressEqual(t.to, PANAL_ESCROW_V2_ADDRESS)) {
    const llamada = decodificar(panalEscrowV2Abi, datos, 'el escrow');
    if (llamada.functionName !== 'createTask') {
      if (valor !== 0n) bloquear(`MON a ${llamada.functionName}, que no lo cobra`);
      return;
    }
    const [worker, , , currency, amount] = llamada.args as readonly [Address, Hex, bigint, Address, bigint];
    const e = encargo;
    if (!e || e.vence < ahora) bloquear('un createTask que ninguna hoja ha confirmado');
    if (!isAddressEqual(worker, e.worker) || !isAddressEqual(currency, e.currency) || amount !== e.amount) {
      bloquear(`un createTask a ${worker} por ${amount}, y la hoja confirmó ${e.worker} por ${e.amount}`);
    }
    if (valor !== (isAddressEqual(currency, NATIVE_CURRENCY) ? amount : 0n)) {
      bloquear(`un createTask que manda ${valor} wei de MON por un encargo de ${amount}`);
    }
    encargo = null;
    return;
  }

  if (isAddressEqual(t.to, PANAL_REGISTRY_V2_ADDRESS)) {
    decodificar(panalRegistryV2Abi, datos, 'el registro');
    if (valor !== 0n) bloquear('MON al registro');
    return;
  }

  if (isAddressEqual(t.to, PANAL_TOKEN_ADDRESS)) {
    const llamada = decodificar(panalTokenAbi, datos, '$PANAL');
    if (llamada.functionName !== 'approve' || !isAddressEqual(llamada.args?.[0] as Address, PANAL_ESCROW_V2_ADDRESS)) {
      bloquear(`$PANAL.${llamada.functionName} a ${String(llamada.args?.[0])}: solo se aprueba al escrow`);
    }
    if (valor !== 0n) bloquear('MON a $PANAL');
    return;
  }

  bloquear(`una transacción a ${t.to}, que no es un contrato de Panal`);
}

/** Un `personal_sign`. Llega en hexadecimal, como lo manda viem. */
export function revisarMensaje(datos: string): void {
  const texto = isHex(datos) ? hexToString(datos) : datos;
  if (!MENSAJES_DE_PANAL.test(texto)) bloquear(`un mensaje que no es de Panal: «${texto.slice(0, 80)}»`);
}

/** Un `eth_signTypedData`. Solo pasa el permit de x402 que armó la hoja. */
export function revisarTipado(tipado: TypedDataDefinition, dueno: Address, ahora = Date.now()): void {
  if (tipado.primaryType !== 'Permit') bloquear(`datos tipados de tipo ${String(tipado.primaryType)}`);

  const dominio = tipado.domain ?? {};
  if (!dominio.verifyingContract || !isAddressEqual(dominio.verifyingContract, PANAL_TOKEN_ADDRESS)) {
    bloquear(`un permit de ${String(dominio.verifyingContract)}, que no es $PANAL`);
  }
  if (Number(dominio.chainId) !== activeChain.id) bloquear(`un permit para la cadena ${String(dominio.chainId)}`);

  const campos = (tipado.types as Record<string, readonly { name: string; type: string }[]>).Permit;
  if (JSON.stringify(campos?.map((c) => [c.name, c.type])) !== JSON.stringify(CAMPOS_PERMIT)) {
    bloquear('un permit con campos que no son los de EIP-2612');
  }

  const m = tipado.message as Record<string, string | number | bigint>;
  if (!isAddressEqual(m.owner as Address, dueno)) bloquear(`un permit a nombre de ${String(m.owner)}`);

  const ahoraS = BigInt(Math.floor(ahora / 1000));
  const plazo = BigInt(m.deadline);
  if (plazo <= ahoraS || plazo > ahoraS + BigInt(PLAZO_MAX_PERMIT_S)) {
    bloquear(`un permit que caduca en ${plazo - ahoraS} s`);
  }

  const p = pago;
  if (!p || p.vence < ahora) bloquear('un permit que ninguna hoja ha confirmado');
  if (!isAddressEqual(m.spender as Address, p.spender) || BigInt(m.value) !== p.value) {
    bloquear(`un permit a ${String(m.spender)} por ${String(m.value)}, y la hoja confirmó ${p.spender} por ${p.value}`);
  }
  pago = null;
}
