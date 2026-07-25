/**
 * Panal — Provider del estado global de wallet REAL (wagmi · injected).
 * Mantiene la misma API pública que la wallet simulada original y añade
 * detección de red incorrecta con acción para cambiar a Monad testnet.
 */

import { useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useAccount, useChainId, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { WalletContext, shortAddress } from '@/hooks/useWallet';
import type { WalletState } from '@/hooks/useWallet';
import { monadTestnet } from '@/contracts/config';

export default function WalletProvider({ children }: { children: ReactNode }) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connect, isPending: connecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  const doConnect = useCallback(() => {
    if (isConnected || connecting) return;
    connect({ connector: injected() });
  }, [connect, isConnected, connecting]);

  const doDisconnect = useCallback(() => {
    disconnect();
  }, [disconnect]);

  const wrongNetwork = isConnected && chainId !== monadTestnet.id;

  const switchToMonad = useCallback(() => {
    switchChain({ chainId: monadTestnet.id });
  }, [switchChain]);

  const value = useMemo<WalletState>(
    () => ({
      connected: isConnected,
      connecting,
      address: address ?? null,
      addressShort: address ? shortAddress(address) : null,
      connect: doConnect,
      disconnect: doDisconnect,
      wrongNetwork,
      switchToMonad,
      chainId: isConnected ? chainId : null,
    }),
    [isConnected, connecting, address, doConnect, doDisconnect, wrongNetwork, switchToMonad, chainId],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}
