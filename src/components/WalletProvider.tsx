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
 *
 * Con WalletConnect en un teléfono, además, va a buscar a la wallet en cada
 * firma (ver «Ir a buscar a la wallet» más abajo).
 * Añade detección de red incorrecta con acción para cambiar a la red activa
 * (Monad mainnet por defecto).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import AvisoFirmaWallet from '@/components/AvisoFirmaWallet';
import { activeChain } from '@/contracts/config';
import { elegirWallets, WALLETCONNECT_ID } from '@/lib/wallets';
import { esMovil } from '@/lib/deepLinks';
import { PIDE_FIRMA, enlaceDeVuelta, olvidarWallet, walletRecordada } from '@/lib/vueltaWallet';
import type { Redireccion } from '@/lib/vueltaWallet';

/** Lo poco que hace falta saber del proveedor de WalletConnect. */
interface ProveedorWC {
  request: (args: { method: string; params?: unknown }) => Promise<unknown>;
  session?: { peer?: { metadata?: { name?: string; redirect?: Redireccion } } };
  __panalEnvuelto?: boolean;
}

/**
 * Trae la wallet al frente.
 *
 * Un esquema propio (`metamask://`, `panal://`) se abre con `location.href`:
 * es una navegación que Android entrega a la app sin que la página se vaya a
 * ninguna parte. Un https NO: si el sistema no lo asocia a la app, cargaría la
 * web de la wallet EN ESTA pestaña, en mitad de una firma. Ese va a otra.
 */
function abrirWallet(enlace: string): void {
  if (/^https?:/i.test(enlace)) window.open(enlace, '_blank', 'noopener,noreferrer');
  else window.location.href = enlace;
}

export default function WalletProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { address, isConnected, status, connector: enMarcha } = useAccount();
  const chainId = useChainId();
  const { connect, connectors, isPending: conectando } = useConnect();

  /**
   * Recargar la página NO es desconectarse.
   *
   * wagmi guarda la sesión y al montar intenta recuperarla, y mientras lo hace
   * `isConnected` es `false`. Sin mirar `status`, la barra no distinguía ese
   * instante de no tener wallet: enseñaba «Conectar wallet» a alguien que ya
   * estaba conectado y sólo tenía que esperar un momento.
   *
   * Y no era sólo cosmético. Pulsar ahí lanzaba un `connect` NUEVO por encima
   * del que ya venía en camino, así que la wallet pedía aprobación otra vez
   * para una sesión que iba a volver sola.
   *
   * Sólo `reconnecting`, no `connecting`: wagmi pone `connecting` también en
   * la primera visita de quien nunca conectó nada, y ahí deshabilitar el botón
   * sería estorbar sin motivo. `reconnecting` significa exactamente «había una
   * sesión guardada y la estoy recuperando».
   */
  const reconectando = status === 'reconnecting';
  const connecting = conectando || reconectando;
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const [installOpen, setInstallOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  /** La URI de la sesión de WalletConnect, mientras se espera aprobación. */
  const [wcUri, setWcUri] = useState<string | null>(null);
  const [wcOpen, setWcOpen] = useState(false);
  /** Hay una firma esperando en la wallet del teléfono, y cómo ir a ella. */
  const [firma, setFirma] = useState<{ enlace: string | null; nombre: string } | null>(null);
  /** Cuántas firmas siguen en camino: el aviso se quita con la última, no con la primera. */
  const enCamino = useRef(0);

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
    // Solo aquí, y no al ver `isConnected` en falso: eso también pasa un
    // instante al recargar, mientras wagmi recupera la sesión.
    olvidarWallet();
    disconnect();
  }, [disconnect]);

  /**
   * Ir a buscar a la wallet cuando sale una firma, y decirlo en pantalla.
   *
   * EL FALLO. En el Chrome de un teléfono, conectar abría la wallet, pero
   * después cada firma —pagar un mensaje, encargar, aprobar— viajaba por el
   * relé hasta una wallet que estaba en segundo plano. Nadie la traía al
   * frente: la web se quedaba esperando y parecía colgada. WalletConnect lo
   * resuelve solo si encuentra la clave que escribe el modal de Reown, y esta
   * web no usa ese modal (ver `WalletConnectDialog`).
   *
   * Así que se hace como en la app (`movil/src/ProveedorWallet.tsx`): se
   * envuelve `request` una sola vez por proveedor, y cada petición que pide
   * firma abre la wallet con el enlace que ella misma mandó al conectar, o con
   * el que se tocó en el diálogo. Y mientras espera, un aviso con un botón,
   * porque una redirección sin gesto de la persona puede bloquearla el
   * navegador, y quedarse sin saber que hay algo esperando es el fallo.
   *
   * Solo en un teléfono: en un escritorio la wallet está en otro aparato y el
   * QR ya dijo dónde mirar.
   */
  useEffect(() => {
    if (!isConnected || !enMarcha || enMarcha.id !== WALLETCONNECT_ID || !esMovil()) return;
    let vivo = true;
    let deshacer: (() => void) | null = null;

    void (async () => {
      const p = (await enMarcha.getProvider()) as ProveedorWC;
      if (!vivo || p.__panalEnvuelto) return;

      const meta = p.session?.peer?.metadata;
      const salida = enlaceDeVuelta(meta?.redirect, walletRecordada());
      const nombre = meta?.name?.trim() || t('wallet.firma.tuWallet');

      const original = p.request.bind(p);
      p.__panalEnvuelto = true;
      p.request = async (args) => {
        if (!PIDE_FIRMA.has(args.method)) return original(args);
        enCamino.current += 1;
        setFirma({ enlace: salida, nombre });
        if (salida) abrirWallet(salida);
        try {
          return await original(args);
        } finally {
          enCamino.current = Math.max(0, enCamino.current - 1);
          if (enCamino.current === 0) setFirma(null);
        }
      };

      deshacer = () => {
        Reflect.deleteProperty(p, 'request');
        Reflect.deleteProperty(p, '__panalEnvuelto');
      };
    })();

    return () => {
      vivo = false;
      deshacer?.();
      enCamino.current = 0;
      setFirma(null);
    };
  }, [isConnected, enMarcha, t]);

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
      <AvisoFirmaWallet firma={firma} onAbrir={abrirWallet} />
      <InstallWalletDialog open={installOpen} onOpenChange={setInstallOpen} />
    </WalletContext.Provider>
  );
}
