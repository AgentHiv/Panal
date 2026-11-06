/**
 * El borrador cerrado del MCP remoto: lo que cierra el servidor (Node) lo abre
 * la web (WebCrypto), y nada más.
 *
 *   npx tsx scripts/test-borrador.ts
 *
 * Las dos mitades viven en sitios distintos —`mcp/src/borrador-cifrado.ts` y
 * `src/lib/borrador.ts`— y con APIs distintas. Si una cambiara el formato sin
 * la otra, los enlaces dejarían de abrir y nadie lo vería hasta que alguien
 * intentara contratar desde una conversación.
 */
import { abrirBorradorEnNode, cerrarBorrador } from '../mcp/src/borrador-cifrado';
import { abrirBorrador } from '../src/lib/borrador';

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

const contenido = {
  agente: '0x8E9c1Cf58c1F510e22022ebE1Bfd65c4cd6C0308',
  encargo: 'Redacta un contrato de alquiler en Cochabamba — con tildes, eñes y emojis 🐝.',
  nivel: 'Un documento largo',
  nivelWei: '2000000000000000000000',
  horas: 24,
};
const id = 'I919k9rGnVPVbj18pbkh6Q';
const { cifrado, clave } = cerrarBorrador(contenido, id);

console.log('\n─── la caja ───');
check('no lleva el encargo legible', !Buffer.from(cifrado, 'base64url').toString('utf8').includes('Cochabamba'));
check('la clave es corta: 22 caracteres', clave.length === 22, String(clave.length));
check('dos cierres del mismo contenido no se parecen', cerrarBorrador(contenido, id).cifrado !== cifrado);

console.log('\n─── la web la abre ───');
const abierto = await abrirBorrador(cifrado, clave, id);
check('con su clave y su id', JSON.stringify(abierto) === JSON.stringify(contenido), JSON.stringify(abierto));
check('y Node lo abre igual', JSON.stringify(abrirBorradorEnNode(cifrado, clave, id)) === JSON.stringify(contenido));

console.log('\n─── y no abre lo que no debe ───');
const otra = cerrarBorrador(contenido, id).clave;
check('con otra clave, no', (await abrirBorrador(cifrado, otra, id)) === null);
check('con la clave cortada (enlace copiado a medias), no', (await abrirBorrador(cifrado, clave.slice(0, 15), id)) === null);
check('sin clave, no', (await abrirBorrador(cifrado, '', id)) === null);
check('con el id de otro borrador, no: la caja va atada a su número', (await abrirBorrador(cifrado, clave, 'OtroIdDeVeintidosChars')) === null);
const datos = Buffer.from(cifrado, 'base64url');
datos[20] = datos[20]! ^ 1;
check('una caja tocada en un solo bit, no', (await abrirBorrador(datos.toString('base64url'), clave, id)) === null);
check('basura, no', (await abrirBorrador('###', clave, id)) === null);

console.log(fallos === 0 ? '\n✅ Lo que cierra el MCP lo abre la web, y solo con su clave\n' : `\n❌ ${fallos} comprobación(es) fallidas\n`);
process.exit(fallos === 0 ? 0 : 1);
