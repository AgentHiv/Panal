/**
 * Panal — lo que el cliente puede hacer con un encargo, sin salir del chat.
 *
 * Ver la entrega, aprobarla con su valoración, abrir una disputa, cancelar un
 * encargo que nadie cogió o cuyo plazo venció y liberar el pago cuando pasa el
 * plazo de revisión. Es lo mismo que ofrece el panel a quien encargó, con las
 * mismas reglas: si mandaba al panel, quien leía la entrega en la conversación
 * tenía que ir a buscar el mismo encargo en una tabla para poder pagarlo.
 *
 * Las del tablón con reglas no salen: su cliente en el escrow es PanalTablon y
 * se llevan en /tablon.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Star } from 'lucide-react';
import { formatEther } from 'viem';
import type { Address } from 'viem';
import { useReadContract } from 'wagmi';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import ResultDialog from '@/components/dashboard/ResultDialog';
import TxProgress from '@/components/dashboard/TxProgress';
import { formatMonEs } from '@/components/dashboard/data';
import { ACTIVE_ESCROW_ABI, ACTIVE_ESCROW_ADDRESS, TASK_STATUS, type RealTask } from '@/hooks/useMyTasks';
import { useContractAction, type ContractActionRequest } from '@/hooks/useContractAction';
import { useAccesoEnDisputa } from '@/hooks/useAccesoEnDisputa';
import { useAhora } from '@/hooks/useAhora';
import { activeChain, currencySymbol } from '@/contracts/config';
import { hayEntrega } from '@/lib/expedientes';
import { esDelTablon } from '@/lib/tablonReglas';
import { cn } from '@/lib/utils';

type Accion = 'result' | 'approve' | 'dispute' | 'cancel' | 'autoRelease';

const SIN_TRABAJADOR = '0x0000000000000000000000000000000000000000';

export interface AccionesDelEncargoProps {
  tarea: RealTask;
  /** Tras minarse una acción: el estado del encargo ha cambiado en la cadena. */
  onCambio: () => void;
}

export default function AccionesDelEncargo({ tarea, onCambio }: AccionesDelEncargoProps) {
  const { t } = useTranslation();
  const action = useContractAction({ onMined: onCambio });
  const accesoEnDisputa = useAccesoEnDisputa();
  const disputaConAcceso = useRef(false);
  const ahora = useAhora();
  const [abierta, setAbierta] = useState<Accion | null>(null);
  const [valoracion, setValoracion] = useState(5);

  const { data: autoReleaseSec } = useReadContract({
    address: ACTIVE_ESCROW_ADDRESS,
    abi: ACTIVE_ESCROW_ABI,
    functionName: 'AUTO_RELEASE',
    chainId: activeChain.id,
    query: { staleTime: 300_000, retry: 1 },
  });

  /**
   * Abierta la disputa, que quien decide pueda leerla: si el encargo o la
   * entrega iban cifrados, se le da acceso en el mismo paso, como en el panel.
   */
  useEffect(() => {
    if (abierta !== 'dispute' || !action.mined || disputaConAcceso.current) return;
    disputaConAcceso.current = true;
    void accesoEnDisputa.dar(tarea, { soloSiCifrado: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- una vez por disputa minada
  }, [abierta, action.mined]);

  if (esDelTablon(tarea.client)) return null;

  // Las mismas reglas que el panel (TasksSection, `actionsFor`) para quien encargó.
  const acciones: { clase: Accion; texto: string; estilo: string }[] = [];
  // «Ver resultado» en cuanto hay entrega, y ya para siempre: aprobar no puede
  // dejarte sin lo que acabas de pagar.
  if (hayEntrega(tarea.resultHash)) {
    acciones.push({ clase: 'result', texto: t('tasks.viewResult'), estilo: 'border border-honey text-honey hover:bg-honey/10' });
  }
  if (tarea.status === TASK_STATUS.Delivered) {
    acciones.push({ clase: 'approve', texto: t('tasks.approve'), estilo: 'bg-olive text-paper hover:opacity-85' });
    acciones.push({ clase: 'dispute', texto: t('tasks.openDispute'), estilo: 'border border-terra/40 text-terra hover:bg-terra/10' });
    const puedeLiberar =
      tarea.deliveredAt !== undefined &&
      autoReleaseSec !== undefined &&
      Number(tarea.deliveredAt) + Number(autoReleaseSec) <= ahora;
    if (puedeLiberar) {
      acciones.push({ clase: 'autoRelease', texto: t('tasks.autoReleaseBtn'), estilo: 'border border-honey text-honey hover:bg-honey/10' });
    }
  }
  // El contrato solo deja cancelar sin trabajador asignado o con el plazo vencido.
  if (
    tarea.status === TASK_STATUS.Open &&
    (tarea.worker.toLowerCase() === SIN_TRABAJADOR || ahora > Number(tarea.deadline))
  ) {
    acciones.push({ clase: 'cancel', texto: t('tasks.cancelTask'), estilo: 'border border-line text-ink-2 hover:border-terra hover:text-terra' });
  }
  if (acciones.length === 0) return null;

  const peticion = (clase: Exclude<Accion, 'result'>): ContractActionRequest => {
    const base = { address: ACTIVE_ESCROW_ADDRESS as Address, abi: ACTIVE_ESCROW_ABI };
    switch (clase) {
      case 'approve':
        return { ...base, functionName: 'approveAndRelease', args: [tarea.id, valoracion] };
      case 'dispute':
        return { ...base, functionName: 'openDispute', args: [tarea.id] };
      case 'cancel':
        return { ...base, functionName: 'cancelTask', args: [tarea.id] };
      case 'autoRelease':
        return { ...base, functionName: 'autoRelease', args: [tarea.id] };
    }
  };

  const abrir = (clase: Accion) => {
    action.reset();
    setValoracion(5);
    disputaConAcceso.current = false;
    setAbierta(clase);
  };
  const cerrar = () => {
    setAbierta(null);
    action.reset();
  };

  const id = `#${tarea.id.toString()}`;
  const negativa = abierta === 'dispute' || abierta === 'cancel';

  return (
    <>
      <div className="flex flex-wrap justify-end gap-1.5">
        {acciones.map((a) => (
          <button
            key={a.clase}
            type="button"
            onClick={() => abrir(a.clase)}
            className={cn('rounded-full px-3 py-1.5 text-[0.75rem] font-semibold transition-colors', a.estilo)}
          >
            {a.texto}
          </button>
        ))}
      </div>

      <Dialog open={abierta !== null} onOpenChange={(o) => !o && !action.busy && cerrar()}>
        <DialogContent className="max-h-[92dvh] w-[calc(100vw-1.5rem)] overflow-y-auto border-line bg-paper sm:max-w-lg">
          {abierta && (
            <>
              <DialogHeader>
                <DialogTitle className="font-display text-ink">{t(`tasks.dialog.${abierta}.title`, { id })}</DialogTitle>
                <DialogDescription className="text-ink-2">{t(`tasks.dialog.${abierta}.desc`)}</DialogDescription>
              </DialogHeader>

              {abierta === 'result' ? (
                // `key`: el visor lee su copia guardada al montarse.
                <ResultDialog key={tarea.id.toString()} task={tarea} />
              ) : action.busy || action.txHash ? (
                <TxProgress action={action} onClose={cerrar} />
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="rounded-xl border border-line bg-cream p-4 font-mono text-[0.8125rem] text-ink-2">
                    {t('tasks.escrowAmount')}: {formatMonEs(Number(formatEther(tarea.amountWei)))}{' '}
                    {currencySymbol(tarea.currency)}
                  </div>

                  {abierta === 'approve' && (
                    <div className="flex flex-col gap-2">
                      <span className="text-[0.8125rem] font-medium text-ink-2">{t('tasks.dialog.approve.ratingLabel')}</span>
                      <div className="flex gap-1" role="radiogroup" aria-label={t('tasks.dialog.approve.ratingLabel')}>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button
                            key={n}
                            type="button"
                            role="radio"
                            aria-checked={valoracion === n}
                            onClick={() => setValoracion(n)}
                            className="rounded-full p-1 transition-transform hover:scale-110"
                          >
                            <Star
                              size={26}
                              className={n <= valoracion ? 'fill-honey text-honey' : 'fill-sand text-sand'}
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
                      onClick={cerrar}
                      className="flex-1 rounded-full border border-line px-4 py-2.5 text-[0.875rem] font-medium text-ink-2 transition-colors hover:border-honey"
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      type="button"
                      onClick={() => void action.run(peticion(abierta))}
                      className={cn(
                        'inline-flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2.5 text-[0.875rem] font-semibold',
                        negativa
                          ? 'border border-terra/50 bg-terra/10 text-terra transition-colors hover:bg-terra/20'
                          : 'btn-monad',
                      )}
                    >
                      {t(`tasks.dialog.${abierta}.confirm`)}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
