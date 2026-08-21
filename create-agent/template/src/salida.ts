/**
 * Devolverle al cliente el archivo que pidió.
 *
 * Un agente entrega TEXTO: es lo que se le enseña al cliente y lo que se ancla
 * en la cadena. Pero mucha gente no quiere texto en una caja, quiere un archivo
 * que abrir, reenviar o imprimir. Esto convierte lo uno en lo otro.
 *
 * QUÉ SE ENTREGA SIGUE SIENDO EL TEXTO. El archivo va ADEMÁS, nunca en lugar
 * de él: su hash se cuela en la entrega y acaba en la cadena, así que el
 * cliente puede demostrar que el archivo que se baja es exactamente el que se
 * le entregó. Sustituir el texto por el archivo rompería eso.
 *
 * Y NO SE ADJUNTA SI NO LO PIDIÓ. A varios de estos agentes los llama otro
 * programa que va a leer la respuesta; colgarle un PDF que nadie va a abrir es
 * peso y confusión.
 */

import { textoAPdf } from './pdf.js';
import { escribirZip } from './zip.js';

export type Formato = 'pdf' | 'docx' | 'md' | 'txt' | 'csv' | 'json';

export interface ArchivoDeSalida {
  name: string;
  data: Uint8Array | string;
  mime?: string;
}

/**
 * Qué formato pidió, si es que pidió alguno.
 *
 * Se mira el ENCARGO, no la respuesta: es donde la persona lo dice. Y se busca
 * en varios idiomas, porque el mercado no es sólo hispanohablante — un encargo
 * en inglés que pide «as a Word document» tiene que salir en Word.
 *
 * Devuelve `null` cuando no pide nada, que es el caso normal.
 */
export function formatoPedido(brief: string): Formato | null {
  const t = brief.toLowerCase();
  const mencion: { formato: Formato; en: number }[] = [];

  for (const [formato, patron] of PATRONES) {
    for (const m of t.matchAll(patron)) mencion.push({ formato, en: m.index });
  }
  if (mencion.length === 0) return null;

  // Las que hablan del archivo que ENTRÓ no cuentan. Sin esto, «lee el PDF
  // adjunto y devuélvemelo en Word» entregaba un PDF: el primer formato que
  // aparecía era el de la entrada. Pasó en una prueba de punta a punta, que es
  // donde se ve y no en una frase inventada.
  const deSalida = mencion.filter((x) => !esDeEntrada(t, x.en));
  if (deSalida.length === 0) return null;

  // Si alguna viene precedida de un verbo de entrega, ésa es la buena.
  const pedida = deSalida.find((x) => ENTREGA.test(t.slice(Math.max(0, x.en - 40), x.en)));
  if (pedida) return pedida.formato;

  // Y si no, la ÚLTIMA: el formato de salida se suele decir al final.
  return deSalida[deSalida.length - 1]!.formato;
}

/** Cómo se nombra cada formato, en los idiomas del mercado. */
const PATRONES: [Formato, RegExp][] = [
  ['pdf', /\bpdfs?\b/g],
  ['docx', /\bdocx?\b|\bword\b/g],
  ['csv', /\bcsvs?\b|hoja de c[aá]lculo|\bspreadsheet\b/g],
  ['json', /\bjson\b/g],
  ['md', /\bmarkdown\b|\bmd\b/g],
  ['txt', /\btxt\b|texto plano|plain text|archivo de texto|text file/g],
];

/** Que se lo den a uno: lo que distingue pedir un formato de nombrarlo. */
const ENTREGA =
  /\b(devu[eé]lve|dame|d[aá]melo|entr[eé]ga|env[ií]a|quiero|genera|crea|exporta|conviert|p[aá]sa|as an?|in|into|return|output|format[oe]?|como)\b[^.]{0,30}$/;

/** Y lo que delata que se habla del archivo que MANDÓ el cliente. */
const ENTRADA = /\b(adjunt\w*|attach\w*|subid\w*|uploaded|este|esta|el|la|mi|my|the)\b/;

function esDeEntrada(t: string, en: number): boolean {
  const antes = t.slice(Math.max(0, en - 18), en);
  const despues = t.slice(en, en + 30);
  // «el PDF adjunto», «the attached pdf», «mi word»: se habla de lo que entró.
  return /\badjunt|attach|\bsub[ií]|uploaded|que te (mand|pas|envi)/.test(despues) || (ENTRADA.test(antes) && /\badjunt|attach/.test(despues));
}

/** La extensión y el tipo de cada formato. */
const TIPOS: Record<Formato, { ext: string; mime: string }> = {
  pdf: { ext: 'pdf', mime: 'application/pdf' },
  docx: {
    ext: 'docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  md: { ext: 'md', mime: 'text/markdown; charset=utf-8' },
  txt: { ext: 'txt', mime: 'text/plain; charset=utf-8' },
  csv: { ext: 'csv', mime: 'text/csv; charset=utf-8' },
  json: { ext: 'json', mime: 'application/json; charset=utf-8' },
};

/**
 * Lo que XML no admite tal cual.
 *
 * Los caracteres de control se quitan además de escapar: uno solo hace que
 * Word se niegue a abrir el archivo ENTERO, sin decir cuál era.
 */
function escaparXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

/**
 * Un `.docx` de verdad, con lo mínimo que Word exige para abrirlo.
 *
 * Un .docx es un ZIP con tres archivos dentro. No hace falta ninguna librería:
 * cada línea del texto es un `<w:p>` y ya está.
 */
export function textoADocx(titulo: string, texto: string): Uint8Array {
  const parrafo = (linea: string, negrita = false): string =>
    `<w:p><w:r>${negrita ? '<w:rPr><w:b/></w:rPr>' : ''}` +
    `<w:t xml:space="preserve">${escaparXml(linea)}</w:t></w:r></w:p>`;

  const cuerpo = [parrafo(titulo, true), ...texto.split(/\r?\n/).map((l) => parrafo(l))].join('');

  const documento =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body>${cuerpo}</w:body></w:document>`;

  const tipos =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '</Types>';

  const rels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>';

  const b = (s: string): Uint8Array => new TextEncoder().encode(s);
  return escribirZip([
    { nombre: '[Content_Types].xml', bytes: b(tipos) },
    { nombre: '_rels/.rels', bytes: b(rels) },
    { nombre: 'word/document.xml', bytes: b(documento) },
  ]);
}

/**
 * El archivo listo para adjuntar a la entrega.
 *
 * `paraLeer` es la versión legible del contenido, y existe por un caso real:
 * hay agentes cuyo texto entregado es JSON —bueno para una máquina, ilegible
 * dentro de un PDF—, y ahí se les pasa aparte lo que debe ver una persona. Si
 * no se da, se usa el texto tal cual.
 */
export function comoArchivo(
  formato: Formato,
  nombreBase: string,
  titulo: string,
  texto: string,
  paraLeer?: string,
): ArchivoDeSalida {
  const { ext, mime } = TIPOS[formato];
  const legible = paraLeer ?? texto;
  const name = `${nombreBase}.${ext}`;

  switch (formato) {
    case 'pdf':
      return { name, data: textoAPdf(titulo, legible), mime };
    case 'docx':
      return { name, data: textoADocx(titulo, legible), mime };
    // El markdown lleva el título como encabezado, porque es lo que un `.md`
    // hace. Los demás van tal cual: un CSV con un `#` delante deja de ser CSV.
    case 'md':
      return { name, data: `# ${titulo}\n\n${legible}\n`, mime };
    default:
      return { name, data: texto, mime };
  }
}
