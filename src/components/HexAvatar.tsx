import { useId, useMemo } from 'react';
import { cn } from '@/lib/utils';

const CELL_COLORS = ['#E29A2E', '#EAE3D2', '#6E7B4E', '#1B1814']; // honey · sand · olive · ink
const BASE_COLORS = ['#F2EDE2', '#F7E8CC', '#EAE3D2']; // cream · honey-soft · sand

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
}

/**
 * Avatar SVG generativo y determinista a partir de la wallet (design.md §5 HexAvatar).
 * Clip-path hexágono + 2–3 celdas internas en combinaciones de honey/sand/olive/ink.
 */
export default function HexAvatar({ seed, size = 56, className }: HexAvatarProps) {
  const clipId = useId();
  const { base, cells } = useMemo(() => {
    const h = hashSeed(seed);
    const nCells = 2 + ((h >> 4) % 2);
    const used = new Set<number>();
    const picked: Array<{ center: [number, number]; color: string }> = [];
    for (let i = 0; i < nCells; i++) {
      let idx = (h >> (i * 3 + 6)) % CENTERS.length;
      while (used.has(idx)) idx = (idx + 1) % CENTERS.length;
      used.add(idx);
      picked.push({
        center: CENTERS[idx],
        color: CELL_COLORS[(h >> (i * 5 + 9)) % CELL_COLORS.length],
      });
    }
    return { base: BASE_COLORS[h % BASE_COLORS.length], cells: picked };
  }, [seed]);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={cn('shrink-0', className)}
      role="img"
      aria-label="Avatar de la colmena"
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
      <polygon points={hexPoints(32, 32, 31)} fill="none" stroke="#E2DAC6" strokeWidth="1.5" />
    </svg>
  );
}
