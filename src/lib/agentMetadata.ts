/**
 * Panal — Parser/compositor del metadataURI de un agente.
 *
 * Formato on-chain (el mismo que compone el registro guiado):
 *   "Nombre · descripción · skill1, skill2 · bot:<url> · logo:<url> · github:<usuario>"
 *
 * El parser es tolerante: si falta un campo deja el resto intacto y el
 * token `bot:` es opcional (puede estar en cualquier segmento, aunque por
 * convención es el último). Segmentos extra tras el tercero se tratan como
 * más skills (separadas por comas).
 *
 * Los tokens de MARCA —el logo y los enlaces del creador— se apartan igual que
 * `bot:`, y apartarlos es justo lo que hace falta: sin eso, un agente que se
 * pusiera logo vería su `logo:https://…` salir como una skill más en su propia
 * tarjeta. El formato y qué valores valen están en `marca.ts`.
 */

import { esTokenDeMarca, leerMarca, tokensDeMarca, type Marca } from './marca';

export interface AgentMetadataFields {
  name: string;
  description: string;
  skills: string[];
  botUrl: string;
  /** Logo y enlaces del creador. Todo opcional: vacío es lo normal. */
  marca: Marca;
}

/** metadataURI → campos editables (nombre, descripción, skills, botUrl). */
export function parseAgentMetadata(metadataURI: string): AgentMetadataFields {
  const segments = metadataURI
    .split('·')
    .map((s) => s.trim())
    .filter(Boolean);

  let botUrl = '';
  const rest: string[] = [];
  for (const seg of segments) {
    const m = /^bot:\s*(\S.*)$/i.exec(seg);
    if (m && !botUrl) {
      botUrl = m[1].trim();
    } else if (!esTokenDeMarca(seg)) {
      rest.push(seg);
    }
  }

  const [name = '', description = ''] = rest;
  const skills = rest
    .slice(2)
    .join(', ')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return { name, description, skills, botUrl, marca: leerMarca(metadataURI) };
}

/** Campos → metadataURI (idéntico al compositor del registro guiado). */
export function composeAgentMetadata(fields: Omit<AgentMetadataFields, 'marca'> & { marca?: Partial<Marca> }): string {
  const parts = [
    fields.name.trim(),
    fields.description.trim(),
    fields.skills.join(', '),
  ].filter(Boolean);
  let composed = parts.join(' · ');
  const bot = fields.botUrl.trim();
  if (bot) composed += ` · bot:${bot}`;
  // La marca va después del bot: primero lo que el protocolo necesita, luego
  // lo que el creador quiere enseñar. Los vacíos no escriben nada, así que un
  // agente sin logo compone exactamente la misma ficha que antes.
  for (const token of tokensDeMarca(fields.marca ?? {})) composed += ` · ${token}`;
  return composed;
}

/**
 * true si es una URL **https** válida. `http://` no vale, y no es tiquismiquis:
 *
 *   - Por ahí viaja el encargo del cliente con su firma. En claro lo lee
 *     cualquier intermediario.
 *   - El navegador lo bloquea igual: panal.lat es https, y pedirle algo a un
 *     http es contenido mixto. El agente nace roto sin decir por qué.
 *   - El indexador exige https para comprobar el dominio, así que un agente
 *     http se quedaría PARA SIEMPRE con el aviso de «sin verificar».
 *
 * El registro por línea de comandos ya lo exigía; los formularios de la web
 * eran el único sitio por el que se podía crear un agente así.
 */
export function isHttpsUrl(s: string): boolean {
  try {
    return new URL(s).protocol === 'https:';
  } catch {
    return false;
  }
}
