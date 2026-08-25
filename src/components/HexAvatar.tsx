import { useId, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';

const CELL_COLORS = ['#E29A2E', '#836EF9', '#C8C3DC', '#6E7B4E', '#1B1814']; // honey · monad · sand · olive · ink
const BASE_COLORS = ['#EFEAF8', '#F2EFFA', '#C8C3DC']; // cream · honey-soft · sand

function hashSeed(seed: string): number {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) + h + seed.charCodeAt(i)) >>> 0;
  return h;
}

// 7 celdas internas: centro + 6 alrededor (orientación flat-top como el logo)
const CENTERS: Array<[number, number]> = [[32, 32]];
for (let k = 0; k < 6; k++) {
  const a = (Math.PI / 3) * k;
  CENTERS.push([32 + 19 * Math.cos(a), 32 + 19 * Math.sin(a)]);
}

function hexPoints(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 3) * k;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
}

export interface HexAvatarProps {
  /** wallet o nombre: el avatar es determinista a partir de esta semilla */
  seed: string;
  /** 40 / 56 / 96 / 128 (design.md §5) */
  size?: number;
  className?: string;
  /**
   * El logo que el agente publicó en su ficha, si publicó alguno.
   *
   * Si no carga —dominio caído, ruta cambiada, un PNG que ya no está— se cae
   * al avatar generado sin decir nada. Un hueco en la tarjeta sería peor que
   * el hexágono de siempre, y quien mira el mercado no puede hacer nada al
   * respecto: el archivo es del agente, no suyo.
   */
  logo?: string;
  /** Para el `alt` de la imagen: el nombre del agente. */
  alt?: string;
}

/**
 * Avatar SVG generativo y determinista a partir de la wallet (design.md §5 HexAvatar).
 * Clip-path hexágono + 2–3 celdas internas en combinaciones de honey/sand/olive/ink.
 */
export default function HexAvatar({ seed, size = 56, className, logo, alt }: HexAvatarProps) {
  const clipId = useId();
  /** Un logo que no carga deja de intentarlo y cede el sitio al generado. */
  /**
   * Un logo que no carga deja de intentarlo y cede el sitio al generado.
   *
   * El «volver a intentarlo» cuando cambia el logo se hace AQUÍ, ajustando el
   * estado durante el render, y no en un efecto: si se hiciera en un efecto, el
   * primer pintado de un agente nuevo usaría todavía el «roto» del anterior y
   * su logo no llegaría a intentarse.
   */
  const [cual, setCual] = useState(logo);
  const [roto, setRoto] = useState(false);
  if (cual !== logo) {
    setCual(logo);
    setRoto(false);
  }
  const { base, cells } = useMemo(() => {
    const h = hashSeed(seed);
    const nCells = 2 + ((h >>> 4) % 2);
    const used = new Set<number>();
    const picked: Array<{ center: [number, number]; color: string }> = [];
    for (let i = 0; i < nCells; i++) {
      let idx = (h >>> (i * 3 + 6)) % CENTERS.length;
      while (used.has(idx)) idx = (idx + 1) % CENTERS.length;
      used.add(idx);
      picked.push({
        center: CENTERS[idx],
        color: CELL_COLORS[(h >>> (i * 5 + 9)) % CELL_COLORS.length],
      });
    }
    return { base: BASE_COLORS[h % BASE_COLORS.length], cells: picked };
  }, [seed]);

  if (logo && !roto) {
    return (
      <div
        className={cn('shrink-0 overflow-hidden', className)}
        style={{
          width: size,
          height: size,
          // El mismo hexágono del avatar generado, recortando la imagen: así
          // una tarjeta con logo y otra sin él tienen la misma silueta.
          clipPath: 'polygon(100% 50%, 75% 93.3%, 25% 93.3%, 0% 50%, 25% 6.7%, 75% 6.7%)',
          background: base,
        }}
      >
        <img
          src={logo}
          alt={alt ?? ''}
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          // Sin `referrer`: el servidor del agente sirve el logo, y no tiene por
          // qué enterarse además de qué página del mercado estaba mirando cada
          // visitante. La imagen se ve igual.
          referrerPolicy="no-referrer"
          onError={() => setRoto(true)}
          className="h-full w-full object-cover"
        />
      </div>
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={cn('shrink-0', className)}
      role="img"
      aria-label="Avatar del panal"
    >
      <defs>
        <clipPath id={clipId}>
          <polygon points={hexPoints(32, 32, 31)} />
        </clipPath>
      </defs>
      <polygon points={hexPoints(32, 32, 31)} fill={base} />
      <g clipPath={`url(#${clipId})`}>
        {cells.map((c, i) => (
          <polygon key={i} points={hexPoints(c.center[0], c.center[1], 11)} fill={c.color} />
        ))}
      </g>
      <polygon points={hexPoints(32, 32, 31)} fill="none" stroke="#342E4A" strokeWidth="1.5" />
    </svg>
  );
}
