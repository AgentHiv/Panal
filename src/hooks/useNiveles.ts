/**
 * Lo que un agente vende DE VERDAD, leído de su tarjeta.
 *
 * Existe porque la pestaña de servicios se los inventaba: multiplicaba el
 * precio base por 1,5 y por 9, pintaba tres tarjetas y las tres contrataban lo
 * mismo al precio base. El cliente veía un precio que no se le iba a cobrar y
 * un servicio que no existía.
 *
 * Aquí no se calcula ningún precio. Lo que no venga del agente no se enseña, y
 * un agente que no declare niveles sale con lo único que tiene: su precio por
 * encargo, y su precio por mensaje si además cobra por llamada.
 *
 * EL PRECIO DE LA CADENA, EL TEXTO DE LA FICHA. Son dos cosas con dueños
 * distintos: el importe es lo que se bloquea y tiene que salir de donde nadie
 * pueda cambiarlo —y donde siga estando con el bot caído—, mientras que el
 * nombre es una etiqueta y la ficha es el único sitio donde puede estar
 * traducida. El porqué entero está en `conTextoDeLaFicha`.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { conTextoDeLaFicha, leerNivelesDeMetadata, type Nivel } from '@panal/sdk';
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
  const { i18n } = useTranslation();
  const idioma = i18n.language;
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
        const enCadena = leerNivelesDeMetadata(meta.metadataURI);
        const botUrl = extractBotUrl(meta.metadataURI);
        if (!botUrl) {
          // Sin endpoint no hay tarjeta, pero los de la cadena están: no hacen
          // falta ni un servidor ni una respuesta para leerlos.
          if (vigente) setLeido({ de, datos: { ...NADA, niveles: enCadena } });
          return;
        }
        // Las dos leen la misma tarjeta y las dos fallan cerrado. Van juntas
        // para que la pestaña no se pinte dos veces con medio contenido.
        const [caps, cobro] = await Promise.all([
          // En el idioma de quien mira: los niveles se llaman «Un archivo» o
          // «El repositorio», y en árabe eso no lo lee nadie.
          leerCapacidades(botUrl, 6_000, idioma),
          leerCobroPorLlamada(botUrl),
        ]);
        // El precio de la cadena con el texto de la ficha: ver
        // `conTextoDeLaFicha`. Sin esto el escaparate sale en francés y los
        // tres niveles de cada agente en español, porque la cadena guarda una
        // sola versión y la traducción solo puede vivir en la ficha.
        const niveles =
          enCadena.length > 0 ? conTextoDeLaFicha(enCadena, caps.niveles) : caps.niveles;
        if (vigente) setLeido({ de, datos: { niveles, cobro, cargando: false } });
      } catch {
        // Falla cerrado: no se anuncia nada que no esté ya en la cadena. Y lo
        // que SÍ está en la cadena no se pierde por esto, pero aquí ya no se
        // puede saber —la lectura que falló era justo esa—, así que nada.
        if (vigente) setLeido({ de, datos: NADA });
      }
    })();

    return () => {
      vigente = false;
    };
  }, [de, idioma]);

  // Se DERIVA en vez de resetearse desde el efecto: poner el estado a cero al
  // cambiar de agente provoca un render de más y, peor, una ventana en la que
  // se enseñan los niveles del agente anterior.
  if (!de) return NADA;
  return leido?.de === de ? leido.datos : { ...NADA, cargando: true };
}
