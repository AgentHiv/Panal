/**
 * Panal — Panel de arbitraje para los firmantes del multisig.
 *
 * POR QUÉ EXISTE
 * El rol de `arbitrator` del escrow lo ostenta un multisig 2-de-3, pero hasta
 * ahora sus firmantes no tenían dónde ver una disputa ni cómo resolverla: el
 * dashboard solo mostraba disputas a quien era PARTE del conflicto. Un juez
 * entraba y no veía nada. Resolver exigía construir el calldata a mano y
 * llamar al multisig desde un explorador, así que en la práctica no se
 * resolvía ninguna — mientras el reloj de 14 días corría hacia el reembolso
 * automático al cliente.
 *
 * QUÉ MUESTRA
 * Solo se renderiza si la wallet conectada es uno de los firmantes. Para cada
 * disputa abierta: importe, partes, días restantes, y el estado de firma de
 * LOS TRES jueces — quién ha confirmado y cuántas faltan. Sin eso, en un
 * 2-de-3 nadie sabe si su firma es la que falta.
 *
 * EL CALLDATA SE ENSEÑA DECODIFICADO
 * Quien confirma está aprobando lo que otro propuso. La propuesta se muestra
 * traducida a lenguaje llano (cuánto al agente, cuánto al cliente, qué nota)
 * para que nadie firme a ciegas.
 */

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, Check, ExternalLink, Gavel, Loader2, Scale } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { decodeFunctionData, encodeFunctionData, formatEther, type Address } from 'viem';
import { useAccount, useReadContract, useReadContracts } from 'wagmi';
import { useContractAction } from '@/hooks/useContractAction';
import { shortAddress } from '@/hooks/useWallet';
import {
  panalEscrowV2Abi,
  panalMultisigAbi,
  panalResolveDisputeAbi,
} from '@/contracts/abis';
import {
  EXPLORER_ADDRESS,
  EXPLORER_TX,
  PANAL_ESCROW_V2_ADDRESS,
  V2_ENABLED,
  activeChain,
  currencySymbol,
} from '@/contracts/config';

/**
 * Reloj en segundos que se refresca solo.
 *
 * Leer `Date.now()` durante el render es impuro: el valor cambia entre
 * renderizados sin que nada lo provoque, y el compilador de React lo rechaza.
 * Con estado, además, la cuenta atrás del plazo avanza de verdad en pantalla
 * en vez de quedarse congelada en el instante en que se montó la tarjeta.
 */
function useNowSec(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** Estado `Disputed` del enum Status de PanalEscrowV2. */
const STATUS_DISPUTED = 3;
/** Cuántas tareas recientes se revisan buscando disputas. */
const TASK_SCAN = 60;
/** Cuántas propuestas recientes del multisig se revisan. */
const TX_SCAN = 30;

interface DisputedTask {
  id: bigint;
  client: Address;
  worker: Address;
  amount: bigint;
  currency: Address;
}

interface Proposal {
  txId: bigint;
  confirmations: number;
  executed: boolean;
  workerShareBps: number;
  rating: number;
}

export default function ArbitrationCard() {
  const { t } = useTranslation();
  const { address } = useAccount();
  const me = address?.toLowerCase();

  // ---- Quién arbitra -------------------------------------------------------
  const { data: arbitrator } = useReadContract({
    address: PANAL_ESCROW_V2_ADDRESS,
    abi: panalEscrowV2Abi,
    functionName: 'arbitrator',
    chainId: activeChain.id,
    query: { enabled: V2_ENABLED, retry: 1 },
  });

  const multisig = arbitrator as Address | undefined;

  // Los tres firmantes. Si el árbitro fuese una wallet suelta y no un multisig,
  // estas lecturas fallan y la tarjeta simplemente no se muestra.
  const { data: ownersRaw } = useReadContracts({
    contracts: [0, 1, 2].map((i) => ({
      address: multisig,
      abi: panalMultisigAbi,
      functionName: 'owners' as const,
      args: [BigInt(i)],
      chainId: activeChain.id,
    })),
    query: { enabled: Boolean(multisig), retry: 1 },
  });

  const owners = useMemo(
    () =>
      (ownersRaw ?? [])
        .map((r) => (r.status === 'success' ? (r.result as Address) : undefined))
        .filter((a): a is Address => Boolean(a)),
    [ownersRaw],
  );

  const isJudge = Boolean(me && owners.some((o) => o.toLowerCase() === me));

  // ---- Disputas abiertas ---------------------------------------------------
  const { data: taskCount } = useReadContract({
    address: PANAL_ESCROW_V2_ADDRESS,
    abi: panalEscrowV2Abi,
    functionName: 'getTaskCount',
    chainId: activeChain.id,
    query: { enabled: isJudge, refetchInterval: 60_000, retry: 1 },
  });

  const scanIds = useMemo(() => {
    const total = taskCount === undefined ? 0 : Number(taskCount);
    const from = Math.max(0, total - TASK_SCAN);
    return Array.from({ length: Math.max(0, total - from) }, (_, k) => BigInt(from + k));
  }, [taskCount]);

  const { data: tasksRaw, refetch: refetchTasks } = useReadContracts({
    contracts: scanIds.map((id) => ({
      address: PANAL_ESCROW_V2_ADDRESS,
      abi: panalEscrowV2Abi,
      functionName: 'tasks' as const,
      args: [id],
      chainId: activeChain.id,
    })),
    query: { enabled: isJudge && scanIds.length > 0, refetchInterval: 60_000, retry: 1 },
  });

  const disputed = useMemo<DisputedTask[]>(() => {
    const out: DisputedTask[] = [];
    (tasksRaw ?? []).forEach((r, i) => {
      if (r.status !== 'success' || !r.result) return;
      const task = r.result as unknown as {
        client: Address;
        worker: Address;
        amount: bigint;
        status: number;
        currency: Address;
      };
      if (Number(task.status) !== STATUS_DISPUTED) return;
      out.push({
        id: scanIds[i]!,
        client: task.client,
        worker: task.worker,
        amount: task.amount,
        currency: task.currency,
      });
    });
    return out;
  }, [tasksRaw, scanIds]);

  // ---- Propuestas ya presentadas en el multisig ----------------------------
  const { data: txCount } = useReadContract({
    address: multisig,
    abi: panalMultisigAbi,
    functionName: 'txCount',
    chainId: activeChain.id,
    query: { enabled: isJudge && Boolean(multisig), refetchInterval: 30_000, retry: 1 },
  });

  const txIds = useMemo(() => {
    const total = txCount === undefined ? 0 : Number(txCount);
    const from = Math.max(0, total - TX_SCAN);
    return Array.from({ length: Math.max(0, total - from) }, (_, k) => BigInt(from + k));
  }, [txCount]);

  const { data: txsRaw, refetch: refetchTxs } = useReadContracts({
    contracts: txIds.map((id) => ({
      address: multisig,
      abi: panalMultisigAbi,
      functionName: 'getTx' as const,
      args: [id],
      chainId: activeChain.id,
    })),
    query: { enabled: isJudge && txIds.length > 0, refetchInterval: 30_000, retry: 1 },
  });

  /** taskId -> propuesta viva más reciente. */
  const proposals = useMemo(() => {
    const map = new Map<string, Proposal>();
    (txsRaw ?? []).forEach((r, i) => {
      if (r.status !== 'success' || !r.result) return;
      const [, data, confirmations, executed] = r.result as unknown as [Address, `0x${string}`, number, boolean];
      try {
        const decoded = decodeFunctionData({ abi: panalResolveDisputeAbi, data });
        if (decoded.functionName !== 'resolveDispute') return;
        const [taskId, bps, rating] = decoded.args as readonly [bigint, bigint, number];
        map.set(taskId.toString(), {
          txId: txIds[i]!,
          confirmations: Number(confirmations),
          executed: Boolean(executed),
          workerShareBps: Number(bps),
          rating: Number(rating),
        });
      } catch {
        // La propuesta es de otra cosa (cambiar treasury, migrar árbitro…): se ignora.
      }
    });
    return map;
  }, [txsRaw, txIds]);

  if (!V2_ENABLED || !isJudge) return null;

  const pending = disputed.filter((d) => !proposals.get(d.id.toString())?.executed);

  return (
    <motion.section
      initial={{ opacity: 0, y: 32 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.5 }}
      className="rounded-2xl border border-monad/30 bg-cream p-6 sm:p-7"
    >
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-monad/40 bg-paper text-monad">
            <Scale size={17} aria-hidden />
          </span>
          <div>
            <h3 className="font-display text-[1.0625rem] font-semibold text-ink">
              {t('dashReal.arbitration.title')}
            </h3>
            <p className="mt-1 max-w-xl text-[0.875rem] leading-relaxed text-ink-2">
              {t('dashReal.arbitration.subtitle')}
            </p>
          </div>
        </div>
        {multisig && (
          <a
            href={EXPLORER_ADDRESS(multisig)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 font-mono text-[0.75rem] text-ink-2 transition-colors hover:border-monad hover:text-monad"
          >
            {shortAddress(multisig)}
            <ExternalLink size={12} />
          </a>
        )}
      </header>

      {pending.length === 0 ? (
        <p className="mt-6 rounded-xl border border-line bg-paper px-4 py-6 text-center text-[0.875rem] text-ink-3">
          {t('dashReal.arbitration.empty')}
        </p>
      ) : (
        <div className="mt-6 flex flex-col gap-4">
          {pending.map((d) => (
            <DisputeRow
              key={d.id.toString()}
              dispute={d}
              proposal={proposals.get(d.id.toString())}
              owners={owners}
              multisig={multisig!}
              me={me}
              onDone={() => {
                void refetchTxs();
                void refetchTasks();
              }}
            />
          ))}
        </div>
      )}
    </motion.section>
  );
}

// ---------------------------------------------------------------------------

function DisputeRow({
  dispute,
  proposal,
  owners,
  multisig,
  me,
  onDone,
}: {
  dispute: DisputedTask;
  proposal: Proposal | undefined;
  owners: Address[];
  multisig: Address;
  me: string | undefined;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const action = useContractAction({ onMined: onDone });

  const symbol = currencySymbol(dispute.currency);

  // Cuenta atrás: pasado DISPUTE_TIMEOUT cualquiera puede reembolsar al
  // cliente al 100 %, y el agente se queda sin cobrar aunque hubiera entregado.
  const { data: disputedAt } = useReadContract({
    address: PANAL_ESCROW_V2_ADDRESS,
    abi: panalEscrowV2Abi,
    functionName: 'disputedAt',
    args: [dispute.id],
    chainId: activeChain.id,
    query: { retry: 1 },
  });
  const { data: timeout } = useReadContract({
    address: PANAL_ESCROW_V2_ADDRESS,
    abi: panalEscrowV2Abi,
    functionName: 'DISPUTE_TIMEOUT',
    chainId: activeChain.id,
    query: { retry: 1 },
  });

  const nowSec = useNowSec();
  const expiresAt =
    disputedAt !== undefined && timeout !== undefined ? Number(disputedAt) + Number(timeout) : null;
  const daysLeft = expiresAt === null ? null : Math.max(0, (expiresAt - nowSec) / 86_400);
  const urgent = daysLeft !== null && daysLeft < 3;

  // Estado de firma de LOS TRES jueces.
  const { data: confirmedRaw } = useReadContracts({
    contracts: owners.map((o) => ({
      address: multisig,
      abi: panalMultisigAbi,
      functionName: 'isConfirmedBy' as const,
      args: [proposal?.txId ?? 0n, o],
      chainId: activeChain.id,
    })),
    query: { enabled: Boolean(proposal), refetchInterval: 30_000, retry: 1 },
  });

  const confirmedBy = owners.map(
    (_, i) => confirmedRaw?.[i]?.status === 'success' && Boolean(confirmedRaw[i]!.result),
  );
  const iConfirmed = owners.some((o, i) => o.toLowerCase() === me && confirmedBy[i]);
  const missing = Math.max(0, 2 - (proposal?.confirmations ?? 0));

  const propose = (workerShareBps: number, rating: number) =>
    void action.run({
      address: multisig,
      abi: panalMultisigAbi,
      functionName: 'submit',
      args: [
        PANAL_ESCROW_V2_ADDRESS,
        encodeFunctionData({
          abi: panalResolveDisputeAbi,
          functionName: 'resolveDispute',
          args: [dispute.id, BigInt(workerShareBps), rating],
        }),
      ],
    });

  return (
    <article className="rounded-xl border border-line bg-paper p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[0.9375rem] font-medium text-ink">
            {t('dashReal.arbitration.taskLabel', { id: dispute.id.toString() })}
          </p>
          <p className="mt-1 font-mono text-[0.8125rem] text-ink-2">
            {formatEther(dispute.amount)} {symbol}
          </p>
          <dl className="mt-3 grid gap-1 text-[0.8125rem] text-ink-3">
            <div className="flex gap-2">
              <dt>{t('dashReal.arbitration.client')}</dt>
              <dd className="font-mono text-ink-2">{shortAddress(dispute.client)}</dd>
            </div>
            <div className="flex gap-2">
              <dt>{t('dashReal.arbitration.agent')}</dt>
              <dd className="font-mono text-ink-2">{shortAddress(dispute.worker)}</dd>
            </div>
          </dl>
        </div>

        <div
          className={`rounded-xl border px-4 py-3 ${urgent ? 'border-terra/40 bg-terra/5' : 'border-line'}`}
        >
          <p className="eyebrow text-ink-3">{t('dashReal.arbitration.deadline')}</p>
          <p className={`mt-1 font-mono text-[1.0625rem] ${urgent ? 'text-terra' : 'text-ink'}`}>
            {daysLeft === null ? '…' : t('dashReal.dispute.daysLeft', { days: daysLeft.toFixed(1) })}
          </p>
          {urgent && (
            <p className="mt-1 flex items-center gap-1 text-[0.75rem] text-terra">
              <AlertTriangle size={12} aria-hidden />
              {t('dashReal.arbitration.urgent')}
            </p>
          )}
        </div>
      </div>

      {/* Estado de los tres firmantes */}
      <div className="mt-5 border-t border-line pt-4">
        <p className="eyebrow text-ink-3">{t('dashReal.arbitration.signers')}</p>
        <ul className="mt-2 flex flex-wrap gap-2">
          {owners.map((o, i) => {
            const done = Boolean(proposal) && confirmedBy[i];
            const isMe = o.toLowerCase() === me;
            return (
              <li
                key={o}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[0.75rem] ${
                  done ? 'border-olive/50 bg-olive/10 text-olive' : 'border-line text-ink-3'
                }`}
              >
                {done && <Check size={12} aria-hidden />}
                {shortAddress(o)}
                {isMe && <span className="text-ink-2">{t('dashReal.arbitration.you')}</span>}
              </li>
            );
          })}
        </ul>
      </div>

      {/* Propuesta viva, decodificada para que nadie firme a ciegas */}
      {proposal ? (
        <div className="mt-4 rounded-xl border border-monad/30 bg-cream p-4">
          <p className="eyebrow text-monad">{t('dashReal.arbitration.proposalLabel')}</p>
          <p className="mt-2 text-[0.875rem] leading-relaxed text-ink-2">
            {t('dashReal.arbitration.proposalDetail', {
              agent: (proposal.workerShareBps / 100).toFixed(0),
              client: ((10_000 - proposal.workerShareBps) / 100).toFixed(0),
              rating: proposal.rating,
            })}
          </p>
          <p className="mt-2 font-mono text-[0.8125rem] text-ink-3">
            {t('dashReal.arbitration.confirmations', {
              have: proposal.confirmations,
              missing,
            })}
          </p>
          <div className="mt-3">
            {action.busy || action.txHash ? (
              <TxState action={action} />
            ) : iConfirmed ? (
              <p className="text-[0.8125rem] text-olive">{t('dashReal.arbitration.alreadySigned')}</p>
            ) : (
              <button
                type="button"
                onClick={() =>
                  void action.run({
                    address: multisig,
                    abi: panalMultisigAbi,
                    functionName: 'confirm',
                    args: [proposal.txId],
                  })
                }
                className="inline-flex items-center gap-2 rounded-full border border-monad/50 px-4 py-2 text-[0.875rem] font-semibold text-monad transition-colors hover:bg-monad/10"
              >
                <Gavel size={14} />
                {t('dashReal.arbitration.confirm')}
              </button>
            )}
          </div>
        </div>
      ) : (
        <VerdictForm busy={action.busy} txHash={action.txHash} action={action} onPropose={propose} />
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------

/** Tres fallos habituales, para no obligar a nadie a pensar en puntos básicos. */
const PRESETS: { bps: number; rating: number; key: string }[] = [
  { bps: 10_000, rating: 5, key: 'worker' },
  { bps: 5_000, rating: 3, key: 'split' },
  { bps: 0, rating: 1, key: 'client' },
];

function VerdictForm({
  busy,
  txHash,
  action,
  onPropose,
}: {
  busy: boolean;
  txHash: `0x${string}` | undefined;
  action: ReturnType<typeof useContractAction>;
  onPropose: (bps: number, rating: number) => void;
}) {
  const { t } = useTranslation();

  if (busy || txHash) {
    return (
      <div className="mt-4">
        <TxState action={action} />
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-line bg-cream p-4">
      <p className="eyebrow text-ink-3">{t('dashReal.arbitration.verdictLabel')}</p>
      <p className="mt-2 text-[0.8125rem] leading-relaxed text-ink-3">
        {t('dashReal.arbitration.verdictHelp')}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => onPropose(p.bps, p.rating)}
            className="rounded-full border border-line px-4 py-2 text-[0.8125rem] font-medium text-ink-2 transition-colors hover:border-monad hover:text-monad"
          >
            {t(`dashReal.arbitration.preset.${p.key}`)}
          </button>
        ))}
      </div>
    </div>
  );
}

function TxState({ action }: { action: ReturnType<typeof useContractAction> }) {
  const { t } = useTranslation();
  if (action.mined && action.txHash) {
    return (
      <a
        href={EXPLORER_TX(action.txHash)}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 font-mono text-[0.8125rem] text-ink-2 transition-colors hover:text-honey-deep"
      >
        {t('hire.step3.viewTx')}
        <ExternalLink size={13} />
      </a>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 font-mono text-[0.8125rem] text-ink-2">
      <Loader2 size={14} className="animate-spin" aria-hidden />
      {action.signing ? t('hire.step3.signing') : t('hire.step3.confirming')}
    </span>
  );
}
