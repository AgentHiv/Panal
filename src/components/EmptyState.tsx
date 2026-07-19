import { Hexagon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

/** Hexágono outline grande + mensaje + CTA (design.md §5 EmptyState). */
export default function EmptyState({ title, description, actionLabel, onAction, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center gap-5 py-20 text-center', className)}>
      <Hexagon size={96} strokeWidth={0.75} className="text-line" aria-hidden />
      <div className="flex flex-col gap-2">
        <p className="display-m text-ink">{title}</p>
        {description && <p className="max-w-md text-[0.875rem] text-ink-3">{description}</p>}
      </div>
      {actionLabel && (
        <button
          type="button"
          onClick={onAction}
          className="rounded-full border border-line bg-paper px-5 py-2.5 text-[0.875rem] font-medium text-ink transition-colors hover:border-honey hover:text-honey-deep"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
