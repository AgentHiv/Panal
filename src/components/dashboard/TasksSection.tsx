/**
 * AgentHive — Tareas activas del dashboard (dashboard.md S5).
 * Tabs Activas/Completadas/En disputa, estados vivos (el progreso avanza en
 * cliente +1%/2s; cada ~15s una tarea pasa a "Entregada — verificar", parpadea
 * honey-soft y sube al principio), verificación con liberación de pago
 * simulada y apertura de disputa.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Check, Eye, FileCheck, Hexagon } from 'lucide-react';
import { toast } from 'sonner';
import HexAvatar from '@/components/HexAvatar';
import RatingStars from '@/components/RatingStars';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatMon } from '@/data/agents';
import { randomTxHash, truncateHash } from '@/data/events';
import type { DashTask, Perspective, TaskStatus } from './data';
import { ACTIVE_TASKS, COMPLETED_TASKS, TASK_COUNTS } from './data';

const STATUS_META: Record<TaskStatus, { label: string; className: string; pulse?: boolean }> = {
  escrow: { label: 'En escrow', className: 'bg-sand text-ink-2' },
  progreso: { label: 'En progreso', className: 'bg-honey-soft text-honey-deep' },
  entregada: { label: 'Entregada — verificar', className: 'bg-olive/10 text-olive', pulse: true },
  disputa: { label: 'En disputa', className: 'bg-terra/10 text-terra' },
};

function StatusBadge({ status }: { status: TaskStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[0.75rem] font-medium',
        meta.className,
        meta.pulse && 'animate-pulse',
      )}
    >
      {status === 'disputa' && <AlertTriangle size={12} />}
      {meta.label}
    </span>
  );
}

function ProgressCell({ task }: { task: DashTask }) {
  return (
    <div className="flex min-w-[110px] items-center gap-2">
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-sand">
        <div
          className={cn('h-full rounded-full transition-[width] duration-700', task.status === 'disputa' ? 'bg-terra' : 'bg-honey')}
          style={{ width: `${task.progress}%` }}
        />
      </div>
      <span className="w-9 text-right font-mono text-[0.75rem] text-ink-3">{task.progress}%</span>
    </div>
  );
}

const PAGE_SIZE = 6;

export default function TasksSection({ perspective }: { perspective: Perspective }) {
  const [tasks, setTasks] = useState<DashTask[]>(() => ACTIVE_TASKS[perspective].map((t) => ({ ...t })));
  const [flashId, setFlashId] = useState<string | null>(null);
  const [verifyTask, setVerifyTask] = useState<DashTask | null>(null);
  const [detailTask, setDetailTask] = useState<DashTask | null>(null);
  const [releasing, setReleasing] = useState(false);
  const [page, setPage] = useState(0);
  const tasksRef = useRef(tasks);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  // Hash del resultado entregado: estable por tarea (no se regenera por render)
  const resultHash = useMemo(
    () => (verifyTask ? truncateHash(randomTxHash()) : ''),
    [verifyTask],
  );

  // Nota: el contenedor padre usa key={perspective}, así que esta sección se
  // remonta al cambiar de perspectiva y el estado vivo se reinicia solo.

  // Progreso en vivo: +1% cada ~2s en tareas "En progreso" (tope 95%)
  useEffect(() => {
    const id = window.setInterval(() => {
      setTasks((prev) =>
        prev.map((t) =>
          t.status === 'progreso' && t.progress < 95 ? { ...t, progress: t.progress + 1 } : t,
        ),
      );
    }, 2000);
    return () => window.clearInterval(id);
  }, []);

  // Entrega simulada: cada ~15s una tarea "En progreso" → "Entregada — verificar"
  useEffect(() => {
    const id = window.setInterval(() => {
      const candidates = tasksRef.current.filter((t) => t.status === 'progreso');
      if (candidates.length === 0) return;
      const next = candidates.reduce((a, b) => (a.progress >= b.progress ? a : b));
      setTasks((prev) => {
        const updated = prev.map((t) =>
          t.id === next.id ? { ...t, status: 'entregada' as TaskStatus, progress: 100 } : t,
        );
        const moved = updated.find((t) => t.id === next.id)!;
        return [moved, ...updated.filter((t) => t.id !== next.id)];
      });
      setFlashId(next.id);
      window.setTimeout(() => setFlashId((f) => (f === next.id ? null : f)), 2400);
      toast(`Nueva entrega de ${next.counterparty} — verifícala`, {
        icon: <FileCheck size={15} className="text-olive" />,
      });
    }, 15000);
    return () => window.clearInterval(id);
  }, []);

  const liberarPago = () => {
    if (!verifyTask) return;
    setReleasing(true);
    window.setTimeout(() => {
      const tx = randomTxHash();
      setTasks((prev) => prev.filter((t) => t.id !== verifyTask.id));
      setReleasing(false);
      setVerifyTask(null);
      toast(`Pago liberado: tx ${truncateHash(tx)}`, {
        icon: <Check size={14} className="text-olive" />,
        description: `${verifyTask.id} · ${formatMon(verifyTask.amount)} MON transferidos (simulado).`,
      });
    }, 1200);
  };

  const abrirDisputa = (task: DashTask) => {
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: 'disputa' as TaskStatus } : t)));
    setVerifyTask(null);
    toast(`Disputa abierta en ${task.id}`, {
      icon: <AlertTriangle size={14} className="text-terra" />,
      description: 'El jurado con stake será convocado en las próximas horas.',
    });
  };

  const active = tasks.filter((t) => t.status !== 'disputa');
  const disputed = tasks.filter((t) => t.status === 'disputa');
  const completed = COMPLETED_TASKS[perspective];
  const counts = TASK_COUNTS[perspective];
  const pages = Math.max(1, Math.ceil(completed.length / PAGE_SIZE));
  const completedPage = completed.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const renderRows = (rows: DashTask[], withActions: boolean) =>
    rows.map((t, i) => (
      <motion.tr
        key={t.id}
        layout="position"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: Math.min(i * 0.04, 0.4), layout: { type: 'spring', stiffness: 300, damping: 30 } }}
        className={cn(
          'border-b border-line last:border-0 hover:bg-cream/70',
          flashId === t.id && 'bg-honey-soft/70',
        )}
      >
        <td className="whitespace-nowrap py-3.5 pl-5 pr-3 font-mono text-[0.8125rem] text-ink-2">{t.id}</td>
        <td className="px-3 py-3.5">
          <span className="flex items-center gap-2">
            <HexAvatar seed={t.counterpartyWallet} size={32} />
            <span className="max-w-[130px] truncate text-[0.875rem] font-medium text-ink">{t.counterparty}</span>
          </span>
        </td>
        <td className="max-w-[240px] px-3 py-3.5">
          <span className="block truncate text-[0.875rem] text-ink-2">{t.task}</span>
        </td>
        <td className="whitespace-nowrap px-3 py-3.5 font-mono text-[0.8125rem] text-ink">{formatMon(t.amount)} MON</td>
        <td className="px-3 py-3.5"><StatusBadge status={t.status} /></td>
        <td className="px-3 py-3.5"><ProgressCell task={t} /></td>
        {withActions && (
          <td className="whitespace-nowrap py-3.5 pl-3 pr-5">
            <div className="flex items-center justify-end gap-1.5">
              {t.status === 'entregada' && (
                <button
                  type="button"
                  onClick={() => setVerifyTask(t)}
                  className="rounded-full bg-olive px-3 py-1.5 text-[0.75rem] font-semibold text-paper transition-opacity hover:opacity-85"
                >
                  Verificar entrega
                </button>
              )}
              <button
                type="button"
                onClick={() => setDetailTask(t)}
                className="rounded-full border border-line px-3 py-1.5 text-[0.75rem] font-medium text-ink-2 transition-colors hover:border-honey hover:text-honey-deep"
              >
                Ver detalle
              </button>
              {t.status !== 'disputa' && (
                <button
                  type="button"
                  onClick={() => abrirDisputa(t)}
                  className="rounded-full border border-terra/30 px-3 py-1.5 text-[0.75rem] font-medium text-terra transition-colors hover:bg-terra/10"
                >
                  Abrir disputa
                </button>
              )}
            </div>
          </td>
        )}
      </motion.tr>
    ));

  const tableHead = (withActions: boolean, completedView = false) => (
    <thead>
      <tr className="border-b border-line text-left">
        <th className="py-3 pl-5 pr-3 text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-ink-3">ID</th>
        <th className="px-3 py-3 text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-ink-3">Contraparte</th>
        <th className="px-3 py-3 text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-ink-3">Tarea</th>
        <th className="px-3 py-3 text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-ink-3">Monto</th>
        {completedView ? (
          <>
            <th className="px-3 py-3 text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-ink-3">Duración</th>
            <th className="px-3 py-3 text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-ink-3">Rating dado</th>
          </>
        ) : (
          <>
            <th className="px-3 py-3 text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-ink-3">Estado</th>
            <th className="px-3 py-3 text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-ink-3">Progreso</th>
          </>
        )}
        {withActions && !completedView && (
          <th className="py-3 pl-3 pr-5 text-right text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-ink-3">Acciones</th>
        )}
      </tr>
    </thead>
  );

  return (
    <div>
      <Tabs defaultValue="activas">
        <TabsList className="h-auto gap-1 rounded-full border border-line bg-cream p-1">
          <TabsTrigger
            value="activas"
            className="rounded-full px-4 py-2 text-[0.8125rem] data-[state=active]:bg-paper data-[state=active]:text-ink data-[state=active]:shadow-sm"
          >
            Activas <span className="ml-1.5 rounded-full bg-honey-soft px-1.5 py-0.5 font-mono text-[0.6875rem] text-honey-deep">{counts.activas}</span>
          </TabsTrigger>
          <TabsTrigger
            value="completadas"
            className="rounded-full px-4 py-2 text-[0.8125rem] data-[state=active]:bg-paper data-[state=active]:text-ink data-[state=active]:shadow-sm"
          >
            Completadas
          </TabsTrigger>
          <TabsTrigger
            value="disputa"
            className="rounded-full px-4 py-2 text-[0.8125rem] data-[state=active]:bg-paper data-[state=active]:text-ink data-[state=active]:shadow-sm"
          >
            En disputa
            {disputed.length > 0 && (
              <span className="ml-1.5 rounded-full bg-terra/15 px-1.5 py-0.5 font-mono text-[0.6875rem] text-terra">{disputed.length}</span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="activas" className="mt-6">
          <div className="overflow-x-auto rounded-2xl border border-line bg-paper shadow-card">
            <table className="w-full min-w-[900px] border-collapse">
              {tableHead(true)}
              <tbody>{renderRows(active, true)}</tbody>
            </table>
          </div>
          <p className="mt-3 text-[0.8125rem] text-ink-3">
            Mostrando {active.length} de {counts.activas} tareas activas · el progreso se actualiza en vivo (simulado).
          </p>
        </TabsContent>

        <TabsContent value="completadas" className="mt-6">
          <div className="overflow-x-auto rounded-2xl border border-line bg-paper shadow-card">
            <table className="w-full min-w-[820px] border-collapse">
              {tableHead(false, true)}
              <tbody>
                <AnimatePresence initial={false}>
                  {completedPage.map((t, i) => (
                    <motion.tr
                      key={t.id}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.3, delay: i * 0.04 }}
                      className="border-b border-line last:border-0 hover:bg-cream/70"
                    >
                      <td className="whitespace-nowrap py-3.5 pl-5 pr-3 font-mono text-[0.8125rem] text-ink-2">{t.id}</td>
                      <td className="px-3 py-3.5">
                        <span className="flex items-center gap-2">
                          <HexAvatar seed={t.counterpartyWallet} size={32} />
                          <span className="max-w-[130px] truncate text-[0.875rem] font-medium text-ink">{t.counterparty}</span>
                        </span>
                      </td>
                      <td className="max-w-[260px] px-3 py-3.5">
                        <span className="block truncate text-[0.875rem] text-ink-2">{t.task}</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3.5 font-mono text-[0.8125rem] text-ink">{formatMon(t.amount)} MON</td>
                      <td className="whitespace-nowrap px-3 py-3.5 font-mono text-[0.8125rem] text-ink-2">{t.duration}</td>
                      <td className="px-3 py-3.5"><RatingStars rating={t.ratingGiven ?? 5} size={12} /></td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
          {/* Paginación simple */}
          <div className="mt-4 flex items-center justify-between">
            <p className="font-mono text-[0.75rem] text-ink-3">
              Página {page + 1} de {pages} · {completed.length} tareas
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="rounded-full border-line bg-transparent hover:bg-cream">
                Anterior
              </Button>
              <Button variant="outline" size="sm" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)} className="rounded-full border-line bg-transparent hover:bg-cream">
                Siguiente
              </Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="disputa" className="mt-6">
          {disputed.length > 0 ? (
            <div className="overflow-x-auto rounded-2xl border border-line bg-paper shadow-card">
              <table className="w-full min-w-[900px] border-collapse">
                {tableHead(true)}
                <tbody>{renderRows(disputed, true)}</tbody>
              </table>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line bg-paper px-6 py-16 text-center">
              <Hexagon size={40} className="text-line" strokeWidth={1.25} />
              <p className="font-display text-[1.05rem] font-semibold text-ink">Sin disputas abiertas</p>
              <p className="max-w-sm text-[0.875rem] text-ink-2">
                Cuando una entrega se impugne, el expediente y la votación del jurado aparecerán aquí.
              </p>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Dialog: verificar entrega */}
      <Dialog open={verifyTask !== null} onOpenChange={(o) => !o && !releasing && setVerifyTask(null)}>
        <DialogContent className="border-line bg-paper sm:max-w-lg">
          {verifyTask && (
            <>
              <DialogHeader>
                <DialogTitle className="font-display text-ink">Verificar entrega — {verifyTask.id}</DialogTitle>
                <DialogDescription className="text-ink-2">
                  {verifyTask.task} · {verifyTask.counterparty}
                </DialogDescription>
              </DialogHeader>
              {releasing ? (
                <div className="flex flex-col items-center gap-4 py-8">
                  <Hexagon size={44} className="animate-spin-slow text-honey" strokeWidth={1.5} />
                  <p className="font-mono text-[0.8125rem] text-ink-2">Liberando escrow…</p>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="rounded-xl border border-line bg-cream p-4">
                    <p className="eyebrow mb-2 text-ink-3">Resultado entregado (mock)</p>
                    <p className="text-[0.875rem] leading-relaxed text-ink-2">
                      «Resumen ejecutivo generado: 12 puntos clave, 3 riesgos y próximos pasos. Hash del
                      resultado anclado on-chain para verificación.»
                    </p>
                    <p className="mt-3 font-mono text-[0.75rem] text-ink-3">
                      resultado: {resultHash} · monto {formatMon(verifyTask.amount)} MON
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      onClick={liberarPago}
                      className="flex-1 rounded-full bg-honey px-4 py-2.5 text-[0.875rem] font-semibold text-ink transition-colors hover:bg-honey-deep hover:text-paper"
                    >
                      Liberar pago
                    </button>
                    <button
                      type="button"
                      onClick={() => abrirDisputa(verifyTask)}
                      className="flex-1 rounded-full border border-terra/40 px-4 py-2.5 text-[0.875rem] font-semibold text-terra transition-colors hover:bg-terra/10"
                    >
                      Abrir disputa
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog: detalle de tarea */}
      <Dialog open={detailTask !== null} onOpenChange={(o) => !o && setDetailTask(null)}>
        <DialogContent className="border-line bg-paper sm:max-w-md">
          {detailTask && (
            <>
              <DialogHeader>
                <DialogTitle className="font-display text-ink">Detalle — {detailTask.id}</DialogTitle>
                <DialogDescription className="text-ink-2">{detailTask.task}</DialogDescription>
              </DialogHeader>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-line bg-cream p-4 text-[0.875rem]">
                <dt className="text-ink-3">Contraparte</dt>
                <dd className="text-right font-medium text-ink">{detailTask.counterparty}</dd>
                <dt className="text-ink-3">Monto en escrow</dt>
                <dd className="text-right font-mono text-ink">{formatMon(detailTask.amount)} MON</dd>
                <dt className="text-ink-3">Fee protocolo (2,5%)</dt>
                <dd className="text-right font-mono text-ink">{formatMon(detailTask.amount * 0.025, 5)} MON</dd>
                <dt className="text-ink-3">Estado</dt>
                <dd className="text-right"><StatusBadge status={detailTask.status} /></dd>
                <dt className="text-ink-3">Auto-release</dt>
                <dd className="text-right font-mono text-ink-2">72 h sin disputa</dd>
              </dl>
              <Button
                variant="outline"
                className="rounded-full border-line bg-transparent hover:bg-cream"
                onClick={() => setDetailTask(null)}
              >
                <Eye size={14} className="mr-1.5" /> Cerrar
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
