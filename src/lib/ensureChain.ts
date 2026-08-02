/**
 * Guarda de red previa a firmar una transacción.
 *
 * Problema que resuelve: el estado de wagmi (`useChainId`) puede quedar
 * DESINCRONIZADO de la chain real de la wallet (p. ej. la wallet resuelve
 * `wallet_switchEthereumChain` sin cambiar de verdad, o el usuario cambia
 * de red dentro de la wallet sin que llegue el evento `chainChanged`).
 * En ese caso el guard clásico (`chainId !== activeChain.id`) se salta y
 * `writeContract` falla con el error crudo de viem:
 * "The current chain of the wallet (id: 1) does not match the target chain
 * for the transaction (id: 143)".
 *
 * Aquí se consulta la chain REAL de la wallet (`eth_chainId` vía el
 * conector activo) antes de firmar, y se RE-VERIFICA después de pedir el
 * cambio de red. Si la wallet sigue en otra chain, se aborta limpio.
 */

import { getConnections } from 'wagmi/actions';
import { activeChain, wagmiConfig } from '@/contracts/config';

/** Chain que reporta la wallet ahora mismo; null si no se puede leer. */
async function walletRealChainId(): Promise<number | null> {
  try {
    const [connection] = getConnections(wagmiConfig);
    if (!connection) return null;
    return await connection.connector.getChainId();
  } catch {
    return null;
  }
}

export interface EnsureChainArgs {
  connected: boolean;
  /** Chain según el estado de wagmi (fallback si no se puede leer la real). */
  chainId: number | null;
  switchChainAsync: (args: { chainId: number }) => Promise<unknown>;
}

/**
 * Garantiza que la wallet está en `activeChain` antes de enviar una tx.
 * Devuelve true si se puede firmar; false si hay que abortar (el caller
 * muestra el toast de red incorrecta).
 */
export async function ensureActiveChain({
  connected,
  chainId,
  switchChainAsync,
}: EnsureChainArgs): Promise<boolean> {
  if (!connected) return false;
  const current = (await walletRealChainId()) ?? chainId;
  if (current === activeChain.id) return true;
  try {
    await switchChainAsync({ chainId: activeChain.id });
  } catch {
    return false; // el usuario rechazó el cambio (o la wallet no lo soporta)
  }
  // Re-verificar contra la wallet: si no se puede leer, confiamos en el
  // switch resuelto; si se puede, exigimos la chain correcta de verdad.
  const after = await walletRealChainId();
  return after === null ? true : after === activeChain.id;
}
