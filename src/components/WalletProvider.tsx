/**
 * Panal — Provider del estado global de wallet REAL (wagmi).
 *
 * Dos caminos, y hacen falta los dos:
 *
 *   - INYECTADA. MetaMask, Trust Wallet y cualquier wallet EIP-6963. Sirve en
 *     un escritorio con extensión y dentro del navegador propio de una wallet.
 *   - WALLETCONNECT. La única que sirve en el Chrome o el Safari de un
 *     teléfono, donde no hay nada inyectado. Se activa con
 *     VITE_WALLETCONNECT_PROJECT_ID.
 *
 * Con varias opciones se abre un picker; con una sola se conecta directo.
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
import { elegirWallets } from '@/lib/wallets';

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
   * Wallets ofrecibles. El criterio vive en `@/lib/wallets`, con sus pruebas:
   * decide si alguien puede entrar, y eso no se razona bien leyendo JSX.
   */
  const walletOptions = useMemo<Connector[]>(
    () => elegirWallets(connectors, typeof window !== 'undefined' && !!window.ethereum),
    [connectors],
  );

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
    // Sin ninguna opción —ni wallet inyectada ni WalletConnect configurado—
    // wagmi lanzaría ConnectorNotFoundError en silencio: mejor explicar cómo
    // conseguir una wallet.
    //
    // La comprobación de `window.ethereum` que había aquí se movió a
    // `walletOptions`: allí es donde se decide qué se puede ofrecer, y
    // tenerla en dos sitios hacía que añadir WalletConnect —que no necesita
    // nada inyectado— dejara este botón sin salida en un móvil, que es justo
    // donde más falta hace.
    if (walletOptions.length === 0) {
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
