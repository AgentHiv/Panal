import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ExternalLink, Hexagon, Loader2, Timer, TriangleAlert } from 'lucide-react';
import { useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import { keccak256, toBytes } from 'viem';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import HexAvatar from '@/components/HexAvatar';
import TxHash from '@/components/TxHash';
import { cn } from '@/lib/utils';
import type { Agent } from '@/data/agents';
import { formatMon } from '@/data/agents';
import { PROTOCOL_FEE, ESCROW_AUTO_RELEASE_H } from '@/data/protocol';
import { randomTxHash } from '@/data/events';
import { useWallet } from '@/hooks/useWallet';
import { isOnchainAgent } from '@/hooks/usePanalAgents';
import { EXPLORER_TX, PANAL_ESCROW_ADDRESS, PANAL_REGISTRY_ADDRESS, activeChain, publicClient } from '@/contracts/config';
import { panalEscrowAbi, panalRegistryAbi } from '@/contracts/abis';

export interface HireDialogProps {
  agent: Agent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const EXAMPLE_CHIPS = ['hire.chip1', 'hire.chip2', 'hire.chip3', 'hire.chip4'];
const STEP_TITLES = ['hire.step1.title', 'hire.step2.title', 'hire.step3.title'];

/**
 * Modal global "Contratar agente" — 3 pasos con stepper de hexágonos (marketplace.md S8).
 * El estado del wizard vive en HireWizard: Radix desmonta el contenido al cerrar,
 * así cada apertura empieza de cero con un hash de transacción nuevo.
 */
export default function HireDialog({ agent, open, onOpenChange }: HireDialogProps) {
  if (!agent) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg border-line bg-paper p-0 sm:rounded-2xl">
        <HireWizard agent={agent} onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

function HireWizard({ agent, onOpenChange }: { agent: Agent; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [taskText, setTaskText] = useState('');
  const [params, setParams] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [txHash] = useState(() => randomTxHash());

  /* ---------- contratación real (PanalEscrow · Monad testnet) ---------- */
  const { connected, wrongNetwork, switchToMonad, chainId } = useWallet();
  const { switchChainAsync } = useSwitchChain();
  const onchain = isOnchainAgent(agent);
  const realMode = onchain && connected && !wrongNetwork;
  const {
    writeContract,
    data: realTxHash,
    isPending: signing,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();
  const { isLoading: confirming, isSuccess: mined } = useWaitForTransactionReceipt({ hash: realTxHash });

  const hireOnchain = async () => {
    if (!isOnchainAgent(agent)) return;
    // Guarda de red: pedir cambio a la chain activa en vez de fallar con
    // el error crudo de viem (chain de la wallet != chain objetivo).
    if (connected && chainId !== activeChain.id) {
      try {
        await switchChainAsync({ chainId: activeChain.id });
      } catch {
        toast(t('wallet.wrongChainToast'), {
          description: t('wallet.wrongChainToastDesc', { network: `${activeChain.name} · ${activeChain.id}` }),
        });
        return;
      }
    }
    // Revalidar el precio on-chain justo antes de firmar: el agente puede
    // haberlo cambiado desde que se cargó la lista (protección económica).
    try {
      const fresh = await publicClient.readContract({
        address: PANAL_REGISTRY_ADDRESS,
        abi: panalRegistryAbi,
        functionName: 'getAgent',
        args: [agent.workerAddress],
      });
      if (fresh.pricePerTask !== agent.priceWei) {
        toast.error(t('wallet.txError'));
        return;
      }
    } catch {
      // si el RPC falla, seguimos con el precio cacheado (misma fuente)
    }
    const brief = taskText.trim() + (params.trim() ? '\n' + params.trim() : '');
    const taskHash = keccak256(toBytes(brief));
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3 * 24 * 60 * 60);
    writeContract({
      address: PANAL_ESCROW_ADDRESS,
      abi: panalEscrowAbi,
      functionName: 'createTask',
      args: [agent.workerAddress, taskHash, deadline],
      value: agent.priceWei,
      chainId: activeChain.id,
    });
    setStep(2);
  };

  const price = agent.pricePerTask;
  const fee = price * PROTOCOL_FEE;
  // Lo que bloquea/firma el cliente es exactamente `price`; el fee del 2,5 %
  // se descuenta del pago al agente al liberar el escrow (ver contrato).
  const total = price;

  const confetti = useMemo(
    () =>
      Array.from({ length: 8 }, (_, i) => {
        const a = (Math.PI * 2 * i) / 8 + 0.35;
        return { x: Math.cos(a) * (52 + (i % 3) * 22), y: Math.sin(a) * (52 + ((i + 1) % 3) * 20), delay: i * 0.02 };
      }),
    [],
  );

  return (
    <div className="px-7 pb-7 pt-6">
          {/* Stepper de hexágonos */}
          <div className="mb-6 flex items-center gap-3" aria-label={t('hire.stepAria', { step: step + 1 })}>
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <span
                  className={cn(
                    'flex h-8 w-8 items-center justify-center transition-colors duration-300',
                    i < step
                      ? 'text-ink'
                      : i === step
                        ? 'text-ink'
                        : 'text-ink-3',
                  )}
                  style={{
                    clipPath: 'polygon(50% 0%, 93.3% 25%, 93.3% 75%, 50% 100%, 6.7% 75%, 6.7% 25%)',
                    backgroundColor: i < step ? '#E29A2E' : i === step ? '#F2EFFA' : '#C8C3DC',
                  }}
                >
                  {i < step ? <Check size={14} strokeWidth={3} /> : <span className="font-mono text-[12px] font-semibold">{i + 1}</span>}
                </span>
                {i < 2 && (
                  <span className="relative h-px w-10 bg-line sm:w-16">
                    <span
                      className="absolute inset-y-0 left-0 bg-honey transition-all duration-500"
                      style={{ width: i < step ? '100%' : '0%' }}
                    />
                  </span>
                )}
              </div>
            ))}
            <span className="ml-2 font-mono text-[12px] text-ink-3">0{step + 1}/03</span>
          </div>

          <DialogTitle className="display-m text-ink">{t(STEP_TITLES[step])}</DialogTitle>
          <DialogDescription className="sr-only">{t('hire.desc', { name: agent.name })}</DialogDescription>

          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.25 }}
              className="mt-5"
            >
              {step === 0 && (
                <div className="flex flex-col gap-4">
                  {/* agente resumido */}
                  <div className="flex items-center gap-3 rounded-xl border border-line bg-cream px-4 py-3">
                    <HexAvatar seed={agent.wallet} size={40} />
                    <div className="flex-1">
                      <p className="text-[0.875rem] font-semibold text-ink">{agent.name}</p>
                      <p className="font-mono text-[12px] text-ink-3">{t('common.monPerTask', { price: formatMon(price) })}</p>
                    </div>
                  </div>
                  <textarea
                    value={taskText}
                    onChange={(e) => setTaskText(e.target.value)}
                    rows={4}
                    placeholder={t('hire.taskPlaceholder')}
                    className="w-full resize-none rounded-xl border border-line bg-paper px-4 py-3 text-[0.875rem] text-ink placeholder:text-ink-3 focus:border-honey focus:outline-none"
                  />
                  <div className="flex flex-wrap gap-2">
                    {EXAMPLE_CHIPS.map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => setTaskText(t(chip))}
                        className="rounded-full bg-sand px-3 py-1.5 text-[0.8125rem] text-ink-2 transition-colors hover:bg-honey-soft hover:text-honey-deep"
                      >
                        {t(chip)}
                      </button>
                    ))}
                  </div>
                  <input
                    value={params}
                    onChange={(e) => setParams(e.target.value)}
                    placeholder={t('hire.paramsPlaceholder')}
                    className="w-full rounded-xl border border-line bg-paper px-4 py-2.5 font-mono text-[12px] text-ink placeholder:text-ink-3 focus:border-honey focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    disabled={taskText.trim().length === 0}
                    className="mt-2 btn-monad px-5 py-3 text-[0.875rem] font-semibold disabled:opacity-40"
                  >
                    {t('common.continue')}
                  </button>
                </div>
              )}

              {step === 1 && (
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2 rounded-xl border border-line bg-cream px-5 py-4 font-mono text-[0.875rem]">
                    <div className="flex justify-between">
                      <span className="text-ink-2">{t('hire.step2.taskPrice')}</span>
                      <span className="text-ink">{price.toFixed(3)} MON</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink-2">{t('hire.step2.protocolFee')}</span>
                      <span className="text-ink">{formatMon(fee, 5)} MON</span>
                    </div>
                    <div className="mt-1 flex justify-between border-t border-line pt-2 font-semibold">
                      <span className="text-ink">{t('hire.step2.totalLock')}</span>
                      <span className="text-honey-deep">{formatMon(total, 5)} MON</span>
                    </div>
                  </div>
                  <p className="flex items-start gap-2 text-[0.8125rem] text-ink-2">
                    <Timer size={15} className="mt-0.5 shrink-0 text-honey-deep" />
                    {t('hire.step2.autoRelease', { hours: ESCROW_AUTO_RELEASE_H })}
                  </p>
                  <label className="flex cursor-pointer items-center gap-2.5 text-[0.875rem] text-ink-2">
                    <Checkbox
                      checked={accepted}
                      onCheckedChange={(v) => setAccepted(v === true)}
                      className="border-line data-[state=checked]:border-honey data-[state=checked]:bg-honey data-[state=checked]:text-ink"
                    />
                    {t('hire.step2.accept')}
                  </label>
                  {onchain && connected && wrongNetwork ? (
                    <div className="mt-1 flex flex-col gap-3">
                      <p className="flex items-start gap-2 rounded-xl border border-honey bg-honey-soft px-4 py-3 text-[0.8125rem] text-honey-deep">
                        <TriangleAlert size={15} className="mt-0.5 shrink-0" />
                        {t('hire.step2.wrongNetwork')}
                      </p>
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={() => setStep(0)}
                          className="rounded-full border border-line px-5 py-3 text-[0.875rem] font-medium text-ink-2 transition-colors hover:border-honey"
                        >
                          {t('common.back')}
                        </button>
                        <button
                          type="button"
                          onClick={switchToMonad}
                          className="btn-monad inline-flex flex-1 px-5 py-3 text-[0.875rem] font-semibold disabled:opacity-40"
                        >
                          {t('nav.switchNetwork')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-1 flex gap-3">
                      <button
                        type="button"
                        onClick={() => setStep(0)}
                        className="rounded-full border border-line px-5 py-3 text-[0.875rem] font-medium text-ink-2 transition-colors hover:border-honey"
                      >
                        {t('common.back')}
                      </button>
                      <button
                        type="button"
                        onClick={() => (realMode ? hireOnchain() : setStep(2))}
                        disabled={!accepted || signing}
                        className="flex-1 rounded-full bg-honey px-5 py-3 text-[0.875rem] font-semibold text-ink transition-colors hover:bg-honey-deep hover:text-paper disabled:opacity-40"
                      >
                        {realMode ? t('hire.step2.signLock', { price: formatMon(price) }) : t('hire.step2.lockHire')}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {step === 2 && realMode && (
                <div className="relative flex flex-col items-center gap-5 py-2 text-center">
                  {writeError ? (
                    <>
                      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-terra/10 text-terra">
                        <TriangleAlert size={28} />
                      </span>
                      <div>
                        <p className="display-m text-ink">{t('hire.step3.txFailed')}</p>
                        <p className="mt-1 max-w-sm text-[0.875rem] text-ink-2">
                          {writeError.message.includes('User rejected')
                            ? t('hire.step3.rejected')
                            : writeError.message.split("\n")[0]}
                        </p>
                      </div>
                      <div className="flex w-full flex-col gap-2 sm:flex-row">
                        <button
                          type="button"
                          onClick={() => {
                            resetWrite();
                            setStep(1);
                          }}
                          className="flex-1 btn-monad px-5 py-3 text-[0.875rem] font-semibold"
                        >
                          {t('hire.step3.retry')}
                        </button>
                      </div>
                    </>
                  ) : !mined ? (
                    <>
                      <Loader2 size={40} className="animate-spin text-honey-deep" aria-hidden />
                      <div>
                        <p className="display-m text-ink">
                          {!realTxHash ? t('hire.step3.signing') : t('hire.step3.confirming')}
                        </p>
                        <p className="mt-1 text-[0.875rem] text-ink-2">
                          {!realTxHash ? t('hire.step3.signingHint') : t('hire.step3.confirmingHint')}
                        </p>
                      </div>
                      {realTxHash && (
                        <a
                          href={EXPLORER_TX(realTxHash)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 font-mono text-[12px] text-ink-2 transition-colors hover:border-honey hover:text-honey-deep"
                        >
                          {t('hire.step3.viewTx')}
                          <ExternalLink size={13} />
                        </a>
                      )}
                      {confirming && <p className="font-mono text-[11px] text-ink-3">{t('hire.step3.oneConfirm')}</p>}
                    </>
                  ) : (
                    <>
                      {/* hexágono sellado (éxito real) */}
                      <div className="relative">
                        <svg viewBox="0 0 96 96" className="h-24 w-24">
                          <motion.polygon
                            points="88,48 68,82.64 28,82.64 8,48 28,13.36 68,13.36"
                            fill="#F2EFFA"
                            stroke="#E29A2E"
                            strokeWidth="2.5"
                            strokeLinejoin="round"
                            initial={{ pathLength: 0, fillOpacity: 0 }}
                            animate={{ pathLength: 1, fillOpacity: 1 }}
                            transition={{ pathLength: { duration: 0.9, ease: 'easeInOut' }, fillOpacity: { duration: 0.5, delay: 0.5 } }}
                          />
                          <motion.g
                            initial={{ scale: 0, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={{ delay: 0.75, type: 'spring', stiffness: 300, damping: 16 }}
                            style={{ transformOrigin: '48px 48px' }}
                          >
                            <circle cx="48" cy="48" r="15" fill="#6E7B4E" />
                            <path d="M41 48.5l5 5 9-10" stroke="#F2EFFA" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                          </motion.g>
                        </svg>
                      </div>
                      <div>
                        <p className="display-m text-ink">{t('hire.step3.sealed')}</p>
                        <p className="mt-1 text-[0.875rem] text-ink-2">
                          {t('hire.step3.sealedDescReal', { name: agent.name, price: formatMon(price) })}
                        </p>
                      </div>
                      {realTxHash && <TxHash hash={realTxHash} className="rounded-full border border-line bg-cream px-4 py-2" />}
                      <div className="flex w-full flex-col gap-2 sm:flex-row">
                        <Link
                          to="/dashboard"
                          onClick={() => onOpenChange(false)}
                          className="flex-1 btn-monad px-5 py-3 text-center text-[0.875rem] font-semibold"
                        >
                          {t('hire.step3.viewDashboard')}
                        </Link>
                        {realTxHash && (
                          <a
                            href={EXPLORER_TX(realTxHash)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-line px-5 py-3 text-[0.875rem] font-medium text-ink-2 transition-colors hover:border-honey"
                          >
                            {t('hire.step3.viewExplorer')}
                            <ExternalLink size={14} />
                          </a>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}

              {step === 2 && !realMode && (
                <div className="relative flex flex-col items-center gap-5 py-2 text-center">
                  {/* hexágono que se dibuja y sella */}
                  <div className="relative">
                    <svg viewBox="0 0 96 96" className="h-24 w-24">
                      <motion.polygon
                        points="88,48 68,82.64 28,82.64 8,48 28,13.36 68,13.36"
                        fill="#F2EFFA"
                        stroke="#E29A2E"
                        strokeWidth="2.5"
                        strokeLinejoin="round"
                        initial={{ pathLength: 0, fillOpacity: 0 }}
                        animate={{ pathLength: 1, fillOpacity: 1 }}
                        transition={{ pathLength: { duration: 0.9, ease: 'easeInOut' }, fillOpacity: { duration: 0.5, delay: 0.5 } }}
                      />
                      <motion.g
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ delay: 0.75, type: 'spring', stiffness: 300, damping: 16 }}
                        style={{ transformOrigin: '48px 48px' }}
                      >
                        <circle cx="48" cy="48" r="15" fill="#6E7B4E" />
                        <path d="M41 48.5l5 5 9-10" stroke="#F2EFFA" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                      </motion.g>
                    </svg>
                    {/* micro-confetti de hexágonos */}
                    {confetti.map((c, i) => (
                      <motion.span
                        key={i}
                        className="absolute left-1/2 top-1/2 text-honey"
                        initial={{ x: 0, y: 0, opacity: 1, scale: 0 }}
                        animate={{ x: c.x, y: c.y, opacity: 0, scale: 1 }}
                        transition={{ duration: 0.9, delay: 0.75 + c.delay, ease: 'easeOut' }}
                      >
                        <Hexagon size={8} className="fill-honey" />
                      </motion.span>
                    ))}
                  </div>
                  <div>
                    <p className="display-m text-ink">{t('hire.step3.sealed')}</p>
                    <p className="mt-1 text-[0.875rem] text-ink-2">
                      {t('hire.step3.sealedDesc', { name: agent.name })}
                    </p>
                  </div>
                  <TxHash hash={txHash} className="rounded-full border border-line bg-cream px-4 py-2" />
                  <div className="flex w-full flex-col gap-2 sm:flex-row">
                    <Link
                      to="/dashboard"
                      onClick={() => onOpenChange(false)}
                      className="flex-1 btn-monad px-5 py-3 text-center text-[0.875rem] font-semibold"
                    >
                      {t('hire.step3.viewDashboard')}
                    </Link>
                    <button
                      type="button"
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-line px-5 py-3 text-[0.875rem] font-medium text-ink-2 transition-colors hover:border-honey"
                    >
                      {t('hire.step3.viewExplorer')}
                      <ExternalLink size={14} />
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
    </div>
  );
}
