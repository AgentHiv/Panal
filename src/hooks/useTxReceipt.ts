/**
 * Panal — Esperar una transacción SIN dar por buena la que revierte.
 *
 * `useWaitForTransactionReceipt` de wagmi expone `isSuccess`, y ese nombre
 * engaña: significa "llegó el recibo", no "la transacción funcionó". Una tx
 * que revierte también se mina, también entra en un bloque y también gasta
 * gas — simplemente no hace nada. viem la resuelve sin lanzar
 * (`waitForTransactionReceipt` nunca mira `receipt.status`), así que wagmi
 * pone `isSuccess = true` y la UI canta victoria.
 *
 * Costó un registro de agente: la web enseñó el tick verde y "registrado con
 * éxito" para una transacción revertida por `already registered`, y el agente
 * no existía en ninguna parte.
 *
 * El dato que distingue una cosa de otra es `receipt.status`. Aquí se mira una
 * vez y se devuelve ya masticado, para no volver a confundirlos.
 */

import { useWaitForTransactionReceipt } from 'wagmi';
import type { TransactionReceipt } from 'viem';

export interface TxReceiptState {
  /** La tx está en vuelo, esperando recibo. */
  confirming: boolean;
  /** Minada Y ejecutada bien. Esto es lo que debe abrir una pantalla de éxito. */
  mined: boolean;
  /** Minada pero revertida: gastó gas y no hizo nada. */
  reverted: boolean;
  /** El recibo crudo (para leer `logs`, por ejemplo). */
  receipt: TransactionReceipt | undefined;
}

export function useTxReceipt(hash: `0x${string}` | undefined): TxReceiptState {
  const { isLoading, isSuccess, data } = useWaitForTransactionReceipt({ hash });
  const recibido = isSuccess && data !== undefined;
  return {
    confirming: isLoading,
    mined: recibido && data.status === 'success',
    reverted: recibido && data.status === 'reverted',
    receipt: data,
  };
}
