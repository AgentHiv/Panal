/**
 * La costura: el navegador escribe el manifiesto, el agente lo lee.
 *
 *     npx tsx scripts/test-adjuntos.ts
 *
 * El formato de `[panal-attach/1]` está implementado DOS veces —en el SDK, que
 * es la fuente de la verdad, y en `src/lib/adjuntos.ts`, porque el SDK trae
 * medio Node y no cabe en un navegador—. Eso es deliberado y está explicado en
 * los dos archivos, pero tiene un precio: si las dos se separan un solo byte,
 * el `keccak256` del encargo deja de cuadrar con el `taskHash` que el escrow
 * ancló, el agente rechaza el trabajo y el cliente se queda con el pago
 * bloqueado hasta que vence el plazo.
 *
 * No es un riesgo teórico: es la clase de error que no se ve leyendo ninguno
 * de los dos archivos por separado. Por eso esta prueba compara los bytes.
 */
import { keccak256 } from 'viem';
import {
  appendAttachmentsManifest as appendWeb,
  buildAttachmentsManifest as buildWeb,
  type Adjunto,
} from '../src/lib/adjuntos.js';
import { leerCapacidades } from '../src/lib/botEndpoint.js';
import {
  appendAttachmentsManifest as appendSdk,
  buildAttachmentsManifest as buildSdk,
  matchAttachment,
  parseAttachmentsManifest,
  type AttachedFile,
} from '../sdk/src/files.js';

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

const FOTO = new TextEncoder().encode('bytes de una foto que no es una foto');
const PDF = new TextEncoder().encode('%PDF-1.7 y unos cuantos bytes más');
const BRIEF = 'Léeme este recibo y dime cuánto suma.';

/** El mismo archivo, descrito por cada lado. */
const web: Adjunto[] = [
  { name: 'recibo.png', size: FOTO.byteLength, mime: 'image/png', hash: keccak256(FOTO), bytes: FOTO as Uint8Array<ArrayBuffer> },
  { name: 'contrato.pdf', size: PDF.byteLength, hash: keccak256(PDF), bytes: PDF as Uint8Array<ArrayBuffer> },
];
const sdk: AttachedFile[] = web.map(({ name, size, mime, hash }) => ({
  name,
  size,
  ...(mime ? { mime } : {}),
  hash: hash as `0x${string}`,
}));

console.log('\n── El manifiesto sale igual por los dos lados ──\n');

check('mismo bloque, byte a byte', buildWeb(web) === buildSdk(sdk), `\nweb: ${JSON.stringify(buildWeb(web))}\nsdk: ${JSON.stringify(buildSdk(sdk))}`);
check('mismo encargo completo', appendWeb(BRIEF, web) === appendSdk(BRIEF, sdk));

// Lo que de verdad importa: que el hash del texto coincida. Es lo que el
// escrow ancla al pagar y lo que el agente comprueba al recibir.
const hashWeb = keccak256(new TextEncoder().encode(appendWeb(BRIEF, web)));
const hashSdk = keccak256(new TextEncoder().encode(appendSdk(BRIEF, sdk)));
check('mismo keccak256 del encargo', hashWeb === hashSdk, `${hashWeb} vs ${hashSdk}`);

check('sin adjuntos, el encargo se queda intacto', appendWeb(BRIEF, []) === BRIEF && appendSdk(BRIEF, []) === BRIEF);

console.log('\n── El agente entiende lo que escribió el navegador ──\n');

const leidos = parseAttachmentsManifest(appendWeb(BRIEF, web));
check('lee los dos adjuntos', leidos.length === 2, `leyó ${leidos.length}`);
check(
  'con el nombre, el tamaño y el hash intactos',
  leidos[0]?.name === 'recibo.png' &&
    leidos[0]?.size === FOTO.byteLength &&
    leidos[0]?.hash.toLowerCase() === keccak256(FOTO).toLowerCase(),
);
check('y el mime sólo donde lo había', leidos[0]?.mime === 'image/png' && leidos[1]?.mime === undefined);

console.log('\n── La guarda del agente ──\n');

check('acepta los bytes que el encargo anunció', matchAttachment(leidos, FOTO)?.name === 'recibo.png');
check('rechaza unos bytes que nadie anunció', matchAttachment(leidos, new TextEncoder().encode('cualquier cosa')) === null);

const tocada = new Uint8Array(FOTO);
tocada[0] ^= 0x01;
check('rechaza el mismo archivo con un byte cambiado', matchAttachment(leidos, tocada) === null);

console.log('\n── Sólo se ofrece el clip a quien sabe recibirlo ──\n');

/** Un fetch de mentira que devuelve la tarjeta que le pongas. */
function conTarjeta(respuesta: { ok: boolean; body?: unknown } | 'revienta'): void {
  globalThis.fetch = (async () => {
    if (respuesta === 'revienta') throw new Error('red caída');
    return {
      ok: respuesta.ok,
      json: async () => {
        if (respuesta.body === undefined) throw new Error('no es JSON');
        return respuesta.body;
      },
    } as Response;
  }) as unknown as typeof fetch;
}

const original = globalThis.fetch;
try {
  conTarjeta({
    ok: true,
    body: { endpoints: { postAttachment: { path: '/upload/:taskId', maxAttachmentBytes: 26214400 } } },
  });
  const nuevo = await leerCapacidades('https://agente.example');
  check('un agente actualizado acepta adjuntos', nuevo.adjuntos === true);
  check('y se le hace caso a su tope', nuevo.maxAdjuntoBytes === 26214400, String(nuevo.maxAdjuntoBytes));

  // El caso que motiva todo esto: la plantilla anterior responde su tarjeta
  // tan feliz, sin `postAttachment`, y aceptaría el encargo igual.
  conTarjeta({ ok: true, body: { endpoints: { postBrief: { path: '/brief/:taskId' } } } });
  check('un agente anterior a la función NO', (await leerCapacidades('https://viejo.example')).adjuntos === false);

  conTarjeta({ ok: false });
  check('sin tarjeta que valga, no', (await leerCapacidades('https://roto.example')).adjuntos === false);

  conTarjeta({ ok: true, body: undefined });
  check('con la tarjeta ilegible, no', (await leerCapacidades('https://ilegible.example')).adjuntos === false);

  conTarjeta('revienta');
  check('y con el agente caído, tampoco', (await leerCapacidades('https://caido.example')).adjuntos === false);
} finally {
  globalThis.fetch = original;
}

console.log(
  fallos === 0
    ? '\n✅ El navegador y el agente escriben y leen lo mismo, y el clip sólo se ofrece a quien sabe recibirlo\n'
    : `\n❌ ${fallos} comprobación(es) fallidas: las dos implementaciones se han separado\n`,
);
process.exit(fallos === 0 ? 0 : 1);
