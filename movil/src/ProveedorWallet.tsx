import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccount, useChainId, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { WalletContext, shortAddress } from '@/hooks/useWallet';
import type { WalletState } from '@/hooks/useWallet';
import { activeChain } from '@/contracts/config';
import { WALLETCONNECT_ID } from '@/lib/wallets';
import HojaWallet from '~/componentes/HojaWallet';
import AvisoFirma from '~/componentes/AvisoFirma';
import { abrirFuera } from '~/lib/wallets';
import { PIDE_FIRMA, enlaceDeVuelta, olvidarWallet, walletRecordada } from '~/lib/regreso';
import type { Redireccion } from '~/lib/regreso';
import Teclado from '~/componentes/Teclado';
import Icono from '~/componentes/Icono';
import { conectorLlavero } from '~/lib/conector';
import { abrirSesion, idRecordado, useSesion } from '~/lib/sesion';
import { abrir as abrirLlavero, listar } from '~/lib/llavero';
import { useTextos } from '~/i18n/idiomas';
import type { WalletGuardada } from '~/lib/llavero';

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
 *
 * LO SEGUNDO QUE ESTABA ROTO
 * --------------------------
 * Conectar iba, pero FIRMAR no llegaba nunca. La petición sale por el relé y
 * la wallet está en segundo plano; si nadie la trae al frente, se queda ahí
 * esperando y la app parece colgada. WalletConnect trae la redirección hecha y
 * estaba muerta por dos motivos —falta la clave que escribe el modal que
 * quitamos, y redirige con `window.open`, que en un WebView no sale a
 * Android—; los dos están explicados en `lib/regreso.ts`.
 *
 * LA TERCERA FORMA DE FIRMAR
 * --------------------------
 * Y la que quita la incomodidad de raíz: la wallet del propio teléfono. Con
 * ella no hay relé, ni otra app, ni redirección que pueda fallar — se firma
 * donde se está. Va por un conector de wagmi propio (`lib/conector.ts`), así
 * que las quince pantallas de la app no distinguen una de otra.
 *
 * Se arregla envolviendo `request` del proveedor. No hay API pública para
 * «va a salir una petición»: el evento `session_request_sent` vive en el
 * `SignClient` de dentro y llegar hasta él es agarrarse a tres capas de
 * campos internos. `request` es la única puerta por la que pasa TODO lo que
 * wagmi pide, y envolverla da las dos cosas que hacen falta: ir a buscar a la
 * wallet, y saber cuándo hay algo esperando para poder decirlo en pantalla.
 */
/** Lo poco que hace falta saber del proveedor de WalletConnect. */
interface ProveedorWC {
  request: (args: { method: string; params?: unknown }) => Promise<unknown>;
  session?: { peer?: { metadata?: { redirect?: Redireccion } } };
  __panalEnvuelto?: boolean;
}

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
  /** Hay una petición esperando aprobación en la otra app. */
  const [firmando, setFirmando] = useState(false);
  /** Por dónde se vuelve a esa app. `null` si no lo sabemos. */
  const [vuelta, setVuelta] = useState<string | null>(null);
  /** La wallet del llavero que se está desbloqueando, si hay alguna. */
  const [abriendo, setAbriendo] = useState<WalletGuardada | null>(null);
  const [errorPin, setErrorPin] = useState<string | null>(null);
  const [ocupadoPin, setOcupadoPin] = useState(false);

  const navegar = useNavigate();
  const sesion = useSesion();
  const T = useTextos();
  // Uno solo por montaje: cada `connect` con una función crea un conector
  // nuevo, y con la misma referencia al menos no se multiplican por render.
  const conector = useMemo(() => conectorLlavero(), []);
  // Se leen al abrir la hoja, no en cada render: el llavero está en disco.
  const [delTelefono, setDelTelefono] = useState<WalletGuardada[]>([]);

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

  /**
   * Ir a buscar a la wallet cuando sale una firma, y decirlo en pantalla.
   *
   * Se envuelve una sola vez por proveedor —`envuelto` lo marca— porque el
   * efecto se vuelve a ejecutar al reconectar y envolver dos veces abriría la
   * wallet dos veces por firma.
   */
  useEffect(() => {
    if (!isConnected || !wc) return;
    let vivo = true;
    let deshacer: (() => void) | null = null;

    void (async () => {
      const p = (await wc.getProvider()) as ProveedorWC;
      if (!vivo || p.__panalEnvuelto) return;

      const salida = enlaceDeVuelta(p.session?.peer?.metadata?.redirect, walletRecordada());
      setVuelta(salida);

      const original = p.request.bind(p);
      p.__panalEnvuelto = true;
      p.request = async (args) => {
        if (!PIDE_FIRMA.has(args.method)) return original(args);
        setFirmando(true);
        if (salida) abrirFuera(salida);
        try {
          return await original(args);
        } finally {
          setFirmando(false);
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
    };
  }, [isConnected, wc]);

  /**
   * Conectar la wallet de este teléfono.
   *
   * El PIN se pide aquí y no dentro del conector porque un conector de wagmi
   * no puede enseñar nada: `connect()` devuelve cuentas o falla. Así que la
   * secuencia es al revés de lo que parece — primero se abre el llavero, y
   * solo cuando ya hay una cuenta lista se le dice a wagmi que conecte.
   */
  const conLaDelTelefono = useCallback(
    async (pin: string): Promise<void> => {
      if (!abriendo) return;
      setOcupadoPin(true);
      // Un respiro para que React pinte el sexto punto antes de que PBKDF2
      // bloquee el hilo medio segundo.
      await new Promise((r) => setTimeout(r, 30));
      const llave = await abrirLlavero(pin);
      if (!llave) {
        setOcupadoPin(false);
        setErrorPin(T.llavero.pinMalo);
        return;
      }
      try {
        await abrirSesion(llave, abriendo);
        connect({ connector: conector });
        setAbriendo(null);
        setErrorPin(null);
        setHoja(false);
      } catch {
        setErrorPin(T.importar.noSePudoAbrir);
      } finally {
        setOcupadoPin(false);
      }
    },
    [abriendo, conector, connect, T],
  );

  /**
   * Abre la hoja de elegir wallet y levanta la sesión de WalletConnect.
   *
   * Va aparte de `conectar` desde que existe el atajo al PIN: si se entra por
   * ahí, NO hay que levantar ninguna sesión contra el relé — sería una sesión
   * pendiente que nadie va a aprobar.
   */
  const abrirHoja = useCallback(() => {
    // La hoja se abre YA, sin URI todavía: levantar la sesión contra el relé
    // tarda un segundo largo y un botón que no responde parece roto —que es
    // exactamente el fallo que estamos arreglando—.
    setUri(null);
    setFallo(null);
    setDelTelefono(listar());
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
  }, [connect, wc]);

  /**
   * Conectar, y al reabrir la app ir DERECHO al PIN.
   *
   * Al cerrar la app la clave descifrada se pierde a propósito —si se
   * guardara, el PIN no serviría de nada—, así que hay que volver a teclearlo.
   * Lo que sí sobra es el camino: la app ya sabe cuál wallet usabas, y aun así
   * enseñaba la hoja entera para que la eligieras otra vez. Tres toques donde
   * basta uno, cada vez que Android se lleva la app por delante.
   *
   * Solo se toma el atajo si esa wallet SIGUE en el llavero: si se borró, el
   * teclado pediría el PIN de algo que ya no está.
   */
  const conectar = useCallback(() => {
    if (isConnected || isPending) return;
    const recordada = idRecordado();
    const suya = recordada ? listar().find((w) => w.id === recordada) : undefined;
    if (suya) {
      setErrorPin(null);
      setAbriendo(suya);
      return;
    }
    abrirHoja();
  }, [abrirHoja, isConnected, isPending]);

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
      disconnect: () => {
        olvidarWallet();
        disconnect();
      },
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
        abierta={hoja && !abriendo}
        uri={uri}
        hayWalletConnect={!!wc}
        fallo={fallo}
        delTelefono={delTelefono}
        recordada={idRecordado()}
        onElegirDelTelefono={(w) => {
          setErrorPin(null);
          setAbriendo(w);
        }}
        onIrAlLlavero={() => {
          cerrarHoja();
          navegar('/llavero');
        }}
        onCerrar={cerrarHoja}
      />

      {abriendo && (
        <div className="fixed inset-0 z-50 flex flex-col bg-paper">
          <div className="con-barra-arriba flex shrink-0 items-center justify-between px-4 pt-3">
            {/* Se llega aquí directo al reabrir la app, así que tiene que haber
                una salida a elegir otra wallet — o la de siempre. Sin esto, la
                única forma de cambiar sería borrar la del llavero. */}
            <button
              type="button"
              onClick={() => {
                setAbriendo(null);
                setErrorPin(null);
                abrirHoja();
              }}
              className="pulsable tocable rounded-full px-2 py-1.5 text-[13px] font-medium text-ink-3"
            >
              {T.hojaWallet.usarOtra}
            </button>
            <button
              type="button"
              onClick={() => {
                setAbriendo(null);
                setErrorPin(null);
              }}
              className="pulsable tocable flex h-9 w-9 items-center justify-center rounded-full border border-line"
              aria-label={T.comun.cerrar}
            >
              <Icono nombre="cerrar" tamano={15} color="#C8C3DC" grosor={1.9} />
            </button>
          </div>
          <Teclado
            titulo={abriendo.nombre}
            explicacion={T.hojaWallet.pinTitulo}
            onCompleto={(pin) => void conLaDelTelefono(pin)}
            error={errorPin}
            ocupado={ocupadoPin}
          />
        </div>
      )}

      {/* Con la wallet del teléfono no hay a dónde ir: se firma aquí. */}
      <AvisoFirma visible={firmando && !sesion.abierta} enlace={vuelta} />
    </WalletContext.Provider>
  );
}
