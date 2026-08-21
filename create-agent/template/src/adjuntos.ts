/**
 * Lo que el cliente adjuntó, convertido en algo que un modelo pueda usar.
 *
 * Un encargo puede traer cinco archivos de hasta 25 MB, y llegan verificados:
 * su hash se anunció DENTRO del encargo antes de que se pagara, así que son
 * exactamente los que el escrow cubre. Lo que hace este archivo es la otra
 * mitad: abrirlos.
 *
 * Cada tipo entra por donde puede:
 *
 *   imagen (png/jpeg/gif/webp)  se le ENSEÑA al modelo, no se describe
 *   texto (código, md, csv…)    tal cual
 *   PDF                         se le extrae el texto
 *   .docx                       es un ZIP con XML dentro
 *   .zip                        se abre y se leen los que sí se puedan
 *   cualquier otra cosa         se NOMBRA, y se dice que no se pudo abrir
 *
 * ESE ÚLTIMO CASO NO ES UN DESCUIDO. Callar un archivo que no se pudo abrir
 * hace que el modelo conteste como si el cliente no hubiera mandado nada, y el
 * cliente recibe una respuesta que ignora la mitad de lo que pidió sin decir
 * por qué. Decirlo cuesta una línea y convierte un fallo en una explicación.
 *
 * EL TIPO SE MIRA POR LOS BYTES, no por el nombre ni por el `content-type` que
 * mandó el cliente: los dos los escribe él, y un `.txt` que en realidad es un
 * PDF es un accidente normal, no un ataque.
 */

import { esZip, leerZip } from './zip.js';

export interface AdjuntoRecibido {
  name: string;
  mime?: string;
  bytes: Uint8Array;
}

/** Una imagen lista para enseñársela al modelo. */
export interface ImagenAdjunta {
  mime: string;
  bytes: Uint8Array;
}

export interface AdjuntosLeidos {
  /** Ya etiquetado y listo para pegar al encargo. Vacío si no hay nada. */
  texto: string;
  /** Las que el modelo puede mirar de verdad. */
  imagenes: ImagenAdjunta[];
}

/** Tope de caracteres que aporta UN adjunto. El encargo lo paga el agente. */
const MAX_CHARS_POR_ADJUNTO = 8_000;
/** Y el de todos juntos, porque cinco archivos al tope son demasiado. */
const MAX_CHARS_TOTAL = 24_000;
/** Archivos que se miran dentro de un ZIP. */
const MAX_DENTRO_DEL_ZIP = 40;

const MIMES_IMAGEN: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

/** Qué es esto, mirando los primeros bytes. */
export function tipoDe(bytes: Uint8Array): 'png' | 'jpeg' | 'gif' | 'webp' | 'pdf' | 'zip' | 'otro' {
  const b = bytes;
  if (b.length < 4) return 'otro';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return 'webp';
  // El %PDF- puede venir tras unos bytes de basura; el estándar tolera hasta
  // 1024, y hay generadores que se aprovechan.
  const cabeza = new TextDecoder('latin1').decode(b.subarray(0, Math.min(1024, b.length)));
  if (cabeza.includes('%PDF-')) return 'pdf';
  if (esZip(b)) return 'zip';
  return 'otro';
}

/**
 * ¿Esto es texto?
 *
 * Se decodifica en modo estricto, así un binario LANZA en vez de colarse como
 * un reguero de caracteres de reemplazo. Y aun decodificando bien, se rechaza
 * lo que trae bytes de control: hay binarios que pasan por UTF-8 válido y
 * mandárselos a un modelo es gastar el encargo en basura.
 */
export function comoTexto(bytes: Uint8Array): string | null {
  try {
    const texto = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    for (const ch of texto) {
      const c = ch.codePointAt(0)!;
      if (c < 0x20 && c !== 0x0a && c !== 0x0d && c !== 0x09) return null;
    }
    return texto;
  } catch {
    return null;
  }
}

/**
 * El texto de un `.docx`.
 *
 * Un .docx es un ZIP con `word/document.xml` dentro. No hace falta entender
 * Word: cada `</w:p>` cierra un párrafo y cada `<w:t>` envuelve un trozo de
 * texto. Se quitan las etiquetas y quedan las palabras.
 *
 * Los `<w:t>` se conservan PEGADOS entre sí a propósito: Word parte una misma
 * frase en varios cuando cambia algo del formato, y meter espacios entre ellos
 * escribiría «contra tante» donde pone «contratante».
 */
export function textoDeDocx(bytes: Uint8Array): string | null {
  const doc = leerZip(bytes).find((e) => e.nombre === 'word/document.xml');
  if (!doc) return null;
  const xml = comoTexto(doc.bytes);
  if (!xml) return null;
  return xml
    .replace(/<w:p\b[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:tab\b[^>]*\/>/g, '\t')
    .replace(/<w:br\b[^>]*\/>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** `A1` → 0, `B1` → 1, `AA7` → 26. Sirve para no descolocar una fila con huecos. */
function columnaDe(ref: string): number {
  const letras = /^([A-Z]+)/.exec(ref.toUpperCase())?.[1];
  if (!letras) return 0;
  let n = 0;
  for (const c of letras) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

/** Lo que el XML trae escapado, de vuelta a texto. */
function desescapar(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

/**
 * El contenido de un `.xlsx`, como filas de texto.
 *
 * Un Excel es otro ZIP con XML, como el .docx, pero con una vuelta de tuerca:
 * las celdas de texto no suelen guardar el texto. Guardan un ÍNDICE a
 * `sharedStrings.xml`, donde cada cadena aparece una sola vez aunque se repita
 * en mil celdas. Sin resolver esa tabla, una hoja llena de nombres se lee como
 * una lista de números.
 *
 * Y hay cuatro maneras de que una celda tenga texto, según quién escribiera el
 * archivo: `t="s"` (la tabla), `t="str"` (resultado de fórmula), `t="inlineStr"`
 * (el texto ahí mismo) y sin `t` (un número). Se contemplan las cuatro porque
 * Excel, LibreOffice y las librerías no escogen la misma.
 *
 * Las filas salen separadas por tabuladores: es lo que un modelo lee como
 * tabla sin tener que adivinar dónde acaba una celda, y no exige entrecomillar
 * nada.
 */
export function textoDeXlsx(bytes: Uint8Array): string | null {
  const partes = leerZip(bytes);
  const hojas = partes
    .filter((e) => /^xl\/worksheets\/sheet\d*\.xml$/.test(e.nombre))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
  if (hojas.length === 0) return null;

  // La tabla de cadenas compartidas, si la hay.
  const compartidas: string[] = [];
  const tabla = partes.find((e) => e.nombre === 'xl/sharedStrings.xml');
  if (tabla) {
    const xml = comoTexto(tabla.bytes) ?? '';
    for (const si of xml.match(/<si>[\s\S]*?<\/si>/g) ?? []) {
      // Una cadena puede venir partida en varios <t> cuando lleva formato
      // dentro; se pegan sin separador, como en Word.
      compartidas.push(desescapar([...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1] ?? '').join('')));
    }
  }

  const salida: string[] = [];
  for (const hoja of hojas) {
    const xml = comoTexto(hoja.bytes);
    if (!xml) continue;
    const filas: string[] = [];

    for (const fila of xml.match(/<row[^>]*>[\s\S]*?<\/row>/g) ?? []) {
      const celdas: string[] = [];
      for (const m of fila.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
        const attrs = m[1] ?? '';
        const cuerpo = m[2] ?? '';
        const tipo = /\bt="([^"]+)"/.exec(attrs)?.[1];
        const ref = /\br="([^"]+)"/.exec(attrs)?.[1] ?? '';

        let valor = '';
        if (tipo === 'inlineStr') {
          valor = desescapar([...cuerpo.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1] ?? '').join(''));
        } else {
          const v = /<v[^>]*>([\s\S]*?)<\/v>/.exec(cuerpo)?.[1] ?? '';
          if (tipo === 's') valor = compartidas[Number(v)] ?? '';
          else if (tipo === 'b') valor = v === '1' ? 'VERDADERO' : 'FALSO';
          else valor = desescapar(v);
        }

        // Una fila puede saltarse columnas: `A1` y luego `D1`. Colocar cada
        // valor en SU columna es lo que evita que una tabla con huecos salga
        // desplazada y el modelo lea el dato de otra cabecera.
        const col = ref ? columnaDe(ref) : celdas.length;
        while (celdas.length < col) celdas.push('');
        celdas[col] = valor;
      }
      if (celdas.some((c) => c !== '')) filas.push(celdas.join('\t'));
    }

    if (filas.length > 0) {
      salida.push(hojas.length > 1 ? `[hoja ${salida.length + 1}]\n${filas.join('\n')}` : filas.join('\n'));
    }
  }

  return salida.length > 0 ? salida.join('\n\n') : null;
}

/**
 * El texto de un PDF.
 *
 * Se apoya en `unpdf`, que es el motor de pdf.js empaquetado. Se hizo así tras
 * medir: un extractor a mano lee bien los PDF que genera este mismo agente y
 * se atraganta con los de Word o Chrome, que son justo los que manda un
 * cliente. Las codificaciones de fuente son el problema, y resolverlas es lo
 * que hace pdf.js.
 *
 * Devuelve null si no sale texto: un PDF escaneado es una imagen dentro de un
 * PDF, y sin OCR no hay nada que leer. Decirlo es mejor que entregar el vacío.
 */
export async function textoDePdf(bytes: Uint8Array): Promise<string | null> {
  try {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const doc = await getDocumentProxy(bytes);
    const { text } = await extractText(doc, { mergePages: true });
    const limpio = (Array.isArray(text) ? text.join('\n') : text).trim();
    return limpio.length > 0 ? limpio : null;
  } catch {
    return null;
  }
}

/** Recorta y avisa de que ha recortado, que es lo que evita una cita a medias. */
function acotar(texto: string, tope: number): string {
  if (texto.length <= tope) return texto;
  return `${texto.slice(0, tope)}\n--- (recortado: son ${texto.length} caracteres) ---`;
}

/**
 * Abre todos los adjuntos de un encargo.
 *
 * Es `async` porque leer un PDF lo es. Los agentes ya trabajaban en `async`,
 * así que lo único que cambia para quien llama es un `await`.
 */
export async function leerAdjuntos(adjuntos: AdjuntoRecibido[]): Promise<AdjuntosLeidos> {
  const partes: string[] = [];
  const imagenes: ImagenAdjunta[] = [];
  let gastado = 0;

  const anadir = (cabecera: string, cuerpo: string): void => {
    const queda = MAX_CHARS_TOTAL - gastado;
    if (queda <= 200) return;
    const trozo = acotar(cuerpo, Math.min(MAX_CHARS_POR_ADJUNTO, queda));
    gastado += trozo.length;
    partes.push(`--- ${cabecera} ---\n${trozo}\n--- fin ---`);
  };

  const noSePudo = (a: AdjuntoRecibido, motivo: string): void => {
    partes.push(
      `[Archivo adjunto "${a.name}"${a.mime ? ` (${a.mime})` : ''}: ${motivo}. ` +
        `Dilo con claridad en la respuesta en vez de ignorarlo.]`,
    );
  };

  for (const a of adjuntos) {
    const tipo = tipoDe(a.bytes);

    if (tipo in MIMES_IMAGEN) {
      // La imagen no se describe: se le enseña. El agente decide si su modelo
      // puede mirarla; aquí sólo se separa de lo que es texto.
      imagenes.push({ mime: MIMES_IMAGEN[tipo]!, bytes: a.bytes });
      partes.push(`[Imagen adjunta "${a.name}": va con este mensaje, míralo.]`);
      continue;
    }

    if (tipo === 'pdf') {
      const texto = await textoDePdf(a.bytes);
      if (texto) anadir(`PDF adjunto: ${a.name}`, texto);
      else noSePudo(a, 'es un PDF del que no se pudo sacar texto (probablemente escaneado)');
      continue;
    }

    if (tipo === 'zip') {
      // Word y Excel son ZIPs también, así que se prueban antes de tratarlo
      // como una carpeta: leer un .xlsx entrada por entrada devolvería su XML
      // en crudo, que para un modelo es ruido caro.
      const docx = textoDeDocx(a.bytes);
      if (docx) {
        anadir(`Documento adjunto: ${a.name}`, docx);
        continue;
      }
      const xlsx = textoDeXlsx(a.bytes);
      if (xlsx) {
        anadir(`Hoja de cálculo adjunta (columnas separadas por tabulador): ${a.name}`, xlsx);
        continue;
      }
      // Un ZIP normal: una carpeta. Se leen los que sí sean texto y se
      // NOMBRAN los que no, para que el modelo sepa qué había dentro.
      const dentro = leerZip(a.bytes).slice(0, MAX_DENTRO_DEL_ZIP);
      if (dentro.length === 0) {
        noSePudo(a, 'es un archivo comprimido que no se pudo abrir');
        continue;
      }
      const ilegibles: string[] = [];
      for (const e of dentro) {
        const texto = comoTexto(e.bytes);
        if (texto === null) ilegibles.push(e.nombre);
        else anadir(`${a.name} → ${e.nombre}`, texto);
      }
      if (ilegibles.length > 0) {
        partes.push(`[Dentro de "${a.name}" hay ${ilegibles.length} archivo(s) que no son texto: ${ilegibles.join(', ')}.]`);
      }
      continue;
    }

    const texto = comoTexto(a.bytes);
    if (texto !== null) anadir(`Archivo adjunto: ${a.name}`, texto);
    else noSePudo(a, 'no es texto y este agente no puede abrirlo');
  }

  return { texto: partes.join('\n\n'), imagenes };
}

/**
 * La imagen en el formato que espera `/chat/completions`.
 *
 * Vive aquí y no en cada agente porque los cuatro la necesitan igual, y una
 * data-url mal montada falla con un error del proveedor que no dice nada.
 */
export function parteDeImagen(img: ImagenAdjunta): {
  type: 'image_url';
  image_url: { url: string };
} {
  return {
    type: 'image_url',
    image_url: { url: `data:${img.mime};base64,${Buffer.from(img.bytes).toString('base64')}` },
  };
}
