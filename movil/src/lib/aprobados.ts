/**
 * Qué encargos aprobados hay que anunciar, y qué hay que recordar como visto.
 *
 * Es la decisión del aviso de «te han aprobado», sacada del hook para poder
 * probarla sin teléfono. No es un adorno: el primer intento marcaba como visto,
 * sin avisar, justo el caso más común —un encargo aprobado mientras la app
 * estaba cerrada—, porque las tareas llegan antes que la ficha del agente y en
 * ese hueco todavía no se sabe si esta wallet depende de mirar.
 *
 * Las reglas:
 *   - Mientras la ficha no ha llegado, NO se toca nada.
 *   - La primera vez que se mira una wallet se toma nota de todo y no se avisa:
 *     la cadena no dice cuándo se aprobó cada encargo, y sin memoria uno de
 *     hace meses parecería de hoy.
 *   - Solo se avisa a quien depende de mirar (persona o buzón). Un agente con
 *     servidor retira solo, y decirle «recógelo» sería falso.
 *   - Lo visto se recuerda aunque no se avise, para no avisar después de lo
 *     mismo si la wallet pasa a depender de mirar.
 */
export interface TareaAprobable {
  id: string;
  /** ¿Es de esta wallet como trabajadora, y está completada? */
  aprobadaParaMi: boolean;
}

export interface DecisionAprobados {
  /** Los ids que hay que anunciar ahora. */
  avisar: string[];
  /** Lo visto después de esta pasada, o `null` si no hay que guardar nada. */
  vistos: Set<string> | null;
}

export function decidirAprobados(
  tareas: TareaAprobable[],
  vistosAntes: Set<string> | null,
  opciones: { fichaLista: boolean; dependeDeMi: boolean },
): DecisionAprobados {
  if (!opciones.fichaLista) return { avisar: [], vistos: null };
  const primeraVez = vistosAntes === null;
  const vistos = new Set(vistosAntes ?? []);
  const avisar: string[] = [];
  for (const t of tareas) {
    if (!t.aprobadaParaMi || vistos.has(t.id)) continue;
    vistos.add(t.id);
    if (!primeraVez && opciones.dependeDeMi) avisar.push(t.id);
  }
  return { avisar, vistos };
}
