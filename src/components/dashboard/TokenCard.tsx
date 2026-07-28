/**
 * Panal — TokenCard: tarjeta del token oficial $PANAL (solo mainnet).
 * Datos 100 % on-chain: totalSupply + balanceOf de la wallet conectada.
 * Acciones: ver contrato en el explorer, copiar dirección, añadir a MetaMask
 * (wallet_watchAsset via wagmi useWatchAsset).
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, ExternalLink, Hexagon, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useReadContract, useWatchAsset } from 'wagmi';
import { formatUnits } from 'viem';
import { panalTokenAbi } from '@/contracts/abis';
import {
  EXPLORER_ADDRESS,
  IS_MAINNET,
  PANAL_TOKEN_ADDRESS,
  activeChain,
} from '@/contracts/config';
import { useWallet } from '@/hooks/useWallet';

const compact = (n: number) =>
  new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 }).format(n);

export default function TokenCard() {
  const { t } = useTranslation();
  const { connected, address } = useWallet();
  const addr = (address ?? null) as `0x${string}` | null;
  const [copied, setCopied] = useState(false);

  const { data: supply } = useReadContract({
    address: PANAL_TOKEN_ADDRESS,
    abi: panalTokenAbi,
    functionName: 'totalSupply',
    chainId: activeChain.id,
    query: { enabled: IS_MAINNET, staleTime: 300_000, retry: 1 },
  });

  const { data: balance } = useReadContract({
    address: PANAL_TOKEN_ADDRESS,
    abi: panalTokenAbi,
    functionName: 'balanceOf',
    args: addr ? [addr] : undefined,
    chainId: activeChain.id,
    query: { enabled: IS_MAINNET && !!addr, refetchInterval: 15_000, retry: 1 },
  });

  const { watchAsset, isPending: watching } = useWatchAsset({
    mutation: {
      onSuccess: () => toast(t('token.addedToast')),
      onError: (e) =>
        toast.error(
          e.message.includes('User rejected') ? t('hire.step3.rejected') : e.message.split('\n')[0],
        ),
    },
  });

  if (!IS_MAINNET) return null;

  const copy = async () => {
    await navigator.clipboard.writeText(PANAL_TOKEN_ADDRESS);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const addToWallet = () =>
    watchAsset({
      type: 'ERC20',
      options: { address: PANAL_TOKEN_ADDRESS, symbol: 'PANAL', decimals: 18 },
    });

  const short = `${PANAL_TOKEN_ADDRESS.slice(0, 8)}…${PANAL_TOKEN_ADDRESS.slice(-6)}`;

  return (
    <div className="ring-glow-monad flex flex-col gap-5 rounded-2xl border border-monad/30 bg-coal-2 p-5 md:flex-row md:items-center md:justify-between md:p-6">
      {/* Identidad + supply + balance */}
      <div className="flex items-start gap-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-monad/15">
          <Hexagon size={20} className="fill-honey text-honey" aria-hidden />
        </span>
        <div className="flex flex-col gap-1.5">
          <p className="font-display text-[1.05rem] font-semibold text-coal-text">
            $PANAL <span className="font-body text-[0.8125rem] font-normal text-coal-mute">· {t('token.official')}</span>
          </p>
          <p className="font-mono text-[12px] text-coal-mute">
            {t('token.supply')}: <span className="text-coal-text">{supply !== undefined ? compact(Number(formatUnits(supply, 18))) : '…'}</span>
            {connected && (
              <>
                {'  ·  '}
                {t('token.yourBalance')}: <span className="text-monad-mist">{balance !== undefined ? compact(Number(formatUnits(balance, 18))) : '…'}</span>
              </>
            )}
          </p>
          <div className="flex items-center gap-2">
            <a
              href={EXPLORER_ADDRESS(PANAL_TOKEN_ADDRESS)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 font-mono text-[12px] text-coal-mute transition-colors hover:text-monad-mist"
            >
              {short} <ExternalLink size={11} aria-hidden />
            </a>
            <button
              type="button"
              onClick={copy}
              aria-label={t('token.copy')}
              className="inline-flex items-center justify-center rounded-full border border-coal-line p-1.5 text-coal-mute transition-colors hover:border-monad hover:text-monad-mist"
            >
              {copied ? <Check size={11} className="text-olive" /> : <Copy size={11} />}
            </button>
          </div>
        </div>
      </div>

      {/* Añadir a MetaMask */}
      <button
        type="button"
        onClick={addToWallet}
        disabled={watching}
        className="btn-monad inline-flex w-full items-center justify-center gap-2 px-5 py-2.5 text-[0.875rem] font-semibold disabled:opacity-50 md:w-auto"
      >
        {watching ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} aria-hidden />}
        {t('token.addToWallet')}
      </button>
    </div>
  );
}
