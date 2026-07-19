import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { toast } from 'sonner';
import HexAvatar from '@/components/HexAvatar';
import RatingStars from '@/components/RatingStars';
import TxHash from '@/components/TxHash';
import { ratingHistogram, reviewsFor } from '@/components/market/detail-data';
import type { Agent } from '@/data/agents';
import { formatInt, formatRating } from '@/data/agents';

/**
 * Tab Reseñas (agente.md S3): resumen con número gigante + histograma animado
 * (scaleX, stagger .1) y lista de reseñas verificadas on-chain.
 */
export default function ReviewsTab({ agent }: { agent: Agent }) {
  const reviews = useMemo(() => reviewsFor(agent), [agent]);
  const histogram = useMemo(() => ratingHistogram(agent), [agent]);

  return (
    <div className="grid gap-10 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      {/* Resumen (col izq) */}
      <div>
        <div className="flex items-end gap-3">
          <span className="font-display text-[3.5rem] font-bold leading-none tracking-[-0.02em] text-ink">
            {formatRating(agent.rating)}
          </span>
          <span className="pb-2 font-mono text-[12px] text-ink-3">/ 5</span>
        </div>
        <RatingStars rating={agent.rating} size={18} className="mt-3" />
        <p className="mt-2 text-[0.875rem] text-ink-3">({formatInt(agent.reviews)} reseñas verificadas)</p>

        {/* histograma */}
        <div className="mt-6 flex flex-col gap-2.5">
          {histogram.map((pct, i) => {
            const stars = 5 - i;
            return (
              <div key={stars} className="flex items-center gap-3">
                <span className="w-6 shrink-0 font-mono text-[11px] text-ink-3">{stars}★</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-sand">
                  <motion.div
                    className="h-full rounded-full bg-honey"
                    initial={{ scaleX: 0 }}
                    whileInView={{ scaleX: 1 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.6, delay: i * 0.1, ease: 'easeOut' }}
                    style={{ width: `${pct}%`, transformOrigin: 'left' }}
                  />
                </div>
                <span className="w-8 shrink-0 text-right font-mono text-[11px] text-ink-3">{pct}%</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Lista (col dcha) */}
      <div className="flex flex-col gap-5">
        {reviews.map((r, i) => (
          <motion.article
            key={`${r.author}-${i}`}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.06, duration: 0.45, ease: 'easeOut' }}
            className="rounded-2xl border border-line bg-paper p-5"
          >
            <div className="flex items-center gap-3">
              <HexAvatar seed={r.author} size={36} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[0.8125rem] font-medium text-ink">{r.author}</span>
                  <span className="rounded-full bg-sand px-2 py-0.5 text-[0.6875rem] font-medium text-ink-2">
                    {r.kind === 'agente' ? 'Agente verificado' : 'Humano verificado'}
                  </span>
                </div>
                <RatingStars rating={r.rating} size={12} className="mt-1" />
              </div>
            </div>
            <p className="mt-3 text-[0.9375rem] leading-[1.6] text-ink-2">“{r.text}”</p>
            <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-ink-3">
              <Check size={12} className="text-olive" strokeWidth={3} aria-hidden />
              Verificada on-chain · tx <TxHash hash={r.tx} className="text-[11px]" /> · {r.ago}
            </p>
          </motion.article>
        ))}

        <button
          type="button"
          onClick={() => toast('Has visto las reseñas destacadas de la muestra')}
          className="mt-2 self-center rounded-full border border-line bg-paper px-6 py-2.5 text-[0.875rem] font-medium text-ink-2 transition-colors duration-200 hover:border-honey hover:text-honey-deep"
        >
          Cargar más reseñas
        </button>
      </div>
    </div>
  );
}
