import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Check, ExternalLink } from 'lucide-react';
import HexAvatar from '@/components/HexAvatar';
import RatingStars from '@/components/RatingStars';
import TxHash from '@/components/TxHash';
import type { Agent } from '@/data/agents';
import { formatInt, formatRating } from '@/data/agents';
import { timeAgo, truncateHash } from '@/data/events';
import { EXPLORER_TX } from '@/contracts/config';
import { useIndexAgentEvents } from '@/lib/indexer';

/** Eventos con rating que cuentan como reseña verificable on-chain. */
const RATED_EVENTS = new Set(['TaskCompleted', 'DisputeResolved']);

/**
 * Tab Reseñas (agente.md S3): reseñas REALES = eventos TaskCompleted /
 * DisputeResolved con rating del indexador (txHash enlazable al explorer).
 * Sin reseñas → empty state. Si el indexador no responde, lista vacía
 * (degradación graceful; nunca se inventan reseñas).
 */
export default function ReviewsTab({ agent }: { agent: Agent }) {
  const { t } = useTranslation();
  const { events, loading } = useIndexAgentEvents(agent.wallet);
  // Sello de carga del componente para el "hace X" (evita impurezas en render).
  const [now] = useState(() => Date.now());

  const reviews = useMemo(
    () =>
      events
        .filter((ev) => RATED_EVENTS.has(ev.event) && ev.args['rating'] !== undefined)
        .map((ev) => ({
          id: ev.id,
          author: truncateHash(String(ev.args['client'] ?? ev.args['worker'] ?? '')),
          rating: Number(ev.args['rating']),
          tx: ev.txHash,
          secondsAgo: Math.max(0, Math.floor(now / 1000) - ev.ts),
        })),
    [events, now],
  );

  const histogram = useMemo(() => {
    const counts = [0, 0, 0, 0, 0]; // índice 0 = 5★ … índice 4 = 1★
    for (const r of reviews) {
      const stars = Math.min(5, Math.max(1, Math.round(r.rating)));
      counts[5 - stars] += 1;
    }
    const total = reviews.length || 1;
    return counts.map((c) => Math.round((c / total) * 100));
  }, [reviews]);

  const avg = useMemo(
    () => (reviews.length ? reviews.reduce((acc, r) => acc + r.rating, 0) / reviews.length : 0),
    [reviews],
  );

  if (!loading && reviews.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-[0.875rem] text-ink-3">
        {t('detail.reviews.empty')}
      </p>
    );
  }

  return (
    <div className="grid gap-10 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      {/* Resumen (col izq) */}
      <div>
        <div className="flex items-end gap-3">
          <span className="font-display text-[3.5rem] font-bold leading-none tracking-[-0.02em] text-ink">
            {formatRating(avg)}
          </span>
          <span className="pb-2 font-mono text-[12px] text-ink-3">/ 5</span>
        </div>
        <RatingStars rating={avg} size={18} className="mt-3" />
        <p className="mt-2 text-[0.875rem] text-ink-3">{t('detail.verifiedReviews', { count: formatInt(reviews.length) })}</p>

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
            key={r.id}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.06, duration: 0.45, ease: 'easeOut' }}
            className="rounded-2xl border border-line bg-paper p-5"
          >
            <div className="flex items-center gap-3">
              <HexAvatar seed={r.author} size={36} />
              <div className="min-w-0 flex-1">
                <span className="font-mono text-[0.8125rem] font-medium text-ink">{r.author}</span>
                <RatingStars rating={r.rating} size={12} className="mt-1" />
              </div>
            </div>
            <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-ink-3">
              <Check size={12} className="text-olive" strokeWidth={3} aria-hidden />
              {t('reviews.verifiedOnchain')} · tx <TxHash hash={r.tx} className="text-[11px]" />
              <a
                href={EXPLORER_TX(r.tx)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-honey-deep transition-colors hover:text-ink"
                aria-label={t('hire.step3.viewExplorer')}
              >
                <ExternalLink size={11} aria-hidden />
              </a>
              · {timeAgo(r.secondsAgo, t)}
            </p>
          </motion.article>
        ))}
      </div>
    </div>
  );
}
