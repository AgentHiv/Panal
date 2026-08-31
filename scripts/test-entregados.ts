/**
 * Lo que vuelve: el manifiesto de la entrega y la comprobación de los bytes.
 *
 *     npx tsx scripts/test-entregados.ts
 *
 * `[panal-files/1]` es el camino de vuelta de `[panal-attach/1]`: el agente
 * anuncia dentro de la entrega los archivos que ha producido, y el cliente los
 * baja aparte. Como el texto de la entrega ya cuadró con el `resultHash` de la
 * cadena, el hash de cada archivo viaja anclado igual de firme que el texto.
 *
 * Esa es toda la garantía que hay, y descansa en una sola línea: la que compara
 * el keccak256 de los bytes servidos con el hash del manifiesto. Si esa línea
 * se ablandara —devolver los bytes «avisando» en vez de lanzar—, quien llama
 * acabaría guardando en el teléfono del cliente un archivo que el agente NO
 * entregó, con el sello de que sí. Por eso se prueba byte a byte.
 */
import { keccak256 } from 'viem';
import {
  FILES_BLOCK,
  FileVerificationError,
  appendFilesManifest,
  buildFilesManifest,
  downloadDeliveredFile,
  fileUrl,
  parseFilesManifest,
  sanitizeFileName,
  stripFilesManifest,
  type DeliveredFile,
} from '../src/lib/deliveredFiles.js';
import { buildFilesManifest as buildSdk } from '@panal/sdk';

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

const BYTES = new TextEncoder().encode('%PDF-1.7 los casos de prueba que pediste');
const HASH = keccak256(BYTES);
const BOT = 'https://agente.example/bot';

const entrega = `Aquí tienes lo que pediste.

${FILES_BLOCK}
name: casos-de-prueba.pdf
size: ${BYTES.byteLength}
mime: application/pdf
hash: ${HASH}
path: /files/7/casos-de-prueba.pdf`;

console.log('\n── Escribir lo que anuncia la entrega ──\n');

/**
 * Ahora la web también ESCRIBE manifiestos: una persona que entrega desde el
 * panel adjunta sus archivos, y ese texto es el que se ancla en la cadena.
 *
 * Por eso el formato tiene que salir carácter por carácter igual que el del
 * SDK, que es la referencia y el que usa la plantilla de agentes. Si se
 * separan, el mismo archivo entregado desde el panel y desde un agente daría
 * dos `resultHash` distintos, y el que lo lea no podría saber cuál es el bueno.
 */
const paraEscribir: DeliveredFile[] = [
  {
    name: 'casos-de-prueba.pdf',
    size: BYTES.byteLength,
    mime: 'application/pdf',
    hash: HASH,
    path: 'archivo/7/casos-de-prueba.pdf',
  },
];
check('la web escribe el mismo manifiesto que el SDK', buildFilesManifest(paraEscribir) === buildSdk(paraEscribir));
check(
  'y lo que escribe se puede volver a leer',
  parseFilesManifest(appendFilesManifest('Ahí va.', paraEscribir))[0]?.hash === HASH,
);
check(
  'sin archivos no toca el texto: una entrega sin adjuntos se ancla igual que antes',
  appendFilesManifest('Ahí va.', []) === 'Ahí va.',
);
check(
  'y el texto de una entrega con archivos sigue siendo legible sin ellos',
  stripFilesManifest(appendFilesManifest('Ahí va.', paraEscribir)).trim() === 'Ahí va.',
);
// Una ruta relativa es lo que necesita el buzón: sus agentes cuelgan de
// `/buzon/0x…`, y una ruta absoluta se resolvería contra la raíz del dominio.
check(
  'una ruta relativa se resuelve DENTRO del buzón del agente',
  fileUrl(paraEscribir[0]!, 'https://api.panal.lat/buzon/0xabc') ===
    'https://api.panal.lat/buzon/0xabc/archivo/7/casos-de-prueba.pdf',
  fileUrl(paraEscribir[0]!, 'https://api.panal.lat/buzon/0xabc'),
);

console.log('\n── Leer lo que anuncia la entrega ──\n');

const leidos = parseFilesManifest(entrega);
check('se encuentra el archivo', leidos.length === 1, String(leidos.length));
check('con su nombre', leidos[0]?.name === 'casos-de-prueba.pdf');
check('su tamaño', leidos[0]?.size === BYTES.byteLength);
check('y su hash en minúsculas', leidos[0]?.hash === HASH.toLowerCase());
check(
  'el bloque no se le enseña a nadie',
  stripFilesManifest(entrega) === 'Aquí tienes lo que pediste.',
  JSON.stringify(stripFilesManifest(entrega)),
);

// Un manifiesto roto no puede llevarse por delante la entrega: el cliente ya
// pagó y tiene derecho a leer al menos la parte escrita.
const sinHash = entrega.replace(`hash: ${HASH}`, 'hash: 0xnoesunhash');
check('un hash inválido descarta el archivo', parseFilesManifest(sinHash).length === 0);
check('pero el texto sigue ahí', stripFilesManifest(sinHash).startsWith('Aquí tienes'));
check('sin ruta ni url, no hay archivo', parseFilesManifest(entrega.replace(/^path:.*$/m, '')).length === 0);

console.log('\n── El nombre lo escribe el agente ──\n');

check('no se sale de su carpeta', sanitizeFileName('../../etc/passwd') === 'passwd');
check('ni por la barra de Windows', sanitizeFileName('..\\..\\secreto.txt') === 'secreto.txt');
check('no empieza por punto', !sanitizeFileName('...oculto').startsWith('.'));
check('y el alfabeto del cliente se respeta', sanitizeFileName('两个整数相除.pdf') === '两个整数相除.pdf');

console.log('\n── De dónde se baja ──\n');

// El host sale del REGISTRO, nunca del texto de la entrega: si el agente
// pudiera elegirlo, uno comprometido mandaría a su cliente a otro servidor.
check(
  'la ruta relativa se resuelve contra el endpoint del registro',
  fileUrl(leidos[0]!, BOT) === 'https://agente.example/files/7/casos-de-prueba.pdf',
  fileUrl(leidos[0]!, BOT),
);

console.log('\n── Comprobar los bytes ──\n');

const CRED = { firma: '0xfirma', expira: 9_999_999_999 };
const original = globalThis.fetch;
const sirviendo = (cuerpo: Uint8Array, estado = 200): void => {
  globalThis.fetch = (async (_u: string, init?: RequestInit) => {
    vistas.push(init?.headers as Record<string, string>);
    return {
      ok: estado === 200,
      status: estado,
      arrayBuffer: async () => cuerpo.buffer.slice(cuerpo.byteOffset, cuerpo.byteOffset + cuerpo.byteLength),
    };
  }) as typeof fetch;
};
const vistas: Record<string, string>[] = [];

try {
  sirviendo(BYTES);
  const blob = await downloadDeliveredFile(leidos[0]!, BOT, '0xcliente', CRED);
  check('los bytes buenos se entregan', blob.size === BYTES.byteLength, String(blob.size));
  check('con el mime que anunció', blob.type === 'application/pdf', blob.type);

  // En cabeceras y no en la query: por la query la firma acababa escrita en el
  // log de accesos del proxy, y esa firma abre la entrega entera.
  check('la firma va en cabeceras', vistas[0]?.['x-panal-signature'] === '0xfirma');
  check('y la dirección también', vistas[0]?.['x-panal-address'] === '0xcliente');
  check('nada de firmas en la URL', !fileUrl(leidos[0]!, BOT).includes('0xfirma'));

  // LO QUE IMPORTA: un byte cambiado y no se guarda nada.
  const manipulado = new Uint8Array(BYTES);
  manipulado[0] = manipulado[0]! ^ 0x01;
  sirviendo(manipulado);
  let saltó = false;
  try {
    await downloadDeliveredFile(leidos[0]!, BOT, '0xcliente', CRED);
  } catch (err) {
    saltó = err instanceof FileVerificationError && err.message === 'hash';
  }
  check('un solo byte cambiado se rechaza', saltó);

  sirviendo(new TextEncoder().encode('otra cosa mucho más corta'));
  let porTamano = false;
  try {
    await downloadDeliveredFile(leidos[0]!, BOT, '0xcliente', CRED);
  } catch (err) {
    porTamano = err instanceof FileVerificationError && err.message === 'size';
  }
  check('y un tamaño que no cuadra, antes de mirar el hash', porTamano);

  sirviendo(BYTES, 404);
  let por404 = false;
  try {
    await downloadDeliveredFile(leidos[0]!, BOT, '0xcliente', CRED);
  } catch (err) {
    por404 = err instanceof FileVerificationError && err.message === 'HTTP 404';
  }
  check('un archivo que ya no está se dice', por404);

  // Que lance y no devuelva es el punto: `Blob` vacío también es `Blob`, y
  // quien llama lo guardaría igual.
  const mentiroso: DeliveredFile = { ...leidos[0]!, hash: keccak256(new Uint8Array([0])) };
  sirviendo(BYTES);
  let noCuela = false;
  try {
    await downloadDeliveredFile(mentiroso, BOT, '0xcliente', CRED);
  } catch {
    noCuela = true;
  }
  check('el hash del manifiesto manda, no los bytes servidos', noCuela);
} finally {
  globalThis.fetch = original;
}

console.log(
  fallos === 0
    ? '\n✅ La entrega dice qué archivos trae, y ninguno se guarda sin cuadrar con su hash\n'
    : `\n❌ ${fallos} comprobación(es) fallidas\n`,
);
process.exit(fallos === 0 ? 0 : 1);
