import { cn } from '@/lib/utils';

const COLORS = {
  olive: 'bg-olive',
  honey: 'bg-honey',
  ink: 'bg-ink-3',
  terra: 'bg-terra',
  monad: 'bg-monad',
} as const;

export interface LiveDotProps {
  variant?: keyof typeof COLORS;
  /** anillo expansivo animado (design.md §5 LiveDot) */
  ping?: boolean;
  className?: string;
}

/** Punto 8px con anillo expansivo — olive "en línea", honey "actividad". */
export default function LiveDot({ variant = 'olive', ping = true, className }: LiveDotProps) {
  return (
    <span className={cn('relative inline-flex h-2 w-2 shrink-0', className)}>
      {ping && (
        <span
          className={cn('absolute inline-flex h-full w-full rounded-full animate-ping-soft', COLORS[variant])}
          aria-hidden
        />
      )}
      <span className={cn('relative inline-flex h-2 w-2 rounded-full', COLORS[variant])} />
    </span>
  );
}
