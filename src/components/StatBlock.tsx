import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export interface StatBlockProps {
  value: number;
  decimals?: number;
  suffix?: string;
  prefix?: string;
  label: string;
  /** variante oscura (design.md §5) */
  dark?: boolean;
  className?: string;
  durationMs?: number;
}

/** Número Space Grotesk + label eyebrow, con count-up al entrar en viewport (1.4s ease-out, es-ES). */
export default function StatBlock({
  value,
  decimals = 0,
  suffix,
  prefix,
  label,
  dark = false,
  className,
  durationMs = 1400,
}: StatBlockProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  const [display, setDisplay] = useState('0');
  const [reduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setActive(true);
          io.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!active || reduced) return;
    const fmt = new Intl.NumberFormat('es-ES', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(fmt.format(value * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, reduced, value, decimals, durationMs]);

  const text = reduced
    ? new Intl.NumberFormat('es-ES', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }).format(value)
    : display;

  return (
    <div ref={ref} className={cn('flex flex-col gap-2', className)}>
      <span className={cn('stat-number', dark ? 'text-coal-text' : 'text-ink')}>
        {prefix}
        {text}
        {suffix && (
          <span className={cn('ml-1 text-[0.45em] font-semibold', dark ? 'text-honey' : 'text-honey-deep')}>
            {suffix}
          </span>
        )}
      </span>
      <span className={cn('eyebrow', dark ? 'text-coal-mute' : 'text-ink-3')}>{label}</span>
    </div>
  );
}
