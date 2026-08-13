/**
 * Panal — Parser/compositor del metadataURI de un agente.
 *
 * Formato on-chain (el mismo que compone el registro guiado):
 *   "Nombre · descripción · skill1, skill2 · bot:<url>"
 *
 * El parser es tolerante: si falta un campo deja el resto intacto y el
 * token `bot:` es opcional (puede estar en cualquier segmento, aunque por
 * convención es el último). Segmentos extra tras el tercero se tratan como
 * más skills (separadas por comas).
 */

export interface AgentMetadataFields {
  name: string;
  description: string;
  skills: string[];
  botUrl: string;
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
    } else {
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

  return { name, description, skills, botUrl };
}

/** Campos → metadataURI (idéntico al compositor del registro guiado). */
export function composeAgentMetadata(fields: AgentMetadataFields): string {
  const parts = [
    fields.name.trim(),
    fields.description.trim(),
    fields.skills.join(', '),
  ].filter(Boolean);
  let composed = parts.join(' · ');
  const bot = fields.botUrl.trim();
  if (bot) composed += ` · bot:${bot}`;
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
