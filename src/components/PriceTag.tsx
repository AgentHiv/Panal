import { cn } from '@/lib/utils';
import { formatMon } from '@/data/agents';

export interface PriceTagProps {
  amount: number; // MON
  /** texto del sufijo, por defecto "MON/tarea" */
  suffix?: string;
  className?: string;
}

/** Mono `0.015` + `MON/tarea` small ink-3 (design.md §5). */
export default function PriceTag({ amount, suffix = 'MON/tarea', className }: PriceTagProps) {
  return (
    <span className={cn('inline-flex items-baseline gap-1.5', className)}>
      <span className="font-mono text-[0.875rem] font-medium text-ink">{formatMon(amount)}</span>
      <span className="text-[0.8125rem] text-ink-3">{suffix}</span>
    </span>
  );
}
