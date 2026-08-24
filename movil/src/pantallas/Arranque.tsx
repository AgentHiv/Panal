import { useNavigate } from 'react-router-dom';
import { useWallet } from '@/hooks/useWallet';
import { useSaldos } from '~/lib/usarSaldos';
import Icono from '~/componentes/Icono';
import Menu from '~/componentes/Menu';

/**
 * El primer arranque: lo que se ve al abrir la app sin nada dentro.
 *
 * DOS ESTADOS, no uno. Antes era una sola pantalla que se enseñaba igual con
 * wallet y sin ella, y sin wallet no ofrecía forma de conectar: el único botón
 * llevaba al mercado, donde tampoco se podía hacer nada. Se podía recorrer la
 * app entera sin encontrar la puerta.
 *
 * SE CAYÓ EL REGALO. Había una tarjeta que prometía «10 $PANAL para ti», con un
 * PENDIENTE en el código reconociendo que la cifra era de muestra y que el
 * saldo real ni se leía. Eso no es un adorno a medio hacer: es la app diciendo
 * en su primera pantalla que te va a dar dinero que no existe. En su sitio va
 * el saldo de verdad, leído de la cadena. Cuando haya reparto se vuelve a
 * poner, y entonces será cierto.
 */
export default function Arranque(): React.ReactElement {
  const navegar = useNavigate();
  const { connected, connecting, connect } = useWallet();

  return (
    <div className="flex min-h-0 grow flex-col">
      {/* El menú también aquí: esta es la primera pantalla de la app, y sin
          él quien acaba de instalarla no tiene ninguna forma de llegar al
          llavero ni de ver en qué red está. */}
      <header className="flex shrink-0 items-center justify-between px-5 pb-1 pt-5">
        <h1 className="font-display text-[26px] font-semibold -tracking-[0.015em]">Chats</h1>
        <Menu />
      </header>

      {/* `shrink-0` en TODOS los hijos, y no por costumbre: sin él este mismo
          bloque se aplastaba. En una columna flex los hijos encogen antes de
          que el contenedor decida desplazarse, así que la tarjeta de abajo
          —que lleva `overflow-hidden`— perdía media fila: se veía «Encargar un
          trabajo» cortado por la mitad, sin su precio ni su estado. */}
      <div className="flex min-h-0 grow flex-col overflow-y-auto px-5 pb-5">
        <PanalVacio />

        {connected ? <Dentro /> : <Fuera conectando={connecting} onConectar={connect} />}

        <div className="mt-5 shrink-0 overflow-hidden rounded-2xl border border-line">
          <Puerta
            icono="chat"
            titulo="Hablar con un agente"
            pie="se paga por mensaje, en $PANAL"
            estado="sin gas"
            bueno
          />
          <div className="h-px bg-line" />
          <Puerta
            icono="candado"
            titulo="Encargar un trabajo"
            pie="el dinero queda en depósito hasta que entregue"
            estado="en MON"
          />
        </div>

        <p className="mt-3 shrink-0 rounded-xl bg-sand px-3.5 py-3 text-[12px] leading-[1.5] text-ink-3">
          $PANAL se cambia en nad.fun y MON lo traes a tu dirección desde donde ya tengas. Panal no
          vende ninguna de las dos.
        </p>

        <button
          type="button"
          onClick={() => navegar('/mercado')}
          className="pulsable mt-4 flex h-[52px] shrink-0 items-center justify-center gap-2 rounded-full border border-line text-[15px] font-semibold text-ink-2"
        >
          <Icono nombre="bolsa" tamano={18} color="#C8C3DC" />
          Ver el mercado
        </button>
        <p className="mt-2 shrink-0 text-center text-[11.5px] text-ink-3">
          Mirar los agentes y sus precios no cuesta nada.
        </p>
      </div>
    </div>
  );
}

/** Sin wallet: lo único que importa es la puerta. */
function Fuera({
  conectando,
  onConectar,
}: {
  conectando: boolean;
  onConectar: () => void;
}): React.ReactElement {
  return (
    <>
      <h2 className="shrink-0 text-pretty text-center font-display text-[22px] font-semibold -tracking-[0.015em]">
        Agentes que cobran solos
      </h2>
      <p className="mt-2 shrink-0 text-pretty text-center text-[14px] leading-[1.55] text-ink-2">
        Tu wallet es tu cuenta: no hay registro ni contraseña. Conéctala y ya puedes empezar.
      </p>
      <button
        type="button"
        onClick={onConectar}
        disabled={conectando}
        className="pulsable mt-5 flex h-[52px] shrink-0 items-center justify-center gap-2 rounded-full bg-monad text-[15px] font-semibold text-white shadow-monad disabled:opacity-60"
      >
        {conectando ? 'Conectando…' : 'Conectar wallet'}
      </button>
    </>
  );
}

/** Con wallet y sin conversaciones: lo que tienes y con qué se hace qué. */
function Dentro(): React.ReactElement {
  const { panal, mon, cargando } = useSaldos();
  const sinNada = !cargando && panal?.valor === 0n && mon?.valor === 0n;

  return (
    <>
      <h2 className="shrink-0 text-pretty text-center font-display text-[22px] font-semibold -tracking-[0.015em]">
        {sinNada ? 'Tu wallet está a cero' : 'Todavía no has hablado con nadie'}
      </h2>
      <p className="mt-2 shrink-0 text-pretty text-center text-[14px] leading-[1.55] text-ink-2">
        {sinNada
          ? 'Hace falta $PANAL para hablar con un agente, o MON para encargarle un trabajo.'
          : 'Elige un agente en el mercado y empieza por preguntarle algo.'}
      </p>

      <div className="mt-5 flex shrink-0 gap-2.5">
        <Bolsillo simbolo="$PANAL" valor={panal?.texto ?? null} color="#E29A2E" cargando={cargando} />
        <Bolsillo simbolo="MON" valor={mon?.texto ?? null} color="#B7A8FC" cargando={cargando} />
      </div>
    </>
  );
}

function Bolsillo({
  simbolo,
  valor,
  color,
  cargando,
}: {
  simbolo: string;
  valor: string | null;
  color: string;
  cargando: boolean;
}): React.ReactElement {
  return (
    <div className="grow rounded-[14px] border border-line bg-cream px-3.5 py-3">
      {cargando && valor === null ? (
        <span className="my-0.5 block h-[22px] w-16 animate-pulse rounded bg-sand" />
      ) : (
        <p className="font-mono text-[20px] font-medium leading-tight" style={{ color }}>
          {valor ?? '—'}
        </p>
      )}
      <p className="mt-1 text-[11.5px] font-semibold" style={{ color }}>
        {simbolo}
      </p>
    </div>
  );
}

function Puerta({
  icono,
  titulo,
  pie,
  estado,
  bueno = false,
}: {
  icono: 'chat' | 'candado';
  titulo: string;
  pie: string;
  estado: string;
  bueno?: boolean;
}): React.ReactElement {
  return (
    <div className="flex items-center gap-3 px-3.5 py-3.5">
      <Icono nombre={icono} tamano={18} color="#948DAE" className="shrink-0" />
      <div className="min-w-0 grow">
        <p className="text-[13.5px] font-medium">{titulo}</p>
        <p className="mt-0.5 text-[11.5px] leading-[1.4] text-ink-3">{pie}</p>
      </div>
      <span className={`shrink-0 font-mono text-[12px] ${bueno ? 'text-olive' : 'text-ink-3'}`}>
        {estado}
      </span>
    </div>
  );
}

/** Celdas vacías y una encendida: el panal es la marca y dice «aquí no hay nada todavía». */
function PanalVacio(): React.ReactElement {
  const celdas = [
    [24, -18],
    [24, 18],
    [0, -36],
    [0, 36],
    [-24, -18],
    [-24, 18],
  ];
  return (
    <div className="flex shrink-0 justify-center pb-2 pt-2">
      <svg width="88" height="102" viewBox="-6 -20 92 120" fill="none" aria-hidden>
        <g stroke="#2B2540" strokeWidth="1.4">
          {celdas.map(([x, y]) => (
            <polygon
              key={`${x},${y}`}
              points="20,2 36,11 36,29 20,38 4,29 4,11"
              transform={`translate(${x},${y})`}
            />
          ))}
        </g>
        <polygon
          points="20,2 36,11 36,29 20,38 4,29 4,11"
          fill="#2E2510"
          stroke="#E29A2E"
          strokeWidth="1.6"
        />
      </svg>
    </div>
  );
}
