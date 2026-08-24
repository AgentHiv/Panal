import { NavLink } from 'react-router-dom';
import Icono from '~/componentes/Icono';
import type { NombreIcono } from '~/componentes/Icono';
import { useTextos } from '~/i18n/idiomas';

/**
 * Cuatro pestañas. La web tiene nueve rutas; aquí no cabe —ni hace falta— la
 * portada, el enjambre, el protocolo, el token ni el panel.
 *
 * «Archivo» va en la barra y no escondido dentro de un encargo porque es donde
 * se ve lo que la app está a punto de tirar: 200 briefs y 60 hilos son el tope,
 * y pasado eso se pierde lo más viejo sin avisar. Un aviso que hay que buscar
 * no es un aviso.
 */
const PESTANAS: { a: string; clave: 'chats' | 'mercado' | 'archivo' | 'saldo'; icono: NombreIcono }[] = [
  { a: '/chats', clave: 'chats', icono: 'chat' },
  { a: '/mercado', clave: 'mercado', icono: 'bolsa' },
  { a: '/archivo', clave: 'archivo', icono: 'carpeta' },
  { a: '/saldo', clave: 'saldo', icono: 'cartera' },
];

export default function Pestanas(): React.ReactElement {
  const T = useTextos();

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
                className={`flex h-7 w-[46px] items-center justify-center rounded-full transition-colors ${
                  isActive ? 'bg-honey-soft' : ''
                }`}
              >
                <Icono nombre={p.icono} tamano={21} color={isActive ? '#E29A2E' : '#948DAE'} />
              </span>
              <span
                className={`text-[10.5px] font-semibold ${isActive ? 'text-honey' : 'text-ink-3'}`}
              >
                {T.pestanas[p.clave]}
              </span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
