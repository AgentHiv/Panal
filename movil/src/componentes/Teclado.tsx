import { useState } from 'react';
import Icono from '~/componentes/Icono';
import { useTextos } from '~/i18n/idiomas';

/**
 * El teclado del PIN.
 *
 * Numérico y de la app, no el del sistema: un `<input type="password">` en
 * Android levanta el teclado, empuja la pantalla y ofrece autocompletar y
 * pegar. Para seis dígitos que abren un llavero, eso sobra.
 *
 * Avisa cuando se completan los seis y no antes: el PIN no viaja dígito a
 * dígito, y quien llama derivará la clave una sola vez.
 */
export const LARGO_PIN = 6;

export default function Teclado({
  titulo,
  explicacion,
  onCompleto,
  error,
  ocupado,
}: {
  titulo: string;
  explicacion: string;
  onCompleto: (pin: string) => void;
  /** Un texto aquí vacía los puntos y los tiñe de rojo. */
  error?: string | null;
  ocupado?: boolean;
}): React.ReactElement {
  const [pin, setPin] = useState('');
  const T = useTextos();

  /**
   * Se vacía SIEMPRE al completar los seis, no cuando llega un error.
   *
   * Al principio se vaciaba con el error, y eso dejaba el teclado muerto en dos
   * casos reales: al confirmar un PIN nuevo —que no es ningún error, y sin
   * embargo hay que volver a teclear— y al fallar dos veces seguidas, porque el
   * mensaje era idéntico y no había cambio que detectar. Los seis puntos se
   * quedaban llenos y no pasaba nada al pulsar. Lo encontró el recorrido
   * automático, no el typecheck.
   */
  const teclear = (d: string): void => {
    if (ocupado || pin.length >= LARGO_PIN) return;
    const nuevo = pin + d;
    setPin(nuevo);
    if (nuevo.length === LARGO_PIN) {
      onCompleto(nuevo);
      setPin('');
    }
  };

  const teclas = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '←'];

  return (
    <div className="flex min-h-0 grow flex-col items-center justify-center px-7 pb-6">
      {/* El candado va encima del hexágono con CSS y no dentro del SVG: un
          <svg> anidado hereda el sistema de coordenadas del de fuera y habría
          que cuadrar el trazo a mano cada vez que cambie el tamaño. */}
      <span className="relative flex h-[54px] w-[54px] items-center justify-center">
        <svg width="54" height="54" viewBox="0 0 40 40" className="absolute inset-0" aria-hidden>
          <polygon
            points="20,2 36,11 36,29 20,38 4,29 4,11"
            fill="none"
            stroke="#E29A2E"
            strokeWidth="1.6"
          />
        </svg>
        <Icono nombre="candado" tamano={21} color="#E29A2E" grosor={2} className="relative" />
      </span>

      <h1 className="mt-4 font-display text-[22px] font-semibold -tracking-[0.015em]">{titulo}</h1>
      <p className="mt-2 max-w-[300px] text-pretty text-center text-[13px] leading-[1.55] text-ink-2">
        {explicacion}
      </p>

      <div className="mt-6 flex h-4 items-center gap-3">
        {Array.from({ length: LARGO_PIN }, (_, i) => (
          // Con `ocupado` van todos llenos: el PIN ya se mandó y se está
          // derivando la clave, así que vaciarlos parecería que se ha borrado.
          <span
            key={i}
            className={`h-2.5 w-2.5 rounded-full transition-colors ${
              ocupado || i < pin.length ? 'bg-ink' : 'bg-line'
            }`}
          />
        ))}
      </div>

      {/* El hueco se reserva siempre: sin esto el teclado da un salto cada vez
          que aparece o desaparece el aviso. */}
      <p className="mt-3 h-4 text-[12px] text-terra">{error ?? ''}</p>

      <div className="mt-3 grid w-full max-w-[290px] grid-cols-3 gap-2.5">
        {teclas.map((t, i) =>
          t === '' ? (
            <span key={i} />
          ) : (
            <button
              key={i}
              type="button"
              disabled={ocupado}
              onClick={() => (t === '←' ? setPin(pin.slice(0, -1)) : teclear(t))}
              className={`pulsable flex h-[58px] items-center justify-center rounded-[15px] font-display text-[22px] font-medium disabled:opacity-40 ${
                t === '←' ? 'text-ink-3' : 'bg-cream text-ink'
              }`}
            >
              {t}
            </button>
          ),
        )}
      </div>

      <p className="mt-4 h-4 text-[12px] text-ink-3">{ocupado ? T.comun.abriendo : ''}</p>
    </div>
  );
}
