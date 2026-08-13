/**
 * Panal — La hora actual, en segundos, que se refresca sola.
 *
 * Varias pantallas comparan `Date.now()` con un plazo de la cadena para decidir
 * qué enseñar: si una tarea ya venció, cuánto queda para poder liberar el pago,
 * si una disputa se puede resolver. Eso se hacía calculando `Date.now()` en el
 * cuerpo del render, y tiene dos problemas, uno feo y otro peor:
 *
 *   - El feo: React puede renderizar dos veces o descartar un render a medias,
 *     y entonces dos partes de la misma pantalla se calculan con relojes
 *     distintos.
 *   - El peor: el valor se congela. Un plazo que vence mientras alguien mira la
 *     página sigue diciendo "quedan 2 minutos" para siempre, porque nada vuelve
 *     a renderizar. La cuenta atrás no cuenta.
 *
 * Con esto el componente se entera de que pasa el tiempo, que es justo lo que
 * necesitaba para lo que estaba haciendo.
 */

import { useEffect, useState } from 'react';

/**
 * @param cadaMs Cada cuánto se refresca. 30 s por defecto: los plazos de Panal
 *               se miden en horas y días, así que afinar más solo cuesta
 *               renders. Baja a 1000 si enseñas segundos.
 */
export function useAhora(cadaMs = 30_000): number {
  const [ahora, setAhora] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const id = setInterval(() => setAhora(Math.floor(Date.now() / 1000)), cadaMs);
    return () => clearInterval(id);
  }, [cadaMs]);

  return ahora;
}
