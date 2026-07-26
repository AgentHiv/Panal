/**
 * Panal — Provider del estado global de wallet REAL (wagmi · injected).
 * Mantiene la misma API pública que la wallet simulada original y añade
 * detección de red incorrecta con acción para cambiar a Monad testnet.
 */

import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useAccount, useChainId, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { WalletContext, shortAddress } from '@/hooks/useWallet';
import type { WalletState } from '@/hooks/useWallet';
import InstallWalletDialog from '@/components/InstallWalletDialog';
import { monadTestnet } from '@/contracts/config';

export default function WalletProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connect, isPending: connecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const [installOpen, setInstallOpen] = useState(false);

  const openInstallDialog = useCallback(() => setInstallOpen(true), []);

  const doConnect = useCallback(() => {
    if (isConnected || connecting) return;
    // Sin wallet EVM inyectada wagmi lanzaría ConnectorNotFoundError en silencio:
    // mejor explicar al usuario cómo instalar MetaMask (deep link en móvil).
    if (typeof window !== 'undefined' && !window.ethereum) {
      setInstallOpen(true);
      return;
    }
    connect(
      { connector: injected() },
      { onError: () => toast.error(t('wallet.connectError')) },
    );
  }, [connect, isConnected, connecting, t]);

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
      installOpen,
      openInstallDialog,
    }),
    [isConnected, connecting, address, doConnect, doDisconnect, wrongNetwork, switchToMonad, chainId, installOpen, openInstallDialog],
  );

  return (
    <WalletContext.Provider value={value}>
      {children}
      <InstallWalletDialog open={installOpen} onOpenChange={setInstallOpen} />
    </WalletContext.Provider>
  );
}
