import { formatUnits } from 'viem';
import { useAccount, useBalance, useReadContract } from 'wagmi';
import { activeChain, PANAL_TOKEN_ADDRESS } from '@/contracts/config';
import { panalTokenAbi } from '@/contracts/abis';

/**
 * Las dos monedas, que no son intercambiables y hacen cosas distintas.
 *
 *   - $PANAL paga los mensajes por x402, y para eso NO hace falta gas: en x402
 *     firma el cliente y manda la transacción quien cobra (sdk/src/x402.ts:16).
 *     Con $PANAL y cero MON se puede hablar.
 *   - MON paga los encargos con escrow y el gas de bloquearlos.
 *
 * Por eso la pantalla enseña las dos por separado en vez de un total: sumarlas
 * daría un número que no sirve para decidir nada.
 */
export type Saldos = {
  panal: { valor: bigint; texto: string } | null;
  mon: { valor: bigint; texto: string } | null;
  cargando: boolean;
};

/** Los decimales se LEEN, no se dan por hechos: 18 es lo normal, no lo seguro. */
export function useSaldos(): Saldos {
  const { address } = useAccount();
  const activo = !!address;

  const mon = useBalance({ address, chainId: activeChain.id, query: { enabled: activo } });

  const decimales = useReadContract({
    address: PANAL_TOKEN_ADDRESS,
    abi: panalTokenAbi,
    functionName: 'decimals',
    chainId: activeChain.id,
  });

  const panal = useReadContract({
    address: PANAL_TOKEN_ADDRESS,
    abi: panalTokenAbi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: activeChain.id,
    query: { enabled: activo },
  });

  const dec = decimales.data ?? 18;

  return {
    panal:
      panal.data === undefined
        ? null
        : { valor: panal.data, texto: conDecimales(panal.data, dec) },
    mon: mon.data === undefined ? null : { valor: mon.data.value, texto: conDecimales(mon.data.value, 18) },
    cargando: activo && (panal.isLoading || mon.isLoading),
  };
}

/**
 * Un saldo se lee de un vistazo o no se lee.
 *
 * Dos decimales para las cantidades normales; cuatro solo cuando con dos
 * saldría «0,00» teniendo algo, que es peor que un número largo: parece que no
 * tienes nada.
 */
export function conDecimales(bruto: bigint, decimales: number): string {
  const n = Number(formatUnits(bruto, decimales));
  if (n === 0) return '0';
  const d = n < 0.01 ? 4 : 2;
  return n.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });
}
