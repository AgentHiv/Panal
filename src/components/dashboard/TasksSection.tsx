/**
 * Panal — Tareas REALES del dashboard (PanalEscrow).
 * Tabs Activas (Open/Delivered) / Completadas (Completed/Cancelled) /
 * En disputa (Disputed) con counts reales y acciones on-chain por rol:
 * - Worker: claimTask (Open sin worker) y deliverResult (Open asignada,
 *   resultado → keccak256(toBytes(texto))).
 * - Cliente: approveAndRelease (Delivered, rating 1–5), openDispute,
 *   cancelTask (Open) y autoRelease (Delivered y plazo AUTO_RELEASE pasado).
 * Todas pasan por el patrón de escritura obligatorio (useContractAction) y
 * tras minarse la tx se hace refetch de las tareas.
 */

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, ExternalLink, Hexagon, Loader2, RefreshCw, Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatEther, keccak256, toBytes } from 'viem';
import type { Address } from 'viem';
import { useReadContract } from 'wagmi';
import HexAvatar from '@/components/HexAvatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useWallet } from '@/hooks/useWallet';
import { getTaskBrief } from '@/lib/taskBriefs';
import { ACTIVE_ESCROW_ABI, ACTIVE_ESCROW_ADDRESS, TASK_STATUS, useMyTasks } from '@/hooks/useMyTasks';
import type { RealTask } from '@/hooks/useMyTasks';
import { usePanalAgents } from '@/hooks/usePanalAgents';
import { useContractAction } from '@/hooks/useContractAction';
import type { ContractActionRequest } from '@/hooks/useContractAction';
import { shortAddress } from '@/hooks/useWallet';
import { EXPLORER_TX, activeChain, currencySymbol } from '@/contracts/config';
import type { Perspective } from './data';
import { formatMonEs } from './data';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const STATUS_META: Record<number, { label: string; className: string; pulse?: boolean }> = {
  [TASK_STATUS.Open]: { label: 'tasks.status.open', className: 'bg-honey-soft text-honey-deep' },
  [TASK_STATUS.Delivered]: { label: 'tasks.status.entregada', className: 'bg-olive/10 text-olive', pulse: true },
  [TASK_STATUS.Completed]: { label: 'tasks.status.completed', className: 'bg-olive/10 text-olive' },
  [TASK_STATUS.Disputed]: { label: 'tasks.status.disputa', className: 'bg-terra/10 text-terra' },
  [TASK_STATUS.Cancelled]: { label: 'tasks.status.cancelled', className: 'bg-sand text-ink-3' },
};

function StatusBadge({ status }: { status: number }) {
  const { t } = useTranslation();
  const meta = STATUS_META[status] ?? STATUS_META[TASK_STATUS.Open];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[0.75rem] font-medium',
        meta.className,
        meta.pulse && 'animate-pulse',
      )}
    >
      {status === TASK_STATUS.Disputed && <AlertTriangle size={12} />}
      {t(meta.label)}
    </span>
  );
}

/* ---------- Diálogos de acción ---------- */

type DialogKind = 'deliver' | 'approve' | 'dispute' | 'cancel' | 'autoRelease' | 'claim';

interface ActionDialogState {
  kind: DialogKind;
  task: RealTask;
}

/** Vista de progreso/éxito de tx dentro de los diálogos. */
function TxProgress({
  action,
  onClose,
}: {
  action: ReturnType<typeof useContractAction>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  if (action.mined && action.txHash) {
    return (
      <div className="flex flex-col items-center gap-4 py-4 text-center">
        <p className="font-display text-ink">{t('dashReal.txConfirmed')}</p>
        <a
          href={EXPLORER_TX(action.txHash)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 font-mono text-[12px] text-ink-2 transition-colors hover:border-honey hover:text-honey-deep"
        >
          {t('hire.step3.viewTx')}
          <ExternalLink size={13} />
        </a>
        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-full border border-line px-5 py-3 text-[0.875rem] font-medium text-ink-2 transition-colors hover:border-honey"
        >
          {t('common.close')}
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center">
      <Loader2 size={28} className="animate-spin text-honey-deep" aria-hidden />
      <p className="text-[0.875rem] font-medium text-ink">
        {action.signing ? t('hire.step3.signing') : t('hire.step3.confirming')}
      </p>
      {action.txHash && (
        <a
          href={EXPLORER_TX(action.txHash)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 font-mono text-[12px] text-ink-2 transition-colors hover:border-honey hover:text-honey-deep"
        >
          {t('hire.step3.viewTx')}
          <ExternalLink size={13} />
        </a>
      )}
    </div>
  );
}

function EmptyTab({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line bg-paper px-6 py-16 text-center">
      <Hexagon size={40} className="text-line" strokeWidth={1.25} />
      <p className="font-display text-[1.05rem] font-semibold text-ink">{title}</p>
      <p className="max-w-sm text-[0.875rem] text-ink-2">{desc}</p>
    </div>
  );
}

export default function TasksSection({ perspective }: { perspective: Perspective }) {
  const { t, i18n } = useTranslation();
  const { address } = useWallet();
  const { tasks, loading, error, refetch } = useMyTasks();
  const { agents } = usePanalAgents();
  const action = useContractAction({ onMined: refetch });

  const { data: autoReleaseSec } = useReadContract({
    address: ACTIVE_ESCROW_ADDRESS,
    abi: ACTIVE_ESCROW_ABI,
    functionName: 'AUTO_RELEASE',
    chainId: activeChain.id,
    query: { staleTime: 300_000, retry: 1 },
  });

  const [dialog, setDialog] = useState<ActionDialogState | null>(null);
  const [deliverText, setDeliverText] = useState('');
  const [rating, setRating] = useState(5);

  const nameOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of agents) map.set(a.workerAddress.toLowerCase(), a.name);
    return (addr: string) => map.get(addr.toLowerCase()) ?? shortAddress(addr);
  }, [agents]);

  const meLc = address?.toLowerCase();
  const mine = useMemo(
    () => tasks.filter((tk) => (perspective === 'proveedor' ? tk.role === 'worker' : tk.role === 'client')),
    [tasks, perspective],
  );
  const active = mine.filter((tk) => tk.status === TASK_STATUS.Open || tk.status === TASK_STATUS.Delivered);
  const completed = mine.filter((tk) => tk.status === TASK_STATUS.Completed || tk.status === TASK_STATUS.Cancelled);
  const disputed = mine.filter((tk) => tk.status === TASK_STATUS.Disputed);

  const nowSec = Math.floor(Date.now() / 1000);

  /* ---------- Acciones por rol ---------- */

  const requestFor = (kind: DialogKind, task: RealTask, extra?: { text?: string; rating?: number }): ContractActionRequest => {
    const base = { address: ACTIVE_ESCROW_ADDRESS as Address, abi: ACTIVE_ESCROW_ABI };
    switch (kind) {
      case 'claim':
        return { ...base, functionName: 'claimTask', args: [task.id] };
      case 'deliver':
        return { ...base, functionName: 'deliverResult', args: [task.id, keccak256(toBytes(extra?.text ?? ''))] };
      case 'approve':
        return { ...base, functionName: 'approveAndRelease', args: [task.id, extra?.rating ?? 5] };
      case 'dispute':
        return { ...base, functionName: 'openDispute', args: [task.id] };
      case 'cancel':
        return { ...base, functionName: 'cancelTask', args: [task.id] };
      case 'autoRelease':
        return { ...base, functionName: 'autoRelease', args: [task.id] };
    }
  };

  const openDialog = (kind: DialogKind, task: RealTask) => {
    action.reset();
    setDeliverText('');
    setRating(5);
    setDialog({ kind, task });
  };

  const closeDialog = () => {
    setDialog(null);
    action.reset();
  };

  const submitDialog = () => {
    if (!dialog) return;
    void action.run(requestFor(dialog.kind, dialog.task, { text: deliverText, rating }));
  };

  /** Botones de acción disponibles para una tarea (según rol y estado real). */
  const actionsFor = (task: RealTask) => {
    const out: { kind: DialogKind; label: string; className: string }[] = [];
    const workerZero = task.worker.toLowerCase() === ZERO_ADDRESS;
    if (task.role === 'worker') {
      if (task.status === TASK_STATUS.Open && workerZero) {
        out.push({ kind: 'claim', label: t('tasks.claim'), className: 'bg-honey text-[#1B1814] hover:bg-honey-deep' });
      }
      if (task.status === TASK_STATUS.Open && meLc && task.worker.toLowerCase() === meLc) {
        out.push({ kind: 'deliver', label: t('tasks.deliver'), className: 'bg-honey text-[#1B1814] hover:bg-honey-deep' });
      }
    } else {
      if (task.status === TASK_STATUS.Delivered) {
        out.push({ kind: 'approve', label: t('tasks.approve'), className: 'bg-olive text-paper hover:opacity-85' });
        out.push({ kind: 'dispute', label: t('tasks.openDispute'), className: 'border border-terra/30 text-terra hover:bg-terra/10' });
        const canAuto =
          task.deliveredAt !== undefined &&
          autoReleaseSec !== undefined &&
          Number(task.deliveredAt) + Number(autoReleaseSec) <= nowSec;
        if (canAuto) {
          out.push({ kind: 'autoRelease', label: t('tasks.autoReleaseBtn'), className: 'border border-honey text-honey-deep hover:bg-honey-soft' });
        }
      }
      if (task.status === TASK_STATUS.Open) {
        out.push({ kind: 'cancel', label: t('tasks.cancelTask'), className: 'border border-line text-ink-2 hover:border-terra hover:text-terra' });
      }
    }
    return out;
  };

  const fmtDate = (ts: bigint) =>
    ts === 0n
      ? '—'
      : new Date(Number(ts) * 1000).toLocaleString(i18n.language, {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        });

  const renderRows = (rows: RealTask[], withActions: boolean) =>
    rows.map((task, i) => {
      const counterparty = task.role === 'worker' ? task.client : task.worker;
      const counterpartyZero = counterparty.toLowerCase() === ZERO_ADDRESS;
      const acts = withActions ? actionsFor(task) : [];
      return (
        <motion.tr
          key={task.id.toString()}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: Math.min(i * 0.04, 0.4) }}
          className="border-b border-line last:border-0 hover:bg-cream/70"
        >
          <td className="whitespace-nowrap py-3.5 pl-5 pr-3 font-mono text-[0.8125rem] text-ink-2">
            #{task.id.toString()}
          </td>
          <td className="px-3 py-3.5">
            <span className="flex items-center gap-2">
              <HexAvatar seed={counterparty} size={32} />
              <span className="flex min-w-0 flex-col">
                <span className="max-w-[150px] truncate text-[0.875rem] font-medium text-ink">
                  {counterpartyZero ? t('tasks.unassigned') : nameOf(counterparty)}
                </span>
                {(() => {
                  const brief = getTaskBrief(task.taskHash);
                  return brief ? (
                    <span className="max-w-[190px] truncate text-[0.75rem] text-ink-3" title={brief}>
                      {brief}
                    </span>
                  ) : (
                    <span className="text-[0.75rem] italic text-ink-3/70">{t('tasks.briefMissing')}</span>
                  );
                })()}
              </span>
            </span>
          </td>
          <td className="whitespace-nowrap px-3 py-3.5 font-mono text-[0.8125rem] text-ink">
            {formatMonEs(Number(formatEther(task.amountWei)))} {currencySymbol(task.currency)}
          </td>
          <td className="px-3 py-3.5"><StatusBadge status={task.status} /></td>
          <td className="hidden whitespace-nowrap px-3 py-3.5 font-mono text-[0.75rem] text-ink-3 sm:table-cell">
            {fmtDate(task.deadline)}
          </td>
          {withActions && (
            <td className="whitespace-nowrap py-3.5 pl-3 pr-5">
              <div className="flex items-center justify-end gap-1.5">
                {acts.length === 0 && <span className="font-mono text-[0.75rem] text-ink-3">—</span>}
                {acts.map((a) => (
                  <button
                    key={a.kind}
                    type="button"
                    onClick={() => openDialog(a.kind, task)}
                    className={cn('rounded-full px-3 py-1.5 text-[0.75rem] font-semibold transition-colors', a.className)}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </td>
          )}
        </motion.tr>
      );
    });

  const tableHead = (withActions: boolean) => (
    <thead>
      <tr className="border-b border-line text-left">
        <th className="py-3 pl-5 pr-3 text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-ink-3">ID</th>
        <th className="px-3 py-3 text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-ink-3">{t('tasks.colCounterparty')}</th>
        <th className="px-3 py-3 text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-ink-3">{t('tasks.colAmount')}</th>
        <th className="px-3 py-3 text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-ink-3">{t('tasks.colStatus')}</th>
        <th className="hidden px-3 py-3 text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-ink-3 sm:table-cell">{t('tasks.colDeadline')}</th>
        {withActions && (
          <th className="py-3 pl-3 pr-5 text-right text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-ink-3">{t('ranking.colActions')}</th>
        )}
      </tr>
    </thead>
  );

  const renderTable = (rows: RealTask[], withActions: boolean) => (
    <div className="overflow-x-auto rounded-2xl border border-line bg-paper shadow-card">
      <table className="w-full min-w-[640px] border-collapse">
        {tableHead(withActions)}
        <tbody>{renderRows(rows, withActions)}</tbody>
      </table>
    </div>
  );

  /* ---------- Estados de carga / error ---------- */
  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-terra/40 bg-terra/5 px-6 py-14 text-center">
        <AlertTriangle size={28} className="text-terra" />
        <p className="text-[0.875rem] text-ink-2">{t('tasks.loadError')}</p>
        <button
          type="button"
          onClick={refetch}
          className="inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-[0.8125rem] font-medium text-ink-2 transition-colors hover:border-honey hover:text-honey-deep"
        >
          <RefreshCw size={13} /> {t('tasks.retry')}
        </button>
      </div>
    );
  }

  const dialogTitle = dialog
    ? t(`tasks.dialog.${dialog.kind}.title`, { id: `#${dialog.task.id.toString()}` })
    : '';
  const dialogDesc = dialog ? t(`tasks.dialog.${dialog.kind}.desc`) : '';
  const dialogConfirm = dialog ? t(`tasks.dialog.${dialog.kind}.confirm`) : '';

  return (
    <div>
      <Tabs defaultValue="activas">
        <TabsList className="h-auto gap-1 rounded-full border border-line bg-cream p-1">
          <TabsTrigger
            value="activas"
            className="rounded-full px-4 py-2 text-[0.8125rem] data-[state=active]:bg-paper data-[state=active]:text-ink data-[state=active]:shadow-sm"
          >
            {t('tasks.tabActive')}
            <span className="ml-1.5 rounded-full bg-honey-soft px-1.5 py-0.5 font-mono text-[0.6875rem] text-honey-deep">{active.length}</span>
          </TabsTrigger>
          <TabsTrigger
            value="completadas"
            className="rounded-full px-4 py-2 text-[0.8125rem] data-[state=active]:bg-paper data-[state=active]:text-ink data-[state=active]:shadow-sm"
          >
            {t('tasks.tabCompleted')}
            <span className="ml-1.5 rounded-full bg-sand px-1.5 py-0.5 font-mono text-[0.6875rem] text-ink-2">{completed.length}</span>
          </TabsTrigger>
          <TabsTrigger
            value="disputa"
            className="rounded-full px-4 py-2 text-[0.8125rem] data-[state=active]:bg-paper data-[state=active]:text-ink data-[state=active]:shadow-sm"
          >
            {t('tasks.tabDisputed')}
            {disputed.length > 0 && (
              <span className="ml-1.5 rounded-full bg-terra/15 px-1.5 py-0.5 font-mono text-[0.6875rem] text-terra">{disputed.length}</span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="activas" className="mt-6">
          {loading ? (
            <div className="flex items-center justify-center gap-2 rounded-2xl border border-line bg-paper py-14 text-ink-3">
              <Loader2 size={18} className="animate-spin" /> {t('tasks.loading')}
            </div>
          ) : active.length > 0 ? (
            renderTable(active, true)
          ) : (
            <EmptyTab title={t('tasks.noActive')} desc={t('tasks.noActiveDesc')} />
          )}
        </TabsContent>

        <TabsContent value="completadas" className="mt-6">
          {loading ? (
            <div className="flex items-center justify-center gap-2 rounded-2xl border border-line bg-paper py-14 text-ink-3">
              <Loader2 size={18} className="animate-spin" /> {t('tasks.loading')}
            </div>
          ) : completed.length > 0 ? (
            renderTable(completed, false)
          ) : (
            <EmptyTab title={t('tasks.noCompleted')} desc={t('tasks.noCompletedDesc')} />
          )}
        </TabsContent>

        <TabsContent value="disputa" className="mt-6">
          {loading ? (
            <div className="flex items-center justify-center gap-2 rounded-2xl border border-line bg-paper py-14 text-ink-3">
              <Loader2 size={18} className="animate-spin" /> {t('tasks.loading')}
            </div>
          ) : disputed.length > 0 ? (
            renderTable(disputed, false)
          ) : (
            <EmptyTab title={t('tasks.noDisputes')} desc={t('tasks.noDisputesDesc')} />
          )}
        </TabsContent>
      </Tabs>

      {/* Diálogo de acción (deliver / approve / confirmaciones) */}
      <Dialog open={dialog !== null} onOpenChange={(o) => !o && !action.busy && closeDialog()}>
        <DialogContent className="max-h-[92dvh] w-[calc(100vw-1.5rem)] overflow-y-auto border-line bg-paper sm:max-w-lg">
          {dialog && (
            <>
              <DialogHeader>
                <DialogTitle className="font-display text-ink">{dialogTitle}</DialogTitle>
                <DialogDescription className="text-ink-2">{dialogDesc}</DialogDescription>
              </DialogHeader>

              {action.busy || action.txHash ? (
                <TxProgress action={action} onClose={closeDialog} />
              ) : (
                <div className="flex flex-col gap-4">
                  {(() => {
                    const brief = getTaskBrief(dialog.task.taskHash);
                    return (
                      <div className="rounded-xl border border-monad/30 bg-monad/5 p-4">
                        <p className="eyebrow mb-1.5 text-monad-mist">{t('tasks.briefLabel')}</p>
                        {brief ? (
                          <p className="whitespace-pre-wrap text-[0.875rem] leading-relaxed text-ink">{brief}</p>
                        ) : (
                          <p className="text-[0.8125rem] italic text-ink-3">{t('tasks.briefMissingLong')}</p>
                        )}
                      </div>
                    );
                  })()}
                  <div className="rounded-xl border border-line bg-cream p-4 font-mono text-[0.8125rem] text-ink-2">
                    {t('tasks.escrowAmount')}: {formatMonEs(Number(formatEther(dialog.task.amountWei)))} {currencySymbol(dialog.task.currency)}
                  </div>

                  {dialog.kind === 'deliver' && (
                    <textarea
                      value={deliverText}
                      onChange={(e) => setDeliverText(e.target.value)}
                      rows={4}
                      placeholder={t('tasks.dialog.deliver.placeholder')}
                      className="w-full resize-none rounded-xl border border-line bg-paper px-4 py-3 text-[0.875rem] text-ink placeholder:text-ink-3 focus:border-honey focus:outline-none"
                    />
                  )}

                  {dialog.kind === 'approve' && (
                    <div className="flex flex-col gap-2">
                      <span className="text-[0.8125rem] font-medium text-ink-2">{t('tasks.dialog.approve.ratingLabel')}</span>
                      <div className="flex gap-1" role="radiogroup" aria-label={t('tasks.dialog.approve.ratingLabel')}>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button
                            key={n}
                            type="button"
                            role="radio"
                            aria-checked={rating === n}
                            onClick={() => setRating(n)}
                            className="rounded-full p-1 transition-transform hover:scale-110"
                          >
                            <Star
                              size={26}
                              className={n <= rating ? 'fill-honey text-honey' : 'fill-sand text-sand'}
                              strokeWidth={0}
                            />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      onClick={closeDialog}
                      className="flex-1 rounded-full border border-line px-4 py-2.5 text-[0.875rem] font-medium text-ink-2 transition-colors hover:border-honey"
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      type="button"
                      onClick={submitDialog}
                      disabled={dialog.kind === 'deliver' && deliverText.trim().length === 0}
                      className={cn(
                        'inline-flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2.5 text-[0.875rem] font-semibold disabled:opacity-40',
                        dialog.kind === 'dispute' || dialog.kind === 'cancel'
                          ? 'border border-terra/50 bg-terra/10 text-terra transition-colors hover:bg-terra/20'
                          : 'btn-monad',
                      )}
                    >
                      {dialogConfirm}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
