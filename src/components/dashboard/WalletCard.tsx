/**
 * Panal — Card de wallet del dashboard (dashboard.md S2), 100% on-chain.
 * Disponible (balance nativo), En escrow (pendingWithdrawals del escrow) y
 * Total ganado (suma de eventos Withdrawal) se leen de Monad en tiempo real
 * (react-query, refetch 15–30 s). Enviar firma una transferencia real;
 * Recibir muestra un QR real de la address. Sin mocks ni address de ejemplo.
 * Móvil: bloques en columna y botones Enviar/Recibir a ancho completo.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { ArrowDownLeft, ArrowUpRight, Check, Copy, ExternalLink, Loader2, TriangleAlert, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { useBalance, useReadContract, useSendTransaction, useWaitForTransactionReceipt } from 'wagmi';
import { panalEscrowV2Abi, panalTokenAbi } from '@/contracts/abis';
import { formatEther, formatUnits, isAddress, parseAbiItem, parseEther } from 'viem';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import TxHash from '@/components/TxHash';
import { useWallet } from '@/hooks/useWallet';
import { EXPLORER_TX, NATIVE_CURRENCY, PANAL_ESCROW_ADDRESS, PANAL_ESCROW_V2_ADDRESS, activeChain, publicClient , IS_MAINNET, PANAL_TOKEN_ADDRESS, V2_ENABLED } from '@/contracts/config';
import { panalEscrowAbi } from '@/contracts/abis';
import { WalletSparkline } from './charts';
import { formatMonEs } from './data';

/** 12.345678 → "12,3457" (es-ES, 4 decimales máx — saldo disponible). */
const nfES4 = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 4 });

function formatMon4(n: number): string {
  return nfES4.format(n);
}

/** Formato compacto para cantidades grandes de token (1,2 M, 3,4 K…). */
const formatCompact = (n: number) =>
  new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 }).format(n);

/** Evento Withdrawal del escrow (espejo de panalEscrowAbi, tipado por parseAbiItem). */
const WITHDRAWAL_EVENT = parseAbiItem('event Withdrawal(address indexed to, uint256 amount)');
/** v2: mismo evento con el token indexado (mismo patrón que useWithdrawals). */
const WITHDRAWAL_EVENT_V2 = parseAbiItem(
  'event Withdrawal(address indexed to, address indexed token, uint256 amount)',
);

interface WithdrawalPoint {
  blockNumber: bigint;
  amount: bigint;
}

interface WithdrawalEvent {
  /** timestamp del bloque (s) */
  t: number;
  /** MON retirados (number para la sparkline) */
  amount: number;
}

interface WithdrawalsData {
  total: bigint;
  events: WithdrawalEvent[];
}

const LOG_WINDOW = 100_000n;
/** Ventanas máx. hacia atrás si el RPC rechaza el rango completo (rate limit ~15 req/s). */
const MAX_LOG_WINDOWS = 80;

/** Lee los Withdrawal del usuario de UN escrow; si el RPC rechaza fromBlock 0, ventanas de 100k bloques. */
async function fetchWithdrawalPointsFor(
  filter: Readonly<{ address: `0x${string}`; event: typeof WITHDRAWAL_EVENT | typeof WITHDRAWAL_EVENT_V2; args: Record<string, `0x${string}`> }>,
): Promise<WithdrawalPoint[]> {
  const map = (logs: readonly { blockNumber: bigint; args: { amount?: bigint } }[]): WithdrawalPoint[] =>
    logs.map((l) => ({ blockNumber: l.blockNumber, amount: l.args.amount ?? 0n }));

  try {
    return map(await publicClient.getLogs({ ...filter, fromBlock: 0n }));
  } catch {
    /* rango amplio rechazado: ventanas hacia atrás */
  }

  const latest = await publicClient.getBlockNumber();
  const out: WithdrawalPoint[] = [];
  let to = latest;
  for (let i = 0; i < MAX_LOG_WINDOWS && to >= 0n; i++) {
    const from = to > LOG_WINDOW ? to - LOG_WINDOW + 1n : 0n;
    let chunk;
    try {
      chunk = await publicClient.getLogs({ ...filter, fromBlock: from, toBlock: to });
    } catch {
      break; // RPC saturado: devolvemos lo acumulado (react-query reintentará)
    }
    out.push(...map(chunk));
    if (from === 0n) break;
    if (chunk.length === 0 && out.length > 0) break; // ya hay eventos y la ventana anterior está vacía
    to = from - 1n;
  }
  return out;
}

/**
 * Retiros del usuario en MON: escrow v1 + (con V2_ENABLED) escrow v2 solo en
 * moneda nativa (token = address(0)); los retiros en $PANAL no se suman a un
 * total denominado en MON.
 */
async function fetchWithdrawalPoints(addr: `0x${string}`): Promise<WithdrawalPoint[]> {
  const v1 = { address: PANAL_ESCROW_ADDRESS, event: WITHDRAWAL_EVENT, args: { to: addr } } as const;
  const filters = V2_ENABLED
    ? [v1, { address: PANAL_ESCROW_V2_ADDRESS, event: WITHDRAWAL_EVENT_V2, args: { to: addr, token: NATIVE_CURRENCY } } as const]
    : [v1];
  const chunks = await Promise.all(filters.map((f) => fetchWithdrawalPointsFor(f)));
  return chunks.flat().sort((a, b) => (a.blockNumber < b.blockNumber ? -1 : 1));
}

/** Resuelve timestamps de bloque solo para los bloques con retiros (pocos). */
async function fetchWithdrawals(addr: `0x${string}`): Promise<WithdrawalsData> {
  const points = await fetchWithdrawalPoints(addr);
  const total = points.reduce((acc, p) => acc + p.amount, 0n);
  if (points.length === 0) return { total, events: [] };

  const unique = [...new Set(points.map((p) => p.blockNumber))];
  const blocks = await Promise.all(unique.map((n) => publicClient.getBlock({ blockNumber: n })));
  const ts = new Map(unique.map((n, i) => [n.toString(), Number(blocks[i].timestamp)]));

  const events = points
    .map((p) => ({ t: ts.get(p.blockNumber.toString()) ?? 0, amount: Number(formatEther(p.amount)) }))
    .filter((e) => e.t > 0)
    .sort((a, b) => a.t - b.t);
  return { total, events };
}

/** Acumulado de MON ganados por día (30 puntos) a partir de los retiros reales. */
function buildSparkline30d(events: WithdrawalEvent[]): number[] {
  const DAY = 86_400;
  const now = Math.floor(Date.now() / 1000);
  const start = now - 29 * DAY;
  const out: number[] = [];
  for (let d = 0; d < 30; d++) {
    const dayEnd = start + (d + 1) * DAY;
    const acc = events.reduce((sum, e) => (e.t < dayEnd ? sum + e.amount : sum), 0);
    out.push(acc);
  }
  return out;
}

function WalletBlock({ label, value, hint, suffix = 'MON' }: { label: string; value: string; hint?: string; suffix?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="eyebrow text-ink-3">{label}</span>
      <span className="font-mono text-[1.35rem] font-medium leading-tight text-ink md:text-[1.6rem]">
        {value}
        <span className="ml-1.5 text-[0.6em] text-ink-3">{suffix}</span>
      </span>
      {hint && <span className="text-[0.8125rem] text-ink-3">{hint}</span>}
    </div>
  );
}

export default function WalletCard() {
  const { t } = useTranslation();
  const { connected, address, addressShort, wrongNetwork, switchToMonad, connect } = useWallet();
  const addr = (address ?? null) as `0x${string}` | null;

  /* ---------- Datos on-chain ---------- */

  const { data: balance, isLoading: balanceLoading, isError: balanceError } = useBalance({
    address: addr ?? undefined,
    chainId: activeChain.id,
    query: { enabled: !!addr, refetchInterval: 15_000, retry: 1 },
  });

  // v1: pendingWithdrawals(me) — se mantiene mientras !V2_ENABLED.
  const { data: pendingEscrowV1, isLoading: escrowLoadingV1, isError: escrowErrorV1 } = useReadContract({
    address: PANAL_ESCROW_ADDRESS,
    abi: panalEscrowAbi,
    functionName: 'pendingWithdrawals',
    args: addr ? [addr] : undefined,
    chainId: activeChain.id,
    query: { enabled: !!addr && !V2_ENABLED, refetchInterval: 15_000, retry: 1 },
  });

  // v2: pendingWithdrawals(token, me) por moneda — MON nativo y $PANAL.
  const { data: pendingEscrowNative, isLoading: escrowLoadingNative, isError: escrowErrorNative } = useReadContract({
    address: PANAL_ESCROW_V2_ADDRESS,
    abi: panalEscrowV2Abi,
    functionName: 'pendingWithdrawals',
    args: addr ? [NATIVE_CURRENCY, addr] : undefined,
    chainId: activeChain.id,
    query: { enabled: V2_ENABLED && !!addr, refetchInterval: 15_000, retry: 1 },
  });

  const { data: pendingEscrowToken, isError: escrowErrorToken } = useReadContract({
    address: PANAL_ESCROW_V2_ADDRESS,
    abi: panalEscrowV2Abi,
    functionName: 'pendingWithdrawals',
    args: addr ? [PANAL_TOKEN_ADDRESS, addr] : undefined,
    chainId: activeChain.id,
    query: { enabled: V2_ENABLED && !!addr, refetchInterval: 15_000, retry: 1 },
  });

  const pendingEscrow = V2_ENABLED ? pendingEscrowNative : pendingEscrowV1;
  const escrowLoading = V2_ENABLED ? escrowLoadingNative : escrowLoadingV1;
  const escrowError = V2_ENABLED ? escrowErrorNative : escrowErrorV1;

  const { data: panalBal, isLoading: panalLoading, isError: panalError } = useReadContract({
    address: PANAL_TOKEN_ADDRESS,
    abi: panalTokenAbi,
    functionName: 'balanceOf',
    args: addr ? [addr] : undefined,
    chainId: activeChain.id,
    query: { enabled: IS_MAINNET && !!addr, refetchInterval: 15_000, retry: 1 },
  });

  const { data: withdrawals, isLoading: withdrawalsLoading, isError: withdrawalsError } = useQuery({
    queryKey: ['panal-withdrawals', activeChain.id, V2_ENABLED, addr],
    enabled: !!addr,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: 1,
    queryFn: () => fetchWithdrawals(addr as `0x${string}`),
  });

  const availableStr = balanceLoading ? '…' : balanceError ? '—' : formatMon4(balance ? Number(formatEther(balance.value)) : 0);
  const escrowStr = escrowLoading
    ? '…'
    : escrowError || pendingEscrow === undefined
      ? '—' // lectura revertida (p. ej. despliegue antiguo sin pendingWithdrawals)
      : formatMonEs(Number(formatUnits(pendingEscrow, 18)));
  const totalStr = withdrawalsLoading
    ? '…'
    : withdrawalsError || !withdrawals
      ? '—'
      : formatMonEs(Number(formatUnits(withdrawals.total, 18)));
  const totalEarned = withdrawals?.total ?? 0n;
  const panalStr = panalLoading
    ? '…'
    : panalError || panalBal === undefined
      ? '—'
      : formatCompact(Number(formatUnits(panalBal, 18)));
  const spark30d = useMemo(
    () => (withdrawals && withdrawals.events.length >= 2 ? buildSparkline30d(withdrawals.events) : null),
    [withdrawals],
  );

  // Con V2_ENABLED el hint de "En escrow" incluye la parte en $PANAL.
  const escrowHint = V2_ENABLED
    ? pendingEscrowToken !== undefined && !escrowErrorToken
      ? `${formatMonEs(Number(formatUnits(pendingEscrowToken, 18)))} $PANAL · ${t('wallet.autoRelease')}`
      : t('wallet.autoRelease')
    : t('wallet.autoRelease');

  /* ---------- Estado local (copiar / diálogos / QR) ---------- */

  const [copied, setCopied] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [dest, setDest] = useState('');
  const [amount, setAmount] = useState('');
  const [qrUrl, setQrUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!addr) {
      setQrUrl(null);
      return;
    }
    let alive = true;
    QRCode.toDataURL(addr, { margin: 1, width: 320, color: { dark: '#1B1814', light: '#E9E4FF' } })
      .then((url) => alive && setQrUrl(url))
      .catch(() => alive && setQrUrl(null));
    return () => {
      alive = false;
    };
  }, [addr]);

  const copyAddress = async () => {
    if (!addr) return;
    try {
      await navigator.clipboard.writeText(addr);
    } catch {
      /* portapapeles no disponible */
    }
    setCopied(true);
    toast(t('detail.copied'), { icon: <Check size={14} className="text-olive" /> });
    window.setTimeout(() => setCopied(false), 1600);
  };

  /* ---------- Envío real ---------- */

  const { sendTransaction, data: txHash, isPending: signing, reset: resetSend } = useSendTransaction();
  const { isLoading: confirming, isSuccess: mined } = useWaitForTransactionReceipt({ hash: txHash });
  const toastedHash = useRef<string | null>(null);

  useEffect(() => {
    if (mined && txHash && toastedHash.current !== txHash) {
      toastedHash.current = txHash;
      toast(t('wallet.sendSuccess'), {
        description: <TxHash hash={txHash} className="text-[0.75rem]" />,
      });
    }
  }, [mined, txHash, t]);

  const destTrim = dest.trim();
  const amountStr = amount.replace(',', '.').trim();
  const destValid = isAddress(destTrim);
  const amountValid = /^\d+(\.\d{1,18})?$/.test(amountStr) && Number(amountStr) > 0;
  const sendValid = destValid && amountValid;

  const submitSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sendValid || !addr || wrongNetwork) return;
    sendTransaction(
      { to: destTrim as `0x${string}`, value: parseEther(amountStr), chainId: activeChain.id },
      {
        onError: (err) =>
          toast(t('wallet.sendFailed'), {
            description: err.message.includes('User rejected') ? t('hire.step3.rejected') : err.message.split('\n')[0],
          }),
      },
    );
  };

  const closeSend = (open: boolean) => {
    setSendOpen(open);
    if (!open) {
      resetSend();
      setDest('');
      setAmount('');
      toastedHash.current = null;
    }
  };

  /* ---------- Render ---------- */

  return (
    <div className="rounded-2xl border border-line bg-paper p-5 shadow-card md:p-7">
      {!connected || !addr ? (
        <div className="flex flex-col items-center gap-4 py-8 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full border border-line bg-cream">
            <Wallet size={24} className="text-honey" aria-hidden />
          </div>
          <p className="max-w-sm text-[0.9375rem] leading-relaxed text-ink-2">{t('wallet.connectPrompt')}</p>
          <button type="button" onClick={connect} className="btn-monad px-6 py-3 text-[0.9375rem] font-semibold">
            {t('nav.connect')}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between lg:gap-8">
          {/* 3 bloques mono (columna en móvil) */}
          <div className={`grid flex-1 grid-cols-1 gap-5 sm:gap-8 ${IS_MAINNET ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3'}`}>
            <WalletBlock label={t('wallet.available')} value={availableStr} />
            <WalletBlock label={t('wallet.inEscrow')} value={escrowStr} hint={escrowHint} />
            <WalletBlock
              label={t('wallet.totalEarned')}
              value={totalStr}
              hint={withdrawals && totalEarned === 0n ? t('wallet.noWithdrawals') : undefined}
            />
            {IS_MAINNET && (
              <WalletBlock label="$PANAL" value={panalStr} hint={t('wallet.tokenOfficial')} suffix="PANAL" />
            )}
          </div>

          {/* Sparkline (solo con datos reales suficientes) + acciones */}
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:gap-6">
            {spark30d && (
              <div className="flex flex-col gap-1 lg:items-end">
                <span className="eyebrow text-ink-3">{t('wallet.balance30')}</span>
                <WalletSparkline data={spark30d} className="h-16 w-full max-w-[260px] lg:w-[220px]" />
              </div>
            )}
            <div className="grid w-full grid-cols-2 gap-3 lg:flex lg:w-auto lg:flex-col lg:gap-2">
              {/* Enviar (real) */}
              <Dialog open={sendOpen} onOpenChange={closeSend}>
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    className="h-auto w-full rounded-full border-line bg-transparent px-4 py-3 font-mono text-[0.9375rem] hover:bg-cream lg:w-auto lg:py-2 lg:text-[0.8125rem]"
                  >
                    <ArrowUpRight size={15} className="mr-1.5" />
                    {t('wallet.send')}
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-h-[92dvh] w-[calc(100vw-2rem)] overflow-y-auto border-line bg-paper sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle className="font-display text-ink">{t('wallet.sendTitle')}</DialogTitle>
                    <DialogDescription className="text-ink-2">
                      {t('wallet.sendDesc', { address: addressShort })}
                    </DialogDescription>
                  </DialogHeader>

                  {mined && txHash ? (
                    <div className="flex flex-col items-center gap-4 py-2 text-center">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-olive/50 bg-olive/10">
                        <Check size={22} className="text-olive" aria-hidden />
                      </div>
                      <p className="font-display text-ink">{t('wallet.sendSuccess')}</p>
                      <TxHash hash={txHash} className="rounded-full border border-line bg-cream px-4 py-2" />
                      <div className="flex w-full flex-col gap-2 sm:flex-row">
                        <a
                          href={EXPLORER_TX(txHash)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex flex-1 items-center justify-center gap-2 btn-monad px-5 py-3 text-[0.875rem] font-semibold"
                        >
                          {t('hire.step3.viewExplorer')}
                          <ExternalLink size={14} />
                        </a>
                        <button
                          type="button"
                          onClick={() => closeSend(false)}
                          className="flex-1 rounded-full border border-line px-5 py-3 text-[0.875rem] font-medium text-ink-2 transition-colors hover:border-honey"
                        >
                          {t('common.close')}
                        </button>
                      </div>
                    </div>
                  ) : txHash ? (
                    <div className="flex flex-col items-center gap-3 py-2 text-center">
                      <Loader2 size={28} className="animate-spin text-honey-deep" aria-hidden />
                      <p className="text-[0.875rem] font-medium text-ink">{t('hire.step3.confirming')}</p>
                      <a
                        href={EXPLORER_TX(txHash)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 font-mono text-[12px] text-ink-2 transition-colors hover:border-honey hover:text-honey-deep"
                      >
                        {t('hire.step3.viewTx')}
                        <ExternalLink size={13} />
                      </a>
                      {confirming && <p className="font-mono text-[11px] text-ink-3">{t('hire.step3.oneConfirm')}</p>}
                    </div>
                  ) : (
                    <form onSubmit={submitSend} className="flex flex-col gap-4">
                      <label className="flex flex-col gap-1.5">
                        <span className="text-[0.8125rem] font-medium text-ink-2">{t('wallet.destAddress')}</span>
                        <Input
                          value={dest}
                          onChange={(e) => setDest(e.target.value)}
                          required
                          placeholder="0x…"
                          className="rounded-xl border-line bg-paper font-mono text-[0.8125rem]"
                        />
                        {destTrim.length > 0 && !destValid && (
                          <span className="flex items-center gap-1.5 text-[0.75rem] text-terra">
                            <TriangleAlert size={12} aria-hidden />
                            {t('wallet.invalidAddress')}
                          </span>
                        )}
                      </label>
                      <label className="flex flex-col gap-1.5">
                        <span className="text-[0.8125rem] font-medium text-ink-2">{t('wallet.amount')}</span>
                        <Input
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                          required
                          inputMode="decimal"
                          placeholder="0.010"
                          className="rounded-xl border-line bg-paper font-mono text-[0.8125rem]"
                        />
                        {amountStr.length > 0 && !amountValid && (
                          <span className="flex items-center gap-1.5 text-[0.75rem] text-terra">
                            <TriangleAlert size={12} aria-hidden />
                            {t('wallet.invalidAmount')}
                          </span>
                        )}
                      </label>
                      {wrongNetwork ? (
                        <button
                          type="button"
                          onClick={switchToMonad}
                          className="btn-monad inline-flex w-full items-center justify-center gap-2 px-5 py-3 text-[0.875rem] font-semibold"
                        >
                          {t('wallet.switchNetwork')}
                        </button>
                      ) : (
                        <button
                          type="submit"
                          disabled={!sendValid || signing}
                          className="btn-monad inline-flex w-full items-center justify-center gap-2 px-5 py-3 text-[0.875rem] font-semibold disabled:opacity-40"
                        >
                          {signing && <Loader2 size={15} className="animate-spin" aria-hidden />}
                          {signing ? t('wallet.signing') : t('wallet.confirmSend')}
                        </button>
                      )}
                    </form>
                  )}
                </DialogContent>
              </Dialog>

              {/* Recibir → QR real + copia */}
              <Dialog>
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    className="h-auto w-full rounded-full border-line bg-transparent px-4 py-3 font-mono text-[0.9375rem] hover:bg-cream lg:w-auto lg:py-2 lg:text-[0.8125rem]"
                  >
                    <ArrowDownLeft size={15} className="mr-1.5" />
                    {t('wallet.receive')}
                  </Button>
                </DialogTrigger>
                <DialogContent className="w-[calc(100vw-2rem)] border-line bg-paper sm:max-w-sm">
                  <DialogHeader>
                    <DialogTitle className="font-display text-ink">{t('wallet.receiveTitle')}</DialogTitle>
                    <DialogDescription className="text-ink-2">{t('wallet.receiveDesc')}</DialogDescription>
                  </DialogHeader>
                  <div className="flex flex-col items-center gap-4 py-2">
                    <div className="rounded-xl bg-monad-soft p-3">
                      {qrUrl ? (
                        <img src={qrUrl} width={168} height={168} alt={t('wallet.qrAria')} className="block" />
                      ) : (
                        <div className="flex h-[168px] w-[168px] items-center justify-center">
                          <Loader2 size={22} className="animate-spin text-ink-3" aria-hidden />
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={copyAddress}
                      className="group inline-flex max-w-full items-center gap-2 rounded-full border border-line bg-cream px-4 py-2 font-mono text-[0.75rem] text-ink-2 transition-colors hover:border-honey hover:text-ink"
                    >
                      <span className="truncate">{addr}</span>
                      {copied ? (
                        <Check size={13} className="shrink-0 text-olive" />
                      ) : (
                        <Copy size={13} className="shrink-0 opacity-50 group-hover:opacity-100" />
                      )}
                    </button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
