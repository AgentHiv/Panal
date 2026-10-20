/**
 * Panal — Disputa real en curso (PanalEscrow).
 * Solo se renderiza cuando la wallet tiene tareas en estado Disputed:
 * taskId, contraparte, monto bloqueado y cuenta atrás real
 * (`disputedAt(taskId)` + `DISPUTE_TIMEOUT()`). Cuando el plazo ha pasado
 * aparece el botón real `resolveStuckDispute(taskId)` con el patrón de
 * escritura obligatorio; al minarse, refetch de las tareas.
 */

import { motion } from 'framer-motion';
import { AlertTriangle, ExternalLink, Gavel, Loader2, Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatEther } from 'viem';
import { useReadContract } from 'wagmi';
import HexAvatar from '@/components/HexAvatar';
import { useLogoDeAgente } from '@/hooks/useLogoDeAgente';
import { useWallet, shortAddress } from '@/hooks/useWallet';
import { useAhora } from '@/hooks/useAhora';
import { ACTIVE_ESCROW_ABI, ACTIVE_ESCROW_ADDRESS, type RealTask } from '@/hooks/useMyTasks';
import { usePanalAgents } from '@/hooks/usePanalAgents';
import { useContractAction } from '@/hooks/useContractAction';
import { useAccesoEnDisputa } from '@/hooks/useAccesoEnDisputa';
import { EXPLORER_TX, activeChain, currencySymbol } from '@/contracts/config';
import { formatMonEs } from './data';

function DisputeEntry({
  task,
  timeoutSec,
  nameOf,
  onResolved,
}: {
  task: RealTask;
  timeoutSec: bigint | undefined;
  nameOf: (addr: string) => string;
  onResolved: () => void;
}) {
  // Su logo, si es un agente que lo publica. Ver `useLogoDeAgente`.
  const logoDe = useLogoDeAgente();
  const { t, i18n } = useTranslation();
  const action = useContractAction({ onMined: onResolved });
  const acceso = useAccesoEnDisputa();
  // Solo con quien recibe en el buzón: lo suyo puede ir cifrado, y quien
  // decide no lo leería sin que una parte le diera acceso.
  const conBuzon = acceso.buzonDe(task) !== null;

  const { data: disputedAt } = useReadContract({
    address: ACTIVE_ESCROW_ADDRESS,
    abi: ACTIVE_ESCROW_ABI,
    functionName: 'disputedAt',
    args: [task.id],
    chainId: activeChain.id,
    query: { refetchInterval: 60_000, retry: 1 },
  });

  const counterparty = task.role === 'worker' ? task.client : task.worker;
  // Se refresca solo: calculado en el render se congelaba, y un plazo que
  // vencia mientras alguien miraba la pantalla seguia diciendo que quedaba rato.
  const nowSec = useAhora();
  const resolvableAt =
    disputedAt !== undefined && timeoutSec !== undefined
      ? Number(disputedAt) + Number(timeoutSec)
      : null;
  const passed = resolvableAt !== null && resolvableAt <= nowSec;
  const daysLeft = resolvableAt !== null ? Math.max(0, (resolvableAt - nowSec) / 86_400) : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 32 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      className="rounded-2xl border border-terra bg-[#B2562E0D] p-6 shadow-card md:p-8"
    >
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl flex-1">
          <p className="eyebrow flex items-center gap-2 text-terra">
            <AlertTriangle size={13} aria-hidden />
            {t('dash.dispute.eyebrow')} #{task.id.toString()}
          </p>
          <h3 className="display-m mt-3 text-ink">{t('dashReal.dispute.title')}</h3>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.9375rem] text-ink-2">
            <span className="inline-flex items-center gap-2">
              <HexAvatar seed={counterparty} size={24} logo={logoDe(counterparty)} />
              <span className="font-medium text-ink">{nameOf(counterparty)}</span>
            </span>
            ·
            {/* La moneda REAL de la tarea. Estaba escrita "MON" a mano, asi que
                una disputa por 100 $PANAL se anunciaba como 100 MON: en la pantalla
                donde se discute cuanto dinero hay en juego. */}
            <span className="font-mono">
              {formatMonEs(Number(formatEther(task.amountWei)))} {currencySymbol(task.currency)}
            </span>
            {t('dash.dispute.locked')}
          </p>
          {disputedAt !== undefined && disputedAt > 0n && (
            <p className="mt-2 font-mono text-[0.75rem] text-ink-3">
              {t('dashReal.dispute.openedAt', {
                date: new Date(Number(disputedAt) * 1000).toLocaleString(i18n.language, {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                }),
              })}
            </p>
          )}
        </div>

        {/* Plazo real + acción */}
        <div className="flex shrink-0 flex-col items-start gap-4 lg:items-end">
          <div className="rounded-xl border border-terra/30 bg-paper px-4 py-3">
            <p className="eyebrow text-ink-3">{t('dashReal.dispute.timeoutLabel')}</p>
            <p className="mt-1 font-mono text-[1.125rem] font-medium text-terra">
              {daysLeft === null
                ? '…'
                : passed
                  ? t('dashReal.dispute.timeoutPassed')
                  : t('dashReal.dispute.daysLeft', { days: daysLeft.toFixed(1) })}
            </p>
          </div>
          {passed &&
            (action.busy || action.txHash ? (
              <span className="inline-flex items-center gap-2 font-mono text-[0.8125rem] text-ink-2">
                {action.mined && action.txHash ? (
                  <a
                    href={EXPLORER_TX(action.txHash)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 transition-colors hover:border-honey hover:text-honey-deep"
                  >
                    {t('hire.step3.viewTx')}
                    <ExternalLink size={13} />
                  </a>
                ) : (
                  <>
                    <Loader2 size={14} className="animate-spin" aria-hidden />
                    {action.signing ? t('hire.step3.signing') : t('hire.step3.confirming')}
                  </>
                )}
              </span>
            ) : (
              <button
                type="button"
                onClick={() =>
                  void action.run({
                    address: ACTIVE_ESCROW_ADDRESS,
                    abi: ACTIVE_ESCROW_ABI,
                    functionName: 'resolveStuckDispute',
                    args: [task.id],
                  })
                }
                className="inline-flex items-center gap-2 rounded-full border border-terra/50 px-4 py-2 text-[0.875rem] font-semibold text-terra transition-colors hover:bg-terra/10"
              >
                <Gavel size={14} />
                {t('dashReal.dispute.resolve')}
              </button>
            ))}
          <p className="max-w-[260px] text-[0.8125rem] leading-relaxed text-ink-2 lg:text-right">
            {t('dashReal.dispute.note')}
          </p>
          {conBuzon && (
            <div className="flex max-w-[260px] flex-col items-start gap-2 lg:items-end">
              <button
                type="button"
                onClick={() => void acceso.dar(task)}
                disabled={acceso.dando !== null}
                className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 text-[0.8125rem] font-medium text-ink-2 transition-colors hover:border-honey hover:text-honey-deep disabled:opacity-50"
              >
                {acceso.dando === task.id ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Lock size={13} aria-hidden />}
                {t('dashReal.dispute.darAcceso')}
              </button>
              <p className="text-[0.75rem] leading-relaxed text-ink-3 lg:text-right">{t('dashReal.dispute.darAccesoPista')}</p>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export default function DisputeCard({
  tasks,
  onResolved,
}: {
  tasks: RealTask[];
  onResolved: () => void;
}) {
  const { address } = useWallet();
  const { agents } = usePanalAgents();
  const { data: timeoutSec } = useReadContract({
    address: ACTIVE_ESCROW_ADDRESS,
    abi: ACTIVE_ESCROW_ABI,
    functionName: 'DISPUTE_TIMEOUT',
    chainId: activeChain.id,
    query: { staleTime: 300_000, retry: 1 },
  });

  if (tasks.length === 0) return null;

  const meLc = address?.toLowerCase();
  const nameOf = (addr: string) => {
    if (addr.toLowerCase() === meLc) return shortAddress(addr);
    return (
      agents.find((a) => a.workerAddress.toLowerCase() === addr.toLowerCase())?.name ??
      shortAddress(addr)
    );
  };

  return (
    <div className="flex flex-col gap-6">
      {tasks.map((task) => (
        <DisputeEntry
          key={task.id.toString()}
          task={task}
          timeoutSec={timeoutSec}
          nameOf={nameOf}
          onResolved={onResolved}
        />
      ))}
    </div>
  );
}
