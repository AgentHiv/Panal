/**
 * Panal — tu archivo: lo que te han entregado, siempre alcanzable.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * QUÉ ARREGLA
 *
 * El contenido de un encargo solo se podía abrir mientras la tarea estuviera
 * en `Delivered`. O sea que APROBAR —pagar— era justo el gesto que te dejaba
 * sin forma de volver a lo que acababas de comprar: el botón desaparecía con
 * la tarea al pasar a `Completed`, y no había ninguna otra puerta.
 *
 * El contenido nunca se iba a ninguna parte. El bot del agente no mira el
 * estado de la tarea (`bot/src/http.ts`): comprueba la firma y que seas el
 * cliente, y sirve. Era la web la que dejaba de ofrecerlo.
 *
 * DE DÓNDE SALE CADA COSA
 *
 * La lista es de la CADENA, así que sale igual en cualquier navegador donde
 * conectes la misma wallet: no hay cuentas ni servidor de Panal que la guarde.
 * El texto entregado vive en el agente y, desde que se abre una vez, también
 * en una copia de ESTE navegador comprobada contra el `resultHash` on-chain.
 * Los adjuntos NO se copian —pesan— así que para bajarlos hace falta que el
 * agente siga en pie.
 *
 * POR QUÉ ES UNA PÁGINA Y NO UNA PESTAÑA DEL DASHBOARD
 *
 * El dashboard es de quien opera: KPIs, cobros, reputación, tu propio agente.
 * Esto es de quien compra, y quien compra no tiene por qué entrar en un panel
 * de administración para releer un informe que pagó.
 * ───────────────────────────────────────────────────────────────────────────
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { formatEther } from 'viem';
import { Archive, FileText, Loader2, Wallet } from 'lucide-react';
import HexAvatar from '@/components/HexAvatar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import ResultDialog from '@/components/dashboard/ResultDialog';
import { TASK_STATUS, useMyTasks } from '@/hooks/useMyTasks';
import type { RealTask } from '@/hooks/useMyTasks';
import { usePanalAgents, isOnchainAgent } from '@/hooks/usePanalAgents';
import { useWallet } from '@/hooks/useWallet';
import { getTaskBrief } from '@/lib/taskBriefs';
import { hayEntrega, leerEntrega } from '@/lib/expedientes';
import { currencySymbol } from '@/contracts/config';
import { cn } from '@/lib/utils';
import { useTituloDePagina } from '@/hooks/useTituloDePagina';

/** Solo lo entregado. Un encargo sin entrega no tiene contenido que archivar. */
function esEntrega(task: RealTask): boolean {
  return task.role === 'client' && hayEntrega(task.resultHash);
}

/** Cuándo pasó, para ordenar: la entrega si consta, y si no, la creación. */
function cuando(task: RealTask): number {
  const ts = task.deliveredAt && task.deliveredAt > 0n ? task.deliveredAt : task.createdAt;
  return Number(ts) * 1000;
}

const ETIQUETA: Record<number, { clave: string; clase: string }> = {
  [TASK_STATUS.Delivered]: { clave: 'tasks.status.entregada', clase: 'bg-olive/10 text-olive' },
  [TASK_STATUS.Completed]: { clave: 'tasks.status.completed', clase: 'bg-olive/10 text-olive' },
  [TASK_STATUS.Disputed]: { clave: 'tasks.status.disputa', clase: 'bg-terra/10 text-terra' },
};

export default function Archivo() {
  useTituloDePagina('archivo.metaTitle');

  const { t, i18n } = useTranslation();
  const { address, connected, connecting, connect } = useWallet();
  const { tasks, loading: cargandoTareas } = useMyTasks();
  const { agents, loading: cargandoAgentes } = usePanalAgents();
  const [abierta, setAbierta] = useState<RealTask | null>(null);

  const entregas = useMemo(() => {
    if (!address) return [];
    return tasks
      .filter(esEntrega)
      .sort((a, b) => cuando(b) - cuando(a))
      .map((task) => {
        const agente = agents.find(
          (a) => isOnchainAgent(a) && a.workerAddress.toLowerCase() === task.worker.toLowerCase(),
        );
        return {
          task,
          nombre: agente && isOnchainAgent(agente) ? agente.name : null,
          ruta: agente ? `/agente/${agente.id}` : null,
          pedido: getTaskBrief(task.taskHash),
          // Que ya esté en este navegador se dice, porque cambia lo que va a
          // pasar al abrirlo: se ve al momento y sin firmar nada.
          copiado: leerEntrega(task.id.toString()) !== null,
        };
      });
  }, [address, tasks, agents]);

  // Al recargar, wagmi tarda un instante en recuperar la sesión. Enseñar
  // «conecta tu wallet» en ese hueco es decirle a alguien que no tiene cuenta
  // justo cuando está entrando en la suya.
  if (!connected && connecting) {
    return (
      <div className="container-hive flex min-h-[60vh] items-center justify-center py-24">
        <Loader2 className="size-6 animate-spin text-ink-3" aria-hidden />
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="container-hive flex min-h-[60vh] max-w-lg flex-col items-center justify-center gap-5 py-24 text-center">
        <Wallet className="size-8 text-ink-3" aria-hidden />
        <div className="space-y-2">
          <h1 className="display-m text-ink">{t('archivo.title')}</h1>
          <p className="text-[0.9375rem] leading-relaxed text-ink-2">{t('archivo.connect')}</p>
        </div>
        <button
          type="button"
          onClick={connect}
          className="btn-monad inline-flex px-6 py-3 text-[0.9375rem] font-semibold"
        >
          {t('nav.connect')}
        </button>
      </div>
    );
  }

  const cargando = cargandoTareas || cargandoAgentes;

  return (
    <div className="container-hive max-w-3xl py-8">
      <h1 className="display-m text-ink">{t('archivo.title')}</h1>
      <p className="mb-6 mt-2 max-w-xl text-[0.9375rem] leading-relaxed text-ink-2">
        {t('archivo.subtitle')}
      </p>

      {entregas.length === 0 ? (
        cargando ? (
          <div className="flex justify-center py-20">
            <Loader2 className="size-6 animate-spin text-ink-3" aria-hidden />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-line bg-cream px-6 py-14 text-center">
            <Archive className="size-7 text-ink-3" aria-hidden />
            <p className="max-w-sm text-[0.9375rem] leading-relaxed text-ink-2">
              {t('archivo.empty')}
            </p>
            <Link
              to="/mercado"
              className="rounded-full border border-line px-5 py-2.5 text-[0.875rem] font-medium text-ink-2 transition-colors hover:border-honey hover:text-ink"
            >
              {t('chat.inbox.browse')}
            </Link>
          </div>
        )
      ) : (
        <ul className="flex flex-col gap-2">
          {entregas.map(({ task, nombre, ruta, pedido, copiado }) => {
            const et = ETIQUETA[task.status];
            return (
              <li
                key={task.id.toString()}
                className="flex items-start gap-3 rounded-2xl border border-line bg-paper px-4 py-4 transition-colors hover:border-honey/40"
              >
                <HexAvatar seed={task.worker} size={40} />

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    {ruta ? (
                      <Link to={ruta} className="text-[0.9375rem] font-semibold text-ink hover:text-honey-deep">
                        {nombre}
                      </Link>
                    ) : (
                      <span className="text-[0.9375rem] font-semibold text-ink">
                        {nombre ?? `${task.worker.slice(0, 6)}…${task.worker.slice(-4)}`}
                      </span>
                    )}
                    <span className="font-mono text-[0.75rem] text-ink-3">#{task.id.toString()}</span>
                    {et && (
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold',
                          et.clase,
                        )}
                      >
                        {t(et.clave)}
                      </span>
                    )}
                  </div>

                  {/* Lo que pediste, si este navegador lo guardó. Sin ello la
                      fila diría solo «#7 · 2 MON», que no recuerda nada. */}
                  <p className="mt-1 line-clamp-2 text-[0.8125rem] leading-relaxed text-ink-2">
                    {pedido ?? <span className="text-ink-3">{t('tasks.briefMissing')}</span>}
                  </p>

                  <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[0.6875rem] text-ink-3">
                    <span>
                      {new Date(cuando(task)).toLocaleDateString(i18n.language, {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </span>
                    <span aria-hidden>·</span>
                    <span>
                      {formatEther(task.amountWei)} {currencySymbol(task.currency)}
                    </span>
                    {copiado && (
                      <>
                        <span aria-hidden>·</span>
                        <span className="text-olive">{t('archivo.saved')}</span>
                      </>
                    )}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setAbierta(task)}
                  className="mt-0.5 inline-flex shrink-0 items-center gap-1.5 rounded-full border border-honey px-3.5 py-2 text-[0.8125rem] font-semibold text-honey-deep transition-colors hover:bg-honey-soft"
                >
                  <FileText size={14} aria-hidden />
                  {t('archivo.view')}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-6 px-1 text-[0.6875rem] leading-relaxed text-ink-3">{t('archivo.note')}</p>

      <Dialog open={abierta !== null} onOpenChange={(o) => !o && setAbierta(null)}>
        <DialogContent className="max-h-[92dvh] w-[calc(100vw-1.5rem)] overflow-y-auto border-line bg-paper sm:max-w-lg">
          {abierta && (
            <>
              <DialogHeader>
                <DialogTitle className="font-display text-ink">
                  {t('tasks.dialog.result.title', { id: `#${abierta.id.toString()}` })}
                </DialogTitle>
                <DialogDescription className="text-ink-2">
                  {t('tasks.dialog.result.desc')}
                </DialogDescription>
              </DialogHeader>
              {/* `key`: el visor lee su copia guardada en el inicializador del
                  estado, así que tiene que remontarse al cambiar de entrega. */}
              <ResultDialog key={abierta.id.toString()} task={abierta} />
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
