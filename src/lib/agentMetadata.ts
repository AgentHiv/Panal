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
 *
 * Los NIVELES se apartan por lo mismo y el formato lo manda `niveles.ts` del
 * SDK. Un agente con tres niveles tiene tres segmentos más, y sin apartarlos
 * los tres saldrían escritos como skills suyas en su propia tarjeta.
 */

import {
  componerNivel,
  esTokenDeNivel,
  leerNivelesDeMetadata,
  precioAWei,
  weiAPrecio,
  type Nivel,
} from '@panal/sdk';
import { bytesDeLogo, esTokenDeMarca, leerMarca, tokensDeMarca, type Marca } from './marca';

export interface AgentMetadataFields {
  name: string;
  description: string;
  skills: string[];
  botUrl: string;
  /** Logo y enlaces del creador. Todo opcional: vacío es lo normal. */
  marca: Marca;
  /**
   * Lo que cobra por cada tamaño de encargo, de menor a mayor.
   *
   * Vacío es lo normal y NO significa «tiene un nivel»: significa que este
   * agente cobra un precio y ya, el del registro. Quien lea esto no debe
   * fabricarle un nivel a partir de él.
   */
  niveles: Nivel[];
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
    } else if (!esTokenDeMarca(seg) && !esTokenDeNivel(seg)) {
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

  return {
    name,
    description,
    skills,
    botUrl,
    marca: leerMarca(metadataURI),
    niveles: leerNivelesDeMetadata(metadataURI),
  };
}

/** Campos → metadataURI (idéntico al compositor del registro guiado). */
export function composeAgentMetadata(
  fields: Omit<AgentMetadataFields, 'marca' | 'niveles'> & {
    marca?: Partial<Marca>;
    niveles?: Nivel[];
  },
): string {
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
  // Y los niveles al final del todo, porque son los segmentos más largos y
  // porque un lector antiguo que no los conozca los verá como skills raras al
  // final en vez de perder la descripción, que es el daño reversible.
  // `componerNivel` devuelve null en lo que no se puede escribir sin mentir;
  // el formulario ya lo impide antes, esto es la última red.
  for (const nivel of fields.niveles ?? []) {
    const token = componerNivel({
      name: nivel.name ?? '',
      description: nivel.description,
      precio: weiAPrecio(nivel.wei),
      maxBriefChars: nivel.maxBriefChars,
      maxAttachChars: nivel.maxAttachChars,
      maxAttachCharsTotal: nivel.maxAttachCharsTotal,
    });
    if (token) composed += ` · ${token}`;
  }
  return composed;
}

/**
 * La ficha tal y como se enseña en el preview del formulario.
 *
 * Es la misma cadena, con una excepción: un logo incrustado son miles de
 * caracteres de base64, y volcarlos en el recuadro convertiría el preview
 * —cuyo trabajo es dejar VER lo que se va a firmar— en un muro ilegible que
 * esconde justo lo que importa, el nombre y las skills. Se resume por su peso,
 * que además es el dato del que depende el gas.
 *
 * Solo para mirar: lo que se firma es siempre `composeAgentMetadata`.
 */
export function resumirFicha(metadataURI: string): string {
  return metadataURI.replace(/logo:data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/g, (token) => {
    const kb = Math.round(bytesDeLogo(token.slice('logo:'.length)) / 102.4) / 10;
    return kb > 0 ? `logo:<imagen ${kb} KB>` : token;
  });
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

/* ── niveles, en la forma que necesita un formulario ─────────────────────── */

/**
 * Un nivel mientras se teclea.
 *
 * El precio es TEXTO y no un bigint a propósito: alguien escribiendo «0.» pasa
 * por un estado que no es un número, y convertirlo en cada tecla le borraría
 * el punto mientras escribe.
 *
 * Los tres topes no se editan aquí —serían dieciocho campos en pantalla para
 * algo que casi nadie toca— pero se arrastran: un agente que los declaró desde
 * su código no puede perderlos porque su dueño corrigiera una tilde en la web.
 */
export interface NivelEditable {
  name: string;
  description: string;
  precio: string;
  maxBriefChars: number | null;
  maxAttachChars: number | null;
  maxAttachCharsTotal: number | null;
}

export const NIVEL_VACIO: NivelEditable = {
  name: '',
  description: '',
  precio: '',
  maxBriefChars: null,
  maxAttachChars: null,
  maxAttachCharsTotal: null,
};

/** Lo leído de la cadena → lo que se edita. */
export function aNivelEditable(n: Nivel): NivelEditable {
  return {
    name: n.name ?? '',
    description: n.description ?? '',
    precio: weiAPrecio(n.wei),
    maxBriefChars: n.maxBriefChars,
    maxAttachChars: n.maxAttachChars,
    maxAttachCharsTotal: n.maxAttachCharsTotal,
  };
}

/**
 * Lo que se edita → lo que se escribe, o `null` si esta fila no es un nivel.
 *
 * Una fila vacía devuelve `null` y eso es lo normal: el formulario enseña tres
 * y casi nadie va a rellenar las tres.
 */
export function aNivel(e: NivelEditable): Nivel | null {
  const precio = e.precio.replace(',', '.').trim();
  const wei = precioAWei(precio);
  const name = e.name.replace(/\s+/g, ' ').trim();
  if (wei === null || !name) return null;
  return {
    name,
    description: e.description.replace(/\s+/g, ' ').trim() || null,
    wei,
    maxBriefChars: e.maxBriefChars,
    maxAttachChars: e.maxAttachChars,
    maxAttachCharsTotal: e.maxAttachCharsTotal,
  };
}

/**
 * Qué le pasa a esta fila, para poder decírselo a quien la escribe.
 *
 * `null` es que está bien o que está vacía. Una fila a medias —nombre sin
 * precio, precio sin nombre— es el fallo que hay que cantar: se firmaría una
 * ficha en la que ese nivel sencillamente no está, y su dueño creería que sí.
 */
export function falloDeNivel(e: NivelEditable): 'incompleto' | 'precio' | 'separador' | null {
  const precio = e.precio.replace(',', '.').trim();
  const name = e.name.trim();
  if (!precio && !name && !e.description.trim()) return null;
  if (!precio || !name) return 'incompleto';
  if (precioAWei(precio) === null) return 'precio';
  if (/[·|]/.test(name) || /[·|]/.test(e.description)) return 'separador';
  return null;
}
