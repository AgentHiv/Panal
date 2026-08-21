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

export type Formato = 'pdf' | 'docx' | 'xlsx' | 'md' | 'txt' | 'csv' | 'json';

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
  // «hoja de cálculo» y «spreadsheet» van a Excel, no a CSV: quien lo pide así
  // quiere abrirlo y sumar, no un archivo de texto con comas.
  ['xlsx', /\bxlsx?\b|\bexcel\b|hoja de c[aá]lculo|\bspreadsheet\b/g],
  ['csv', /\bcsvs?\b/g],
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
  xlsx: {
    ext: 'xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
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
 * Cómo está separada una tabla en texto.
 *
 * Se decide mirando TODAS las líneas y no la primera: una tabla cuya cabecera
 * lleva una coma en un título —«Ventas, por región»— haría creer que el
 * separador es la coma cuando en realidad es el tabulador.
 */
function separadorDe(lineas: string[]): '\t' | ',' | null {
  const conTab = lineas.filter((l) => l.includes('\t')).length;
  if (conTab >= lineas.length / 2) return '\t';
  const conComa = lineas.filter((l) => l.includes(',')).length;
  if (conComa >= lineas.length / 2) return ',';
  return null;
}

/** Un CSV puede traer campos entrecomillados con comas dentro. */
function partirCsv(linea: string): string[] {
  const campos: string[] = [];
  let actual = '';
  let dentro = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i]!;
    if (c === '"') {
      if (dentro && linea[i + 1] === '"') {
        actual += '"';
        i++;
      } else dentro = !dentro;
    } else if (c === ',' && !dentro) {
      campos.push(actual);
      actual = '';
    } else actual += c;
  }
  campos.push(actual);
  return campos;
}

/** `0` → A, `26` → AA. */
function letraDe(col: number): string {
  let s = '';
  let n = col + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Un `.xlsx` con lo mínimo que Excel exige.
 *
 * Los números se escriben COMO NÚMEROS y no como texto. Es la diferencia entre
 * una hoja con la que se puede sumar y una en la que cada celda lleva el
 * triangulito verde de «esto parece un número guardado como texto» — que es
 * justo lo que va a hacer quien pide un Excel: sumar.
 *
 * Las cadenas van en línea (`inlineStr`) en vez de en una tabla compartida:
 * ocupa algo más y ahorra una parte entera del archivo, y aquí el tamaño no es
 * el problema.
 */
export function textoAXlsx(titulo: string, texto: string): Uint8Array {
  const lineas = texto.split(/\r?\n/).filter((l, i, a) => l !== '' || i < a.length - 1);
  const sep = separadorDe(lineas);
  const filas = lineas.map((l) => (sep === ',' ? partirCsv(l) : sep === '\t' ? l.split('\t') : [l]));

  const celdas = (fila: string[], nFila: number): string =>
    fila
      .map((valor, col) => {
        const ref = `${letraDe(col)}${nFila}`;
        if (valor === '') return '';
        // Un número es un número; todo lo demás, texto.
        return /^-?\d+([.,]\d+)?$/.test(valor.trim())
          ? `<c r="${ref}"><v>${valor.trim().replace(',', '.')}</v></c>`
          : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escaparXml(valor)}</t></is></c>`;
      })
      .join('');

  const sheet =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
    filas.map((f, i) => `<row r="${i + 1}">${celdas(f, i + 1)}</row>`).join('') +
    '</sheetData></worksheet>';

  const workbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheets><sheet name="${escaparXml(titulo).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;

  const workbookRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '</Relationships>';

  const tipos =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '</Types>';

  const rels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';

  const b = (s: string): Uint8Array => new TextEncoder().encode(s);
  return escribirZip([
    { nombre: '[Content_Types].xml', bytes: b(tipos) },
    { nombre: '_rels/.rels', bytes: b(rels) },
    { nombre: 'xl/workbook.xml', bytes: b(workbook) },
    { nombre: 'xl/_rels/workbook.xml.rels', bytes: b(workbookRels) },
    { nombre: 'xl/worksheets/sheet1.xml', bytes: b(sheet) },
  ]);
}

/**
 * Una tabla, si el texto entregado la lleva dentro.
 *
 * Nace de un resultado real y malo: se le pidió a un agente una hoja de
 * cálculo, entregó su JSON de siempre —correcto— y el Excel salió con UNA
 * columna de frases, porque el texto no traía ni comas ni tabuladores. Válido
 * y sin ningún valor: quien pide un Excel quiere columnas para sumarlas.
 *
 * Así que antes de montar un xlsx o un csv se mira si lo entregado es JSON con
 * una lista de objetos planos. Si lo es, sus claves son la cabecera. Si no, se
 * sigue como antes.
 */
export function comoTabla(texto: string): string | null {
  let dato: unknown;
  try {
    dato = JSON.parse(texto);
  } catch {
    return null;
  }

  // La lista puede ser la raíz, o estar dentro bajo cualquier nombre —los
  // agentes la llaman `hallazgos`, `entries`, `puertos`…
  const lista = Array.isArray(dato)
    ? dato
    : dato && typeof dato === 'object'
      ? Object.values(dato as Record<string, unknown>).find(
          (v): v is unknown[] => Array.isArray(v) && v.length > 0,
        )
      : undefined;
  if (!lista || lista.length === 0) return null;

  const filas = lista.filter(
    (x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x),
  );
  if (filas.length !== lista.length) return null;

  // La cabecera es la unión de las claves, en el orden en que aparecen: una
  // fila a la que le falte un campo no puede descolocar a las demás.
  const columnas: string[] = [];
  for (const f of filas) for (const k of Object.keys(f)) if (!columnas.includes(k)) columnas.push(k);
  if (columnas.length === 0) return null;

  const celda = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    // Un objeto anidado no cabe en una celda; se pone su JSON antes que
    // «[object Object]», que no le sirve a nadie.
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v).replace(/[\t\r\n]+/g, ' ');
  };

  return [
    columnas.map((c) => c.replace(/[_-]+/g, ' ')).join('\t'),
    ...filas.map((f) => columnas.map((c) => celda(f[c])).join('\t')),
  ].join('\n');
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
  const name = `${nombreBase}.${ext}`;
  // Para un Excel o un CSV se busca primero una TABLA dentro de lo entregado:
  // la versión en prosa daría una sola columna de frases, que es un archivo
  // válido y sin ningún valor para quien lo pidió para sumar.
  const tabla = formato === 'xlsx' || formato === 'csv' ? comoTabla(texto) : null;
  const legible = tabla ?? paraLeer ?? texto;

  switch (formato) {
    case 'pdf':
      return { name, data: textoAPdf(titulo, legible), mime };
    case 'docx':
      return { name, data: textoADocx(titulo, legible), mime };
    case 'xlsx':
      return { name, data: textoAXlsx(titulo, legible), mime };
    // El markdown lleva el título como encabezado, porque es lo que un `.md`
    // hace. Los demás van tal cual: un CSV con un `#` delante deja de ser CSV.
    case 'md':
      return { name, data: `# ${titulo}\n\n${legible}\n`, mime };
    case 'csv':
      // Una tabla en tabuladores se convierte a comas; si no había tabla, el
      // texto va tal cual, que es lo que ya hacía.
      return { name, data: tabla ? aCsv(tabla) : texto, mime };
    default:
      return { name, data: texto, mime };
  }
}

/** Tabuladores a comas, entrecomillando sólo lo que lo necesita. */
function aCsv(tabla: string): string {
  return tabla
    .split('\n')
    .map((fila) =>
      fila
        .split('\t')
        .map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c))
        .join(','),
    )
    .join('\n');
}
