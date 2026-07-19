import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface RatingStarsProps {
  rating: number; // 0–5
  size?: number;
  className?: string;
}

/** 5 estrellas lucide, fill honey, tamaño 14 por defecto (design.md §5). */
export default function RatingStars({ rating, size = 14, className }: RatingStarsProps) {
  const pct = Math.min(100, Math.max(0, (rating / 5) * 100));
  const stars = [0, 1, 2, 3, 4];
  return (
    <span
      className={cn('relative inline-flex align-middle', className)}
      role="img"
      aria-label={`${rating.toFixed(1)} de 5 estrellas`}
    >
      <span className="flex gap-0.5">
        {stars.map((i) => (
          <Star key={i} size={size} className="fill-sand text-sand" strokeWidth={0} />
        ))}
      </span>
      <span className="absolute inset-0 overflow-hidden" style={{ width: `${pct}%` }}>
        <span className="flex gap-0.5">
          {stars.map((i) => (
            <Star key={i} size={size} className="shrink-0 fill-honey text-honey" strokeWidth={0} />
          ))}
        </span>
      </span>
    </span>
  );
}
