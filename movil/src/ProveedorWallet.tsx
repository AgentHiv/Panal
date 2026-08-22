import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useAccount, useChainId, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { WalletContext, shortAddress } from '@/hooks/useWallet';
import type { WalletState } from '@/hooks/useWallet';
import { activeChain } from '@/contracts/config';
import { WALLETCONNECT_ID } from '@/lib/wallets';
import HojaWallet from '~/componentes/HojaWallet';

/**
 * El mismo contrato que la web, la interfaz de nadie.
 *
 * `WalletContext` vive en la capa compartida, así que todos los hooks que
 * llaman a `useWallet()` funcionan aquí sin tocarlos. Lo que NO se reutiliza es
 * el proveedor de la web: arrastra tres diálogos suyos —instalar wallet,
 * elegirla, WalletConnect con QR— y en un teléfono el QR no sirve para nada,
 * porque la wallet está en la MISMA pantalla que lo enseñaría.
 *
 * LO QUE ESTABA ROTO
 * ------------------
 * Conectaba con `connectors[0]`, que es `injected()`: una wallet que escribe
 * `window.ethereum` en la página. Dentro de un WebView eso no existe nunca, así
 * que salía `ConnectorNotFoundError` y wagmi lo dejaba en el estado de la
 * mutación, que nadie miraba. El botón no conectaba y tampoco decía nada.
 *
 * Aquí solo se usa WalletConnect: es lo único que puede funcionar dentro del
 * APK. `injected` sigue en la config compartida porque la WEB sí lo necesita.
 */
export default function ProveedorWallet({ children }: { children: ReactNode }): React.ReactElement {
  const { address, isConnected, status } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const chainId = useChainId();

  const [hoja, setHoja] = useState(false);
  /** La URI de la sesión, mientras se espera aprobación en la wallet. */
  const [uri, setUri] = useState<string | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);

  const wc = useMemo(() => connectors.find((c) => c.id === WALLETCONNECT_ID), [connectors]);

  /**
   * La URI llega por un EVENTO, no por la promesa de `connect`.
   *
   * El conector la emite en cuanto levanta la sesión contra el relé, mucho
   * antes de que nadie apruebe nada. La suscripción vive aquí y no en la hoja
   * porque la hoja se monta al pulsar, y para entonces el evento ya pudo pasar.
   */
  useEffect(() => {
    if (!wc) return;
    const alMensaje = ({ type, data }: { type: string; data?: unknown }): void => {
      if (type === 'display_uri' && typeof data === 'string') setUri(data);
    };
    wc.emitter.on('message', alMensaje);
    return () => wc.emitter.off('message', alMensaje);
  }, [wc]);

  const conectar = useCallback(() => {
    if (isConnected || isPending) return;
    // La hoja se abre YA, sin URI todavía: levantar la sesión contra el relé
    // tarda un segundo largo y un botón que no responde parece roto —que es
    // exactamente el fallo que estamos arreglando—.
    setUri(null);
    setFallo(null);
    setHoja(true);
    if (!wc) return; // La hoja explica que se compiló sin WalletConnect.

    connect(
      { connector: wc },
      {
        onSuccess: () => {
          setHoja(false);
          setUri(null);
        },
        onError: (err) => {
          console.error('[panal] no se pudo conectar:', err);
          // Cerrar la wallet o rechazar no es un fallo: es cambiar de idea.
          const cancelado =
            err.name === 'UserRejectedRequestError' ||
            /user rejected|user closed|modal closed|connection request reset/i.test(
              err.message ?? '',
            );
          if (cancelado) {
            setHoja(false);
            setUri(null);
            return;
          }
          // El motivo EN LA PANTALLA. Con WalletConnect el fallo suele estar
          // del lado de Reown —projectId, dominio no permitido, cuota— y desde
          // un teléfono no hay consola donde mirarlo.
          setFallo((err.message ?? 'Error desconocido').split('\n')[0].slice(0, 200));
        },
      },
    );
  }, [connect, isConnected, isPending, wc]);

  /**
   * Cerrar con una conexión a medias cierra TAMBIÉN la sesión pendiente.
   *
   * Sin esto queda una sesión viva en el relé esperando aprobación: si luego se
   * vuelve a pulsar se levanta otra, y la wallet acaba con varias peticiones
   * de la misma app sin saber cuál es la buena.
   */
  const cerrarHoja = useCallback(() => {
    setHoja(false);
    setUri(null);
    setFallo(null);
    if (isPending && wc) void wc.disconnect().catch(() => {});
  }, [isPending, wc]);

  /**
   * Reabrir la app no es desconectarse. Mientras wagmi recupera la sesión
   * guardada, `isConnected` es `false`; sin mirar `status` la app enseñaría
   * «conectar» a quien ya está dentro y solo tiene que esperar un instante.
   */
  const conectando = isPending || status === 'reconnecting';

  const valor = useMemo<WalletState>(
    () => ({
      connected: isConnected,
      connecting: conectando,
      address: address ?? null,
      addressShort: address ? shortAddress(address) : null,
      connect: conectar,
      disconnect: () => disconnect(),
      wrongNetwork: isConnected && chainId !== activeChain.id,
      switchToMonad: () => switchChain({ chainId: activeChain.id }),
      chainId: isConnected ? chainId : null,
      installOpen: false,
      openInstallDialog: conectar,
    }),
    [address, chainId, conectando, conectar, disconnect, isConnected, switchChain],
  );

  return (
    <WalletContext.Provider value={valor}>
      {children}
      <HojaWallet
        abierta={hoja}
        uri={uri}
        hayWalletConnect={!!wc}
        fallo={fallo}
        onCerrar={cerrarHoja}
      />
    </WalletContext.Provider>
  );
}
