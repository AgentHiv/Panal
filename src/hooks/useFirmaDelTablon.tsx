/**
 * Firmar en el tablón con reglas desde la web: la guarda de red, el gas fijado,
 * esperar el recibo, avisar y refrescar. Lo que firma está en
 * `lib/tablonReglas.ts`; esto es la parte que se ve.
 *
 * Una sola acción a la vez: `ocupado` dice cuál (una clave libre, p. ej.
 * `coger:7`), para que el botón que se pulsó gire y los demás esperen.
 *
 * Los errores salen por su nombre, traducidos: el contrato los da en custom
 * errors (`OverPerJobCap`, `NotAllowed("daily quota used")`…) y la estimación
 * del gas los saca antes de pedir la firma, así que lo normal es que un «no»
 * llegue sin haber gastado nada.
 */

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSwitchChain, useWriteContract } from 'wagmi';
import { toast } from 'sonner';
import type { Address, Hex } from 'viem';
import TxHash from '@/components/TxHash';
import { useWallet } from '@/hooks/useWallet';
import { useRefrescarTablon } from '@/hooks/useTablonReglas';
import { ensureActiveChain } from '@/lib/ensureChain';
import { claveDeMotivo, rechazoDe, TxRevertida, type Escribir } from '@/lib/tablonReglas';

export interface FirmaDelTablon {
  /**
   * Ejecuta `paso` con la wallet lista. Devuelve lo que devuelva, o `null` si
   * no se firmó (red, rechazo, error). Avisa en cada caso.
   */
  ejecutar: <T>(clave: string, paso: (escribir: Escribir, cuenta: Address) => Promise<T>) => Promise<T | null>;
  ocupado: string | null;
}

export function useFirmaDelTablon(): FirmaDelTablon {
  const { t } = useTranslation();
  const { address, connected, chainId } = useWallet();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const refrescar = useRefrescarTablon();
  const [ocupado, setOcupado] = useState<string | null>(null);

  /** El texto de un error, en el idioma de quien lo lee. */
  const explicar = useCallback(
    (err: unknown): string => {
      const rechazo = rechazoDe(err);
      if (rechazo) {
        if (rechazo.motivo) {
          return t(`tablon.motivo.${claveDeMotivo(rechazo.motivo)}`, { defaultValue: rechazo.motivo });
        }
        return t(`tablon.error.${rechazo.error}`, { defaultValue: rechazo.error });
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (/user (rejected|denied)/i.test(msg)) return t('hire.step3.rejected');
      return msg.split('\n')[0] ?? msg;
    },
    [t],
  );

  const ejecutar = useCallback(
    async <T,>(clave: string, paso: (escribir: Escribir, cuenta: Address) => Promise<T>): Promise<T | null> => {
      if (!address) return null;
      const enRed = await ensureActiveChain({ connected, chainId, switchChainAsync });
      if (!enRed) {
        toast(t('wallet.wrongChainToast'));
        return null;
      }
      setOcupado(clave);
      // Lo último que se firmó, para enseñarlo en el aviso.
      let ultimo: Hex | null = null;
      const escribir: Escribir = async (req) => {
        ultimo = await writeContractAsync(req as never);
        return ultimo;
      };
      try {
        const res = await paso(escribir, address as Address);
        if (ultimo) {
          toast(t('dashReal.txConfirmed'), { description: <TxHash hash={ultimo} className="text-[0.75rem]" /> });
        }
        return res;
      } catch (err) {
        if (err instanceof TxRevertida) {
          toast(t('dashReal.txReverted'), { description: <TxHash hash={err.hash} className="text-[0.75rem]" /> });
        } else {
          toast.error(t('tablon.noSePudo'), { description: explicar(err) });
        }
        return null;
      } finally {
        setOcupado(null);
        refrescar();
      }
    },
    [address, connected, chainId, switchChainAsync, writeContractAsync, refrescar, explicar, t],
  );

  return { ejecutar, ocupado };
}
