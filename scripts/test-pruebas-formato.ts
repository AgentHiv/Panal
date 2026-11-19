/**
 * Las pruebas de una disputa se firman igual en el SDK y en el buzón.
 *
 *   npx tsx scripts/test-pruebas-formato.ts
 *
 * El protocolo vive en `sdk/src/pruebas.ts` (lo usan la web, la app y el MCP)
 * y está copiado en `bot/src/buzon.ts`, que no depende del SDK. Si una copia
 * cambiara un espacio en el mensaje que se firma o en cómo se calcula el
 * contenido, el buzón rechazaría todas las pruebas con «bad signature» y nadie
 * sabría por qué.
 */
import { keccak256, toBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import * as sdk from '@panal/sdk';
import * as bot from '../bot/src/buzon';

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

const casos = [
  { texto: 'El motivo, con tildes, eñes y emojis 🐝.', archivos: [] },
  { texto: 'Con dos archivos', archivos: [{ hash: '0xAB'.padEnd(66, 'c'), size: 10 }, { hash: '0x' + '1'.repeat(64), size: 0 }] },
  { texto: JSON.stringify({ v: 'panal-cifrado-1', e: 'x', n: 'y', para: ['0xabc'], c: 'Zm9v' }), archivos: [] },
];

console.log('\n─── los mismos números ───');
check('el mismo plazo', sdk.PLAZO_DE_PRUEBAS_DIAS === bot.PLAZO_DE_PRUEBAS_DIAS);
check('el mismo tope de texto', sdk.MAX_PIEZA_CHARS === bot.MAX_PIEZA_CHARS);
check('los mismos archivos por pieza', sdk.MAX_ARCHIVOS_POR_PIEZA === bot.MAX_ARCHIVOS_POR_PIEZA);
check('el mismo margen de fecha', sdk.MARGEN_FECHA_MS === bot.MARGEN_FECHA_MS);

console.log('\n─── los mismos mensajes ───');
check('la firma de sesión', sdk.pruebasSignMessage(42n, 1_900_000_000) === bot.pruebasSignMessage(42n, 1_900_000_000));
for (const [i, c] of casos.entries()) {
  const a = sdk.contenidoDePieza(c.texto, c.archivos);
  const b = bot.contenidoDePieza(c.texto, c.archivos);
  check(`el mismo contenido (caso ${i + 1})`, a === b, `${a} ≠ ${b}`);
  check(`el mismo mensaje de pieza (caso ${i + 1})`, sdk.piezaSignMessage(7n, a, '2026-11-06T21:00:00.000Z') === bot.piezaSignMessage(7n, b, '2026-11-06T21:00:00.000Z'));
}
check('las mayúsculas del hash de un archivo no cambian el contenido', sdk.contenidoDePieza('x', [{ hash: '0xABCD', size: 1 }]) === sdk.contenidoDePieza('x', [{ hash: '0xabcd', size: 1 }]));
check('el orden de los archivos sí', sdk.contenidoDePieza('x', [{ hash: '0x1', size: 1 }, { hash: '0x2', size: 1 }]) !== sdk.contenidoDePieza('x', [{ hash: '0x2', size: 1 }, { hash: '0x1', size: 1 }]));

console.log('\n─── firmado con uno, comprobado con el otro ───');
const cuenta = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const fecha = new Date().toISOString();
const contenido = bot.contenidoDePieza(casos[1]!.texto, casos[1]!.archivos);
const firma = await cuenta.signMessage({ message: bot.piezaSignMessage(9n, contenido, fecha) });
const pieza = { de: 'cliente' as const, autor: cuenta.address, texto: casos[1]!.texto, archivos: casos[1]!.archivos, fecha, firma, recibida: Date.now() };
check('lo que firma el buzón lo comprueba el SDK', await sdk.verificarPieza(9n, pieza));
check('y con otra fecha no', !(await sdk.verificarPieza(9n, { ...pieza, fecha: '2020-01-01T00:00:00.000Z' })));

console.log('\n─── v2: los destinatarios de un sobre de verdad ───');
const otras = [
  privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'),
  privateKeyToAccount('0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6'),
];
const para: sdk.Destinatario[] = [];
for (const c of [cuenta, ...otras]) {
  const clave = sdk.claveDesdeFirma(c.address, await c.signMessage({ message: sdk.mensajeParaDerivarClave(c.address) }));
  para.push({ cuenta: c.address, clave: clave.publica });
}
const cuerpo = sdk.cuerpoDePieza({ tipo: 'peticion', texto: '¿Me pasas la entrega?', para: 'trabajador', pide: 'entrega' });
const sobreV2 = sdk.cifrarTexto(JSON.stringify(cuerpo), para);
check('el mismo tope de lo anclado', sdk.MAX_TEXTO_ANCLADO_CHARS === bot.MAX_TEXTO_ANCLADO_CHARS);
check('el buzón lo reconoce como cifrado', bot.esTextoCifrado(sobreV2));
check(
  'y saca los mismos destinatarios que el SDK',
  JSON.stringify(bot.destinatariosDelSobre(sobreV2)) === JSON.stringify(sdk.destinatariosDe(sobreV2)) && sdk.destinatariosDe(sobreV2).length === 3,
);
check('un texto en claro no tiene destinatarios', bot.destinatariosDelSobre('hola').length === 0);

console.log('\n─── v2: lo que va dentro de cada pieza ───');
const yo = sdk.claveDesdeFirma(cuenta.address, await cuenta.signMessage({ message: sdk.mensajeParaDerivarClave(cuenta.address) }));
const leido = sdk.leerCuerpoDePieza(sdk.descifrarTexto(sobreV2, cuenta.address, yo.secreta));
check('una petición se lee como se escribió', leido.k === 'peticion' && leido.para === 'trabajador' && leido.pide === 'entrega' && leido.t === '¿Me pasas la entrega?');
const v1 = sdk.leerCuerpoDePieza(JSON.stringify({ t: 'una de la v1', a: [{ name: 'a.pdf', size: 3, hash: '0xAB' }] }));
check('una pieza de la v1 sale como mensaje, con sus archivos', v1.k === 'mensaje' && v1.t === 'una de la v1' && v1.a[0]?.hash === '0xab');
check('un texto que no es JSON sale como mensaje, tal cual', sdk.leerCuerpoDePieza('en claro').t === 'en claro');
check('un tipo desconocido sale como mensaje', sdk.leerCuerpoDePieza(JSON.stringify({ v: 2, k: 'veredicto', t: 'x', a: [] })).k === 'mensaje');
check('«auto» solo si es true', sdk.leerCuerpoDePieza(JSON.stringify({ v: 2, k: 'mensaje', t: 'x', a: [], auto: 'si' })).auto === undefined);

console.log('\n─── v2: solo cuenta lo anclado ───');
const adjunto = sdk.attachmentFrom('plano.pdf', new TextEncoder().encode('el plano'));
const encargo = sdk.appendAttachmentsManifest('Tradúceme el contrato al francés.', [adjunto]);
const entregado = { name: 'contrat.pdf', size: 10, hash: keccak256(new TextEncoder().encode('le contrat')), path: 'contrat.pdf' };
const entrega = sdk.appendFilesManifest('Aquí está.', [entregado]);
const tarea = { taskHash: keccak256(toBytes(encargo)), resultHash: keccak256(toBytes(entrega)) };
const deEncargo = sdk.cuerpoDePieza({ tipo: 'encargo', texto: encargo });
check('el encargo exacto coincide con la cadena', sdk.anclaDeLaPieza(deEncargo, tarea) === 'coincide');
check('con una coma cambiada, no', sdk.anclaDeLaPieza(sdk.cuerpoDePieza({ tipo: 'encargo', texto: encargo.replace('.', ',') }), tarea) === 'no-coincide');
check('la entrega exacta coincide', sdk.anclaDeLaPieza(sdk.cuerpoDePieza({ tipo: 'entrega', texto: entrega }), tarea) === 'coincide');
check('un mensaje no se compara con nada', sdk.anclaDeLaPieza(sdk.cuerpoDePieza({ tipo: 'mensaje', texto: encargo }), tarea) === null);
check('sin entrega anclada todavía, tampoco', sdk.anclaDeLaPieza(sdk.cuerpoDePieza({ tipo: 'entrega', texto: entrega }), { ...tarea, resultHash: `0x${'0'.repeat(64)}` }) === null);
const anclados = sdk.hashesAnclados({ encargo, entrega });
check('los archivos anclados: el adjunto del encargo y el de la entrega', anclados.size === 2 && anclados.has(adjunto.hash.toLowerCase()) && anclados.has(entregado.hash.toLowerCase()));
check('y ninguno más', !anclados.has(keccak256(toBytes('otro archivo'))));

console.log('\n─── v2: para quién se cifra ───');
const [c1, c2, c3] = [cuenta.address, otras[0]!.address, otras[1]!.address];
const miembros = sdk.miembrosDelExpediente(c1, c2, [c3, c1.toLowerCase() as `0x${string}`]);
check('los miembros, sin repetir aunque un juez sea parte', miembros.length === 3);
const conClave: Record<string, string> = { [c1.toLowerCase()]: 'k1', [c3.toLowerCase()]: 'k3' };
const destino = await sdk.destinatariosDelExpediente(miembros, async (m) => conClave[m.toLowerCase()] ?? null);
check('se cifra para todos los que tienen clave', destino.para.map((d) => d.cuenta).join() === [c1, c3].join());
check('y dice quién no la tiene todavía', destino.sinClave.join() === c2);

console.log(fallos === 0 ? '\n✅ El SDK y el buzón firman las pruebas igual\n' : `\n❌ ${fallos} comprobación(es) fallidas\n`);
process.exit(fallos === 0 ? 0 : 1);
