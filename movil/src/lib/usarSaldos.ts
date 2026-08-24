import { useQuery } from '@tanstack/react-query';
import { useAccount, useBalance, useReadContract } from 'wagmi';
import { activeChain, PANAL_TOKEN_ADDRESS, publicClient } from '@/contracts/config';
import { panalTokenAbi } from '@/contracts/abis';
import { conDecimales } from '~/lib/formato';

// Se reexporta porque media app la importaba de aquí, y porque este sigue
// siendo el sitio donde uno la busca: es la que da formato a estos saldos.
export { conDecimales };

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

/* ── las wallets del llavero ─────────────────────────────────────────────── */

/** Las dos monedas de una dirección, en crudo. */
export interface Par {
  mon: bigint;
  panal: bigint;
}

export interface SaldosLlavero {
  /** Indexado por dirección en minúsculas. Vacío mientras carga. */
  por: Record<string, Par>;
  cargando: boolean;
  /** Si la red no ha contestado. El saldo NO es cero: es que no se sabe. */
  fallo: boolean;
  refrescar: () => void;
}

/**
 * El saldo de varias direcciones a la vez, sin que ninguna esté conectada.
 *
 * `useSaldos` no servía para esto y no era un descuido suyo: lee de
 * `useAccount()`, o sea de la wallet conectada por WalletConnect, y una wallet
 * del llavero no está conectada a nada. Por eso el llavero decía «esta wallet
 * está vacía hasta que le mandes algo» — no lo sabía, y lo daba por hecho.
 *
 * Va por `publicClient` y no por hooks de wagmi por una razón tonta y firme:
 * los hooks no se pueden llamar dentro de un bucle, y aquí el número de
 * wallets lo decide quien las crea. Una consulta que las recorre todas cabe en
 * un `useQuery` y se refresca sola.
 *
 * Se refresca cada 30 s. Es dinero, y una cantidad vieja en pantalla es la
 * clase de mentira que hace que alguien mande dos veces lo mismo.
 */
export function useSaldosLlavero(direcciones: string[]): SaldosLlavero {
  // Ordenada para que el mismo juego de wallets no reconsulte al reordenarse.
  const clave = direcciones.map((d) => d.toLowerCase()).sort().join(',');

  const consulta = useQuery({
    queryKey: ['saldos-llavero', clave, activeChain.id],
    enabled: direcciones.length > 0,
    refetchInterval: 30_000,
    queryFn: async (): Promise<Record<string, Par>> => {
      const filas = await Promise.all(
        clave.split(',').map(async (d) => {
          const dir = d as `0x${string}`;
          const [mon, panal] = await Promise.all([
            publicClient.getBalance({ address: dir }),
            publicClient.readContract({
              address: PANAL_TOKEN_ADDRESS,
              abi: panalTokenAbi,
              functionName: 'balanceOf',
              args: [dir],
            }),
          ]);
          return [d, { mon, panal }] as const;
        }),
      );
      return Object.fromEntries(filas);
    },
  });

  return {
    por: consulta.data ?? {},
    cargando: consulta.isLoading,
    fallo: consulta.isError,
    refrescar: () => void consulta.refetch(),
  };
}
