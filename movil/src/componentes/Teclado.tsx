import { useEffect, useRef, useState } from 'react';
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
 *
 * Con `huella`, la tecla de abajo a la izquierda —que estaba vacía— es la de
 * la huella. Es el sitio donde la pone cualquier teléfono, y así el teclado no
 * cambia de forma según esté activada o no.
 */
export const LARGO_PIN = 6;

/**
 * El lado de cada tecla. Crece con la pantalla y para en 70 px: en un teléfono
 * bajo (640 px) con teclas fijas de 64 el teclado no cabía con el título y el
 * aviso, y en uno alto, de 58 se veía como un teclado de calculadora.
 */
const TECLA = 'h-[clamp(54px,8.8dvh,70px)] w-[clamp(54px,8.8dvh,70px)]';

export default function Teclado({
  titulo,
  explicacion,
  onCompleto,
  error,
  ocupado,
  huella,
}: {
  titulo: string;
  explicacion: string;
  onCompleto: (pin: string) => void;
  /** Un texto aquí vacía los puntos y los tiñe de rojo. */
  error?: string | null;
  ocupado?: boolean;
  /** La tecla de la huella, si está activada en este teléfono. */
  huella?: { onPulsar: () => void; etiqueta: string } | null;
}): React.ReactElement {
  const [pin, setPin] = useState('');
  const T = useTextos();

  /**
   * Los puntos tiemblan con cada PIN equivocado, también con el segundo.
   *
   * No basta con mirar si cambió `error`: dos fallos seguidos traen el mismo
   * texto y no cambia nada. Por eso cuenta también el final de cada intento
   * (`ocupado` que pasa a falso con un error puesto).
   */
  const [sacudida, setSacudida] = useState(0);
  const antes = useRef({ ocupado, error });
  useEffect(() => {
    const a = antes.current;
    if (error && (error !== a.error || (a.ocupado && !ocupado))) setSacudida((n) => n + 1);
    antes.current = { ocupado, error };
  }, [ocupado, error]);

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

  const digitos = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  return (
    <div className="flex min-h-0 grow flex-col items-center justify-center px-7 pb-6">
      <Sello ocupado={!!ocupado} />

      <h1 className="mt-5 text-center font-display text-[23px] font-semibold -tracking-[0.015em]">
        {titulo}
      </h1>
      <p className="mt-2 max-w-[300px] text-pretty text-center text-[13px] leading-[1.55] text-ink-2">
        {explicacion}
      </p>

      <div
        key={sacudida}
        className={`mt-6 flex h-4 items-center gap-3.5 ${sacudida > 0 && error ? 'sacudir' : ''}`}
      >
        {Array.from({ length: LARGO_PIN }, (_, i) => {
          // Con `ocupado` van todos llenos: el PIN ya se mandó y se está
          // derivando la clave, así que vaciarlos parecería que se ha borrado.
          const lleno = ocupado || i < pin.length;
          return (
            <span
              key={i}
              className={`h-3 w-3 rounded-full border transition-all duration-150 ${
                error && !lleno
                  ? 'border-terra/70 bg-transparent'
                  : lleno
                    ? 'scale-110 border-honey bg-honey shadow-[0_0_10px_rgba(226,154,46,.55)]'
                    : 'border-line bg-transparent'
              }`}
            />
          );
        })}
      </div>

      {/* El hueco se reserva siempre: sin esto el teclado da un salto cada vez
          que aparece o desaparece el aviso. */}
      <p className="mt-3 min-h-4 max-w-[300px] text-center text-[12px] leading-[1.4] text-terra">
        {error ?? ''}
      </p>

      <div className="mt-3 grid grid-cols-3 gap-x-[clamp(16px,6vw,28px)] gap-y-[clamp(8px,1.5dvh,14px)]">
        {digitos.map((d) => (
          <Tecla key={d} digito={d} onPulsar={() => teclear(d)} ocupado={ocupado} />
        ))}

        {huella ? (
          <button
            type="button"
            disabled={ocupado}
            onClick={huella.onPulsar}
            aria-label={huella.etiqueta}
            className={`pulsable flex ${TECLA} items-center justify-center rounded-full disabled:opacity-40`}
          >
            <Icono nombre="huella" tamano={30} color="#E29A2E" grosor={1.7} />
          </button>
        ) : (
          <span />
        )}

        <Tecla digito="0" onPulsar={() => teclear('0')} ocupado={ocupado} />

        <button
          type="button"
          disabled={ocupado || pin.length === 0}
          onClick={() => setPin(pin.slice(0, -1))}
          aria-label={T.comun.borrar}
          className={`pulsable flex ${TECLA} items-center justify-center rounded-full disabled:opacity-30`}
        >
          <Icono nombre="borrar" tamano={26} color="#948DAE" grosor={1.7} />
        </button>
      </div>

      <p className="mt-4 h-4 text-[12px] text-ink-3">{ocupado ? T.comun.abriendo : ''}</p>
    </div>
  );
}

function Tecla({
  digito,
  onPulsar,
  ocupado,
}: {
  digito: string;
  onPulsar: () => void;
  ocupado?: boolean;
}): React.ReactElement {
  return (
    <button
      type="button"
      disabled={ocupado}
      onClick={onPulsar}
      className={`pulsable flex ${TECLA} items-center justify-center rounded-full border border-line/70 bg-cream font-display text-[26px] font-medium text-ink active:bg-sand disabled:opacity-40`}
    >
      {digito}
    </button>
  );
}

/**
 * El sello de arriba: el hexágono de la marca, en miel, con el candado.
 *
 * Relleno y con un halo, no un contorno: es lo primero que se ve cada vez que
 * se abre la app, y un trazo fino de 1,6 sobre fondo casi negro se leía como
 * un icono de ajustes. Mientras se deriva la clave, el candado late.
 */
function Sello({ ocupado }: { ocupado: boolean }): React.ReactElement {
  return (
    <span className="relative flex h-[clamp(60px,10dvh,78px)] w-[clamp(60px,10dvh,78px)] shrink-0 items-center justify-center">
      <span className="absolute -inset-3 rounded-full bg-honey/20 blur-2xl" aria-hidden />
      <svg viewBox="0 0 40 40" className="absolute inset-0 h-full w-full" aria-hidden>
        <defs>
          <linearGradient id="sello-miel" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#F2B54F" />
            <stop offset="1" stopColor="#C9821F" />
          </linearGradient>
        </defs>
        <polygon points="20,2 36,11 36,29 20,38 4,29 4,11" fill="url(#sello-miel)" />
        <polygon
          points="20,5.6 32.8,12.8 32.8,27.2 20,34.4 7.2,27.2 7.2,12.8"
          fill="none"
          stroke="rgba(255,255,255,.3)"
          strokeWidth="0.8"
        />
      </svg>
      <Icono
        nombre="candado"
        tamano={26}
        color="#22170A"
        grosor={2.2}
        className={`relative ${ocupado ? 'animate-pulse' : ''}`}
      />
    </span>
  );
}
