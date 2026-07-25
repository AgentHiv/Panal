import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ExternalLink, Hexagon, Loader2, Timer, TriangleAlert } from 'lucide-react';
import { useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
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
import { EXPLORER_TX, PANAL_ESCROW_ADDRESS, monadTestnet } from '@/contracts/config';
import { panalEscrowAbi } from '@/contracts/abis';

export interface HireDialogProps {
  agent: Agent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const EXAMPLE_CHIPS = ['Audita este contrato', 'Resume este PDF', 'Verifica este precio', 'Traduce esta documentación'];
const STEP_TITLES = ['Define la tarea', 'Bloquea el pago (escrow)', 'Confirmación'];

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
  const [step, setStep] = useState(0);
  const [taskText, setTaskText] = useState('');
  const [params, setParams] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [txHash] = useState(() => randomTxHash());

  /* ---------- contratación real (PanalEscrow · Monad testnet) ---------- */
  const { connected, wrongNetwork, switchToMonad } = useWallet();
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

  const hireOnchain = () => {
    if (!isOnchainAgent(agent)) return;
    const taskHash = keccak256(toBytes(taskText.trim()));
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3 * 24 * 60 * 60);
    writeContract({
      address: PANAL_ESCROW_ADDRESS,
      abi: panalEscrowAbi,
      functionName: 'createTask',
      args: [agent.workerAddress, taskHash, deadline],
      value: agent.priceWei,
      chainId: monadTestnet.id,
    });
    setStep(2);
  };

  const price = agent.pricePerTask;
  const fee = price * PROTOCOL_FEE;
  const total = price + fee;

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
          <div className="mb-6 flex items-center gap-3" aria-label={`Paso ${step + 1} de 3`}>
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
                    backgroundColor: i < step ? '#E29A2E' : i === step ? '#F7E8CC' : '#EAE3D2',
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

          <DialogTitle className="display-m text-ink">{STEP_TITLES[step]}</DialogTitle>
          <DialogDescription className="sr-only">Contratación de {agent.name} con pago protegido por PanalEscrow</DialogDescription>

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
                      <p className="font-mono text-[12px] text-ink-3">{formatMon(price)} MON/tarea</p>
                    </div>
                  </div>
                  <textarea
                    value={taskText}
                    onChange={(e) => setTaskText(e.target.value)}
                    rows={4}
                    placeholder="Describe la tarea…"
                    className="w-full resize-none rounded-xl border border-line bg-paper px-4 py-3 text-[0.875rem] text-ink placeholder:text-ink-3 focus:border-honey focus:outline-none"
                  />
                  <div className="flex flex-wrap gap-2">
                    {EXAMPLE_CHIPS.map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => setTaskText(chip)}
                        className="rounded-full bg-sand px-3 py-1.5 text-[0.8125rem] text-ink-2 transition-colors hover:bg-honey-soft hover:text-honey-deep"
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                  <input
                    value={params}
                    onChange={(e) => setParams(e.target.value)}
                    placeholder="Parámetros (opcional) — p. ej. solidity ^0.8.24"
                    className="w-full rounded-xl border border-line bg-paper px-4 py-2.5 font-mono text-[12px] text-ink placeholder:text-ink-3 focus:border-honey focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    disabled={taskText.trim().length === 0}
                    className="mt-2 rounded-full bg-ink px-5 py-3 text-[0.875rem] font-medium text-paper transition-colors hover:bg-honey-deep disabled:opacity-40"
                  >
                    Continuar
                  </button>
                </div>
              )}

              {step === 1 && (
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2 rounded-xl border border-line bg-cream px-5 py-4 font-mono text-[0.875rem]">
                    <div className="flex justify-between">
                      <span className="text-ink-2">Precio de la tarea</span>
                      <span className="text-ink">{price.toFixed(3)} MON</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink-2">Comisión del protocolo (2.5%)</span>
                      <span className="text-ink">{formatMon(fee, 5)} MON</span>
                    </div>
                    <div className="mt-1 flex justify-between border-t border-line pt-2 font-semibold">
                      <span className="text-ink">Total a bloquear</span>
                      <span className="text-honey-deep">{formatMon(total, 5)} MON</span>
                    </div>
                  </div>
                  <p className="flex items-start gap-2 text-[0.8125rem] text-ink-2">
                    <Timer size={15} className="mt-0.5 shrink-0 text-honey-deep" />
                    Si no hay disputa, el pago se libera solo en {ESCROW_AUTO_RELEASE_H} h.
                  </p>
                  <label className="flex cursor-pointer items-center gap-2.5 text-[0.875rem] text-ink-2">
                    <Checkbox
                      checked={accepted}
                      onCheckedChange={(v) => setAccepted(v === true)}
                      className="border-line data-[state=checked]:border-honey data-[state=checked]:bg-honey data-[state=checked]:text-ink"
                    />
                    Acepto los términos del escrow
                  </label>
                  {onchain && connected && wrongNetwork ? (
                    <div className="mt-1 flex flex-col gap-3">
                      <p className="flex items-start gap-2 rounded-xl border border-honey bg-honey-soft px-4 py-3 text-[0.8125rem] text-honey-deep">
                        <TriangleAlert size={15} className="mt-0.5 shrink-0" />
                        Este agente es on-chain: para contratarlo de verdad tu wallet debe estar en Monad testnet.
                      </p>
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={() => setStep(0)}
                          className="rounded-full border border-line px-5 py-3 text-[0.875rem] font-medium text-ink-2 transition-colors hover:border-honey"
                        >
                          Volver
                        </button>
                        <button
                          type="button"
                          onClick={switchToMonad}
                          className="flex-1 rounded-full bg-ink px-5 py-3 text-[0.875rem] font-semibold text-paper transition-colors hover:bg-honey-deep"
                        >
                          Cambiar a Monad testnet
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
                        Volver
                      </button>
                      <button
                        type="button"
                        onClick={() => (realMode ? hireOnchain() : setStep(2))}
                        disabled={!accepted || signing}
                        className="flex-1 rounded-full bg-honey px-5 py-3 text-[0.875rem] font-semibold text-ink transition-colors hover:bg-honey-deep hover:text-paper disabled:opacity-40"
                      >
                        {realMode ? `Firmar y bloquear ${formatMon(price)} MON` : 'Bloquear y contratar'}
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
                        <p className="display-m text-ink">La transacción no se envió</p>
                        <p className="mt-1 max-w-sm text-[0.875rem] text-ink-2">
                          {writeError.message.includes('User rejected')
                            ? 'Has rechazado la firma en tu wallet.'
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
                          className="flex-1 rounded-full bg-ink px-5 py-3 text-[0.875rem] font-medium text-paper transition-colors hover:bg-honey-deep"
                        >
                          Volver e intentarlo
                        </button>
                      </div>
                    </>
                  ) : !mined ? (
                    <>
                      <Loader2 size={40} className="animate-spin text-honey-deep" aria-hidden />
                      <div>
                        <p className="display-m text-ink">
                          {!realTxHash ? 'Firmando en wallet…' : 'Confirmando en Monad…'}
                        </p>
                        <p className="mt-1 text-[0.875rem] text-ink-2">
                          {!realTxHash
                            ? 'Revisa tu wallet y confirma la transacción de createTask en PanalEscrow.'
                            : 'La transacción está enviada; esperando confirmación en Monad testnet.'}
                        </p>
                      </div>
                      {realTxHash && (
                        <a
                          href={EXPLORER_TX(realTxHash)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 font-mono text-[12px] text-ink-2 transition-colors hover:border-honey hover:text-honey-deep"
                        >
                          Ver transacción en MonadVision
                          <ExternalLink size={13} />
                        </a>
                      )}
                      {confirming && <p className="font-mono text-[11px] text-ink-3">1 confirmación requerida…</p>}
                    </>
                  ) : (
                    <>
                      {/* hexágono sellado (éxito real) */}
                      <div className="relative">
                        <svg viewBox="0 0 96 96" className="h-24 w-24">
                          <motion.polygon
                            points="88,48 68,82.64 28,82.64 8,48 28,13.36 68,13.36"
                            fill="#F7E8CC"
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
                            <path d="M41 48.5l5 5 9-10" stroke="#FAF7F1" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                          </motion.g>
                        </svg>
                      </div>
                      <div>
                        <p className="display-m text-ink">Tarea sellada on-chain</p>
                        <p className="mt-1 text-[0.875rem] text-ink-2">
                          {agent.name} ha recibido tu tarea. {formatMon(price)} MON bloqueados en PanalEscrow.
                        </p>
                      </div>
                      {realTxHash && <TxHash hash={realTxHash} className="rounded-full border border-line bg-cream px-4 py-2" />}
                      <div className="flex w-full flex-col gap-2 sm:flex-row">
                        <Link
                          to="/dashboard"
                          onClick={() => onOpenChange(false)}
                          className="flex-1 rounded-full bg-ink px-5 py-3 text-center text-[0.875rem] font-medium text-paper transition-colors hover:bg-honey-deep"
                        >
                          Ver tarea en mi dashboard
                        </Link>
                        {realTxHash && (
                          <a
                            href={EXPLORER_TX(realTxHash)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-line px-5 py-3 text-[0.875rem] font-medium text-ink-2 transition-colors hover:border-honey"
                          >
                            Ver en el explorador
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
                        fill="#F7E8CC"
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
                        <path d="M41 48.5l5 5 9-10" stroke="#FAF7F1" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
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
                    <p className="display-m text-ink">Tarea sellada on-chain</p>
                    <p className="mt-1 text-[0.875rem] text-ink-2">
                      {agent.name} ha recibido tu tarea. El pago está bloqueado en PanalEscrow.
                    </p>
                  </div>
                  <TxHash hash={txHash} className="rounded-full border border-line bg-cream px-4 py-2" />
                  <div className="flex w-full flex-col gap-2 sm:flex-row">
                    <Link
                      to="/dashboard"
                      onClick={() => onOpenChange(false)}
                      className="flex-1 rounded-full bg-ink px-5 py-3 text-center text-[0.875rem] font-medium text-paper transition-colors hover:bg-honey-deep"
                    >
                      Ver tarea en mi dashboard
                    </Link>
                    <button
                      type="button"
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-line px-5 py-3 text-[0.875rem] font-medium text-ink-2 transition-colors hover:border-honey"
                    >
                      Ver en el explorador
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
