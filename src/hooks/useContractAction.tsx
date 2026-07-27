/**
 * Panal — Patrón de escritura on-chain obligatorio (una sola copia).
 *
 * Envuelve useWriteContract + useWaitForTransactionReceipt con:
 * - Guarda de red: si la wallet está en otra chain, `switchChainAsync` a la
 *   red activa; si el usuario rechaza el cambio, toast `wallet.wrongChainToast`
 *   y no se firma nada.
 * - Errores: `User rejected` → `hire.step3.rejected`; si no, primera línea
 *   del mensaje del error.
 * - Éxito: toast con link al explorador (`EXPLORER_TX`) al minarse la tx y
 *   callback `onMined` (p. ej. refetch de las lecturas afectadas).
 *
 * Usado por: TasksSection (claim/deliver/approve/dispute/autoRelease/cancel),
 * OwnAgentCard (updatePrice/setActive), PaymentsSection (withdraw) y
 * DisputeCard (resolveStuckDispute).
 */

import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import type { Address } from 'viem';
import TxHash from '@/components/TxHash';
import { useWallet } from '@/hooks/useWallet';
import { activeChain } from '@/contracts/config';

export interface ContractActionRequest {
  address: Address;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  abi: any;
  functionName: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args?: readonly any[];
}

export interface ContractAction {
  /** Lanza la acción (con guarda de red incluida). */
  run: (req: ContractActionRequest) => Promise<void>;
  signing: boolean;
  confirming: boolean;
  mined: boolean;
  txHash: `0x${string}` | undefined;
  /** ocupado = firmando o confirmando */
  busy: boolean;
  reset: () => void;
}

export function useContractAction(opts?: { onMined?: () => void }): ContractAction {
  const { t } = useTranslation();
  const { connected, chainId } = useWallet();
  const { switchChainAsync } = useSwitchChain();

  const {
    writeContract,
    data: txHash,
    isPending: signing,
    reset: resetWrite,
  } = useWriteContract();
  const { isLoading: confirming, isSuccess: mined } = useWaitForTransactionReceipt({ hash: txHash });

  const onMinedRef = useRef(opts?.onMined);
  onMinedRef.current = opts?.onMined;
  const toasted = useRef<`0x${string}` | null>(null);

  useEffect(() => {
    if (mined && txHash && toasted.current !== txHash) {
      toasted.current = txHash;
      toast(t('dashReal.txConfirmed'), {
        description: <TxHash hash={txHash} className="text-[0.75rem]" />,
      });
      onMinedRef.current?.();
    }
  }, [mined, txHash, t]);

  const run = async (req: ContractActionRequest) => {
    if (connected && chainId !== activeChain.id) {
      try {
        await switchChainAsync({ chainId: activeChain.id });
      } catch {
        toast(t('wallet.wrongChainToast'), {
          description: t('wallet.wrongChainToastDesc', {
            network: `${activeChain.name} · ${activeChain.id}`,
          }),
        });
        return;
      }
    }
    writeContract(
      {
        address: req.address,
        abi: req.abi,
        functionName: req.functionName,
        args: req.args,
        chainId: activeChain.id,
      },
      {
        onError: (err) =>
          toast(t('dashReal.txFailed'), {
            description: err.message.includes('User rejected')
              ? t('hire.step3.rejected')
              : err.message.split('\n')[0],
          }),
      },
    );
  };

  const reset = () => {
    resetWrite();
    toasted.current = null;
  };

  return { run, signing, confirming, mined, txHash, busy: signing || confirming, reset };
}
