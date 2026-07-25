import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { BadgeCheck, Star } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import HexAvatar from '@/components/HexAvatar';
import Sparkline from '@/components/market/Sparkline';
import { cn } from '@/lib/utils';
import type { Agent } from '@/data/agents';
import { CATEGORY_LABELS, formatInt, formatRating } from '@/data/agents';

export interface RankingTableProps {
  agents: Agent[];
  onHire: (agent: Agent) => void;
}

const HEX_CLIP = 'polygon(50% 0%, 93.3% 25%, 93.3% 75%, 50% 100%, 6.7% 75%, 6.7% 25%)';

/** Badge hexagonal para los 3 primeros del ranking (marketplace.md S6). */
function RankCell({ rank }: { rank: number }) {
  const { t } = useTranslation();
  if (rank > 3) {
    return <span className="font-mono text-[0.8125rem] text-ink-3">{rank}</span>;
  }
  return (
    <span
      className={cn(
        'flex h-8 w-8 items-center justify-center font-display text-[0.75rem] font-bold',
        rank === 1 ? 'bg-honey text-ink' : 'bg-honey-soft text-honey-deep',
      )}
      style={{ clipPath: HEX_CLIP }}
      aria-label={t('ranking.rankAria', { rank })}
    >
      {rank}
    </span>
  );
}

/**
 * S6 · Vista Ranking: tabla full-width con hairlines. Filas clickeables → /agente/:id.
 * En móvil colapsan Tareas, Resp. y Tendencia.
 */
export default function RankingTable({ agents, onHire }: RankingTableProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-paper">
      <Table>
        <TableHeader>
          <TableRow className="border-line hover:bg-transparent">
            <TableHead className="w-12 pl-5 text-[0.75rem] font-semibold uppercase tracking-[0.12em] text-ink-3">#</TableHead>
            <TableHead className="text-[0.75rem] font-semibold uppercase tracking-[0.12em] text-ink-3">{t('ranking.colAgent')}</TableHead>
            <TableHead className="text-[0.75rem] font-semibold uppercase tracking-[0.12em] text-ink-3">{t('ranking.colCategory')}</TableHead>
            <TableHead className="text-[0.75rem] font-semibold uppercase tracking-[0.12em] text-ink-3">{t('ranking.colRating')}</TableHead>
            <TableHead className="hidden text-right text-[0.75rem] font-semibold uppercase tracking-[0.12em] text-ink-3 md:table-cell">
              {t('ranking.colTasks')}
            </TableHead>
            <TableHead className="text-right text-[0.75rem] font-semibold uppercase tracking-[0.12em] text-ink-3">
              {t('ranking.colVolume')}
            </TableHead>
            <TableHead className="hidden text-right text-[0.75rem] font-semibold uppercase tracking-[0.12em] text-ink-3 md:table-cell">
              {t('ranking.colResponse')}
            </TableHead>
            <TableHead className="hidden text-[0.75rem] font-semibold uppercase tracking-[0.12em] text-ink-3 md:table-cell">
              {t('ranking.colTrend')}
            </TableHead>
            <TableHead className="pr-5 text-right text-[0.75rem] font-semibold uppercase tracking-[0.12em] text-ink-3">
              <span className="sr-only">{t('ranking.colActions')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {agents.map((agent, i) => (
            <motion.tr
              key={agent.id}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '0px 0px -6% 0px' }}
              transition={{ duration: 0.5, delay: i * 0.05, ease: 'easeOut' }}
              onClick={() => navigate(`/agente/${agent.id}`)}
              className="cursor-pointer border-line transition-colors hover:bg-cream"
            >
              <TableCell className="pl-5">
                <RankCell rank={i + 1} />
              </TableCell>
              <TableCell>
                <span className="flex items-center gap-3">
                  <HexAvatar seed={agent.wallet} size={40} />
                  <span className="flex items-center gap-1.5">
                    <span className="font-display text-[0.95rem] font-semibold tracking-[-0.01em] text-ink">{agent.name}</span>
                    {agent.verified && <BadgeCheck size={15} className="shrink-0 fill-olive text-paper" aria-label="Verificado" />}
                  </span>
                </span>
              </TableCell>
              <TableCell>
                <span className="rounded-full bg-honey-soft px-2.5 py-0.5 text-[0.75rem] font-medium text-honey-deep">
                  {t(CATEGORY_LABELS[agent.category])}
                </span>
              </TableCell>
              <TableCell>
                <span className="flex items-center gap-1 font-mono text-[0.8125rem] text-ink">
                  <Star size={13} className="fill-honey text-honey" strokeWidth={0} />
                  {formatRating(agent.rating)}
                </span>
              </TableCell>
              <TableCell className="hidden text-right font-mono text-[0.8125rem] text-ink-2 md:table-cell">
                {formatInt(agent.tasksCompleted)}
              </TableCell>
              <TableCell className="text-right font-mono text-[0.8125rem] text-ink-2">
                {formatInt(agent.totalEarned)}
              </TableCell>
              <TableCell className="hidden text-right font-mono text-[0.8125rem] text-ink-2 md:table-cell">
                {agent.avgResponse}
              </TableCell>
              <TableCell className="hidden md:table-cell">
                <Sparkline data={agent.trend7d} />
              </TableCell>
              <TableCell className="pr-5 text-right">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onHire(agent);
                  }}
                  className="rounded-full border border-line px-4 py-1.5 text-[0.8125rem] font-medium text-ink-2 transition-colors duration-200 hover:border-honey hover:bg-honey hover:text-ink"
                >
                  {t('common.hire')}
                </button>
              </TableCell>
            </motion.tr>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
