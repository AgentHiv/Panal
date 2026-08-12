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
 *   callback `onMined` (p. ej. refetch de las lecturas afectadas). "Minarse"
 *   aquí quiere decir ejecutarse bien: una tx revertida se mina igual y saca
 *   el toast de `dashReal.txReverted` sin llamar a `onMined` (ver useTxReceipt).
 *
 * Usado por: TasksSection (claim/deliver/approve/dispute/autoRelease/cancel),
 * OwnAgentCard (updatePrice/setActive), PaymentsSection (withdraw) y
 * DisputeCard (resolveStuckDispute).
 */

import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useSwitchChain, useWriteContract } from 'wagmi';
import type { Address } from 'viem';
import TxHash from '@/components/TxHash';
import { useTxReceipt } from '@/hooks/useTxReceipt';
import { useWallet } from '@/hooks/useWallet';
import { ensureActiveChain } from '@/lib/ensureChain';
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
  /** Minada Y ejecutada bien (ver useTxReceipt: una tx revertida también se mina). */
  mined: boolean;
  /** Minada pero revertida: gastó gas y no cambió nada. */
  reverted: boolean;
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
  const { confirming, mined, reverted } = useTxReceipt(txHash);

  const onMinedRef = useRef(opts?.onMined);
  // La asignación va en un efecto, no en el cuerpo del render: escribir en una
  // ref mientras se renderiza es de las cosas que React se reserva el derecho
  // de romper cuando renderiza dos veces o descarta un render a medias. Aquí
  // da igual el momento —la ref solo se lee dentro de otro efecto, que corre
  // después—, así que no cambia nada y deja de ser una promesa que no toca.
  useEffect(() => {
    onMinedRef.current = opts?.onMined;
  });
  const toasted = useRef<`0x${string}` | null>(null);

  useEffect(() => {
    if (!txHash || toasted.current === txHash) return;
    // Una tx revertida se mina igual: hay que decirlo, y NO llamar a onMined.
    // Llamarlo tampoco rompería nada aquí (suele ser un refetch, y la cadena
    // devolvería el estado sin tocar), pero avisar de un cambio que no ocurrió
    // es justo lo que hacía que esto pasara desapercibido.
    if (reverted) {
      toasted.current = txHash;
      toast(t('dashReal.txReverted'), {
        description: <TxHash hash={txHash} className="text-[0.75rem]" />,
      });
      return;
    }
    if (mined) {
      toasted.current = txHash;
      toast(t('dashReal.txConfirmed'), {
        description: <TxHash hash={txHash} className="text-[0.75rem]" />,
      });
      onMinedRef.current?.();
    }
  }, [mined, reverted, txHash, t]);

  const run = async (req: ContractActionRequest) => {
    // Guarda de red contra la chain REAL de la wallet (eth_chainId), con
    // re-verificación tras el cambio: el estado de wagmi puede ir por delante
    // de la wallet y la tx fallaría con el error crudo de viem.
    const chainOk = await ensureActiveChain({ connected, chainId, switchChainAsync });
    if (!chainOk) {
      toast(t('wallet.wrongChainToast'), {
        description: t('wallet.wrongChainToastDesc', {
          network: `${activeChain.name} · ${activeChain.id}`,
        }),
      });
      return;
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
              : err.message.includes('cannot cancel yet')
                ? t('dashReal.errCancelYet')
                : err.message.includes('not client')
                  ? t('dashReal.errNotClient')
                  : err.message.split('\n')[0],
          }),
      },
    );
  };

  const reset = () => {
    resetWrite();
    toasted.current = null;
  };

  return { run, signing, confirming, mined, reverted, txHash, busy: signing || confirming, reset };
}
