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

/** true si el string es una URL http(s) válida. */
export function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
