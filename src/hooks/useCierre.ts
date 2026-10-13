/**
 * Si se le puede contratar a un agente AHORA, y si no, por qué.
 *
 * Antes solo se cerraba el botón a quien no publica dirección. Al que no
 * contestaba se le pintaba «No responde» en la tarjeta y el botón de contratar
 * seguía encendido al lado: el aviso de verdad salía al abrir el diálogo, cuando
 * ya se había decidido. Y al que su dueño tiene en pausa —que el escrow ni
 * siquiera deja contratar— también se le ofrecía.
 *
 * Dos fuentes, como en `reachability.ts`:
 *
 *   - En las LISTAS (mercado, podio, ranking) manda la última vuelta del
 *     indexador: ver el mercado no puede hacer que cada visitante llame a
 *     todos los agentes.
 *   - En la FICHA se le pregunta en directo, y eso manda sobre el indexador:
 *     un agente que vuelve no se queda cerrado las horas que tarde el
 *     indexador en volver a mirar. La pregunta se hace una vez por ficha
 *     aunque la pidan cuatro botones.
 */

import { useQuery } from '@tanstack/react-query';
import type { Agent } from '@/data/agents';
import { canalDe, isOnchainAgent } from '@/hooks/usePanalAgents';
import { respondeElAgente } from '@/lib/reachability';

/** Por qué no se puede contratar. */
export type Cierre = 'sin-canal' | 'pausado' | 'no-responde';

/**
 * El motivo, con lo que se sepa. `responde` es la pregunta en directo: `null`
 * mientras no hay respuesta, y entonces vale lo que dijo el indexador. Las
 * listas lo llaman sin ella.
 */
export function cierreDe(agent: Agent, responde: boolean | null = null): Cierre | null {
  if (canalDe(agent) === 'ninguno') return 'sin-canal';
  // En pausa en la cadena: el escrow rechaza el encargo.
  if (agent.status === 'desconectado') return 'pausado';
  if (responde === true) return null;
  if (responde === false || agent.status === 'no-responde') return 'no-responde';
  return null;
}

/** Para la ficha: preguntándole al agente si contesta. */
export function useCierre(agent: Agent | undefined): Cierre | null {
  const botUrl = agent && isOnchainAgent(agent) ? agent.botUrl : null;
  const { data: responde = null } = useQuery({
    queryKey: ['responde', botUrl],
    queryFn: () => respondeElAgente(botUrl!),
    enabled: !!botUrl,
    staleTime: 60_000,
    // Una pregunta fallida YA es la respuesta («no contesta»), no un error.
    retry: false,
  });
  return agent ? cierreDe(agent, responde) : null;
}

/** La clave del texto que explica el cierre, en la ficha y en el título del botón. */
export const TEXTO_CIERRE: Record<Cierre, string> = {
  'sin-canal': 'detail.sinCanal',
  pausado: 'detail.pausado',
  'no-responde': 'detail.noResponde',
};
