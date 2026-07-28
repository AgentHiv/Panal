/**
 * Panal — Pagos REALES (PanalEscrow, pagos pull).
 * Bloque grande con `pendingWithdrawals(me)` y botón Withdraw que firma
 * `withdraw()` (patrón de escritura obligatorio; deshabilitado si es 0).
 * Historial: eventos Withdrawal reales del usuario (useWithdrawals, ventanas
 * auto-detectadas por el límite de eth_getLogs). Sin filas mock ni CSV fake.
 */

import { motion } from 'framer-motion';
import { ArrowDownLeft, ExternalLink, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatEther } from 'viem';
import type { Address } from 'viem';
import { useReadContract } from 'wagmi';
import TxHash from '@/components/TxHash';
import { useWallet } from '@/hooks/useWallet';
import { useContractAction } from '@/hooks/useContractAction';
import { useWithdrawals } from '@/hooks/useWithdrawals';
import {
  EXPLORER_TX,
  NATIVE_CURRENCY,
  PANAL_ESCROW_ADDRESS,
  PANAL_ESCROW_V2_ADDRESS,
  PANAL_TOKEN_ADDRESS,
  V2_ENABLED,
  activeChain,
} from '@/contracts/config';
import { panalEscrowAbi, panalEscrowV2Abi } from '@/contracts/abis';
import { formatMonEs } from './data';

/**
 * Fila de pendiente por moneda (escrow v2): pendingWithdrawals(token, me) y
 * botón withdraw(token) con el patrón de escritura obligatorio.
 */
function PendingRowV2({ token, symbol, labelKey }: { token: Address; symbol: string; labelKey: string }) {
  const { t } = useTranslation();
  const { address } = useWallet();
  const addr = (address ?? null) as `0x${string}` | null;

  const { data: pending, refetch: refetchPending } = useReadContract({
    address: PANAL_ESCROW_V2_ADDRESS,
    abi: panalEscrowV2Abi,
    functionName: 'pendingWithdrawals',
    args: addr ? [token, addr] : undefined,
    chainId: activeChain.id,
    query: { enabled: !!addr, refetchInterval: 15_000, retry: 1 },
  });

  const action = useContractAction({ onMined: () => void refetchPending() });

  const pendingNum = pending !== undefined ? Number(formatEther(pending)) : null;
  const canWithdraw = pending !== undefined && pending > 0n && !action.busy;

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-line bg-paper p-6 shadow-card sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="eyebrow text-ink-3">{t(labelKey)}</p>
        <p className="mt-1 font-mono text-[2rem] font-medium leading-none text-ink">
          {pendingNum === null ? '…' : formatMonEs(pendingNum)}
          <span className="ml-1.5 text-[0.5em] text-ink-3">{symbol}</span>
        </p>
        <p className="mt-2 text-[0.8125rem] text-ink-3">{t('payments.pendingHint')}</p>
      </div>
      <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
        {action.txHash && !action.mined ? (
          <a
            href={EXPLORER_TX(action.txHash)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 font-mono text-[12px] text-ink-2 transition-colors hover:border-honey hover:text-honey-deep"
          >
            <Loader2 size={13} className="animate-spin" aria-hidden />
            {t('hire.step3.confirming')}
            <ExternalLink size={12} />
          </a>
        ) : action.mined && action.txHash ? (
          <a
            href={EXPLORER_TX(action.txHash)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-olive/40 bg-olive/10 px-4 py-2 font-mono text-[12px] text-olive transition-colors hover:border-olive"
          >
            {t('dashReal.txConfirmed')}
            <ExternalLink size={12} />
          </a>
        ) : (
          <button
            type="button"
            onClick={() =>
              void action.run({
                address: PANAL_ESCROW_V2_ADDRESS,
                abi: panalEscrowV2Abi,
                functionName: 'withdraw',
                args: [token],
              })
            }
            disabled={!canWithdraw}
            className="btn-monad inline-flex items-center gap-2 px-6 py-3 text-[0.9375rem] font-semibold disabled:opacity-40"
          >
            {action.signing && <Loader2 size={15} className="animate-spin" aria-hidden />}
            {action.signing ? t('hire.step3.signing') : t('payments.withdraw')}
          </button>
        )}
        {pending !== undefined && pending === 0n && (
          <span className="text-[0.75rem] text-ink-3">{t('payments.nothingToWithdraw')}</span>
        )}
      </div>
    </div>
  );
}

export default function PaymentsSection() {
  const { t, i18n } = useTranslation();
  const { address } = useWallet();
  const addr = (address ?? null) as `0x${string}` | null;

  const withdrawals = useWithdrawals();

  const { data: pending, refetch: refetchPending } = useReadContract({
    address: PANAL_ESCROW_ADDRESS,
    abi: panalEscrowAbi,
    functionName: 'pendingWithdrawals',
    args: addr ? [addr] : undefined,
    chainId: activeChain.id,
    query: { enabled: !!addr, refetchInterval: 15_000, retry: 1 },
  });

  // Tras minarse withdraw(): refresca pendiente + historial.
  const action = useContractAction({
    onMined: () => {
      withdrawals.refetch();
      void refetchPending();
    },
  });

  const pendingMon = pending !== undefined ? Number(formatEther(pending)) : null;
  const canWithdraw = pending !== undefined && pending > 0n && !action.busy;

  const doWithdraw = () => {
    void action.run({
      address: PANAL_ESCROW_ADDRESS,
      abi: panalEscrowAbi,
      functionName: 'withdraw',
    });
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Pendiente de retiro + Withdraw real (v2: una fila por moneda) */}
      {V2_ENABLED && (
        <>
          <PendingRowV2 token={NATIVE_CURRENCY} symbol="MON" labelKey="payments.rowNative" />
          <PendingRowV2 token={PANAL_TOKEN_ADDRESS as Address} symbol="$PANAL" labelKey="payments.rowToken" />
        </>
      )}
      {!V2_ENABLED && (
      <div className="flex flex-col gap-5 rounded-2xl border border-line bg-paper p-6 shadow-card sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="eyebrow text-ink-3">{t('payments.pending')}</p>
          <p className="mt-1 font-mono text-[2rem] font-medium leading-none text-ink">
            {pendingMon === null ? '…' : formatMonEs(pendingMon)}
            <span className="ml-1.5 text-[0.5em] text-ink-3">MON</span>
          </p>
          <p className="mt-2 text-[0.8125rem] text-ink-3">{t('payments.pendingHint')}</p>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
          {action.txHash && !action.mined ? (
            <a
              href={EXPLORER_TX(action.txHash)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 font-mono text-[12px] text-ink-2 transition-colors hover:border-honey hover:text-honey-deep"
            >
              <Loader2 size={13} className="animate-spin" aria-hidden />
              {t('hire.step3.confirming')}
              <ExternalLink size={12} />
            </a>
          ) : action.mined && action.txHash ? (
            <a
              href={EXPLORER_TX(action.txHash)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-olive/40 bg-olive/10 px-4 py-2 font-mono text-[12px] text-olive transition-colors hover:border-olive"
            >
              {t('dashReal.txConfirmed')}
              <ExternalLink size={12} />
            </a>
          ) : (
            <button
              type="button"
              onClick={doWithdraw}
              disabled={!canWithdraw}
              className="btn-monad inline-flex items-center gap-2 px-6 py-3 text-[0.9375rem] font-semibold disabled:opacity-40"
            >
              {action.signing && <Loader2 size={15} className="animate-spin" aria-hidden />}
              {action.signing ? t('hire.step3.signing') : t('payments.withdraw')}
            </button>
          )}
          {pending !== undefined && pending === 0n && (
            <span className="text-[0.75rem] text-ink-3">{t('payments.nothingToWithdraw')}</span>
          )}
        </div>
      </div>
      )}

      {/* Historial real de retiros */}
      {withdrawals.loading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-line bg-paper py-10 text-ink-3">
          <Loader2 size={16} className="animate-spin" /> {t('tasks.loading')}
        </div>
      ) : withdrawals.withdrawals.length > 0 ? (
        <div className="overflow-hidden rounded-2xl border border-line bg-paper shadow-card">
          <ul className="divide-y divide-line">
            {withdrawals.withdrawals.map((w, i) => (
              <motion.li
                key={`${w.txHash}-${i}`}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{ duration: 0.4, delay: Math.min(i * 0.05, 0.4) }}
              >
                <div className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-cream">
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-olive/10 text-olive"
                    aria-hidden
                  >
                    <ArrowDownLeft size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.9375rem] font-medium text-ink">
                      {t('payments.withdrawalRow')}
                    </p>
                    <p className="mt-0.5 font-mono text-[0.75rem] text-ink-3">
                      {w.timestamp > 0
                        ? new Date(w.timestamp * 1000).toLocaleString(i18n.language, {
                            day: 'numeric',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : `#${w.blockNumber.toString()}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="font-mono text-[0.9375rem] font-medium text-olive">
                      +{formatMonEs(Number(formatEther(w.amountWei)))} MON
                    </span>
                    <TxHash hash={w.txHash} className="text-[0.6875rem]" />
                  </div>
                </div>
              </motion.li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-line bg-paper px-6 py-10 text-center">
          <p className="text-[0.875rem] text-ink-3">{t('payments.emptyHistory')}</p>
        </div>
      )}
    </div>
  );
}
