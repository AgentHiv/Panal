import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Check, Download } from 'lucide-react';
import { toast } from 'sonner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import TxHash from '@/components/TxHash';
import { activityFor } from '@/components/market/detail-data';
import type { ActivityStatus } from '@/components/market/detail-data';
import { cn } from '@/lib/utils';
import type { Agent } from '@/data/agents';
import { formatMon } from '@/data/agents';

const STATUS_STYLES: Record<ActivityStatus, { label: string; className: string }> = {
  completada: { label: 'activity.status.completada', className: 'bg-olive/10 text-olive' },
  'en-curso': { label: 'activity.status.enCurso', className: 'bg-honey-soft text-honey-deep' },
  disputa: { label: 'activity.status.disputa', className: 'bg-terra/10 text-terra' },
};

/**
 * Tab Actividad on-chain (agente.md S3): últimas 8 tareas con TxHash, badges
 * de estado, exportación CSV y click en fila que copia el hash.
 */
export default function ActivityTab({ agent }: { agent: Agent }) {
  const { t } = useTranslation();
  const rows = useMemo(() => activityFor(agent, t), [agent, t]);

  const exportCsv = () => {
    const lines = [
      'tx;cliente;servicio;monto_mon;estado;duracion;cuando',
      ...rows.map((r) =>
        [r.tx, r.client, `"${r.service}"`, String(r.amount), t(STATUS_STYLES[r.status].label), `"${r.duration}"`, `"${r.ago}"`].join(';'),
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `actividad-${agent.id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast(t('activity.csvToast'), { icon: <Download size={14} className="text-olive" /> });
  };

  const copyRowHash = async (hash: string) => {
    try {
      await navigator.clipboard.writeText(hash);
    } catch {
      /* portapapeles no disponible */
    }
    toast(t('activity.hashToast'), { icon: <Check size={14} className="text-olive" /> });
  };

  return (
    <div>
      {/* header con export */}
      <div className="mb-5 flex items-center justify-between gap-4">
        <p className="text-[0.875rem] text-ink-3">
          {t('activity.lastTasks', { count: rows.length })}
        </p>
        <button
          type="button"
          onClick={exportCsv}
          className="flex items-center gap-2 rounded-full border border-line bg-paper px-4 py-2 text-[0.8125rem] font-medium text-ink-2 transition-colors duration-200 hover:border-honey hover:text-honey-deep"
        >
          <Download size={14} aria-hidden />
          {t('activity.exportCsv')}
        </button>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-line bg-paper">
        <Table>
          <TableHeader>
            <TableRow className="border-line hover:bg-transparent">
              {[t('activity.colTx'), t('activity.colClient'), t('activity.colService'), t('activity.colAmount'), t('activity.colStatus'), t('activity.colDuration'), ''].map((h, i) => (
                <TableHead
                  key={h || 'cuando'}
                  className={cn(
                    'text-[0.75rem] font-semibold uppercase tracking-[0.12em] text-ink-3',
                    i === 0 && 'pl-5',
                    (i === 3 || i === 5) && 'text-right',
                    i === 6 && 'pr-5 text-right',
                    i === 5 && 'hidden md:table-cell',
                  )}
                >
                  {i === 6 ? t('activity.colWhen') : h}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => {
              const st = STATUS_STYLES[r.status];
              return (
                <motion.tr
                  key={r.tx}
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '0px 0px -4% 0px' }}
                  transition={{ duration: 0.4, delay: i * 0.04, ease: 'easeOut' }}
                  onClick={() => copyRowHash(r.tx)}
                  className="cursor-pointer border-line transition-colors hover:bg-cream"
                  title={t('activity.copyHashTitle')}
                >
                  <TableCell className="pl-5" onClick={(e) => e.stopPropagation()}>
                    <TxHash hash={r.tx} />
                  </TableCell>
                  <TableCell className="font-mono text-[0.8125rem] text-ink-2">{r.client}</TableCell>
                  <TableCell className="text-[0.8125rem] text-ink-2">{r.service}</TableCell>
                  <TableCell className="text-right font-mono text-[0.8125rem] text-ink">{formatMon(r.amount)} MON</TableCell>
                  <TableCell>
                    <span className={cn('rounded-full px-2.5 py-0.5 text-[0.75rem] font-medium', st.className)}>{t(st.label)}</span>
                  </TableCell>
                  <TableCell className="hidden text-right font-mono text-[0.8125rem] text-ink-2 md:table-cell">{r.duration}</TableCell>
                  <TableCell className="pr-5 text-right text-[0.8125rem] text-ink-3">{r.ago}</TableCell>
                </motion.tr>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <p className="mt-4 text-[0.8125rem] text-ink-3">
        {t('activity.offchainNote')}
      </p>
    </div>
  );
}
