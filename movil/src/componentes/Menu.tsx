import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '@/hooks/useWallet';
import { activeChain } from '@/contracts/config';
import Icono from '~/componentes/Icono';
import type { NombreIcono } from '~/componentes/Icono';
import { avisosEncendidos, encenderAvisos, hayAvisos, pedirPermiso } from '~/lib/avisos';
import { useSesion } from '~/lib/sesion';
import { useCambio } from '~/lib/cambio';
import { IDIOMAS, cambiarIdioma, useIdioma, useTextos } from '~/i18n/idiomas';
import type { Textos } from '~/i18n/idiomas';

/**
 * El menú de la app.
 *
 * Lo que había antes era esto: para llegar al llavero, a los agentes o a la
 * cartera había que pasar por Saldo, porque colgaban de allí. Tenía su lógica
 * —las tres cosas son wallets— pero significaba que media app estaba a dos
 * toques de distancia y detrás de una pestaña que se llama otra cosa.
 *
 * Baja del botón y no sube desde abajo como las demás hojas a propósito: una
 * hoja es para decidir algo —firmar, pagar, borrar— y esto no decide nada,
 * lleva a sitios. Mezclar los dos gestos hace que el que importa deje de
 * significar «cuidado».
 *
 * NO HAY UN SOLO SITIO MUERTO AQUÍ. Cada fila lleva a algo que existe o cambia
 * algo de verdad; un menú con opciones que no hacen nada es peor que no tener
 * menú, porque el que lo abre deja de fiarse del resto.
 */
export default function Menu(): React.ReactElement {
  const [abierto, setAbierto] = useState(false);
  const T = useTextos();

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        aria-label={T.comun.menu}
        className="pulsable tocable flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line"
      >
        <Icono nombre="menu" tamano={18} color="#C8C3DC" grosor={1.9} />
      </button>

      {abierto && <Panel onCerrar={() => setAbierto(false)} />}
    </>
  );
}

function Panel({ onCerrar }: { onCerrar: () => void }): React.ReactElement {
  const navegar = useNavigate();
  const { connected, addressShort, connect, disconnect } = useWallet();
  const sesion = useSesion();
  const { cambiar } = useCambio();
  const T = useTextos();
  const idioma = useIdioma();
  const [avisos, setAvisos] = useState(() => avisosEncendidos());
  const [eligiendoIdioma, setEligiendoIdioma] = useState(false);

  const ir = (a: string): void => {
    onCerrar();
    navegar(a);
  };

  /**
   * Encender pide permiso al sistema; apagar no pide nada.
   *
   * Si el sistema lo niega, el interruptor NO se queda encendido mintiendo:
   * vuelve a apagado, que es lo que va a pasar de verdad.
   */
  const cambiarAvisos = async (): Promise<void> => {
    if (avisos) {
      encenderAvisos(false);
      setAvisos(false);
      return;
    }
    const permiso = await pedirPermiso();
    encenderAvisos(permiso);
    setAvisos(permiso);
  };

  return (
    <div className="fixed inset-0 z-40">
      {/* Un velo flojo, no el de las hojas: esto no bloquea nada, solo separa
          el menú de lo que hay detrás para que se lea de una ojeada. */}
      <button
        type="button"
        aria-label={T.comun.cerrar}
        className="absolute inset-0 bg-[rgba(12,10,18,.45)]"
        onClick={onCerrar}
      />

      <div className="con-barra-arriba pointer-events-none absolute inset-x-0 top-0 flex justify-end px-4 pt-[52px]">
        <div className="pointer-events-auto w-[270px] overflow-hidden rounded-[16px] border border-line bg-cream shadow-hoja">
          {/* La wallet primero: es lo que decide si el resto se puede usar. */}
          <div className="border-b border-line px-4 py-3.5">
            {connected ? (
              <>
                {/* El NOMBRE primero cuando lo hay. Con varias wallets en el
                    llavero, cuatro direcciones cortadas no se distinguen de un
                    vistazo, y ésta es la línea que contesta con cuál se paga. */}
                {sesion.wallet ? (
                  <p className="truncate text-[13.5px] font-semibold">{sesion.wallet.nombre}</p>
                ) : null}
                <p
                  className={`font-mono text-[13px] ${
                    sesion.wallet ? 'mt-0.5 text-ink-3' : 'font-medium'
                  }`}
                >
                  {addressShort}
                </p>
                <p className="mt-1 flex items-center gap-1.5 text-[11.5px] text-ink-3">
                  <Icono
                    nombre={sesion.abierta ? 'llave' : 'eslabon'}
                    tamano={12}
                    color={sesion.abierta ? '#E29A2E' : '#948DAE'}
                  />
                  {sesion.abierta ? T.menu.firmaAqui : T.menu.firmaFuera}
                </p>
              </>
            ) : (
              <p className="text-[13px] text-ink-2">{T.menu.sinWallet}</p>
            )}
            {connected ? (
              // Dos botones y no uno. Antes solo estaba «Desconectar», y para
              // cambiarse había que pulsarlo: un botón que dice que te saca de
              // la app no es donde se busca «quiero pagar con la otra».
              <div className="mt-2.5 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onCerrar();
                    cambiar();
                  }}
                  className="pulsable grow basis-0 rounded-full border border-honey-line bg-honey-soft py-2 text-[12.5px] font-semibold text-honey"
                >
                  {T.menu.cambiarWallet}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onCerrar();
                    disconnect();
                  }}
                  className="pulsable grow basis-0 rounded-full border border-line py-2 text-[12.5px] font-medium text-ink-2"
                >
                  {T.comun.desconectar}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  onCerrar();
                  connect();
                }}
                className="pulsable mt-2.5 w-full rounded-full border border-line py-2 text-[12.5px] font-medium text-ink-2"
              >
                {T.comun.conectarWallet}
              </button>
            )}
          </div>

          {/* El idioma reemplaza el contenido del panel en vez de abrir otra
              cosa encima: son cuatro filas y volver tiene que costar un toque. */}
          {eligiendoIdioma ? (
            <>
              {IDIOMAS.map((i) => (
                <button
                  key={i.codigo}
                  type="button"
                  onClick={() => {
                    cambiarIdioma(i.codigo);
                    setEligiendoIdioma(false);
                    // Y se cierra el menú entero: si se queda abierto, tapa
                    // justo la pantalla que la persona acaba de cambiar.
                    onCerrar();
                  }}
                  className="pulsable flex w-full items-center gap-3 border-t border-line px-4 py-3 text-left"
                >
                  <span className="grow text-[13.5px]">{i.nombre}</span>
                  {i.codigo === idioma && <Icono nombre="check" tamano={15} color="#92A268" grosor={2.4} />}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setEligiendoIdioma(false)}
                className="pulsable flex w-full items-center gap-3 border-t border-line px-4 py-3 text-left"
              >
                <Icono nombre="atras" tamano={15} color="#948DAE" className="shrink-0" />
                <span className="grow text-[13.5px] text-ink-2">{T.comun.atras}</span>
              </button>
            </>
          ) : (
            <>
          <Fila icono="llave" texto={T.menu.llavero} onClick={() => ir('/llavero')} />
          <Fila icono="hexagono" texto={T.menu.agentes} onClick={() => ir('/agentes')} />
          <Fila icono="cartera" texto={T.menu.cartera} onClick={() => ir('/cartera')} />

          <button
            type="button"
            onClick={() => setEligiendoIdioma(true)}
            className="pulsable flex w-full items-center gap-3 border-t border-line px-4 py-3 text-left"
          >
            <Icono nombre="hoja" tamano={17} color="#948DAE" className="shrink-0" />
            <span className="grow text-[13.5px]">{T.menu.idioma}</span>
            <span className="shrink-0 text-[12.5px] text-ink-3">
              {IDIOMAS.find((i) => i.codigo === idioma)?.nombre}
            </span>
          </button>

          {/* Solo dentro del APK: en el navegador no hay a quién pedirle
              permiso, y un interruptor que no puede hacer nada estorba. */}
          {hayAvisos() && (
            <button
              type="button"
              onClick={() => void cambiarAvisos()}
              className="pulsable flex w-full items-center gap-3 border-t border-line px-4 py-3 text-left"
            >
              <Icono nombre="reloj" tamano={17} color="#948DAE" className="shrink-0" />
              <span className="grow text-[13.5px]">{T.menu.avisos}</span>
              <Interruptor encendido={avisos} />
            </button>
          )}

            </>
          )}

          <div className="border-t border-line px-4 py-3">
            <p className="text-[11px] text-ink-3">{T.menu.red(activeChain.name, activeChain.id)}</p>
            <p className="mt-0.5 text-[11px] text-ink-3">{version(T)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Fila({
  icono,
  texto,
  onClick,
}: {
  icono: NombreIcono;
  texto: string;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="pulsable flex w-full items-center gap-3 border-t border-line px-4 py-3 text-left first:border-t-0"
    >
      <Icono nombre={icono} tamano={17} color="#948DAE" className="shrink-0" />
      <span className="grow text-[13.5px]">{texto}</span>
      <Icono nombre="atras" tamano={13} color="#948DAE" className="rotate-180" />
    </button>
  );
}

/** `block` porque un `<span>` es en línea y sin él la altura no se aplica. */
function Interruptor({ encendido }: { encendido: boolean }): React.ReactElement {
  return (
    <span
      className={`block h-6 w-[42px] shrink-0 rounded-full p-0.5 transition-colors ${
        encendido ? 'bg-olive' : 'bg-line'
      }`}
    >
      <span
        className={`block h-5 w-5 rounded-full bg-cream transition-transform ${
          encendido ? 'translate-x-[18px]' : ''
        }`}
      />
    </span>
  );
}

/**
 * La versión que se está usando.
 *
 * Sale de `VITE_VERSION`, que el flujo del APK rellena con el mismo número que
 * `versionName`. Sin ella —al compilar a mano— no se inventa nada: se dice que
 * es una compilación de desarrollo, que es lo que es.
 */
function version(T: Textos): string {
  const v = import.meta.env.VITE_VERSION?.trim();
  return v ? T.menu.version(v) : T.menu.sinVersion;
}
