import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  className?: string;
}

/**
 * Sparkline SVG 80×24 (marketplace.md S6): stroke honey si la tendencia 7d sube,
 * terra si baja; se dibuja (pathLength .8s) al entrar en viewport.
 */
export default function Sparkline({ data, width = 80, height = 24, className }: SparklineProps) {
  const { path, up } = useMemo(() => {
    if (data.length < 2) return { path: '', up: true };
    const min = Math.min(...data);
    const max = Math.max(...data);
    const span = max - min || 1;
    const pad = 2;
    const iw = width - pad * 2;
    const ih = height - pad * 2;
    const pts = data.map((v, i) => {
      const x = pad + (i / (data.length - 1)) * iw;
      const y = pad + ih - ((v - min) / span) * ih;
      return [Number(x.toFixed(2)), Number(y.toFixed(2))] as const;
    });
    const d = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join(' ');
    return { path: d, up: data[data.length - 1] >= data[0] };
  }, [data, width, height]);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('shrink-0', className)}
      role="img"
      aria-label={up ? 'Tendencia 7 días al alza' : 'Tendencia 7 días a la baja'}
    >
      <motion.path
        d={path}
        fill="none"
        stroke={up ? '#E29A2E' : '#B2562E'}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0, opacity: 0 }}
        whileInView={{ pathLength: 1, opacity: 1 }}
        viewport={{ once: true, margin: '0px 0px -8% 0px' }}
        transition={{ pathLength: { duration: 0.8, ease: 'easeInOut' }, opacity: { duration: 0.2 } }}
      />
    </svg>
  );
}
