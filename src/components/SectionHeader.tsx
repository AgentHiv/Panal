import type { ReactNode } from 'react';
import { Hexagon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SectionHeaderProps {
  eyebrow: string;
  /** H2 — admite <em className="serif-accent text-honey-deep">…</em> */
  title: ReactNode;
  sub?: string;
  /** slot de acción a la derecha (design.md §5) */
  action?: ReactNode;
  dark?: boolean;
  align?: 'left' | 'center';
  className?: string;
}

/** Eyebrow + H2 (con palabra serif italic) + sub opcional + acción derecha. */
export default function SectionHeader({
  eyebrow,
  title,
  sub,
  action,
  dark = false,
  align = 'left',
  className,
}: SectionHeaderProps) {
  const centered = align === 'center';
  return (
    <div
      className={cn(
        'flex gap-6',
        centered ? 'flex-col items-center text-center' : 'flex-col md:flex-row md:items-end md:justify-between',
        className,
      )}
    >
      <div className={cn('max-w-2xl', centered && 'flex flex-col items-center')}>
        <p
          className={cn(
            'eyebrow flex items-center gap-2',
            dark ? 'text-honey' : 'text-ink-3',
          )}
        >
          <Hexagon size={12} className="fill-honey text-honey" aria-hidden />
          {eyebrow}
        </p>
        <h2 className={cn('display-l mt-4 text-balance', dark ? 'text-coal-text' : 'text-ink')}>{title}</h2>
        {sub && (
          <p className={cn('mt-4 text-[1.125rem] leading-[1.65]', dark ? 'text-coal-mute' : 'text-ink-2')}>
            {sub}
          </p>
        )}
      </div>
      {action && !centered && <div className="shrink-0">{action}</div>}
      {action && centered && <div>{action}</div>}
    </div>
  );
}
