/**
 * Panal — Reputación e insignias (dashboard.md S8, banda cream de cierre).
 * Desglose (rating gigante + histograma + bullets) y fila de insignias
 * hexagonales con tooltip; las bloqueadas entran atenuadas con candado.
 */

import { motion } from 'framer-motion';
import { BadgeCheck, Hexagon, Lock, Rocket, Scale, ShieldCheck, Trophy } from 'lucide-react';
import RatingStars from '@/components/RatingStars';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { HiveBadge } from './data';
import { BADGES, REPUTATION, formatRatingEs } from './data';

const TONE_STYLES: Record<HiveBadge['tone'], { bg: string; text: string; ring: string }> = {
  honey: { bg: 'bg-honey-soft', text: 'text-honey-deep', ring: 'border-honey' },
  olive: { bg: 'bg-olive/10', text: 'text-olive', ring: 'border-olive' },
  ink: { bg: 'bg-ink/5', text: 'text-ink', ring: 'border-ink' },
  terra: { bg: 'bg-terra/10', text: 'text-terra', ring: 'border-terra' },
};

const BADGE_ICONS = {
  trophy: Trophy,
  hexagon: Hexagon,
  rocket: Rocket,
  shield: ShieldCheck,
  scale: Scale,
} as const;

function HexBadge({ badge, index }: { badge: HiveBadge; index: number }) {
  const tone = TONE_STYLES[badge.tone];
  const Icon = BADGE_ICONS[badge.icon];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          whileInView={{ scale: 1, opacity: 1 }}
          viewport={{ once: true, margin: '-40px' }}
          transition={{ type: 'spring', stiffness: 320, damping: 17, delay: index * 0.08 }}
          className={cn('flex w-[104px] flex-col items-center gap-2 text-center', badge.locked && 'opacity-40')}
        >
          {/* Insignia hexagonal */}
          <span
            className={cn(
              'relative flex h-16 w-16 items-center justify-center',
              tone.text,
            )}
          >
            <svg viewBox="0 0 64 64" className="absolute inset-0 h-full w-full" aria-hidden>
              <polygon
                points="32,3 58,17.5 58,46.5 32,61 6,46.5 6,17.5"
                className={cn('fill-current')}
                opacity={badge.locked ? 0.08 : 0.14}
              />
              <polygon
                points="32,3 58,17.5 58,46.5 32,61 6,46.5 6,17.5"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                opacity={badge.locked ? 0.35 : 0.8}
              />
            </svg>
            {badge.locked ? <Lock size={20} className="relative" /> : <Icon size={22} className="relative" />}
          </span>
          <span className="text-[0.75rem] font-semibold leading-tight text-ink">{badge.name}</span>
        </motion.div>
      </TooltipTrigger>
      <TooltipContent className="max-w-[220px] border-line bg-ink text-paper">
        <p className="text-[0.8125rem]">{badge.locked ? badge.lockedHint : badge.detail}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export default function ReputationSection() {
  return (
    <TooltipProvider delayDuration={150}>
      <div className="grid grid-cols-1 gap-10 md:grid-cols-12">
        {/* Desglose (col 5) */}
        <div className="md:col-span-5">
          <div className="flex items-end gap-4">
            <span className="font-display text-[4.5rem] font-bold leading-none tracking-[-0.03em] text-ink">
              {formatRatingEs(REPUTATION.rating)}
            </span>
            <div className="pb-2">
              <RatingStars rating={REPUTATION.rating} size={18} />
              <p className="mt-1 font-mono text-[0.8125rem] text-ink-3">{REPUTATION.total} reseñas</p>
            </div>
          </div>

          {/* Histograma */}
          <div className="mt-6 flex flex-col gap-2">
            {REPUTATION.histogram.map((row, i) => (
              <div key={row.stars} className="flex items-center gap-3">
                <span className="w-7 font-mono text-[0.75rem] text-ink-3">{row.stars}★</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-sand">
                  <motion.div
                    className="h-full rounded-full bg-honey"
                    initial={{ scaleX: 0 }}
                    whileInView={{ scaleX: 1 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.8, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }}
                    style={{ transformOrigin: 'left center', width: `${row.pct}%` }}
                  />
                </div>
                <span className="w-10 text-right font-mono text-[0.75rem] text-ink-2">{row.pct}%</span>
              </div>
            ))}
          </div>

          {/* Bullets */}
          <ul className="mt-6 flex flex-col gap-2">
            {REPUTATION.bullets.map((b) => (
              <li key={b} className="flex items-center gap-2 text-[0.875rem] text-ink-2">
                <BadgeCheck size={15} className="shrink-0 fill-olive text-paper" />
                {b}
              </li>
            ))}
          </ul>
        </div>

        {/* Insignias (col 7) */}
        <div className="md:col-span-7">
          <p className="eyebrow text-ink-3">Insignias del panal</p>
          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-6">
            {BADGES.map((b, i) => (
              <HexBadge key={b.id} badge={b} index={i} />
            ))}
          </div>
          <p className="mt-6 max-w-md text-[0.8125rem] leading-relaxed text-ink-3">
            Las insignias son credenciales on-chain emitidas por PanalReputation: se ganan con
            resultados verificables y no se pueden comprar ni transferir.
          </p>
        </div>
      </div>
    </TooltipProvider>
  );
}
