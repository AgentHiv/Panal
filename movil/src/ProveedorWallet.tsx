import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
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
import { ID_LLAVERO, conectorLlavero } from '~/lib/conector';
import { abrirSesion, caducar, cerrarSesion, idRecordado, tocar, useSesion } from '~/lib/sesion';
import { CambioContext } from '~/lib/cambio';
import type { Cambio } from '~/lib/cambio';
import { abrir as abrirLlavero, borrarLlavero, hayLlavero, listar } from '~/lib/llavero';
import Bienvenida from '~/pantallas/Bienvenida';
import Olvidado from '~/componentes/Olvidado';
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
 *
 * ───────────────────────────────────────────────────────────────────────────
 * Y ADEMÁS, ESTE ES EL PORTERO DE LA APP
 *
 * Tres puertas, en este orden, y ninguna se puede saltar:
 *
 *   1. SIN LLAVERO → la bienvenida, con dos caminos: crear una wallet o traer
 *      la que ya tienes. No hay un tercero. Sin wallet no hay dirección, sin
 *      dirección no hay saldo, y sin saldo no se puede hablar con un agente ni
 *      encargarle nada: un botón de «saltar» llevaría a una app entera en la
 *      que no se puede hacer nada, que es literalmente lo que había antes.
 *
 *   2. CON LLAVERO Y SIN SESIÓN → el PIN, y sin forma de cerrarlo. Se pide al
 *      abrir la app SIEMPRE, y también cuando la sesión se cierra sola por
 *      inactividad estando la app delante. La clave descifrada vive solo en
 *      memoria (`lib/sesion.ts`), así que al arrancar nunca hay sesión: esto
 *      no añade una comprobación nueva, hace que la que ya existía no se pueda
 *      esquivar mirando el resto de la app sin desbloquear nada.
 *
 *      Con una salida, porque si no sería una trampa: quien olvide el PIN se
 *      quedaría sin app y sin explicación. `Olvidado` dice lo único que se
 *      puede decir —esto no se recupera— y deja empezar de cero.
 *
 *   3. LA WALLET DE FUERA SOLO DONDE HACE FALTA. Conectar por WalletConnect
 *      no es una segunda forma de entrar: es lo que exige ADMINISTRAR un
 *      agente, porque el registro on-chain actúa sobre `msg.sender` y hay que
 *      firmar con la wallet del propio agente. Ofrecerlo en la primera
 *      pantalla ponía dos caminos distintos delante de alguien que todavía no
 *      sabe que existe esa diferencia. Ahora aparece en «Tus agentes» y sus
 *      pantallas, que es donde significa algo.
 * ───────────────────────────────────────────────────────────────────────────
 */
/** Lo poco que hace falta saber del proveedor de WalletConnect. */
interface ProveedorWC {
  request: (args: { method: string; params?: unknown }) => Promise<unknown>;
  session?: { peer?: { metadata?: { redirect?: Redireccion } } };
  __panalEnvuelto?: boolean;
}

export default function ProveedorWallet({ children }: { children: ReactNode }): React.ReactElement {
  const { address, connector: enMarcha, isConnected, status } = useAccount();
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
  /** La pantalla de «he olvidado el PIN», que es la única salida del cerrojo. */
  const [olvidado, setOlvidado] = useState(false);
  /** Ya eligió en la bienvenida y está creando o trayendo su wallet. */
  const [empezando, setEmpezando] = useState(false);

  const navegar = useNavigate();
  const { pathname } = useLocation();
  const sesion = useSesion();
  const T = useTextos();
  // Uno solo por montaje: cada `connect` con una función crea un conector
  // nuevo, y con la misma referencia al menos no se multiplican por render.
  const conector = useMemo(() => conectorLlavero(), []);
  /**
   * El llavero, leído del disco y no en cada render.
   *
   * Se vuelve a mirar cuando cambia algo que puede haberlo cambiado: la
   * pantalla en la que estamos, si hay sesión abierta o si hay wallet
   * conectada. Es el ajuste durante el render que documenta React, y no un
   * efecto, para que no haya un primer fotograma decidiendo con la lista vieja
   * — que aquí sería enseñar la bienvenida a quien ya tiene llavero.
   */
  const [guardadas, setGuardadas] = useState<WalletGuardada[]>(listar);
  const [hayLlave, setHayLlave] = useState(hayLlavero);
  const marca = `${pathname}|${sesion.abierta}|${isConnected}`;
  const [vista, setVista] = useState(marca);
  if (vista !== marca) {
    setVista(marca);
    setGuardadas(listar());
    setHayLlave(hayLlavero());
    // Salir de la pantalla del llavero a medias es cambiar de idea: la
    // bienvenida vuelve, porque la app sigue sin wallet con la que hacer nada.
    if (!pathname.startsWith('/llavero')) setEmpezando(false);
  }

  /**
   * Reabrir la app no es desconectarse. Mientras wagmi recupera la sesión
   * guardada, `isConnected` es `false`; sin mirar `status` la app enseñaría
   * «conectar» a quien ya está dentro y solo tiene que esperar un instante.
   */
  const conectando = isPending || status === 'reconnecting';

  /**
   * Dónde se ofrece conectar una wallet DE FUERA.
   *
   * Solo en las pantallas de agentes, y no por ordenar el menú: administrar un
   * agente exige firmar con la wallet DEL AGENTE, porque `updatePrice`,
   * `setActive` y `withdraw` actúan sobre `msg.sender` y el registro no
   * distingue entre el agente y su dueño. Esa clave suele vivir en el servidor
   * del agente, así que la única forma de traerla al teléfono sin sacarla de
   * donde está es WalletConnect.
   *
   * En el resto de la app no aparece: para hablar y encargar sirve la wallet
   * de este teléfono, que además es la que evita salir a otra aplicación en
   * cada firma.
   */
  const conFuera = /^\/(agentes|panel|guardia|alta)(\/|$)/.test(pathname);

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
   * El reloj de inactividad del llavero.
   *
   * Tres cosas, y las tres hacen falta:
   *
   *   · Cualquier toque reinicia la cuenta. Va en `capture` y pasivo para no
   *     estorbar al desplazamiento, que en un WebView se nota.
   *   · Un repaso cada 30 s cierra si ya se pasó el rato estando la app
   *     delante.
   *   · Y otro al volver a primer plano, porque el intervalo de arriba en
   *     segundo plano lo estrangula Android o no corre: la comprobación tiene
   *     que ser al volver, no confiar en que el reloj siguió.
   *
   * Al cerrarse hay que desconectar wagmi además de tirar la clave: sin eso la
   * app seguiría diciendo que hay una wallet conectada y la primera firma
   * fallaría con un error en vez de pedir el PIN.
   */
  useEffect(() => {
    const alCaducar = (): void => {
      if (caducar()) disconnect();
    };
    const usar = (): void => tocar();

    const eventos = ['pointerdown', 'keydown', 'touchstart'] as const;
    for (const e of eventos) window.addEventListener(e, usar, { capture: true, passive: true });
    const reloj = window.setInterval(alCaducar, 30_000);
    document.addEventListener('visibilitychange', alCaducar);

    return () => {
      for (const e of eventos) window.removeEventListener(e, usar, { capture: true });
      window.clearInterval(reloj);
      document.removeEventListener('visibilitychange', alCaducar);
    };
  }, [disconnect]);

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
    async (pin: string, cual: WalletGuardada): Promise<void> => {
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
        // Abrir la sesión es lo único que hace falta: conectar wagmi lo hace
        // el efecto de abajo, mirando la sesión. Así el llavero abierto desde
        // SU pantalla —al crear la primera wallet, por ejemplo— también deja
        // la app conectada, sin repetir aquí ese trozo.
        await abrirSesion(llave, cual);
        // Si lo que estaba conectado era una wallet de FUERA, hay que echarla:
        // el efecto de abajo solo engancha el llavero cuando no hay nadie
        // conectado, así que sin esto la sesión quedaba abierta —clave
        // descifrada y todo— mientras la app seguía firmando por WalletConnect.
        // Entre dos wallets del llavero no hace falta: de eso se entera wagmi
        // por el aviso de `alCambiarDeWallet`, sin cortar la conexión.
        if (isConnected && enMarcha?.id !== ID_LLAVERO) disconnect();
        setAbriendo(null);
        setErrorPin(null);
        setHoja(false);
      } catch {
        setErrorPin(T.importar.noSePudoAbrir);
      } finally {
        setOcupadoPin(false);
      }
    },
    [T, disconnect, enMarcha, isConnected],
  );

  /**
   * Quien abra la sesión, conecta.
   *
   * La sesión del llavero y la conexión de wagmi son dos cosas distintas y
   * tienen que ir juntas: se puede abrir el llavero desde el cerrojo, desde la
   * hoja de wallets o desde la pantalla del llavero al crear la primera. Con
   * el `connect` metido en cada uno de esos sitios, el que se olvidara dejaría
   * una app con la clave descifrada en memoria y un botón de «conectar» en
   * pantalla.
   *
   * Con una wallet de fuera ya conectada no se hace nada: abrir el llavero
   * para mirar un saldo no es motivo para echar a la wallet que está en uso.
   */
  useEffect(() => {
    if (!sesion.abierta || isConnected || conectando) return;
    connect({ connector: conector });
  }, [conector, connect, conectando, isConnected, sesion.abierta]);

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
    setGuardadas(listar());
    setHoja(true);
    if (!wc) return; // La hoja explica que se compiló sin WalletConnect.
    // Y NO se levanta ninguna sesión si aquí no se ofrece la wallet de fuera:
    // sería una sesión esperando en el relé que nadie va a aprobar nunca.
    if (!conFuera) return;

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
  }, [conFuera, connect, wc]);

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
   * Cambiar la wallet con la que se firma, estando ya dentro.
   *
   * `conectar` no vale para esto y por eso hacía falta otra puerta: se va de
   * vacío si ya hay una wallet conectada —que es siempre, desde que el cerrojo
   * pide el PIN al arrancar—, así que la hoja de elegir no se abría nunca
   * después de la primera vez. Ese es literalmente el anclaje: las wallets que
   * crearas después existían, se les veía el saldo, y no había forma de hablar
   * con un agente desde ellas.
   *
   * SIEMPRE PASA POR EL PIN, y no es un descuido. La sesión guarda la CUENTA
   * descifrada, no la llave que la descifró; con la llave dentro se podría
   * cambiar sin teclear nada, pero entonces la app abierta encima de una mesa
   * podría firmar con CUALQUIERA de las wallets del llavero, no solo con la que
   * estaba en uso. Seis dígitos por cambio es el precio de que eso no pase, y
   * cambiar de wallet no es algo que se haga cada minuto.
   */
  const pedirCambio = useCallback(
    (cual?: WalletGuardada) => {
      setErrorPin(null);
      // Con una wallet ya elegida —se llega así desde el llavero— se va derecho
      // a su PIN: enseñar la lista sería preguntar lo que ya está contestado.
      if (cual) {
        setGuardadas(listar());
        setAbriendo(cual);
        return;
      }
      abrirHoja();
    },
    [abrirHoja],
  );

  /** Soltar la que hay sin poner otra. Para borrar del llavero la que firma. */
  const soltar = useCallback(() => {
    cerrarSesion();
    olvidarWallet();
    disconnect();
  }, [disconnect]);

  const cambio = useMemo<Cambio>(() => ({ cambiar: pedirCambio, soltar }), [pedirCambio, soltar]);

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

  /**
   * EL CERROJO. Hay llavero, hay wallets y no hay con qué firmar: el PIN.
   *
   * Se calcula, no se dispara una vez al arrancar. Así cubre los tres caminos
   * por los que se puede acabar sin sesión —abrir la app, que caduque por
   * inactividad estando delante, y desconectar a mano— con una sola regla, en
   * vez de tres efectos que tarde o temprano dejarían un hueco.
   *
   * Se levanta mientras hay una hoja o la pantalla del PIN olvidado abiertas:
   * son las dos salidas legítimas, y taparlas con el propio cerrojo lo
   * convertiría en un callejón.
   *
   * Y SE LEVANTA EN EL LLAVERO, que tiene su propio candado. Si no, salían DOS
   * teclados de PIN uno encima de otro pidiendo el mismo PIN: se teclea en el
   * de arriba, se desbloquea la app, y detrás sigue el otro esperando —el
   * mismo PIN, dos veces seguidas, sin ninguna razón visible—. Lo encontró el
   * recorrido del llavero, no el typecheck.
   *
   * No abre ninguna puerta: allí no se llega sin pasar por el menú, y el menú
   * está detrás del cerrojo. Y esa pantalla enseña las doce palabras, así que
   * su candado propio tiene que seguir estando — es el único sitio de la app
   * donde vuelve a hacer falta el PIN aunque ya estés dentro.
   *
   * `conectando` importa: al arrancar, wagmi recupera su sesión guardada y
   * durante ese instante `isConnected` todavía es `false`. Sin esperarlo,
   * quien usa una wallet de fuera vería parpadear un teclado de PIN que no le
   * corresponde.
   */
  const cerrojo =
    hayLlave &&
    guardadas.length > 0 &&
    !sesion.abierta &&
    !isConnected &&
    !conectando &&
    !hoja &&
    !olvidado &&
    !pathname.startsWith('/llavero');

  /** Cuál se ofrece desbloquear: la elegida, la de siempre, o la primera. */
  const paraAbrir =
    abriendo ?? guardadas.find((w) => w.id === idRecordado()) ?? guardadas[0] ?? null;
  const pidiendoPin = abriendo ?? (cerrojo ? paraAbrir : null);

  return (
    <WalletContext.Provider value={valor}>
      <CambioContext.Provider value={cambio}>{children}</CambioContext.Provider>

      {/* Sin llavero no hay app: primero se crea o se trae una wallet. Va por
          encima de todo y no como ruta a propósito — una ruta se puede dejar
          atrás con el botón de atrás, y esto no. */}
      {!hayLlave && !empezando && (
        <Bienvenida
          onCrear={() => {
            setEmpezando(true);
            navegar('/llavero?hacer=crear');
          }}
          onTraer={() => {
            setEmpezando(true);
            navegar('/llavero?hacer=traer');
          }}
        />
      )}

      {olvidado && (
        <Olvidado
          T={T}
          onVolver={() => setOlvidado(false)}
          onBorrar={() => {
            borrarLlavero();
            olvidarWallet();
            cerrarSesion();
            disconnect();
            setOlvidado(false);
            setAbriendo(null);
            setErrorPin(null);
            setGuardadas([]);
            setHayLlave(false);
            setEmpezando(false);
            navegar('/chats');
          }}
        />
      )}

      <HojaWallet
        abierta={hoja && !abriendo}
        uri={uri}
        hayWalletConnect={!!wc}
        conFuera={conFuera}
        fallo={fallo}
        delTelefono={guardadas}
        recordada={idRecordado()}
        enUso={sesion.abierta ? (sesion.wallet?.id ?? null) : null}
        onElegirDelTelefono={(w) => {
          // Volver a elegir la que ya está firmando no es cambiar de nada: se
          // cierra la hoja y ya. Pedirle el PIN otra vez sería cobrarle seis
          // dígitos por no hacer nada.
          if (sesion.abierta && sesion.wallet?.id === w.id) {
            cerrarHoja();
            return;
          }
          setErrorPin(null);
          setAbriendo(w);
        }}
        onIrAlLlavero={() => {
          cerrarHoja();
          navegar('/llavero');
        }}
        onCerrar={cerrarHoja}
      />

      {pidiendoPin && (
        <div className="fixed inset-0 z-50 flex flex-col bg-paper">
          <div className="con-barra-arriba flex shrink-0 items-center justify-between px-4 pt-3">
            {/* Se llega aquí directo al abrir la app, así que tiene que haber
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
            {/* La X solo cuando esto NO es el cerrojo. Si lo es, cerrarlo
                dejaría la app abierta sin nada con lo que firmar, que es
                justo lo que se viene a evitar; la salida de ahí es el PIN, o
                decir que se ha olvidado. */}
            {cerrojo ? (
              <button
                type="button"
                onClick={() => setOlvidado(true)}
                className="pulsable tocable rounded-full px-2 py-1.5 text-[12.5px] font-medium text-ink-3"
              >
                {T.olvidado.enlace}
              </button>
            ) : (
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
            )}
          </div>
          <Teclado
            titulo={pidiendoPin.nombre}
            // Cambiando ya hay sesión abierta, así que la frase de siempre
            // —«con él, firmar deja de sacarte de la app»— cuenta algo que ya
            // pasó. Lo que hace falta saber aquí es qué wallet queda firmando.
            explicacion={sesion.abierta ? T.hojaWallet.pinCambiar : T.hojaWallet.pinTitulo}
            onCompleto={(pin) => void conLaDelTelefono(pin, pidiendoPin)}
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
