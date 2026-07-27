/**
 * Panal — Reputación REAL on-chain (PanalReputation + PanalEscrow).
 * Rating medio gigante (ratingSum/ratingCount), nº de reseñas, tareas
 * completadas y total ganado. Las insignias se derivan de reglas reales
 * simples (documentadas en la lista de badges): pionero = agente
 * registrado, 10+ tareas, rating ≥4.5 con 5+ reseñas, cero disputas
 * abiertas; la de jurado queda bloqueada hasta que el sistema de
 * arbitraje sea legible on-chain.
 */

import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { BadgeCheck, Hexagon, Lock, Rocket, Scale, ShieldCheck, Trophy } from 'lucide-react';
import { formatEther } from 'viem';
import RatingStars from '@/components/RatingStars';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { TASK_STATUS, useMyTasks } from '@/hooks/useMyTasks';
import { avgRating, useMyAgentProfile } from '@/hooks/useMyAgentProfile';
import { formatMonEs, formatRatingEs } from './data';

type BadgeTone = 'honey' | 'olive' | 'ink' | 'terra';
type BadgeIcon = 'trophy' | 'hexagon' | 'rocket' | 'shield' | 'scale';

interface RealBadge {
  id: string;
  name: string;
  detail: string;
  tone: BadgeTone;
  icon: BadgeIcon;
  /** true = ganada; false = bloqueada */
  earned: boolean;
}

const TONE_STYLES: Record<BadgeTone, { text: string }> = {
  honey: { text: 'text-honey-deep' },
  olive: { text: 'text-olive' },
  ink: { text: 'text-ink' },
  terra: { text: 'text-terra' },
};

const BADGE_ICONS = {
  trophy: Trophy,
  hexagon: Hexagon,
  rocket: Rocket,
  shield: ShieldCheck,
  scale: Scale,
} as const;

function HexBadge({ badge, index }: { badge: RealBadge; index: number }) {
  const { t } = useTranslation();
  const tone = TONE_STYLES[badge.tone];
  const Icon = BADGE_ICONS[badge.icon];
  const locked = !badge.earned;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          whileInView={{ scale: 1, opacity: 1 }}
          viewport={{ once: true, margin: '-40px' }}
          transition={{ type: 'spring', stiffness: 320, damping: 17, delay: index * 0.08 }}
          className={cn('flex w-[104px] flex-col items-center gap-2 text-center', locked && 'opacity-40')}
        >
          <span className={cn('relative flex h-16 w-16 items-center justify-center', tone.text)}>
            <svg viewBox="0 0 64 64" className="absolute inset-0 h-full w-full" aria-hidden>
              <polygon
                points="32,3 58,17.5 58,46.5 32,61 6,46.5 6,17.5"
                className="fill-current"
                opacity={locked ? 0.08 : 0.14}
              />
              <polygon
                points="32,3 58,17.5 58,46.5 32,61 6,46.5 6,17.5"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                opacity={locked ? 0.35 : 0.8}
              />
            </svg>
            {locked ? <Lock size={20} className="relative" /> : <Icon size={22} className="relative" />}
          </span>
          <span className="text-[0.75rem] font-semibold leading-tight text-ink">{t(badge.name)}</span>
        </motion.div>
      </TooltipTrigger>
      <TooltipContent className="max-w-[220px] border-line bg-coal-2 text-coal-text">
        <p className="text-[0.8125rem]">{t(badge.detail)}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export default function ReputationSection() {
  const { t } = useTranslation();
  const profile = useMyAgentProfile();
  const { tasks } = useMyTasks();

  const rep = profile.reputation;
  const rating = avgRating(rep);
  const ratingCount = Number(rep.ratingCount);
  const tasksCompleted = Number(rep.tasksCompleted);
  const openDisputes = tasks.filter((tk) => tk.status === TASK_STATUS.Disputed).length;

  /* Reglas reales documentadas de insignias (umbral → ganada/bloqueada). */
  const badges: RealBadge[] = [
    {
      id: 'pionero',
      name: 'reputation.badgePioneer.name',
      detail: 'reputation.badgePioneer.detail',
      tone: 'ink',
      icon: 'rocket',
      earned: profile.isAgent,
    },
    {
      id: 'diez',
      name: 'reputation.badgeTasks10.name',
      detail: 'reputation.badgeTasks10.detail',
      tone: 'olive',
      icon: 'hexagon',
      earned: tasksCompleted >= 10,
    },
    {
      id: 'elite',
      name: 'reputation.badgeElite.name',
      detail: 'reputation.badgeElite.detail',
      tone: 'honey',
      icon: 'trophy',
      earned: rating !== null && rating >= 4.5 && ratingCount >= 5,
    },
    {
      id: 'cero',
      name: 'reputation.badgeNoDisputes.name',
      detail: 'reputation.badgeNoDisputes.detail',
      tone: 'olive',
      icon: 'shield',
      earned: tasksCompleted > 0 && openDisputes === 0,
    },
    {
      id: 'jurado',
      name: 'reputation.badgeJuror.name',
      detail: 'reputation.badgeJuror.detail',
      tone: 'terra',
      icon: 'scale',
      earned: false,
    },
  ];

  const bullets = [
    t('reputation.bulletTasks', { count: tasksCompleted }),
    t('reputation.bulletEarned', { amount: formatMonEs(Number(formatEther(rep.totalEarned))) }),
    openDisputes === 0
      ? t('reputation.bulletNoDisputes')
      : t('reputation.bulletDisputes', { count: openDisputes }),
  ];

  return (
    <TooltipProvider delayDuration={150}>
      <div className="grid grid-cols-1 gap-10 md:grid-cols-12">
        {/* Desglose real (col 5) */}
        <div className="md:col-span-5">
          <div className="flex items-end gap-4">
            <span className="font-display text-[4.5rem] font-bold leading-none tracking-[-0.03em] text-ink">
              {rating !== null ? formatRatingEs(rating) : '—'}
            </span>
            <div className="pb-2">
              <RatingStars rating={rating ?? 0} size={18} />
              <p className="mt-1 font-mono text-[0.8125rem] text-ink-3">
                {t('reputation.reviews', { count: ratingCount })}
              </p>
            </div>
          </div>
          {rating === null && (
            <p className="mt-3 text-[0.8125rem] text-ink-3">{t('reputation.noRatings')}</p>
          )}

          {/* Bullets reales */}
          <ul className="mt-6 flex flex-col gap-2">
            {bullets.map((b) => (
              <li key={b} className="flex items-center gap-2 text-[0.875rem] text-ink-2">
                <BadgeCheck size={15} className="shrink-0 fill-olive text-paper" />
                {b}
              </li>
            ))}
          </ul>
        </div>

        {/* Insignias derivadas de reglas reales (col 7) */}
        <div className="md:col-span-7">
          <p className="eyebrow text-ink-3">{t('reputation.badgesEyebrow')}</p>
          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-6">
            {badges.map((b, i) => (
              <HexBadge key={b.id} badge={b} index={i} />
            ))}
          </div>
          <p className="mt-6 max-w-md text-[0.8125rem] leading-relaxed text-ink-3">
            {t('reputation.badgesNoteReal')}
          </p>
        </div>
      </div>
    </TooltipProvider>
  );
}
