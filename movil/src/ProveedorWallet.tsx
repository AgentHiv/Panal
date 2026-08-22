import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useAccount, useChainId, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { WalletContext, shortAddress } from '@/hooks/useWallet';
import type { WalletState } from '@/hooks/useWallet';
import { activeChain } from '@/contracts/config';

/**
 * El mismo contrato que la web, la interfaz de nadie.
 *
 * `WalletContext` vive en la capa compartida, así que todos los hooks que
 * llaman a `useWallet()` funcionan aquí sin tocarlos. Lo que NO se reutiliza es
 * el proveedor de la web: arrastra tres diálogos suyos —instalar wallet,
 * elegirla, WalletConnect— y esos son justo la parte que la app tiene que
 * resolver a su manera, con la pantalla de entrada del diseño.
 *
 * De momento conecta con el primer conector disponible. La pantalla de entrada
 * («créala aquí» / «conecta la mía») entra después.
 */
export default function ProveedorWallet({ children }: { children: ReactNode }): React.ReactElement {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const chainId = useChainId();
  const [installOpen, setInstallOpen] = useState(false);

  const conectar = useCallback(() => {
    const conector = connectors[0];
    if (!conector) {
      setInstallOpen(true);
      return;
    }
    connect({ connector: conector });
  }, [connect, connectors]);

  const valor = useMemo<WalletState>(
    () => ({
      connected: isConnected,
      connecting: isPending,
      address: address ?? null,
      addressShort: address ? shortAddress(address) : null,
      connect: conectar,
      disconnect: () => disconnect(),
      wrongNetwork: isConnected && chainId !== activeChain.id,
      switchToMonad: () => switchChain({ chainId: activeChain.id }),
      chainId: chainId ?? null,
      installOpen,
      openInstallDialog: () => setInstallOpen(true),
    }),
    [address, chainId, conectar, disconnect, installOpen, isConnected, isPending, switchChain],
  );

  return <WalletContext.Provider value={valor}>{children}</WalletContext.Provider>;
}
