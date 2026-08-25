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

import {
  comoAdjunto,
  comoArchivo,
  comoNombre,
  comoTabla,
  formatoPedido,
  textoADocx,
  textoAXlsx,
} from '../template/src/salida.js';
import { leerZip } from '../template/src/zip.js';
import { textoDeDocx, textoDeXlsx } from '../template/src/adjuntos.js';

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

console.log('\n── Excel ──\n');

check('«dámelo en excel»', formatoPedido('dámelo en excel') === 'xlsx');
// Quien pide una «hoja de cálculo» quiere abrirla y sumar, no un archivo de
// texto con comas.
check('«una hoja de cálculo» es Excel, no CSV', formatoPedido('quiero una hoja de cálculo') === 'xlsx');
check('«spreadsheet» también', formatoPedido('give me a spreadsheet') === 'xlsx');
check('pero «en csv» sigue siendo CSV', formatoPedido('sácame la tabla en csv') === 'csv');
check('y el excel que ENTRA no cuenta', formatoPedido('lee el excel adjunto y devuélvemelo en pdf') === 'pdf');

const xlsx = textoAXlsx('Factura', 'Concepto,Importe\nAuditoría,15000\n"Traducción, urgente",100');
const releido = textoDeXlsx(xlsx);
check('lo que se escribe se puede volver a leer', !!releido && releido.includes('Auditoría'), String(releido));
check('un campo con coma dentro no se parte en dos', !!releido && releido.includes('Traducción, urgente'), String(releido));
// Un número guardado como texto le pone a cada celda el triangulito verde de
// «esto parece un número» y no deja sumar, que es justo para lo que se pide un
// Excel. Se mira el XML de la hoja, no el resultado de volver a leerla.
const hojaXml = new TextDecoder().decode(leerZip(xlsx).find((e) => e.nombre === 'xl/worksheets/sheet1.xml')!.bytes);
check(
  'un número se guarda COMO número',
  hojaXml.includes('<c r="B2"><v>15000</v></c>'),
  hojaXml.slice(hojaXml.indexOf('B2') - 10, hojaXml.indexOf('B2') + 60),
);
check(
  'y el texto como texto',
  /<c r="A2" t="inlineStr">/.test(hojaXml),
);

// De un resultado real y malo: se pidió una hoja de cálculo, el agente entregó
// su JSON de siempre —correcto— y el Excel salió con UNA columna de frases.
// Válido, y sin ningún valor para quien lo pidió para sumar.
const conLista = JSON.stringify({
  hallazgos: [
    { concepto: 'Auditoría', importe: 15000 },
    { concepto: 'Traducción', importe: 100 },
  ],
});
const tabla = comoTabla(conLista);
check('un JSON con lista de objetos se vuelve tabla', !!tabla && tabla.split('\n').length === 3, String(tabla));
check('con las claves de cabecera', !!tabla && tabla.startsWith('concepto\timporte'), String(tabla));

const xlsxDeJson = comoArchivo('xlsx', 'x', 'T', conLista, 'Concepto: Auditoría');
const columnas = textoDeXlsx(xlsxDeJson.data as Uint8Array)?.split('\n')[0]?.split('\t').length;
check('y el Excel sale con columnas, no con una sola', columnas === 2, `${columnas} columna(s)`);

check('un texto que no es JSON no se fuerza a tabla', comoTabla('esto es prosa') === null);
check('ni un JSON sin lista', comoTabla('{"a":1}') === null);

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

console.log('\n── Cómo se llama el archivo ──\n');

// El nombre lo escribe el modelo, así que llega como llegue: con comillas,
// con extensión, con la frase entera. Aquí sólo se comprueba la limpieza.
check('un título normal', comoNombre('División de dos enteros') === 'división-de-dos-enteros');
check('se queda en minúsculas', comoNombre('Casos Límite Del Carrito') === 'casos-límite-del-carrito');
check('las tildes NO se quitan', comoNombre('facturación anual').includes('ó'));
check('las comillas del modelo se van', comoNombre('"informe de ventas"') === 'informe-de-ventas');
check('y las tipográficas también', comoNombre('«informe de ventas»') === 'informe-de-ventas');
check('la extensión que sobra, fuera', comoNombre('informe de ventas.pdf') === 'informe-de-ventas');
check('varias líneas: se coge la primera', comoNombre('Informe de ventas\nY una explicación') === 'informe-de-ventas');
check('las líneas vacías de delante no cuentan', comoNombre('\n\n  Informe  ') === 'informe');

// LO QUE DE VERDAD IMPORTA: el nombre va en el idioma del cliente, y eso
// significa su alfabeto. Transliterar al ASCII sería devolverle un nombre que
// no reconoce, que es el problema que esto viene a arreglar.
check('en chino se queda en chino', comoNombre('两个整数相除') === '两个整数相除');
check('en árabe, en árabe', comoNombre('قسمة عددين صحيحين') === 'قسمة-عددين-صحيحين');
check('en ruso, en ruso', comoNombre('Деление двух целых чисел') === 'деление-двух-целых-чисел');
check('en hindi, en hindi', comoNombre('दो पूर्णांकों का विभाजन').startsWith('दो'));

// Un nombre no puede salirse de su carpeta ni romper una cabecera.
check('sin barras', !comoNombre('../../etc/passwd').includes('/'));
check('y sin lo que Windows prohíbe', comoNombre('a:b*c?d"e<f>g|h') === 'a-b-c-d-e-f-g-h');
check('nada de empezar por punto', !comoNombre('...oculto').startsWith('.'));
check('ni acabar en guion', !comoNombre('informe —').endsWith('-'));
check('lo que no deja nada, no deja nada', comoNombre('///') === '');
check('ni una respuesta vacía', comoNombre('') === '');
check(
  'un título kilométrico se corta',
  [...comoNombre('palabra '.repeat(40))].length <= 60,
  String([...comoNombre('palabra '.repeat(40))].length),
);
// Por code points: cortando por unidades UTF-16 se parte un emoji en dos y el
// nombre acaba con medio carácter, que en algunos sistemas no se puede abrir.
check('y no parte un carácter por la mitad', !/[\uD800-\uDBFF]$/.test(comoNombre('🐝'.repeat(80))));

console.log('\n── La cabecera con la que se descarga ──\n');

// Una cabecera HTTP sólo admite latin-1. Desde que el nombre va en el idioma
// del cliente, interpolarlo a pelo hacía que Node lanzara ERR_INVALID_CHAR y
// la descarga respondiera 500: el archivo estaba entregado, pagado y anclado,
// y no había forma de bajárselo.
const cabeceraAscii = comoAdjunto('division-de-enteros.pdf');
check('un nombre ASCII va en filename=', cabeceraAscii.includes('filename="division-de-enteros.pdf"'));
check('y también en filename*=', cabeceraAscii.includes("filename*=UTF-8''division-de-enteros.pdf"));

const cabeceraChina = comoAdjunto('两个整数相除.pdf');
check('el nombre de verdad va percent-encoded', cabeceraChina.includes(`filename*=UTF-8''${encodeURIComponent('两个整数相除.pdf')}`));
check('con un respaldo ASCII para quien no lo entienda', /filename="[\x20-\x7e]+"/.test(cabeceraChina), cabeceraChina);
check('y ese respaldo no lleva comillas', !/filename="[^"]*"[^;]*"/.test(cabeceraChina), cabeceraChina);

// La prueba que cierra el caso: que Node la acepte. Es lo que fallaba.
check('Node la escribe sin lanzar', ((): boolean => {
  try {
    new Response('x', { headers: { 'content-disposition': cabeceraChina } });
    return true;
  } catch {
    return false;
  }
})());

check('un nombre con comillas no parte la cabecera', !comoAdjunto('el "informe".pdf').split('filename="')[1]!.split('"')[0]!.includes('"'));
check('y uno que se queda sin ASCII tiene respaldo igual', comoAdjunto('两个整数').includes('filename="archivo"'));

console.log(
  fallos === 0
    ? '\n✅ El formato se entiende, el archivo sale igual byte a byte, y su nombre llega entero en cualquier alfabeto\n'
    : `\n❌ ${fallos} comprobación(es) fallidas\n`,
);
process.exit(fallos === 0 ? 0 : 1);
