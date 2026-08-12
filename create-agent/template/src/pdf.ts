/**
 * Un PDF de verdad, sin dependencias. Puedes borrar este archivo si tu agente
 * no entrega PDFs.
 *
 * No es una plantilla ni un HTML impreso: se escriben los objetos del PDF a
 * mano, con su tabla xref y sus offsets en bytes. Sale un archivo que abre
 * cualquier lector, y no añade ni un paquete a tus dependencias — meter una
 * librería de 4 MB para pintar texto monoespaciado en un A4 no sale a cuenta.
 *
 * Se usa desde `agent.ts`:
 *
 *     const pdf = textoAPdf('Mi informe', texto);
 *     return { text: texto, files: [{ name: 'informe.pdf', data: pdf, mime: 'application/pdf' }] };
 *
 * El motor calcula su hash y lo ancla en la cadena; tú no tocas nada de eso.
 *
 * Lo que hace bien y cuesta acertar a mano: parte las líneas largas para que no
 * se salgan del papel, pagina solo, y traduce los símbolos que la codificación
 * del PDF no tiene en vez de destrozarlos en silencio.
 */

/** A4 en puntos, que es la unidad del PDF. */
const ANCHO = 595;
const ALTO = 842;
const MARGEN = 50;
const CUERPO = 9.5;
const INTERLINEA = 12.5;
/** Cuántas líneas caben en una página con estos márgenes. */
const LINEAS_POR_PAGINA = Math.floor((ALTO - MARGEN * 2) / INTERLINEA);
/** Ancho de caracteres a 9.5pt en Courier: 0.6 em, redondeado a la baja. */
const COLUMNAS = Math.floor((ANCHO - MARGEN * 2) / (CUERPO * 0.6));

/**
 * Escapa un texto para meterlo entre paréntesis en un PDF.
 *
 * Los paréntesis delimitan las cadenas, así que uno sin escapar rompe el
 * archivo entero — y un JSON viene lleno de ellos.
 */
function escapar(texto: string): string {
  return texto.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * Parte las líneas largas para que no se salgan del papel.
 *
 * Un PDF no ajusta el texto solo: lo que no cabe, sencillamente no se ve. Con
 * un JSON de una sola línea eso significa entregar una hoja casi en blanco.
 */
function ajustar(lineas: string[]): string[] {
  const out: string[] = [];
  for (const linea of lineas) {
    if (linea.length <= COLUMNAS) {
      out.push(linea);
      continue;
    }
    // Se conserva la sangría al partir: en un JSON es lo que deja ver la
    // estructura, y sin ella el corte lo vuelve ilegible.
    const sangria = /^\s*/.exec(linea)![0].slice(0, 20);
    let resto = linea;
    let primera = true;
    while (resto.length > 0) {
      const ancho = primera ? COLUMNAS : COLUMNAS - sangria.length;
      out.push((primera ? '' : sangria) + resto.slice(0, ancho));
      resto = resto.slice(ancho);
      primera = false;
    }
  }
  return out;
}

/**
 * Sustitutos ASCII de los símbolos que WinAnsiEncoding no tiene.
 *
 * Sin esto, `Buffer.from(txt, 'latin1')` los recorta al byte bajo y salen
 * caracteres que no significan nada: un "≠" acababa impreso como "`", así que
 * un caso de prueba que decía "b ≠ 0" pasaba a decir "b ` 0". Silencioso, y
 * dentro de un entregable que se cobra.
 */
const SUSTITUTOS: Record<string, string> = {
  '≠': '!=', '≤': '<=', '≥': '>=', '≈': '~=', '±': '+/-', '×': 'x', '÷': '/',
  '→': '->', '←': '<-', '⇒': '=>', '∞': 'infinito', '∅': 'vacio',
  '“': '"', '”': '"', '„': '"', '‘': "'", '’': "'", '‹': '<', '›': '>',
  '–': '-', '—': '-', '…': '...', '•': '-', '·': '·', '™': '(TM)', '€': 'EUR',
};

/**
 * Latin-1, que es lo que entiende WinAnsiEncoding —la codificación de las
 * fuentes base del PDF—, sustituyendo antes lo que no cabe.
 *
 * Lo que no tiene sustituto se marca con "?" a propósito: un interrogante
 * avisa de que ahí faltaba algo; un carácter aleatorio miente.
 */
function aLatin1(texto: string): Buffer {
  const convertido = [...texto]
    .map((c) => {
      if (SUSTITUTOS[c]) return SUSTITUTOS[c];
      return c.codePointAt(0)! <= 0xff ? c : '?';
    })
    .join('');
  return Buffer.from(convertido, 'latin1');
}

/** Construye el PDF. Devuelve los bytes, listos para escribir o entregar. */
export function textoAPdf(titulo: string, contenido: string): Uint8Array {
  const lineas = ajustar([titulo, '', ...contenido.split('\n')]);

  // Se reparte en páginas antes de escribir nada: hay que saber cuántas son
  // para numerar los objetos, y en un PDF los objetos se referencian por número.
  const paginas: string[][] = [];
  for (let i = 0; i < lineas.length; i += LINEAS_POR_PAGINA) {
    paginas.push(lineas.slice(i, i + LINEAS_POR_PAGINA));
  }
  if (paginas.length === 0) paginas.push(['(sin contenido)']);

  // Numeración: 1 catálogo, 2 árbol de páginas, 3 fuente, y luego cada página
  // con su flujo de contenido, dos objetos por página.
  const FUENTE = 3;
  const primeraPagina = 4;
  const idPagina = (i: number) => primeraPagina + i * 2;
  const idContenido = (i: number) => primeraPagina + i * 2 + 1;

  const objetos: Buffer[] = [];
  const add = (n: number, cuerpo: string | Buffer) => {
    objetos[n] = Buffer.concat([
      aLatin1(`${n} 0 obj\n`),
      typeof cuerpo === 'string' ? aLatin1(cuerpo) : cuerpo,
      aLatin1('\nendobj\n'),
    ]);
  };

  const kids = paginas.map((_, i) => `${idPagina(i)} 0 R`).join(' ');
  add(1, '<< /Type /Catalog /Pages 2 0 R >>');
  add(2, `<< /Type /Pages /Kids [${kids}] /Count ${paginas.length} >>`);
  add(FUENTE, '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>');

  paginas.forEach((lineasPagina, i) => {
    add(
      idPagina(i),
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ANCHO} ${ALTO}] ` +
        `/Resources << /Font << /F1 ${FUENTE} 0 R >> >> /Contents ${idContenido(i)} 0 R >>`,
    );

    const flujo = aLatin1(
      [
        'BT',
        `/F1 ${CUERPO} Tf`,
        `${INTERLINEA} TL`,
        `${MARGEN} ${ALTO - MARGEN} Td`,
        ...lineasPagina.map((l) => `(${escapar(l)}) Tj T*`),
        'ET',
      ].join('\n'),
    );
    // /Length va en BYTES, no en caracteres: con acentos no es lo mismo, y un
    // lector estricto rechaza el archivo si no cuadra.
    add(idContenido(i), Buffer.concat([aLatin1(`<< /Length ${flujo.length} >>\nstream\n`), flujo, aLatin1('\nendstream')]));
  });

  // Ensamblado: hay que ir apuntando el offset en bytes de cada objeto, porque
  // la tabla xref del final los indexa por posición absoluta en el archivo.
  const total = objetos.length - 1;
  const partes: Buffer[] = [aLatin1('%PDF-1.4\n')];
  const offsets: number[] = [];
  let cursor = partes[0]!.length;

  for (let n = 1; n <= total; n++) {
    offsets[n] = cursor;
    partes.push(objetos[n]!);
    cursor += objetos[n]!.length;
  }

  const xref = [
    'xref',
    `0 ${total + 1}`,
    '0000000000 65535 f ',
    ...Array.from({ length: total }, (_, i) => `${String(offsets[i + 1]).padStart(10, '0')} 00000 n `),
  ].join('\n');

  partes.push(aLatin1(`${xref}\ntrailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${cursor}\n%%EOF\n`));
  return new Uint8Array(Buffer.concat(partes));
}
