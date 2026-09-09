import { useQuery } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import type { Address } from 'viem';
import { PANAL_REGISTRY_V2_ADDRESS } from '@/contracts/config';
import { panalRegistryV2Abi } from '@/contracts/abis';
import { partirFicha } from '~/lib/ficha';
import { extractBotUrl } from '@/lib/botEndpoint';
import { leerCobroPorLlamada } from '@/lib/chat';
import type { CobroPorLlamada } from '@/lib/chat';
import { leerNivelesDeMetadata, type Nivel } from '@panal/sdk';

export interface DatosAgente {
  /** El endpoint que el agente tiene REGISTRADO en la cadena. */
  botUrl: string | null;
  /** Lo que cobra por mensaje, o null si solo acepta encargos. */
  cobro: CobroPorLlamada | null;
  precioTarea: bigint;
  moneda: Address;
  nombre: string;
  /**
   * Los niveles que publica EN LA CADENA. Vacío es lo normal.
   *
   * Se leen aquí y no de la tarjeta del bot porque son los únicos que siguen
   * estando con el bot caído: si mandara la tarjeta, un agente que no contesta
   * se quedaría sin niveles y se le encargaría el tamaño grande al precio del
   * pequeño. Los de la tarjeta siguen valiendo de respaldo.
   */
  niveles: Nivel[];
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

      /*
       * El nombre sale del MISMO lector que usa el resto de la app.
       *
       * Aquí se hacía `JSON.parse(metadataURI)`, y la ficha de Panal no es
       * JSON: es texto separado por `·`
       *
       *     Lint · Reviews source code… · code, review… · bot:https://… · nivel:1|…
       *
       * Así que el parse lanzaba SIEMPRE, el catch se lo tragaba y el nombre se
       * quedaba en la dirección abreviada. Se veía en la cabecera del chat, que
       * decía `0x1558…E69C` en vez de «Lint» — y no parecía un fallo, parecía
       * una decisión de diseño.
       *
       * `partirFicha` es el que ya lee `useFicha` en `lib/agentes.ts`. Tener dos
       * lectores del mismo formato era la causa de raíz: uno se quedó atrás y
       * nadie lo notó porque su fallo era silencioso.
       */
      const { nombre: nombreFicha } = partirFicha(ficha.metadataURI ?? '');
      const nombre = nombreFicha || `${direccion!.slice(0, 6)}…${direccion!.slice(-4)}`;

      return {
        botUrl,
        cobro,
        precioTarea: ficha.pricePerTask ?? 0n,
        moneda: (ficha.currency ?? '0x0000000000000000000000000000000000000000') as Address,
        nombre,
        niveles: leerNivelesDeMetadata(ficha.metadataURI),
      };
    },
  });
}
