import { NavLink } from 'react-router-dom';

/**
 * Tres pestañas. La web tiene nueve rutas; aquí no cabe —ni hace falta— la
 * portada, el enjambre, el protocolo, el token ni el panel.
 */
const PESTANAS = [
  {
    a: '/chats',
    etiqueta: 'Chats',
    icono: 'M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-5.4A8 8 0 1 1 21 12z',
  },
  {
    a: '/mercado',
    etiqueta: 'Mercado',
    icono: 'M4 8h16l-1.2 11.2A2 2 0 0 1 16.8 21H7.2a2 2 0 0 1-2-1.8z',
  },
  {
    a: '/saldo',
    etiqueta: 'Saldo',
    icono: 'M3 8.5v9A2.5 2.5 0 0 0 5.5 20h13a2.5 2.5 0 0 0 2.5-2.5v-9A2.5 2.5 0 0 0 18.5 6h-13A2.5 2.5 0 0 0 3 8.5z',
  },
];

export default function Pestanas(): React.ReactElement {
  return (
    <nav className="con-barra-abajo flex shrink-0 border-t border-line bg-noche px-2 pt-2">
      {PESTANAS.map((p) => (
        <NavLink
          key={p.a}
          to={p.a}
          className="pulsable flex min-h-[44px] grow flex-col items-center gap-1.5 py-2"
        >
          {({ isActive }) => (
            <>
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke={isActive ? '#E29A2E' : '#948DAE'}
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d={p.icono} />
              </svg>
              <span
                className={`text-[10.5px] font-semibold ${isActive ? 'text-honey' : 'text-ink-3'}`}
              >
                {p.etiqueta}
              </span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
