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

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useAccount, useChainId, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import type { Connector } from 'wagmi';
import { WalletContext, shortAddress } from '@/hooks/useWallet';
import type { WalletState } from '@/hooks/useWallet';
import InstallWalletDialog from '@/components/InstallWalletDialog';
import WalletPickerDialog from '@/components/WalletPickerDialog';
import WalletConnectDialog from '@/components/WalletConnectDialog';
import { activeChain } from '@/contracts/config';
import { elegirWallets, WALLETCONNECT_ID } from '@/lib/wallets';

export default function WalletProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connect, connectors, isPending: connecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const [installOpen, setInstallOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  /** La URI de la sesión de WalletConnect, mientras se espera aprobación. */
  const [wcUri, setWcUri] = useState<string | null>(null);
  const [wcOpen, setWcOpen] = useState(false);

  /**
   * La URI de WalletConnect llega por un evento, no por la promesa de
   * `connect`.
   *
   * El conector la emite en cuanto levanta la sesión contra el relé, mucho
   * antes de que nadie apruebe nada, y es lo único que se necesita para pintar
   * el QR o abrir la app del teléfono. La suscripción vive aquí y no en el
   * diálogo porque el diálogo se monta DESPUÉS de pulsar, y para entonces el
   * evento ya podría haber pasado.
   */
  useEffect(() => {
    const wc = connectors.find((c) => c.id === WALLETCONNECT_ID);
    if (!wc) return;
    const alMensaje = ({ type, data }: { type: string; data?: unknown }): void => {
      if (type === 'display_uri' && typeof data === 'string') setWcUri(data);
    };
    wc.emitter.on('message', alMensaje);
    return () => wc.emitter.off('message', alMensaje);
  }, [connectors]);

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
      // Con WalletConnect la pantalla se abre YA, sin URI todavía: levantar la
      // sesión tarda un instante y un botón que no responde parece roto.
      if (connector.id === WALLETCONNECT_ID) {
        setWcUri(null);
        setWcOpen(true);
      }
      connect(
        { connector },
        {
          onSuccess: () => {
            setPickerOpen(false);
            setWcOpen(false);
            setWcUri(null);
          },
          onError: (err) => {
            // El error se TIRABA. Con una wallet inyectada casi daba igual
            // —el fallo suele ser que el usuario rechaza—, pero con
            // WalletConnect el motivo vive en el lado de Reown: projectId
            // equivocado, dominio no permitido, proyecto sin cuota. Sin esto
            // el usuario ve "no se pudo conectar" y la consola, vacía, y no
            // hay forma de saber cuál de los tres es.
            console.error(`[panal] no se pudo conectar con ${connector.name}:`, err);

            // Cerrar el QR o rechazar en la wallet NO es un fallo, y decirle
            // "no se pudo conectar" a quien acaba de cambiar de idea es
            // hacerle creer que la web está rota.
            const cancelado =
              err.name === 'UserRejectedRequestError' ||
              /user rejected|user closed|modal closed|connection request reset/i.test(err.message ?? '');
            setWcOpen(false);
            setWcUri(null);
            if (!cancelado) {
              // El motivo va EN EL AVISO, no solo en la consola.
              //
              // "No se pudo conectar, inténtalo de nuevo" es lo mismo para un
              // projectId mal puesto, un relé caído y una wallet que no
              // responde, y quien lo lee no tiene forma de saber cuál es ni de
              // contárselo a nadie. Se recorta porque algunos errores de
              // WalletConnect traen un volcado entero.
              const motivo = (err.message ?? '').split('\n')[0]?.slice(0, 160);
              toast.error(t('wallet.connectError'), motivo ? { description: motivo } : undefined);
            }
          },
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
      <WalletConnectDialog uri={wcUri} open={wcOpen} onOpenChange={setWcOpen} />
      <InstallWalletDialog open={installOpen} onOpenChange={setInstallOpen} />
    </WalletContext.Provider>
  );
}
