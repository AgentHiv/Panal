/**
 * Firmar en el tablón con reglas desde la app.
 *
 * El camino es el de la web (`firmarYEsperar` de `src/lib/tablonReglas.ts`:
 * gas estimado y fijado, y el «no» del contrato antes de pedir la firma); lo
 * que cambia es cómo se cuenta. La app no tiene avisos flotantes: el resultado
 * se queda en `resultado` y la pantalla lo pinta donde toca.
 *
 * Lo que pone dinero a favor de alguien (publicar, elegir) pasa antes por una
 * hoja que lo arma en `signingPolicy.ts`; sin eso, la wallet del teléfono no
 * lo firma.
 */

import { useCallback, useState } from 'react';
import { useSwitchChain, useWriteContract } from 'wagmi';
import type { Address, Hex } from 'viem';
import { useWallet } from '@/hooks/useWallet';
import { useRefrescarTablon } from '@/hooks/useTablonReglas';
import { ensureActiveChain } from '@/lib/ensureChain';
import { claveDeMotivo, rechazoDe, TxRevertida, type Escribir } from '@/lib/tablonReglas';
import { FirmaBloqueada } from '~/lib/signingPolicy';
import { useTextos } from '~/i18n/idiomas';
import type { Textos } from '~/i18n/idiomas';

export interface Resultado {
  bien: boolean;
  texto: string;
  /** La última transacción, si la hubo. */
  hash?: Hex;
}

/** El texto de un error, en el idioma de la app. */
export function explicarFallo(err: unknown, T: Textos): string {
  if (err instanceof FirmaBloqueada) return err.message;
  if (err instanceof TxRevertida) return T.pegas.rechazada;
  const rechazo = rechazoDe(err);
  if (rechazo) {
    const motivos = T.tablon.motivo as Record<string, string>;
    const errores = T.tablon.error as Record<string, string>;
    if (rechazo.motivo) return motivos[claveDeMotivo(rechazo.motivo)] ?? rechazo.motivo;
    return errores[rechazo.error] ?? rechazo.error;
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/user (rejected|denied)/i.test(msg)) return T.pegas.cancelado;
  if (/insufficient funds/i.test(msg)) return T.pegas.sinSaldo;
  return msg.split('\n')[0] ?? msg;
}

export function useFirmaTablon() {
  const T = useTextos();
  const { address, connected, chainId } = useWallet();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const refrescar = useRefrescarTablon();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  const ejecutar = useCallback(
    async <R,>(clave: string, paso: (escribir: Escribir, cuenta: Address) => Promise<R>): Promise<R | null> => {
      if (!address) return null;
      setResultado(null);
      if (!(await ensureActiveChain({ connected, chainId, switchChainAsync }))) {
        setResultado({ bien: false, texto: T.tablon.noSePudo });
        return null;
      }
      setOcupado(clave);
      let ultimo: Hex | undefined;
      const escribir: Escribir = async (req) => {
        ultimo = await writeContractAsync(req as never);
        return ultimo;
      };
      try {
        const r = await paso(escribir, address as Address);
        setResultado({ bien: true, texto: T.tablon.hecho, hash: ultimo });
        return r;
      } catch (err) {
        setResultado({ bien: false, texto: explicarFallo(err, T), hash: err instanceof TxRevertida ? err.hash : undefined });
        return null;
      } finally {
        setOcupado(null);
        refrescar();
      }
    },
    [address, connected, chainId, switchChainAsync, writeContractAsync, refrescar, T],
  );

  return { ejecutar, ocupado, resultado, limpiar: () => setResultado(null) };
}
