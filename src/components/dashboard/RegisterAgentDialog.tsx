/**
 * Panal — Alta real de agente en PanalRegistry (Monad testnet).
 * registerAgent(metadataURI, pricePerTask) con estados de tx:
 * firmando → confirmando (link al explorador) → éxito con TxHash real.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Loader2, TriangleAlert } from 'lucide-react';
import { useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import { parseEther } from 'viem';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import TxHash from '@/components/TxHash';
import { useWallet } from '@/hooks/useWallet';
import { EXPLORER_TX, PANAL_REGISTRY_ADDRESS, activeChain } from '@/contracts/config';
import { panalRegistryAbi } from '@/contracts/abis';

export interface RegisterAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function RegisterAgentDialog({ open, onOpenChange }: RegisterAgentDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg border-line bg-paper p-0 sm:rounded-2xl">
        <RegisterAgentForm onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

function RegisterAgentForm({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const [metadata, setMetadata] = useState('');
  const [price, setPrice] = useState('');

  const {
    writeContract,
    data: txHash,
    isPending: signing,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();
  const { isLoading: confirming, isSuccess: mined } = useWaitForTransactionReceipt({ hash: txHash });

  const { connected, wrongNetwork, switchToMonad, chainId } = useWallet();

  // Validación estricta del string: evita que parseEther lance con notación
  // científica o más de 18 decimales (crash del componente).
  const priceStr = price.replace(',', '.').trim();
  const priceValid = /^\d+(\.\d{1,18})?$/.test(priceStr) && Number(priceStr) > 0;
  const valid = metadata.trim().length > 0 && priceValid;

  const submit = () => {
    if (!valid) return;
    // Guarda de red: nunca dejar que viem lance el error crudo de chain
    // mismatch — pedir el cambio de red y que el usuario reintente.
    if (connected && chainId !== activeChain.id) {
      toast(t('wallet.wrongChainToast'), {
        description: t('wallet.wrongChainToastDesc', { network: activeChain.name }),
      });
      switchToMonad();
      return;
    }
    writeContract(
      {
        address: PANAL_REGISTRY_ADDRESS,
        abi: panalRegistryAbi,
        functionName: 'registerAgent',
        args: [metadata.trim(), parseEther(priceStr)],
        chainId: activeChain.id,
      },
      {
        onSuccess: () =>
          toast(t('register.txSent'), {
            description: t('register.txSentDesc'),
          }),
      },
    );
  };

  const reset = () => {
    resetWrite();
    setMetadata('');
    setPrice('');
  };

  return (
    <div className="px-7 pb-7 pt-6">
      <DialogTitle className="display-m text-ink">{t('dash.registerAgent')}</DialogTitle>
      <DialogDescription className="sr-only">
        {t('register.desc')}
      </DialogDescription>

      {mined && txHash ? (
        <div className="mt-6 flex flex-col items-center gap-5 py-2 text-center">
          <svg viewBox="0 0 96 96" className="h-20 w-20">
            <polygon
              points="88,48 68,82.64 28,82.64 8,48 28,13.36 68,13.36"
              fill="#F2EFFA"
              stroke="#E29A2E"
              strokeWidth="2.5"
              strokeLinejoin="round"
            />
            <circle cx="48" cy="48" r="15" fill="#6E7B4E" />
            <path d="M41 48.5l5 5 9-10" stroke="#F2EFFA" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div>
            <p className="display-m text-ink">{t('register.success')}</p>
            <p className="mt-1 text-[0.875rem] text-ink-2">
              {t('register.successDesc')}
            </p>
          </div>
          <TxHash hash={txHash} className="rounded-full border border-line bg-cream px-4 py-2" />
          <div className="flex w-full flex-col gap-2 sm:flex-row">
            <a
              href={EXPLORER_TX(txHash)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-ink px-5 py-3 text-[0.875rem] font-medium text-paper transition-colors hover:bg-honey-deep"
            >
              {t('hire.step3.viewExplorer')}
              <ExternalLink size={14} />
            </a>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="flex-1 rounded-full border border-line px-5 py-3 text-[0.875rem] font-medium text-ink-2 transition-colors hover:border-honey"
            >
              {t('common.close')}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-5 flex flex-col gap-4">
          <p className="text-[0.8125rem] leading-relaxed text-ink-2">
            {t('register.explain')}{' '}
            <span className="font-mono text-[12px]">{t('register.formatHint')}</span>
          </p>
          <textarea
            value={metadata}
            onChange={(e) => setMetadata(e.target.value)}
            rows={3}
            placeholder={t('register.metadataPlaceholder')}
            className="w-full resize-none rounded-xl border border-line bg-paper px-4 py-3 text-[0.875rem] text-ink placeholder:text-ink-3 focus:border-honey focus:outline-none"
          />
          <div className="flex items-center gap-3">
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              inputMode="decimal"
              placeholder="0.05"
              aria-label={t('ownAgent.priceAria')}
              className="w-full rounded-xl border border-line bg-paper px-4 py-2.5 font-mono text-[0.875rem] text-ink placeholder:text-ink-3 focus:border-honey focus:outline-none"
            />
            <span className="shrink-0 font-mono text-[0.8125rem] text-ink-2">{t('common.monTask')}</span>
          </div>

          {writeError && (
            <p className="flex items-start gap-2 rounded-xl border border-terra/40 bg-terra/10 px-4 py-3 text-[0.8125rem] text-terra">
              <TriangleAlert size={15} className="mt-0.5 shrink-0" />
              {writeError.message.includes('User rejected')
                ? t('hire.step3.rejected')
                : writeError.message.includes('already registered')
                  ? t('register.alreadyRegistered')
                  : writeError.message.includes('does not match the target chain')
                    ? t('wallet.chainMismatch')
                    : writeError.message.split("\n")[0]}
            </p>
          )}

          {txHash && !mined ? (
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
            <div className="mt-1 flex gap-3">
              <button
                type="button"
                onClick={() => {
                  reset();
                  onOpenChange(false);
                }}
                className="rounded-full border border-line px-5 py-3 text-[0.875rem] font-medium text-ink-2 transition-colors hover:border-honey"
              >
                {t('common.cancel')}
              </button>
              {connected && wrongNetwork ? (
                <button
                  type="button"
                  onClick={switchToMonad}
                  className="btn-monad inline-flex flex-1 items-center justify-center gap-2 px-5 py-3 text-[0.875rem] font-semibold"
                >
                  {t('wallet.switchNetwork')}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={submit}
                  disabled={!valid || signing}
                  className="btn-monad inline-flex flex-1 items-center justify-center gap-2 px-5 py-3 text-[0.875rem] font-semibold disabled:opacity-40"
                >
                  {signing && <Loader2 size={15} className="animate-spin" aria-hidden />}
                  {signing ? t('hire.step3.signing') : t('register.submit')}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
