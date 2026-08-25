import Icono from '~/componentes/Icono';
import { IDIOMAS, cambiarIdioma, useIdioma, useTextos } from '~/i18n/idiomas';

/**
 * Lo primero que se ve, y solo la primera vez.
 *
 * QUÉ HABÍA ANTES. La app abría directamente en los chats, y allí, sin wallet,
 * salía un botón de conectar que llevaba a una hoja con dos caminos mezclados
 * —la wallet de este teléfono y la de fuera— más una lista de aplicaciones que
 * quizá no están instaladas. Quien abría Panal por primera vez tenía que
 * decidir entre cinco cosas antes de entender qué era ninguna de ellas.
 *
 * AQUÍ SOLO HAY DOS, y son las dos únicas que existen de verdad: crear una
 * wallet, o traer la que ya tienes. No hay «saltar», y no es por insistir:
 * sin wallet no hay dirección, sin dirección no hay saldo y sin saldo no se
 * puede hablar con un agente ni encargarle nada. Un botón para entrar sin
 * wallet llevaría a una app entera en la que no se puede hacer nada, que es
 * exactamente lo que pasaba.
 *
 * LA WALLET DE FUERA NO SALE AQUÍ. Conectar una wallet que ya usas es lo que
 * hace falta para ADMINISTRAR un agente —el registro on-chain actúa sobre quien
 * firma, así que hay que firmar con la del agente— y esa es una decisión de
 * quien ya tiene un agente montado, no de quien acaba de instalar la app. Vive
 * donde se necesita, en «Tus agentes».
 *
 * EL IDIOMA, ANTES DE NADA. Es la única pantalla donde ponerlo importa de
 * verdad: si no se entiende esto, no se entiende ninguna de las dos opciones,
 * y el menú donde se cambia está detrás de justo la pantalla que no se puede
 * pasar.
 */
export default function Bienvenida({
  onCrear,
  onTraer,
}: {
  onCrear: () => void;
  onTraer: () => void;
}): React.ReactElement {
  const T = useTextos();
  const idioma = useIdioma();

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-paper">
      <div className="con-barra-arriba flex shrink-0 justify-end px-4 pt-3">
        {/* Sin desplegable: son cuatro, caben, y un menú aquí sería una
            pantalla más antes de la primera. */}
        <div className="flex gap-1">
          {IDIOMAS.map((i) => (
            <button
              key={i.codigo}
              type="button"
              onClick={() => cambiarIdioma(i.codigo)}
              className={`pulsable rounded-full px-2.5 py-1.5 text-[12px] font-medium uppercase tracking-[0.04em] ${
                i.codigo === idioma ? 'bg-cream text-ink' : 'text-ink-3'
              }`}
            >
              {i.codigo}
            </button>
          ))}
        </div>
      </div>

      <div className="flex min-h-0 grow flex-col justify-center px-6 pb-7 pt-2">
        <Marca />

        <h1 className="mt-5 shrink-0 text-pretty text-center font-display text-[27px] font-semibold -tracking-[0.015em]">
          {T.bienvenida.titulo}
        </h1>
        <p className="mt-2.5 shrink-0 text-pretty text-center text-[14px] leading-[1.6] text-ink-2">
          {T.bienvenida.texto}
        </p>

        <div className="mt-6 shrink-0 overflow-hidden rounded-[16px] border border-line">
          <Linea icono="chat" texto={T.bienvenida.hablar} />
          <div className="h-px bg-line" />
          <Linea icono="candado" texto={T.bienvenida.encargar} />
          <div className="h-px bg-line" />
          <Linea icono="llave" texto={T.bienvenida.tuya} />
        </div>

        <p className="mt-6 shrink-0 text-center text-[11.5px] uppercase tracking-[0.06em] text-ink-3">
          {T.bienvenida.paraEmpezar}
        </p>

        <button
          type="button"
          onClick={onCrear}
          className="pulsable mt-3 flex h-[54px] shrink-0 items-center justify-center gap-2 rounded-full bg-monad text-[15px] font-semibold text-white shadow-monad"
        >
          <Icono nombre="mas" tamano={18} color="#FFFFFF" grosor={2} />
          {T.bienvenida.crear}
        </button>
        <p className="mt-2 shrink-0 text-center text-[11.5px] leading-[1.45] text-ink-3">
          {T.bienvenida.crearPie}
        </p>

        <button
          type="button"
          onClick={onTraer}
          className="pulsable mt-4 flex h-[54px] shrink-0 items-center justify-center gap-2 rounded-full border border-line text-[15px] font-semibold text-ink-2"
        >
          <Icono nombre="bajar" tamano={18} color="#948DAE" grosor={1.9} />
          {T.bienvenida.traer}
        </button>
        <p className="mt-2 shrink-0 text-center text-[11.5px] leading-[1.45] text-ink-3">
          {T.bienvenida.traerPie}
        </p>

        <p className="con-barra-abajo mt-6 shrink-0 text-pretty text-center text-[11.5px] leading-[1.55] text-ink-3">
          {T.bienvenida.pie}
        </p>
      </div>
    </div>
  );
}

function Linea({
  icono,
  texto,
}: {
  icono: 'chat' | 'candado' | 'llave';
  texto: string;
}): React.ReactElement {
  return (
    <div className="flex items-center gap-3 px-3.5 py-3">
      <Icono nombre={icono} tamano={17} color="#948DAE" className="shrink-0" />
      <p className="text-[12.5px] leading-[1.45] text-ink-2">{texto}</p>
    </div>
  );
}

/** El panal lleno, no el vacío de la pantalla de arranque: aquí se entra. */
function Marca(): React.ReactElement {
  const celdas: [number, number, boolean][] = [
    [24, -18, false],
    [24, 18, true],
    [0, -36, true],
    [0, 36, false],
    [-24, -18, false],
    [-24, 18, true],
  ];
  return (
    <div className="flex shrink-0 justify-center">
      {/* El viewBox sale de las coordenadas, no a ojo: las celdas van de x −20
          a 60 y de y −34 a 74, y con el de la pantalla de arranque —que empieza
          en −6— la columna izquierda se salía del lienzo. Allí se nota menos
          porque son celdas vacías; aquí es la primera imagen de la app. */}
      <svg width="90" height="118" viewBox="-24 -38 88 116" fill="none" aria-hidden>
        {celdas.map(([x, y, llena]) => (
          <polygon
            key={`${x},${y}`}
            points="20,2 36,11 36,29 20,38 4,29 4,11"
            transform={`translate(${x},${y})`}
            fill={llena ? '#2E2510' : 'none'}
            stroke={llena ? '#E29A2E' : '#2B2540'}
            strokeWidth="1.4"
          />
        ))}
        <polygon points="20,2 36,11 36,29 20,38 4,29 4,11" fill="#2E2510" stroke="#E29A2E" strokeWidth="1.7" />
      </svg>
    </div>
  );
}
