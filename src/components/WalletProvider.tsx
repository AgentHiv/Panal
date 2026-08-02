/**
 * Panal — Provider del estado global de wallet REAL (wagmi · injected).
 * Soporta MetaMask, Trust Wallet y cualquier wallet EIP-6963: con varias
 * wallets instaladas se abre un picker; con una sola se conecta directo.
 * Añade detección de red incorrecta con acción para cambiar a la red activa
 * (Monad mainnet por defecto).
 */

import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useAccount, useChainId, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import type { Connector } from 'wagmi';
import { WalletContext, shortAddress } from '@/hooks/useWallet';
import type { WalletState } from '@/hooks/useWallet';
import InstallWalletDialog from '@/components/InstallWalletDialog';
import WalletPickerDialog from '@/components/WalletPickerDialog';
import { activeChain } from '@/contracts/config';

/** ID del injected genérico (window.ethereum sin objetivo concreto). */
const GENERIC_INJECTED_ID = 'injected';

export default function WalletProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connect, connectors, isPending: connecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const [installOpen, setInstallOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const openInstallDialog = useCallback(() => setInstallOpen(true), []);

  /**
   * Wallets ofrecibles: las detectadas (EIP-6963 / conector dirigido de
   * Trust Wallet), deduplicadas por nombre — Trust Wallet puede llegar por
   * ambas vías; se prefiere la entrada con icono (la descubierta). El
   * injected genérico solo se ofrece cuando no hay ninguna específica.
   */
  const walletOptions = useMemo<Connector[]>(() => {
    const byName = new Map<string, Connector>();
    for (const c of connectors) {
      if (c.id === GENERIC_INJECTED_ID) continue;
      const key = c.name.trim().toLowerCase();
      const prev = byName.get(key);
      if (!prev || (!prev.icon && c.icon)) byName.set(key, c);
    }
    const specific = [...byName.values()];
    if (specific.length > 0) return specific;
    return connectors.filter((c) => c.id === GENERIC_INJECTED_ID);
  }, [connectors]);

  const connectWith = useCallback(
    (connector: Connector) => {
      connect(
        { connector },
        {
          onSuccess: () => setPickerOpen(false),
          onError: () => toast.error(t('wallet.connectError')),
        },
      );
    },
    [connect, t],
  );

  const doConnect = useCallback(() => {
    if (isConnected || connecting) return;
    // Sin wallet EVM inyectada wagmi lanzaría ConnectorNotFoundError en silencio:
    // mejor explicar al usuario cómo instalar una (MetaMask / Trust Wallet).
    const hasInjected = typeof window !== 'undefined' && !!window.ethereum;
    if (!hasInjected || walletOptions.length === 0) {
      setInstallOpen(true);
      return;
    }
    if (walletOptions.length === 1) {
      connectWith(walletOptions[0]);
      return;
    }
    setPickerOpen(true);
  }, [connectWith, isConnected, connecting, walletOptions]);

  const doDisconnect = useCallback(() => {
    disconnect();
  }, [disconnect]);

  const wrongNetwork = isConnected && chainId !== activeChain.id;

  const switchToMonad = useCallback(() => {
    switchChain({ chainId: activeChain.id });
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
      <WalletPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        connectors={walletOptions}
        connecting={connecting}
        onSelect={connectWith}
      />
      <InstallWalletDialog open={installOpen} onOpenChange={setInstallOpen} />
    </WalletContext.Provider>
  );
}
