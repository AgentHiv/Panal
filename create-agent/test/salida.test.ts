/**
 * Devolver el archivo que el cliente pidió.
 *
 *     npx tsx test/salida.test.ts     (o: npm test)
 *
 * Dos cosas se comprueban aquí por encima del resto.
 *
 * QUE SEA DETERMINISTA. El hash del archivo entregado se ancla en la cadena, y
 * ahí no hay rectificación: si generar dos veces lo mismo diera bytes
 * distintos, el cliente no podría demostrar que lo que se baja es lo que se le
 * entregó. Por eso el ZIP lleva fecha fija y no la del reloj.
 *
 * QUE EL TEXTO SIGA SIENDO LA ENTREGA. El archivo va ADEMÁS. Cambiar el texto
 * por el archivo rompería la cadena de custodia que hace verificable un
 * encargo.
 *
 * El `.docx` que sale de aquí se valida además con la `zipfile` de Python, que
 * es una implementación que no escribió este autor. Esa comprobación no cabe en
 * un test de tsx, pero está hecha y el resultado fue que `testzip()` lo da por
 * bueno.
 */

import { comoArchivo, formatoPedido, textoADocx } from '../template/src/salida.js';
import { leerZip } from '../template/src/zip.js';
import { textoDeDocx } from '../template/src/adjuntos.js';

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

console.log('\n── Entender qué pidió ──\n');

check('«dámelo en PDF»', formatoPedido('Resume esto y dámelo en PDF') === 'pdf');
check('«as a Word document»', formatoPedido('Summarise this as a Word document') === 'docx');
check('«un .docx»', formatoPedido('quiero un .docx') === 'docx');
check('«en csv»', formatoPedido('sácame la tabla en csv') === 'csv');
check('«en markdown»', formatoPedido('devuélvemelo en markdown') === 'md');
check('«texto plano»', formatoPedido('en texto plano por favor') === 'txt');
// Lo normal es que no pida nada, y entonces no se adjunta nada: a estos
// agentes los llama a menudo otro programa que sólo va a leer la respuesta.
check('sin pedir nada, no hay archivo', formatoPedido('revisa este contrato') === null);
check('una palabra que lo contenga no cuenta', formatoPedido('habla de los pdfs2 raros') === null);

// Estos cuatro salen de un fallo REAL. Se le pidio a un agente «lee el PDF
// adjunto y devuelvemelo como Word» y entrego un PDF: el detector cogia el
// primer formato que aparecia, y ese era el del archivo de ENTRADA. No lo vio
// ninguna frase inventada, lo vio una prueba de punta a punta.
check(
  'el formato del archivo que ENTRA no es el que se pide',
  formatoPedido('Lee el PDF adjunto y devuélvemelo como documento de Word') === 'docx',
  String(formatoPedido('Lee el PDF adjunto y devuélvemelo como documento de Word')),
);
check(
  'y en inglés igual',
  formatoPedido('Summarise the attached PDF as a Word document') === 'docx',
);
check(
  'convertir de uno a otro entrega el DESTINO',
  formatoPedido('convierte el docx adjunto a pdf') === 'pdf',
);
check(
  'nombrar lo que subiste no es pedir nada',
  formatoPedido('analiza el word que te subí') === null,
  String(formatoPedido('analiza el word que te subí')),
);

console.log('\n── Word ──\n');

const docx = textoADocx('Panal · informe #42', 'Primera línea.\nSegunda con ñ y á.\nTercera.');
const dentro = leerZip(docx).map((e) => e.nombre);

check('es un ZIP con lo que Word exige', dentro.includes('[Content_Types].xml') && dentro.includes('_rels/.rels'), dentro.join(', '));
check('y con el documento dentro', dentro.includes('word/document.xml'));

const leido = textoDeDocx(docx);
check('lo que se escribe se puede volver a leer', !!leido && leido.includes('Segunda con ñ y á'), String(leido));
check('el título va dentro', !!leido && leido.includes('informe #42'));

const escapado = textoDeDocx(textoADocx('t', 'un <tag> con & y "comillas"'));
check('los caracteres de XML no rompen el archivo', !!escapado && escapado.includes('<tag>'), String(escapado));

// Un solo carácter de control hace que Word se niegue a abrir el archivo
// entero, y no dice cuál era.
const conControl = textoDeDocx(textoADocx('t', 'antesdespues'));
check('un carácter de control se quita en vez de romper el archivo', !!conControl && conControl.includes('antesdespues'), String(conControl));

console.log('\n── Lo que exige anclar el hash en la cadena ──\n');

const a = textoADocx('Panal', 'contenido');
const b = textoADocx('Panal', 'contenido');
check(
  'generar dos veces lo mismo da los MISMOS bytes',
  a.length === b.length && a.every((v, i) => v === b[i]),
  `${a.length} vs ${b.length}`,
);

console.log('\n── El texto sigue siendo la entrega ──\n');

const md = comoArchivo('md', 'informe', 'Panal · informe', 'el contenido');
check('un .md lleva el título como encabezado', String(md.data).startsWith('# Panal · informe'));
check('con su extensión', md.name === 'informe.md');

const csv = comoArchivo('csv', 'tabla', 'Panal', 'a,b\n1,2');
check('un CSV va tal cual, sin encabezado inventado', csv.data === 'a,b\n1,2');
check('y con su tipo', csv.mime?.startsWith('text/csv') === true);

const pdf = comoArchivo('pdf', 'informe', 'Panal · informe', 'contenido');
check('un PDF sale como bytes', pdf.data instanceof Uint8Array);
check('y empieza por %PDF', new TextDecoder().decode((pdf.data as Uint8Array).subarray(0, 5)) === '%PDF-');

// El caso de `parse`: entrega JSON para una máquina y el archivo es para una
// persona, así que el PDF lleva la versión legible y no las llaves.
const conLegible = comoArchivo('md', 'x', 'T', '{"a":1}', 'A: 1');
check('se puede dar una versión legible aparte', String(conLegible.data).includes('A: 1'));
check('y no la del texto entregado', !String(conLegible.data).includes('{"a":1}'));

console.log(
  fallos === 0
    ? '\n✅ Se entiende qué formato pidió, y el archivo sale igual byte a byte cada vez\n'
    : `\n❌ ${fallos} comprobación(es) fallidas\n`,
);
process.exit(fallos === 0 ? 0 : 1);
