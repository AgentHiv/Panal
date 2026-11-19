import Icono from '~/componentes/Icono';
import type { NombreIcono } from '~/componentes/Icono';

/**
 * Lo que se ve cuando una lista no tiene nada.
 *
 * Antes era una frase gris sobre el fondo, y en un teléfono una pantalla con
 * una sola frase parece una pantalla que no ha cargado. Ahora dice tres cosas,
 * en este orden: qué es esto (el icono, en la celda de miel del panal), por qué
 * está vacío (el título) y qué hacer para que no lo esté (el botón, cuando hay
 * algo que hacer desde aquí; si no, ninguno: un botón que no lleva a nada es
 * peor que no tenerlo).
 *
 * `compacto` es para cuando va dentro de una pantalla con más cosas —«Míos»
 * del tablón, debajo de lo que hay por cobrar—: el mismo dibujo, más pequeño y
 * con menos aire.
 */
export default function Vacio({
  icono,
  titulo,
  texto,
  accion,
  compacto = false,
}: {
  icono: NombreIcono;
  titulo: string;
  texto?: string;
  accion?: { texto: string; onPulsar: () => void; icono?: NombreIcono } | null;
  compacto?: boolean;
}): React.ReactElement {
  return (
    <div
      className={`aparecer flex shrink-0 flex-col items-center text-center ${
        compacto ? 'px-2 py-5' : 'px-4 pb-8 pt-8'
      }`}
    >
      <Panal icono={icono} tamano={compacto ? 92 : 128} />
      <h2
        className={`font-display font-semibold -tracking-[0.01em] ${
          compacto ? 'mt-3 text-[16px]' : 'mt-4 text-[19px]'
        }`}
      >
        {titulo}
      </h2>
      {texto && (
        <p className="mt-1.5 max-w-[300px] text-pretty text-[13px] leading-[1.55] text-ink-2">{texto}</p>
      )}
      {accion && (
        <button
          type="button"
          onClick={accion.onPulsar}
          className="pulsable tocable mt-5 flex items-center justify-center gap-2 rounded-full bg-honey px-5 text-[14px] font-semibold text-[#1B1814]"
        >
          {accion.icono && <Icono nombre={accion.icono} tamano={16} color="#1B1814" grosor={2} />}
          {accion.texto}
        </button>
      )}
    </div>
  );
}

/**
 * Un trozo de panal: la celda del centro, en miel y con el icono; seis vecinas
 * apenas marcadas alrededor. Las celdas encajan de verdad (columna a 32, fila
 * a 27), no están puestas a ojo: un panal mal teselado se nota aunque no se
 * sepa decir por qué.
 */
function Panal({ icono, tamano }: { icono: NombreIcono; tamano: number }): React.ReactElement {
  const vecinas: [number, number, number][] = [
    [-32, 0, 0.9],
    [32, 0, 0.9],
    [-16, -27, 1],
    [16, -27, 0.7],
    [-16, 27, 0.7],
    [16, 27, 1],
  ];
  const lejanas: [number, number][] = [
    [-48, -27],
    [48, 27],
    [0, -54],
    [0, 54],
  ];
  const HEX = '0,-18 16,-9 16,9 0,18 -16,9 -16,-9';
  return (
    <span className="relative flex shrink-0 items-center justify-center" style={{ width: tamano, height: tamano }}>
      <svg viewBox="-66 -66 132 132" className="absolute inset-0 h-full w-full" fill="none" aria-hidden>
        <defs>
          <radialGradient id="vacio-halo">
            <stop offset="0" stopColor="#E29A2E" stopOpacity="0.22" />
            <stop offset="1" stopColor="#E29A2E" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="vacio-miel" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#3A2C10" />
            <stop offset="1" stopColor="#241B0B" />
          </linearGradient>
        </defs>
        <circle r="54" fill="url(#vacio-halo)" />
        <g stroke="#2B2540" strokeWidth="1.2">
          {lejanas.map(([x, y]) => (
            <polygon key={`${x},${y}`} points={HEX} transform={`translate(${x},${y})`} opacity="0.45" />
          ))}
        </g>
        <g stroke="#342E4A" strokeWidth="1.3">
          {vecinas.map(([x, y, o]) => (
            <polygon key={`${x},${y}`} points={HEX} transform={`translate(${x},${y})`} opacity={o} />
          ))}
        </g>
        <polygon points={HEX} fill="url(#vacio-miel)" stroke="#E29A2E" strokeWidth="1.5" />
      </svg>
      <Icono nombre={icono} tamano={Math.round(tamano * 0.17)} color="#E29A2E" grosor={1.9} className="relative" />
    </span>
  );
}
