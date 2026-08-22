import { useNavigate } from 'react-router-dom';

/**
 * El primer arranque. Portado del lienzo de diseño.
 *
 * No dice «no tienes nada»: dice «las primeras van por nuestra cuenta». Es lo
 * único que funciona con la wallet a cero, y funciona por una razón concreta
 * del protocolo: en x402 la transacción la manda el agente, así que el cliente
 * no necesita MON ni para el gas. Con $PANAL regalado ya se puede hablar.
 *
 * Que $PANAL tenga mercado en nad.fun no cambia esto: comprarlo exige MON. El
 * mercado es la RECARGA, no la entrada — por eso está en la nota de abajo y no
 * en el botón.
 *
 * PENDIENTE: la cantidad es un valor de muestra hasta que se decida el reparto,
 * y el saldo real todavía no se lee aquí.
 */
const REGALO = 10;

export default function Arranque(): React.ReactElement {
  const navegar = useNavigate();

  return (
    <div className="flex min-h-0 grow flex-col">
      <header className="con-barra-arriba flex shrink-0 items-center justify-between px-5 pb-1 pt-5">
        <h1 className="font-display text-[26px] font-semibold -tracking-[0.015em]">Chats</h1>
      </header>

      <div className="flex min-h-0 grow flex-col overflow-y-auto px-5 pb-4">
        <PanalVacio />

        <h2 className="text-pretty text-center font-display text-[22px] font-semibold -tracking-[0.015em]">
          Las primeras van por nuestra cuenta
        </h2>
        <p className="mt-2 text-pretty text-center text-[14px] leading-[1.55] text-ink-2">
          Tu wallet ya es tu cuenta: no hay nada más que registrar. Y hablar no te va a costar gas.
        </p>

        <div className="mt-[18px] flex items-center gap-3 rounded-2xl border border-honey bg-honey-soft px-4 py-3.5">
          <svg width="30" height="30" viewBox="0 0 40 40" className="shrink-0" aria-hidden>
            <polygon
              points="20,2 36,11 36,29 20,38 4,29 4,11"
              fill="none"
              stroke="#E29A2E"
              strokeWidth="2"
            />
            <text
              x="20"
              y="26"
              textAnchor="middle"
              fontFamily="Space Grotesk, sans-serif"
              fontSize="13"
              fontWeight="700"
              fill="#E29A2E"
            >
              P
            </text>
          </svg>
          <div className="min-w-0 grow">
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-[20px] font-medium text-honey">{REGALO}</span>
              <span className="text-[13px] font-semibold text-honey">$PANAL para ti</span>
            </div>
            <p className="mt-0.5 text-[11.5px] leading-[1.45] text-ink-2">
              Unas veinte preguntas. Sin gas y sin comprar nada.
            </p>
          </div>
        </div>

        <div className="mt-[22px] overflow-hidden rounded-2xl border border-line">
          <Puerta
            icono="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-5.4A8 8 0 1 1 21 12z"
            titulo="Hablar con un agente"
            pie="desde 0,4 $PANAL el mensaje"
            estado="listo"
            listo
          />
          <div className="h-px bg-line" />
          <Puerta
            icono="M4 10h16v10H4z M8 10V7a4 4 0 0 1 8 0v3"
            titulo="Encargar un trabajo"
            pie="desde 8 MON, y el gas de bloquearlo"
            estado="más adelante"
          />
        </div>

        <p className="mt-3 rounded-xl bg-sand px-3.5 py-3 text-[12px] leading-[1.5] text-ink-3">
          Cuando se te acaben, $PANAL se cambia en nad.fun y MON lo traes a esta dirección desde
          donde ya tengas. Panal no vende ninguna de las dos.
        </p>

        <button
          type="button"
          onClick={() => navegar('/mercado')}
          className="pulsable mt-[18px] flex h-[52px] shrink-0 items-center justify-center gap-2 rounded-full bg-monad text-[15px] font-semibold text-white shadow-monad"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#fff"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M4 8h16l-1.2 11.2A2 2 0 0 1 16.8 21H7.2a2 2 0 0 1-2-1.8z" />
          </svg>
          Elegir con quién hablar
        </button>
        <p className="mt-2 text-center text-[11.5px] text-ink-3">
          Mirar el mercado y los precios no cuesta nada.
        </p>
      </div>
    </div>
  );
}

function Puerta({
  icono,
  titulo,
  pie,
  estado,
  listo = false,
}: {
  icono: string;
  titulo: string;
  pie: string;
  estado: string;
  listo?: boolean;
}): React.ReactElement {
  return (
    <div className="flex items-center gap-3 px-3.5 py-3.5">
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#948DAE"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0"
        aria-hidden
      >
        <path d={icono} />
      </svg>
      <div className="min-w-0 grow">
        <p className="text-[13.5px] font-medium">{titulo}</p>
        <p className="mt-0.5 text-[11.5px] text-ink-3">{pie}</p>
      </div>
      <span
        className={`shrink-0 font-mono text-[12.5px] ${listo ? 'text-olive' : 'text-ink-3'}`}
      >
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
    <div className="flex shrink-0 justify-center pb-3 pt-3.5">
      <svg width="96" height="110" viewBox="-6 -20 92 120" fill="none" aria-hidden>
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
