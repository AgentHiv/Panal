/**
 * El archivo que ENTRA no elige el formato del que SALE.
 *
 *   pnpm test:formato
 *
 * HERMÉTICO: no toca la red, la cadena ni un modelo.
 *
 * Esto se escribe después de pagarlo. En el encargo #67 de mainnet —el primero
 * contratado desde el MCP con un adjunto— el cliente pidió JSON, adjuntó un
 * `.txt`, y se le entregó un `.txt`.
 *
 * El motivo: `formatoPedido` se queda con la ÚLTIMA mención de un formato,
 * porque el de salida se suele decir al final de la frase. Y el manifiesto
 * `[panal-attach/1]` se pega al final del brief —tiene que ir ahí dentro, es
 * lo que hace que la cadena cubra el hash del archivo—, con una línea `name:`
 * y otra `mime:`. Casi todo adjunto lleva en el nombre una extensión que aquí
 * es un formato, así que el bloque ganaba siempre.
 *
 * No era un caso raro: adjuntar un PDF hacía que la entrega fuera un PDF, se
 * hubiera pedido lo que se hubiera pedido. Afectaba a los cuatro agentes en
 * producción, porque `salida.ts` es motor compartido y sale de esta plantilla.
 */
import { appendAttachmentsManifest, attachmentFrom } from '@panal/sdk';
import { formatoPedido } from '../create-agent/template/src/salida.js';

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

const BYTES = new TextEncoder().encode('x'.repeat(428));
const conAdjunto = (brief: string, nombre: string, mime?: string): string =>
  appendAttachmentsManifest(brief, [attachmentFrom(nombre, BYTES, mime)]);

// --- el caso que se pagó ----------------------------------------------------

const B67 = 'Convierte el archivo adjunto en JSON validado. Devuelve solo el JSON.';
check('sin adjunto se pide json', formatoPedido(B67) === 'json', String(formatoPedido(B67)));
check(
  '#67: un .txt adjunto ya no secuestra el json',
  formatoPedido(conAdjunto(B67, 'pedidos ñ.txt', 'text/plain')) === 'json',
  String(formatoPedido(conAdjunto(B67, 'pedidos ñ.txt', 'text/plain'))),
);

// --- y con cada formato que la tabla reconoce -------------------------------

const PIDE_WORD = 'Resume esto y devuélvemelo en Word.';
for (const [nombre, mime] of [
  ['contrato.pdf', 'application/pdf'],
  ['datos.xlsx', undefined],
  ['tabla.csv', 'text/csv'],
  ['notas.md', 'text/markdown'],
  ['salida.json', 'application/json'],
] as [string, string | undefined][]) {
  check(
    `adjuntar ${nombre} no cambia el Word pedido`,
    formatoPedido(conAdjunto(PIDE_WORD, nombre, mime)) === 'docx',
    String(formatoPedido(conAdjunto(PIDE_WORD, nombre, mime))),
  );
}

check(
  'con varios adjuntos tampoco manda ninguno',
  formatoPedido(
    appendAttachmentsManifest('Devuélveme un CSV.', [
      attachmentFrom('a.pdf', BYTES, 'application/pdf'),
      attachmentFrom('b.docx', BYTES),
    ]),
  ) === 'csv',
);

// --- lo que ya funcionaba no puede volverse sordo ---------------------------

check(
  'pedir un formato de verdad sigue valiendo',
  formatoPedido(conAdjunto('Léelo y devuélvemelo en PDF.', 'notas.txt')) === 'pdf',
  String(formatoPedido(conAdjunto('Léelo y devuélvemelo en PDF.', 'notas.txt'))),
);
check(
  'un brief que no pide formato sigue sin pedirlo',
  formatoPedido(conAdjunto('Resume esto en tres frases.', 'notas.txt')) === null,
);
check(
  'y sin adjuntos nada cambia',
  formatoPedido('Dame un csv') === 'csv' && formatoPedido('hola') === null,
);

console.log(fallos === 0 ? '\n✅ todo bien' : `\n❌ ${fallos} fallo(s)`);
process.exit(fallos === 0 ? 0 : 1);
