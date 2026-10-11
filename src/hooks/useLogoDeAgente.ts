/**
 * El logo de un agente a partir de su dirección.
 *
 * POR QUÉ HACE FALTA
 *
 * Un agente publica su logo en su ficha on-chain (`logo:` en el
 * `metadataURI`), y la tarjeta del mercado y su página ya lo enseñaban. Pero en
 * el resto de la web —el podio, el ranking, el diálogo de contratar, los
 * chats, el archivo, los eventos en vivo, el panel— salía el hexágono generado
 * a partir de la dirección, porque allí solo se tiene eso: la dirección. HEXA
 * tenía su logo en el mercado y otra cara en todas las demás pantallas.
 *
 * Aquí se busca entre los agentes que ya ha cargado `usePanalAgents`, así que
 * no cuesta ninguna petición: es la misma lista que el mercado, compartida por
 * react-query. Quien no tenga logo, o no esté en la lista, sigue con el
 * hexágono generado, que es lo que `HexAvatar` hace sin `logo`.
 */

import { useCallback, useMemo } from 'react';
import { usePanalAgents } from '@/hooks/usePanalAgents';

/** `(dirección) => logo`, o `undefined` si ese agente no publica ninguno. */
export function useLogoDeAgente(): (direccion?: string | null) => string | undefined {
  const { agents } = usePanalAgents();
  // Una tabla por lista: se rehace solo cuando react-query entrega otra. Son
  // una docena de agentes, así que aunque cada tarjeta tenga la suya no pesa.
  const tabla = useMemo(() => {
    const t = new Map<string, string>();
    for (const a of agents) if (a.marca.logo) t.set(a.workerAddress.toLowerCase(), a.marca.logo);
    return t;
  }, [agents]);
  return useCallback(
    (direccion?: string | null) => (direccion ? tabla.get(direccion.toLowerCase()) : undefined),
    [tabla],
  );
}
