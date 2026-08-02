import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Check, Download } from 'lucide-react';
import { toast } from 'sonner';
import { formatEther } from 'viem';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import TxHash from '@/components/TxHash';
import { cn } from '@/lib/utils';
import type { Agent } from '@/data/agents';
import { formatMon } from '@/data/agents';
import { timeAgo, truncateHash } from '@/data/events';
import { currencySymbol } from '@/contracts/config';
import { useIndexAgentEvents, type IndexedEvent } from '@/lib/indexer';

type ActivityStatus = 'completada' | 'en-curso' | 'disputa';

const STATUS_STYLES: Record<ActivityStatus, { label: string; className: string }> = {
  completada: { label: 'activity.status.completada', className: 'bg-olive/10 text-olive' },
  'en-curso': { label: 'activity.status.enCurso', className: 'bg-honey-soft text-honey-deep' },
  disputa: { label: 'activity.status.disputa', className: 'bg-terra/10 text-terra' },
};

/** Evento indexado → estado de la fila. */
function statusOf(ev: IndexedEvent): ActivityStatus {
  switch (ev.event) {
    case 'TaskCreated':
    case 'TaskClaimed':
    case 'TaskDelivered':
      return 'en-curso';
    case 'TaskDisputed':
    case 'DisputeResolved':
    case 'TaskCancelled':
      return 'disputa';
    default:
      return 'completada';
  }
}

/** Evento indexado → etiqueta i18n de la columna "servicio". */
function eventLabel(ev: IndexedEvent): string {
  switch (ev.event) {
    case 'TaskCreated':
    case 'TaskClaimed':
      return 'live.events.contratacion';
    case 'TaskDelivered':
      return 'live.events.entrega';
    case 'TaskCompleted':
    case 'Withdrawal':
      return 'live.events.pago';
    case 'TaskDisputed':
    case 'DisputeResolved':
      return 'live.events.disputa';
    case 'AgentRegistered':
      return 'live.events.registro';
    default:
      // PriceUpdated / MetadataUpdated / ActiveUpdated / TaskCancelled: nombre crudo (honesto)
      return ev.event;
  }
}

/** Monto del evento formateado ("0.15 MON"), o '—' si el evento no lleva monto. */
function amountOf(ev: IndexedEvent): string | null {
  const wei = ev.args['workerPaid'] ?? ev.args['amount'];
  if (wei === undefined) return null;
  const currency = String(ev.args['currency'] ?? ev.args['token'] ?? '');
  try {
    return `${formatMon(Number(formatEther(BigInt(String(wei)))), 5)} ${currencySymbol(currency || null)}`;
  } catch {
    return null;
  }
}

interface ActivityRow {
  id: string;
  tx: string;
  client: string;
  service: string;
  amount: string | null;
  status: ActivityStatus;
  ago: string;
}

/**
 * Tab Actividad on-chain (agente.md S3): eventos REALES del agente desde el
 * indexador (TaskCreated → Withdrawal), con TxHash, badges de estado y
 * exportación CSV de los mismos datos. Sin eventos → empty state.
 */
export default function ActivityTab({ agent }: { agent: Agent }) {
  const { t } = useTranslation();
  const { events, loading } = useIndexAgentEvents(agent.wallet);
  // Sello de carga del componente para el "hace X" (evita impurezas en render).
  const [now] = useState(() => Date.now());

  const rows = useMemo<ActivityRow[]>(
    () =>
      events.map((ev) => ({
        id: ev.id,
        tx: ev.txHash,
        client: truncateHash(String(ev.args['client'] ?? ev.args['agent'] ?? ev.args['to'] ?? '')),
        service: eventLabel(ev),
        amount: amountOf(ev),
        status: statusOf(ev),
        ago: timeAgo(Math.max(0, Math.floor(now / 1000) - ev.ts), t),
      })),
    [events, now, t],
  );

  const exportCsv = () => {
    const lines = [
      'tx;cliente;evento;monto;estado;cuando',
      ...rows.map((r) =>
        [r.tx, r.client, `"${r.service.includes('.') ? t(r.service) : r.service}"`, r.amount ?? '', t(STATUS_STYLES[r.status].label), `"${r.ago}"`].join(';'),
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

  if (!loading && rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-[0.875rem] text-ink-3">
        {t('detail.activity.empty')}
      </p>
    );
  }

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
              {[t('activity.colTx'), t('activity.colClient'), t('activity.colService'), t('activity.colAmount'), t('activity.colStatus'), ''].map((h, i) => (
                <TableHead
                  key={h || 'cuando'}
                  className={cn(
                    'text-[0.75rem] font-semibold uppercase tracking-[0.12em] text-ink-3',
                    i === 0 && 'pl-5',
                    i === 3 && 'text-right',
                    i === 5 && 'pr-5 text-right',
                  )}
                >
                  {i === 5 ? t('activity.colWhen') : h}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => {
              const st = STATUS_STYLES[r.status];
              return (
                <motion.tr
                  key={r.id}
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
                  <TableCell className="text-[0.8125rem] text-ink-2">{r.service.includes('.') ? t(r.service) : r.service}</TableCell>
                  <TableCell className="text-right font-mono text-[0.8125rem] text-ink">{r.amount ?? '—'}</TableCell>
                  <TableCell>
                    <span className={cn('rounded-full px-2.5 py-0.5 text-[0.75rem] font-medium', st.className)}>{t(st.label)}</span>
                  </TableCell>
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
