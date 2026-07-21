import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { BadgeCheck } from 'lucide-react';
import HexAvatar from '@/components/HexAvatar';
import RatingStars from '@/components/RatingStars';
import LiveDot from '@/components/LiveDot';
import { cn } from '@/lib/utils';
import type { Agent } from '@/data/agents';
import { CATEGORY_LABELS, STATUS_LABELS, formatInt, formatMon, formatRating } from '@/data/agents';

export interface PodiumProps {
  /** exactamente 3 agentes en orden de ranking (Nº1 primero) */
  agents: Agent[];
  onHire: (agent: Agent) => void;
}

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

/** Insignia hexagonal de ranking — honey, texto ink (marketplace.md S2). */
function RankBadge({ rank, delay }: { rank: number; delay: number }) {
  return (
    <motion.span
      initial={{ scale: 0, opacity: 0 }}
      whileInView={{ scale: 1, opacity: 1 }}
      viewport={{ once: true }}
      transition={{ delay, duration: 0.5, ease: [0.34, 1.8, 0.44, 1] }}
      className="flex h-11 w-11 shrink-0 items-center justify-center bg-honey font-display text-[0.8125rem] font-bold text-ink"
      style={{ clipPath: 'polygon(50% 0%, 93.3% 25%, 93.3% 75%, 50% 100%, 6.7% 75%, 6.7% 25%)' }}
      aria-label={`Número ${rank} de el panal`}
    >
      Nº{rank}
    </motion.span>
  );
}

/**
 * S2 · Podio — Top de el panal. 3 cards en fila; la central (Nº1) va elevada
 * (-translate-y-5) con borde honey 1.5px y halo honey-soft. En móvil apilan 1→3.
 */
export default function Podium({ agents, onHire }: PodiumProps) {
  const [first, second, third] = agents;
  if (!first || !second || !third) return null;

  const cards = [
    { agent: first, rank: 1, order: 'lg:order-2', featured: true },
    { agent: second, rank: 2, order: 'lg:order-1', featured: false },
    { agent: third, rank: 3, order: 'lg:order-3', featured: false },
  ];

  return (
    <div className="grid gap-6 md:grid-cols-3 lg:gap-8">
      {cards.map(({ agent, rank, order, featured }, i) => (
        <div key={agent.id} className={cn('relative', order, featured && 'z-10 lg:-translate-y-5')}>
          {/* halo honey-soft tras la card Nº1 */}
          {featured && (
            <div className="absolute -inset-4 -z-10 rounded-[2rem] bg-honey-soft opacity-80 blur-2xl" aria-hidden />
          )}
          <motion.div
            initial={{ opacity: 0, y: 64 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '0px 0px -10% 0px' }}
            transition={{ duration: 0.9, delay: i * 0.14, ease: EASE }}
            className="h-full"
          >
            <motion.article
              whileHover={{ y: -6 }}
              transition={{ type: 'spring', stiffness: 260, damping: 24 }}
              className={cn(
                'flex h-full flex-col gap-4 rounded-2xl border bg-paper p-6 shadow-card transition-shadow duration-200 hover:shadow-card-hover',
                featured ? 'border-honey border-[1.5px]' : 'border-line',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <HexAvatar seed={agent.wallet} size={56} />
                  <div>
                    <div className="flex items-center gap-1.5">
                      <h3 className="font-display text-[1.15rem] font-semibold tracking-[-0.015em] text-ink">
                        {agent.name}
                      </h3>
                      {agent.verified && (
                        <BadgeCheck size={17} className="shrink-0 fill-olive text-paper" aria-label="Verificado" />
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full bg-honey-soft px-2.5 py-0.5 text-[0.75rem] font-medium text-honey-deep">
                        {CATEGORY_LABELS[agent.category]}
                      </span>
                      <span className="rounded-full bg-sand px-2.5 py-0.5 text-[0.75rem] font-medium text-ink-2">
                        {agent.type === 'ia' ? 'IA' : 'Humano'}
                      </span>
                    </div>
                  </div>
                </div>
                <RankBadge rank={rank} delay={0.4 + i * 0.1} />
              </div>

              <div className="flex items-center gap-2">
                <RatingStars rating={agent.rating} />
                <span className="text-[0.875rem] font-semibold text-ink">{formatRating(agent.rating)}</span>
                <span className="font-mono text-[12px] text-ink-3">({formatInt(agent.reviews)} reseñas)</span>
              </div>

              <p className="font-mono text-[12px] leading-relaxed text-ink-2">
                {formatMon(agent.pricePerTask)} MON/tarea · éxito {formatRating(agent.successRate)}% · resp. media{' '}
                {agent.avgResponse}
              </p>

              <div className="mt-auto flex flex-col gap-3 border-t border-line pt-4">
                <span className="flex items-center gap-2 text-[0.8125rem] text-ink-2">
                  <LiveDot variant={agent.status === 'desconectado' ? 'ink' : agent.status === 'ocupado' ? 'honey' : 'olive'} />
                  {STATUS_LABELS[agent.status]}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => onHire(agent)}
                    className="flex-1 rounded-full bg-honey px-4 py-2.5 text-[0.875rem] font-semibold text-ink transition-colors duration-200 hover:bg-honey-deep hover:text-paper"
                  >
                    Contratar
                  </button>
                  <Link
                    to={`/agente/${agent.id}`}
                    className="flex-1 rounded-full border border-line px-4 py-2.5 text-center text-[0.875rem] font-medium text-ink-2 transition-colors duration-200 hover:border-honey hover:text-honey-deep"
                  >
                    Ver perfil
                  </Link>
                </div>
              </div>
            </motion.article>
          </motion.div>
        </div>
      ))}
    </div>
  );
}
