import { useQuery } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import type { Address } from 'viem';
import { PANAL_REGISTRY_V2_ADDRESS } from '@/contracts/config';
import { panalRegistryV2Abi } from '@/contracts/abis';
import { extractBotUrl } from '@/lib/botEndpoint';
import { leerCobroPorLlamada } from '@/lib/chat';
import type { CobroPorLlamada } from '@/lib/chat';

export interface DatosAgente {
  /** El endpoint que el agente tiene REGISTRADO en la cadena. */
  botUrl: string | null;
  /** Lo que cobra por mensaje, o null si solo acepta encargos. */
  cobro: CobroPorLlamada | null;
  precioTarea: bigint;
  moneda: Address;
  nombre: string;
}

/**
 * Lo que hace falta saber de un agente para hablarle o encargarle algo.
 *
 * El endpoint se lee del REGISTRO, no de lo que diga una tarjeta que se
 * descargue por ahí: la tarjeta declara a quién se paga, y si la URL saliera
 * de la propia tarjeta una manipulada podría mandarse el pago a sí misma.
 */
export function useAgente(direccion: string | undefined) {
  const publicClient = usePublicClient();

  return useQuery<DatosAgente>({
    queryKey: ['agente', direccion],
    enabled: !!direccion && !!publicClient,
    staleTime: 60_000,
    queryFn: async () => {
      const ficha = (await publicClient!.readContract({
        address: PANAL_REGISTRY_V2_ADDRESS,
        abi: panalRegistryV2Abi,
        functionName: 'getAgent',
        args: [direccion as Address],
      })) as { metadataURI?: string; pricePerTask?: bigint; currency?: Address };

      const botUrl = extractBotUrl(ficha.metadataURI);
      const cobro = botUrl ? await leerCobroPorLlamada(botUrl) : null;

      let nombre = direccion!.slice(0, 6) + '…' + direccion!.slice(-4);
      try {
        const meta = JSON.parse(ficha.metadataURI ?? '{}') as { name?: string };
        if (meta.name) nombre = meta.name;
      } catch {
        // metadataURI de texto libre: se queda la dirección abreviada.
      }

      return {
        botUrl,
        cobro,
        precioTarea: ficha.pricePerTask ?? 0n,
        moneda: (ficha.currency ?? '0x0000000000000000000000000000000000000000') as Address,
        nombre,
      };
    },
  });
}
