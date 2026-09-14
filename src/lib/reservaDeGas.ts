/**
 * Panal — la reserva de gas de Monad, mirada ANTES de firmar.
 *
 * QUÉ PASA. Monad bloquea `gas_limit × maxFeePerGas` de la wallet antes de
 * ejecutar una transacción, aunque luego cobre bastante menos. Medido el
 * 2026-09-14 para darse de alta: 263.870 de gas a 122 gwei son 0,032 MON de
 * reserva. Una wallet recién cargada con «lo justo» no llega, y el nodo la
 * rechaza con «Signer had insufficient balance», que viem presenta como si el
 * contrato hubiera revertido. El contrato no llegó a ejecutarse.
 *
 * Y HAY UNA SEGUNDA TRAMPA DETRÁS. Si después de recargar se reintenta con el
 * mismo nonce y las mismas comisiones, la transacción firmada sale idéntica
 * byte a byte, y el nodo repite su rechazo sin volver a mirar el saldo: parece
 * que recargar no ha servido de nada. Comprobando antes de firmar, esa
 * transacción condenada no llega a enviarse.
 *
 * Por eso esto se mira aquí y no se deja al error: con el error se sabe que
 * falla, pero no cuánto falta.
 */

import type { Abi, Address, PublicClient } from 'viem';

export interface Reserva {
  /** Lo que Monad bloquea por adelantado, en wei (más el `value` si lo hay). */
  reserva: bigint;
  /** Lo que tiene la wallet. */
  saldo: bigint;
  /** Lo que falta para cubrir la reserva. 0 si llega. */
  falta: bigint;
}

/**
 * Cuánto reservará una llamada a un contrato, y cuánto le falta a la wallet.
 *
 * Devuelve `null` si no se puede estimar —RPC caído, o una llamada que el
 * contrato rechazaría por otra razón, como un agente ya registrado—. Ahí no se
 * bloquea nada: se deja pasar y que hable el error de verdad. Esto es un aviso
 * que ahorra un rechazo, no una puerta.
 */
export async function reservaParaContrato(
  cliente: PublicClient,
  llamada: {
    account: Address;
    address: Address;
    abi: Abi;
    functionName: string;
    args: readonly unknown[];
    value?: bigint;
  },
): Promise<Reserva | null> {
  try {
    const [gas, comisiones, saldo] = await Promise.all([
      cliente.estimateContractGas(llamada as never),
      cliente.estimateFeesPerGas(),
      cliente.getBalance({ address: llamada.account }),
    ]);
    const reserva = gas * comisiones.maxFeePerGas + (llamada.value ?? 0n);
    return { reserva, saldo, falta: reserva > saldo ? reserva - saldo : 0n };
  } catch {
    return null;
  }
}

/** ¿Este error es el de la reserva, por mucho que venga vestido de revert? */
export function esFaltaDeReserva(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err ?? '');
  return /insufficient (balance|funds)/i.test(m);
}

/**
 * Una cantidad de MON para enseñarla, redondeando HACIA ARRIBA.
 *
 * Hacia arriba a propósito: si faltan 0,01234 MON y se enseña «0,012», quien
 * recargue exactamente eso seguirá sin llegar.
 */
export function monHaciaArriba(wei: bigint, decimales = 4): string {
  const escala = 10n ** BigInt(18 - decimales);
  const redondeado = (wei + escala - 1n) / escala;
  const entero = redondeado / 10n ** BigInt(decimales);
  const fraccion = (redondeado % 10n ** BigInt(decimales)).toString().padStart(decimales, '0').replace(/0+$/, '');
  return fraccion ? `${entero}.${fraccion}` : entero.toString();
}

/**
 * Por encima de esto una retirada no se firma. Retirar MON son 55.157 de gas y
 * $PANAL 103.511 (medido el 2026-09-14): 300.000 sobra para cualquier retirada
 * honrada y corta una estimación disparatada antes de que se cobre.
 */
export const TOPE_GAS_RETIRADA = 300_000n;

/** Se lanza cuando la estimación sale por encima del tope: no se firma nada. */
export class GasFueraDeRango extends Error {
  readonly estimado: bigint;
  constructor(estimado: bigint) {
    super(`gas estimado ${estimado} por encima de ${TOPE_GAS_RETIRADA}`);
    this.name = 'GasFueraDeRango';
    this.estimado = estimado;
  }
}

/**
 * El gas con el que se firma una retirada: `eth_estimateGas` + 10 %.
 *
 * POR QUÉ HACE FALTA, Y LO QUE COSTÓ. viem no estima el gas: le pide al nodo
 * que rellene la transacción (`eth_fillTransaction`), y el de Monad devuelve un
 * gas disparatado para retirar MON —1,05 M para una wallet, 10,7 M para otra—
 * cuando lo necesario son 55.157. Monad cobra el LÍMITE entero, no lo usado:
 * una retirada de 1,092 MON pagó 1,096 MON de gas (tx 0xa960cb7e…). Con el gas
 * explícito, viem lo respeta.
 *
 * Afecta sobre todo a la wallet integrada de la app, que firma con una cuenta
 * local de viem. Una wallet de navegador suele estimar por su cuenta, pero
 * pasarle el gas no le hace daño y la cubre si no lo hace.
 */
export async function gasDeRetirada(
  cliente: PublicClient,
  llamada: { account: Address; address: Address; abi: Abi; functionName: string; args?: readonly unknown[] },
): Promise<bigint> {
  const estimado = await cliente.estimateContractGas(llamada as never);
  const gas = (estimado * 11n + 9n) / 10n;
  if (gas > TOPE_GAS_RETIRADA) throw new GasFueraDeRango(estimado);
  return gas;
}
