import { NavLink } from 'react-router-dom';
import Icono from '~/componentes/Icono';
import type { NombreIcono } from '~/componentes/Icono';

/**
 * Tres pestañas. La web tiene nueve rutas; aquí no cabe —ni hace falta— la
 * portada, el enjambre, el protocolo, el token ni el panel.
 */
const PESTANAS: { a: string; etiqueta: string; icono: NombreIcono }[] = [
  { a: '/chats', etiqueta: 'Chats', icono: 'chat' },
  { a: '/mercado', etiqueta: 'Mercado', icono: 'bolsa' },
  { a: '/saldo', etiqueta: 'Saldo', icono: 'cartera' },
];

export default function Pestanas(): React.ReactElement {
  return (
    <nav className="con-barra-abajo flex shrink-0 border-t border-line bg-noche px-2 pt-1.5">
      {PESTANAS.map((p) => (
        <NavLink
          key={p.a}
          to={p.a}
          className="pulsable tocable flex grow flex-col items-center gap-1 py-1.5"
        >
          {({ isActive }) => (
            <>
              {/* La pestaña activa se marca con una pastilla detrás del icono,
                  no solo con el color: en una barra oscura, miel sobre gris es
                  poca diferencia a la primera ojeada. */}
              <span
                className={`flex h-7 w-[52px] items-center justify-center rounded-full transition-colors ${
                  isActive ? 'bg-honey-soft' : ''
                }`}
              >
                <Icono nombre={p.icono} tamano={21} color={isActive ? '#E29A2E' : '#948DAE'} />
              </span>
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
