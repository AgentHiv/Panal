import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeftRight, BadgeCheck, Bookmark } from 'lucide-react';
import HexAvatar from '@/components/HexAvatar';
import LiveDot from '@/components/LiveDot';
import RatingStars from '@/components/RatingStars';
import HireDialog from '@/components/HireDialog';
import { cn } from '@/lib/utils';
import { currencySymbol } from '@/contracts/config';
import { cambioReciente, isOnchainAgent } from '@/hooks/usePanalAgents';
import { useAhora } from '@/hooks/useAhora';
import type { Agent } from '@/data/agents';
import { CATEGORY_LABELS, STATUS_LABELS, formatInt, formatMon, formatRating } from '@/data/agents';

export interface AgentCardProps {
  agent: Agent;
  className?: string;
}

const STATUS_DOT: Record<Agent['status'], 'olive' | 'honey' | 'ink'> = {
  'en-linea': 'olive',
  ocupado: 'honey',
  desconectado: 'ink',
};

/**
 * Card de agente (design.md §5): HexAvatar + nombre + verificado, chip de categoría,
 * estrellas, fila mono de métricas y footer con estado + CTA "Contratar".
 * Hover: y -4, borde honey, CTA ghost → honey.
 */
export default function AgentCard({ agent, className }: AgentCardProps) {
  const { t } = useTranslation();
  const [hireOpen, setHireOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const offline = agent.status === 'desconectado';
  /** Símbolo del precio: MON por defecto, $PANAL si el agente v2 lo fijó en token. */
  const priceSymbol = isOnchainAgent(agent) ? currencySymbol(agent.currency) : 'MON';

  // El aviso caduca solo, asi que necesita saber que hora es. useAhora lo
  // refresca cada 30 s; sin el, una pestaña abierta toda la tarde seguiria
  // diciendo "hace 29 dias" para siempre.
  const ahora = useAhora();
  const nombre = isOnchainAgent(agent) ? agent.nombreOnchain : null;
  const reciente = cambioReciente(nombre, ahora);
  const diasDesde = nombre ? Math.max(0, Math.floor((ahora - nombre.desdeTs) / 86_400)) : 0;

  return (
    <>
      <motion.div
        whileHover={{ y: -4, scale: 1.01 }}
        transition={{ type: 'spring', stiffness: 260, damping: 24 }}
        className={cn('group relative h-full', className)}
      >
        <Link
          to={`/agente/${agent.id}`}
          className="flex h-full flex-col gap-4 rounded-2xl border border-line bg-paper p-5 shadow-card transition-[border-color,box-shadow] duration-200 hover:border-honey hover:shadow-card-hover"
        >
          {/* Cabecera */}
          <div className="flex items-start gap-3">
            <HexAvatar seed={agent.wallet} size={56} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <h3 className="truncate font-display text-[1.05rem] font-semibold tracking-[-0.015em] text-ink">
                  {agent.name}
                </h3>
                {agent.verified && <BadgeCheck size={16} className="shrink-0 fill-olive text-paper" aria-label={t('common.verified')} />}
              </div>
              {/*
                El nombre único de PanalNames. Se enseña porque es lo único que
                identifica a un agente sin ambigüedad y es corto: el `name` del
                perfil lo escribe él y puede repetirse, y la dirección no la
                recuerda nadie. Sin pintarlo, la mitad de para qué sirve tener
                un nombre único se pierde.
              */}
              {nombre && (
                <p className="truncate font-mono text-[0.75rem] text-ink-3" title={t('agentCard.uniqueName')}>
                  @{nombre.nombre}
                </p>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <span className="rounded-full bg-honey-soft px-2.5 py-0.5 text-[0.75rem] font-medium text-honey-deep">
                  {t(CATEGORY_LABELS[agent.category])}
                </span>
                <span className="rounded-full bg-sand px-2.5 py-0.5 text-[0.75rem] font-medium text-ink-2">
                  {agent.type === 'ia' ? t('common.typeIa') : t('common.typeHuman')}
                </span>
                {/*
                  Un nombre que acaba de cambiar de manos. En una venta lo unico
                  que viaja es el nombre: la reputacion y el historial se quedan
                  en la direccion del vendedor. Quien busca a `lint` por su
                  nombre merece saber que el `lint` de hoy no hizo esas tareas.
                */}
                {reciente && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full bg-terra/15 px-2.5 py-0.5 text-[0.75rem] font-medium text-terra"
                    title={t('agentCard.nameChangedHint')}
                  >
                    <ArrowLeftRight size={12} className="shrink-0" />
                    {t('agentCard.nameChanged', { days: diasDesde })}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Descripción */}
          <p className="line-clamp-2 text-[0.875rem] leading-[1.45] text-ink-2">{agent.tagline}</p>

          {/* Rating */}
          <div className="flex items-center gap-2">
            <RatingStars rating={agent.rating} />
            <span className="text-[0.875rem] font-semibold text-ink">{formatRating(agent.rating)}</span>
            <span className="font-mono text-[12px] text-ink-3">({formatInt(agent.reviews)})</span>
          </div>

          {/* Métricas mono */}
          <p className="font-mono text-[12px] text-ink-2">
            {t(priceSymbol === '$PANAL' ? 'agentCard.metricsToken' : 'agentCard.metrics', { price: formatMon(agent.pricePerTask), tasks: formatInt(agent.tasksCompleted), response: agent.avgResponse })}
          </p>

          {/* Footer */}
          <div className="mt-auto flex items-center justify-between border-t border-line pt-3">
            <span className="flex items-center gap-2 text-[0.8125rem] text-ink-2">
              <LiveDot variant={STATUS_DOT[agent.status]} ping={!offline} />
              {t(STATUS_LABELS[agent.status])}
            </span>
            <span className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label={saved ? t('agentCard.unsave') : t('agentCard.save')}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setSaved((s) => !s);
                }}
                className="flex h-8 w-8 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-cream hover:text-honey-deep"
              >
                <Bookmark size={15} className={cn(saved && 'fill-honey text-honey')} />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setHireOpen(true);
                }}
                className="rounded-full border border-line px-4 py-1.5 text-[0.8125rem] font-medium text-ink-2 transition-all duration-200 group-hover:border-honey group-hover:bg-honey group-hover:text-ink"
              >
                {t('common.hire')}
              </button>
            </span>
          </div>
        </Link>
      </motion.div>

      <HireDialog agent={agent} open={hireOpen} onOpenChange={setHireOpen} />
    </>
  );
}
