/**
 * Lo que un agente vende DE VERDAD, leído de su tarjeta.
 *
 * Existe porque la pestaña de servicios se los inventaba: multiplicaba el
 * precio base por 1,5 y por 9, pintaba tres tarjetas y las tres contrataban lo
 * mismo al precio base. El cliente veía un precio que no se le iba a cobrar y
 * un servicio que no existía.
 *
 * Aquí no se calcula ningún precio. Lo que no venga en la tarjeta del agente
 * no se enseña, y un agente que no declare niveles sale con lo único que tiene:
 * su precio por encargo, y su precio por mensaje si además cobra por llamada.
 */

import { useEffect, useState } from 'react';
import type { Nivel } from '@panal/sdk';
import { PANAL_REGISTRY_V2_ADDRESS, publicClient } from '@/contracts/config';
import { panalRegistryV2Abi } from '@/contracts/abis';
import { extractBotUrl, leerCapacidades } from '@/lib/botEndpoint';
import { leerCobroPorLlamada, type CobroPorLlamada } from '@/lib/chat';
import { isOnchainAgent } from '@/hooks/usePanalAgents';
import type { Agent } from '@/data/agents';

export interface ServiciosDelAgente {
  /** Los niveles que declara. Vacío es lo normal: casi ningún agente los vende. */
  niveles: Nivel[];
  /** Su cobro por mensaje, si lo tiene. */
  cobro: CobroPorLlamada | null;
  cargando: boolean;
}

const NADA: ServiciosDelAgente = { niveles: [], cobro: null, cargando: false };

/** Lo leído, junto a DE QUIÉN es. Sin el dueño no se puede saber si está viejo. */
interface Leido {
  de: string;
  datos: ServiciosDelAgente;
}

export function useNiveles(agent: Agent | null): ServiciosDelAgente {
  const [leido, setLeido] = useState<Leido | null>(null);

  // La dirección y no el objeto: `agent` se vuelve a crear en cada render de
  // la lista y el efecto se dispararía sin que haya cambiado de agente.
  const de = agent && isOnchainAgent(agent) ? agent.workerAddress : null;

  useEffect(() => {
    if (!de) return;
    let vigente = true;

    void (async () => {
      try {
        // El endpoint sale del REGISTRO, nunca de la propia tarjeta: si saliera
        // de ahí, una tarjeta manipulada podría anunciar los niveles de otro.
        const meta = (await publicClient.readContract({
          address: PANAL_REGISTRY_V2_ADDRESS,
          abi: panalRegistryV2Abi,
          functionName: 'getAgent',
          args: [de as `0x${string}`],
        })) as { metadataURI?: string };
        const botUrl = extractBotUrl(meta.metadataURI);
        if (!botUrl) {
          if (vigente) setLeido({ de, datos: NADA });
          return;
        }
        // Las dos leen la misma tarjeta y las dos fallan cerrado. Van juntas
        // para que la pestaña no se pinte dos veces con medio contenido.
        const [caps, cobro] = await Promise.all([
          leerCapacidades(botUrl),
          leerCobroPorLlamada(botUrl),
        ]);
        if (vigente) setLeido({ de, datos: { niveles: caps.niveles, cobro, cargando: false } });
      } catch {
        // Falla cerrado: sin tarjeta no se anuncia nada que no esté ya en la
        // cadena.
        if (vigente) setLeido({ de, datos: NADA });
      }
    })();

    return () => {
      vigente = false;
    };
  }, [de]);

  // Se DERIVA en vez de resetearse desde el efecto: poner el estado a cero al
  // cambiar de agente provoca un render de más y, peor, una ventana en la que
  // se enseñan los niveles del agente anterior.
  if (!de) return NADA;
  return leido?.de === de ? leido.datos : { ...NADA, cargando: true };
}
