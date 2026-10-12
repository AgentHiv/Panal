/**
 * Los precios de MON y $PANAL en dólares, en vivo.
 *
 * Se leen con el SDK (`leerPrecios`): MON de Pyth y $PANAL de la curva de
 * nad.fun, los dos en la cadena con el mismo RPC que el resto de la web. Ver
 * sdk/src/precios.ts y contracts/BOARD.md §11.
 *
 * CADA 30 SEGUNDOS, Y SOLO CON LA PESTAÑA A LA VISTA. react-query no refresca
 * en segundo plano por defecto, que es justo lo que se quiere: una pestaña
 * olvidada no gasta llamadas del RPC público. Al volver, se refresca al
 * momento.
 *
 * Una sola consulta para toda la página: todas las cantidades comparten la
 * misma clave, así que veinte tarjetas no hacen veinte lecturas.
 */

import { useQuery } from '@tanstack/react-query';
import { leerPrecios, type Precios } from '@panal/sdk';
import { IS_MAINNET, PANAL_TOKEN_ADDRESS, publicClient } from '@/contracts/config';

export function usePrecios(): Precios | null {
  const { data } = useQuery({
    queryKey: ['panal', 'precios'],
    queryFn: () => leerPrecios(publicClient, { panalToken: PANAL_TOKEN_ADDRESS }),
    // En testnet no hay precios que valgan.
    enabled: IS_MAINNET,
    refetchInterval: 30_000,
    staleTime: 20_000,
  });
  return data ?? null;
}
