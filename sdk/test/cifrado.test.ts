/**
 * Encargos cifrados: que lo abre quien debe, que no lo abre nadie más y que
 * no se puede cambiar sin que se note.
 *
 * Hermético: firma con claves de prueba, sin red ni cadena.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { keccak256, toBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  aBase64,
  accesoSignMessage,
  archivosAnunciadosEnSobre,
  claveDesdeFirma,
  concederAcceso,
  cifrarArchivo,
  cifrarTexto,
  comprobarClavePublicada,
  deBase64,
  descifrarArchivo,
  descifrarTexto,
  destinatariosDe,
  disputaSignMessage,
  esArchivoCifrado,
  esTextoCifrado,
  mensajeParaDerivarClave,
  mensajeParaPublicarClave,
  nombreEnBuzon,
  puedeAbrir,
  type ClaveDeCifrado,
} from '../src/cifrado.js';
import { ModoTablon, problemaAlPublicar } from '../src/tablon-reglas.js';

const cliente = privateKeyToAccount('0x0123456789012345678901234567890123456789012345678901234567890123');
const persona = privateKeyToAccount('0x1123456789012345678901234567890123456789012345678901234567890123');
const curioso = privateKeyToAccount('0x2123456789012345678901234567890123456789012345678901234567890123');

async function claveDe(cuenta: typeof cliente): Promise<ClaveDeCifrado> {
  return claveDesdeFirma(cuenta.address, await cuenta.signMessage({ message: mensajeParaDerivarClave(cuenta.address) }));
}

const BRIEF = 'Traduce al aymara: «El panal trabaja de noche.» Y ojo con las tildes: ñ, á, ü. 🐝';

test('base64url va y vuelve con cualquier largo', () => {
  for (let n = 0; n < 70; n++) {
    const b = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 255);
    assert.deepEqual(deBase64(aBase64(b)), b);
  }
  assert.throws(() => deBase64('no+vale/'));
});

test('la misma cuenta saca siempre la misma clave, y otra cuenta otra', async () => {
  const a = await claveDe(persona);
  const b = await claveDe(persona);
  assert.equal(a.publica, b.publica);
  assert.deepEqual(a.secreta, b.secreta);
  assert.notEqual((await claveDe(cliente)).publica, a.publica);
});

test('la firma de una cuenta no sirve para derivar la clave de otra', async () => {
  const firmaDePersona = await persona.signMessage({ message: mensajeParaDerivarClave(persona.address) });
  assert.notEqual(claveDesdeFirma(cliente.address, firmaDePersona).publica, claveDesdeFirma(persona.address, firmaDePersona).publica);
});

test('lo abren sus destinatarios y nadie más', async () => {
  const kc = await claveDe(cliente);
  const kp = await claveDe(persona);
  const kx = await claveDe(curioso);
  const sobre = cifrarTexto(BRIEF, [
    { cuenta: persona.address, clave: kp.publica },
    { cuenta: cliente.address, clave: kc.publica },
  ]);
  assert.ok(esTextoCifrado(sobre));
  assert.ok(!sobre.includes('aymara'), 'el texto no puede verse en el sobre');
  assert.equal(descifrarTexto(sobre, persona.address, kp.secreta), BRIEF);
  assert.equal(descifrarTexto(sobre, cliente.address, kc.secreta), BRIEF);
  assert.throws(() => descifrarTexto(sobre, curioso.address, kx.secreta), /no está cifrado para esta cuenta/);
  // Con la cuenta de la persona pero la clave de otro, tampoco.
  assert.throws(() => descifrarTexto(sobre, persona.address, kx.secreta), /no es la que se usó/);
  assert.deepEqual(destinatariosDe(sobre).sort(), [cliente.address.toLowerCase(), persona.address.toLowerCase()].sort());
});

test('dos sobres del mismo texto no se parecen: no se puede adivinar qué dicen', async () => {
  const kp = await claveDe(persona);
  const para = [{ cuenta: persona.address, clave: kp.publica }];
  assert.notEqual(cifrarTexto(BRIEF, para), cifrarTexto(BRIEF, para));
});

test('un sobre tocado no se abre, y su hash ya no es el anclado', async () => {
  const kp = await claveDe(persona);
  const sobre = cifrarTexto(BRIEF, [{ cuenta: persona.address, clave: kp.publica }]);
  const anclado = keccak256(toBytes(sobre));
  const s = JSON.parse(sobre) as { c: string };
  const c = deBase64(s.c);
  c[3] = c[3]! ^ 1;
  const tocado = JSON.stringify({ ...JSON.parse(sobre), c: aBase64(c) });
  assert.throws(() => descifrarTexto(tocado, persona.address, kp.secreta), /dañado o lo han cambiado/);
  assert.notEqual(keccak256(toBytes(tocado)), anclado);
});

test('un texto normal no pasa por cifrado', () => {
  assert.ok(!esTextoCifrado(BRIEF));
  assert.ok(!esTextoCifrado('{"v":"panal-cifrado-1"'));
  assert.ok(!esTextoCifrado('{"hola":1}'));
  assert.deepEqual(destinatariosDe(BRIEF), []);
});

test('la clave pública publicada se comprueba contra su cuenta', async () => {
  const kp = await claveDe(persona);
  const firma = await persona.signMessage({ message: mensajeParaPublicarClave(persona.address, kp.publica) });
  assert.ok(await comprobarClavePublicada({ cuenta: persona.address, clave: kp.publica, firma }));
  // El buzón no puede colar la suya con la firma de otro.
  const kx = await claveDe(curioso);
  assert.ok(!(await comprobarClavePublicada({ cuenta: persona.address, clave: kx.publica, firma })));
  const firmaDelCurioso = await curioso.signMessage({ message: mensajeParaPublicarClave(persona.address, kx.publica) });
  assert.ok(!(await comprobarClavePublicada({ cuenta: persona.address, clave: kx.publica, firma: firmaDelCurioso })));
  assert.ok(!(await comprobarClavePublicada({ cuenta: persona.address, clave: 'corta', firma })));
});

test('una clave pública trucada (punto de orden bajo) no se acepta', () => {
  assert.throws(() => cifrarTexto(BRIEF, [{ cuenta: persona.address, clave: aBase64(new Uint8Array(32)) }]));
});

test('los archivos van cifrados en binario y vuelven igual', async () => {
  const kc = await claveDe(cliente);
  const kp = await claveDe(persona);
  const pdf = Uint8Array.from({ length: 300_000 }, (_, i) => (i * 7) & 255);
  const cifrado = cifrarArchivo(pdf, [
    { cuenta: persona.address, clave: kp.publica },
    { cuenta: cliente.address, clave: kc.publica },
  ]);
  assert.ok(esArchivoCifrado(cifrado));
  assert.ok(!esArchivoCifrado(pdf));
  assert.ok(cifrado.length < pdf.length + 1_000, 'sin base64: apenas crece');
  assert.deepEqual(descifrarArchivo(cifrado, cliente.address, kc.secreta), pdf);
  assert.deepEqual(descifrarArchivo(cifrado, persona.address, kp.secreta), pdf);
  const tocado = cifrado.slice();
  tocado[tocado.length - 5] = tocado[tocado.length - 5]! ^ 1;
  assert.throws(() => descifrarArchivo(tocado, cliente.address, kc.secreta), /dañado/);
});

test('los mensajes que se firman no cambian, letra a letra', () => {
  // Cambiar el primero cambia la clave de todo el mundo: lo cifrado con la de
  // antes no se podría abrir. Una versión nueva es un mensaje nuevo.
  assert.equal(
    mensajeParaDerivarClave(persona.address),
    `Panal · clave de cifrado · v1\n\nFirmar esto no mueve dinero ni autoriza nada. Con esta firma tu dispositivo calcula la clave que abre tus encargos cifrados. No compartas esta firma con nadie.\n\nCuenta: ${persona.address}`,
  );
  // El segundo lo comprueba también el buzón con su propia copia
  // (bot/scripts/test-buzon.ts fija este mismo texto).
  const clave = 'c4SRnEYLEV3MndZ45om_rIOFlmFOzQr6YndhPmsS_XY';
  assert.equal(
    mensajeParaPublicarClave(persona.address, clave),
    `Panal · mi clave pública de cifrado · v1\n\nCuenta: ${persona.address}\nClave: ${clave}`,
  );
});

const arbitro = privateKeyToAccount('0x3123456789012345678901234567890123456789012345678901234567890123');

test('un encargo cifrado solo para su cliente: le da acceso a quien lo coge, sin tocar el sobre', async () => {
  const kc = await claveDe(cliente);
  const kp = await claveDe(persona);
  const sobre = cifrarTexto(BRIEF, [{ cuenta: cliente.address, clave: kc.publica }]);
  const anclado = keccak256(toBytes(sobre));
  assert.ok(!puedeAbrir(sobre, persona.address));
  assert.throws(() => descifrarTexto(sobre, persona.address, kp.secreta), /ni le han dado acceso/);
  const acceso = concederAcceso(sobre, cliente.address, kc.secreta, { cuenta: persona.address, clave: kp.publica });
  assert.equal(acceso.o, anclado.toLowerCase());
  assert.ok(puedeAbrir(sobre, persona.address, [acceso]));
  assert.equal(descifrarTexto(sobre, persona.address, kp.secreta, [acceso]), BRIEF);
  // El sobre es el mismo: el hash anclado no cambia.
  assert.equal(keccak256(toBytes(sobre)), anclado);
});

test('un acceso no sirve a otra cuenta, ni para otro objeto', async () => {
  const kc = await claveDe(cliente);
  const kp = await claveDe(persona);
  const kx = await claveDe(curioso);
  const sobre = cifrarTexto(BRIEF, [{ cuenta: cliente.address, clave: kc.publica }]);
  const otro = cifrarTexto('otro encargo', [{ cuenta: cliente.address, clave: kc.publica }]);
  const acceso = concederAcceso(sobre, cliente.address, kc.secreta, { cuenta: persona.address, clave: kp.publica });
  assert.throws(() => descifrarTexto(sobre, curioso.address, kx.secreta, [acceso]), /ni le han dado acceso/);
  // Se lo cambia de nombre: con la clave del curioso no abre.
  assert.throws(() => descifrarTexto(sobre, curioso.address, kx.secreta, [{ ...acceso, a: curioso.address.toLowerCase() }]), /no es la que se usó/);
  assert.throws(() => descifrarTexto(otro, persona.address, kp.secreta, [acceso]), /ni le han dado acceso/);
});

test('quien tiene acceso puede dárselo a quien decide una disputa', async () => {
  const kc = await claveDe(cliente);
  const kp = await claveDe(persona);
  const ka = await claveDe(arbitro);
  const sobre = cifrarTexto(BRIEF, [{ cuenta: cliente.address, clave: kc.publica }]);
  const aPersona = concederAcceso(sobre, cliente.address, kc.secreta, { cuenta: persona.address, clave: kp.publica });
  const aArbitro = concederAcceso(sobre, persona.address, kp.secreta, { cuenta: arbitro.address, clave: ka.publica }, [aPersona]);
  assert.equal(descifrarTexto(sobre, arbitro.address, ka.secreta, [aArbitro]), BRIEF);
});

test('un acceso manipulado no abre ni puede cambiar lo que dice el sobre', async () => {
  const kc = await claveDe(cliente);
  const kp = await claveDe(persona);
  const sobre = cifrarTexto(BRIEF, [{ cuenta: cliente.address, clave: kc.publica }]);
  // Un acceso hecho con OTRA clave de contenido —la de otro sobre— y pegado a este.
  const ajeno = cifrarTexto('lo que el buzón querría que leyeras', [{ cuenta: cliente.address, clave: kc.publica }]);
  const trucado = { ...concederAcceso(ajeno, cliente.address, kc.secreta, { cuenta: persona.address, clave: kp.publica }), o: keccak256(toBytes(sobre)).toLowerCase() };
  assert.throws(() => descifrarTexto(sobre, persona.address, kp.secreta, [trucado]), /dañado o lo han cambiado/);
});

test('los archivos también se abren con un acceso', async () => {
  const kc = await claveDe(cliente);
  const kp = await claveDe(persona);
  const pdf = Uint8Array.from({ length: 5_000 }, (_, i) => (i * 13) & 255);
  const cifrado = cifrarArchivo(pdf, [{ cuenta: cliente.address, clave: kc.publica }]);
  const acceso = concederAcceso(cifrado, cliente.address, kc.secreta, { cuenta: persona.address, clave: kp.publica });
  assert.deepEqual(descifrarArchivo(cifrado, persona.address, kp.secreta, [acceso]), pdf);
  assert.throws(() => descifrarArchivo(cifrado, persona.address, kp.secreta), /ni le han dado acceso/);
});

test('un sobre puede anunciar sus adjuntos en abierto, sin sus nombres', async () => {
  const kc = await claveDe(cliente);
  const h = [{ hash: '0x' + 'AB'.repeat(32), size: 506 }];
  const sobre = cifrarTexto('con adjunto', [{ cuenta: cliente.address, clave: kc.publica }], { anunciar: h });
  assert.ok(esTextoCifrado(sobre));
  assert.deepEqual(archivosAnunciadosEnSobre(sobre), [{ hash: '0x' + 'ab'.repeat(32), size: 506 }]);
  assert.equal(descifrarTexto(sobre, cliente.address, kc.secreta), 'con adjunto');
  assert.deepEqual(archivosAnunciadosEnSobre(cifrarTexto('sin', [{ cuenta: cliente.address, clave: kc.publica }])), []);
});

test('el nombre opaco de un archivo cifrado es el de la web y el buzón', () => {
  // La web, la app, el SDK y quien baja del buzón tienen que dar el mismo: es
  // como se pide el archivo. Fijado letra a letra.
  assert.equal(nombreEnBuzon('0xABCDEF0123456789aaaa'), 'cifrado-abcdef0123456789.bin');
});

test('los mensajes de acceso y disputa son los del buzón, letra a letra', () => {
  // El buzón (bot/src/buzon.ts) y la política de firma de la app tienen los
  // mismos: si cambia uno, el buzón deja de aceptar la firma.
  assert.equal(accesoSignMessage(12n, 1_900_000_000), 'Panal acceso #12 · 1900000000');
  assert.equal(disputaSignMessage(12n, 1_900_000_000), 'Panal disputa #12 · 1900000000');
});

test('un encargo confidencial del tablón solo se publica en selección', () => {
  const base = {
    encargo: 'el encargo',
    anuncio: 'un anuncio',
    categoria: 2,
    importe: 1n,
    plazoEntregaS: 3600,
    caducaEnS: 3 * 86_400,
    ventanaOfertasS: 3600,
    ventanaEleccionS: 86_400,
    confidencial: true,
  };
  assert.match(problemaAlPublicar({ ...base, modo: ModoTablon.Inmediato }) ?? '', /confidencial se publica en selección/);
  assert.equal(problemaAlPublicar({ ...base, modo: ModoTablon.Seleccion }), null);
});
