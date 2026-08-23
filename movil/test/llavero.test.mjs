/**
 * El llavero, contra un localStorage y un crypto de mentira.
 *
 * Lo que se comprueba de verdad: que el PIN equivocado NO abre, que las
 * palabras vuelven a salir iguales después de cerrar y reabrir, y que lo
 * guardado en disco no contiene la frase en claro.
 */
import { webcrypto } from 'node:crypto';

const disco = new Map();
globalThis.localStorage = {
  getItem: (k) => (disco.has(k) ? disco.get(k) : null),
  setItem: (k, v) => disco.set(k, String(v)),
  removeItem: (k) => disco.delete(k),
};
// Node 24 ya trae crypto global; solo falta randomUUID en algunas versiones.
if (!globalThis.crypto.randomUUID) globalThis.crypto.randomUUID = webcrypto.randomUUID.bind(webcrypto);
globalThis.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
globalThis.atob = (s) => Buffer.from(s, 'base64').toString('binary');

const ll = await import('../src/lib/llavero.ts');

let bien = 0;
let mal = 0;
const dice = (que, cond) => {
  if (cond) { bien++; console.log('  ✅', que); }
  else { mal++; console.log('  ❌', que); }
};

console.log('\nllavero vacío');
dice('no hay llavero al empezar', ll.hayLlavero() === false);
dice('listar da lista vacía', ll.listar().length === 0);

console.log('\ncrear el llavero');
const llave = await ll.crearLlavero('123456');
dice('ahora sí hay llavero', ll.hayLlavero() === true);
dice('devuelve una clave', !!llave);
let repitio = false;
try { await ll.crearLlavero('999999'); } catch { repitio = true; }
dice('crear dos veces falla en vez de pisar', repitio);

console.log('\nabrir');
dice('el PIN bueno abre', (await ll.abrir('123456')) !== null);
dice('el PIN malo devuelve null, no revienta', (await ll.abrir('000000')) === null);
dice('un PIN de otra longitud tampoco', (await ll.abrir('12345')) === null);

console.log('\ncrear una wallet');
const { wallet, palabras } = await ll.crearWallet(llave, 'Dueña de Audit');
dice('doce palabras', palabras.length === 12);
dice('dirección con formato', /^0x[0-9a-fA-F]{40}$/.test(wallet.direccion));
dice('nace sin copia apuntada', wallet.copiada === false);
dice('aparece en la lista', ll.listar().length === 1);
dice('la lista NO trae la semilla', ll.listar()[0].semilla === undefined);

console.log('\nlo que queda escrito en el disco');
const crudo = disco.get('panal:llavero:v1');
dice('no está la frase en claro', !crudo.includes(palabras.join(' ')));
dice('ni una sola palabra suelta rastreable', !palabras.some((p) => crudo.includes(`"${p}"`)));
dice('la dirección sí está en claro', crudo.includes(wallet.direccion));

console.log('\ncerrar y volver a abrir');
const llave2 = await ll.abrir('123456');
const otra = await ll.verPalabras(llave2, wallet.id);
dice('las palabras vuelven iguales', otra.join(' ') === palabras.join(' '));

console.log('\nun PIN equivocado no descifra');
const falsa = await ll.abrir('654321');
dice('ni siquiera abre', falsa === null);

console.log('\nmarcas y borrado');
ll.marcarCopiada(wallet.id);
dice('queda marcada como copiada', ll.listar()[0].copiada === true);
ll.renombrar(wallet.id, '  Otra  ');
dice('renombra y recorta espacios', ll.listar()[0].nombre === 'Otra');
const { wallet: w2 } = await ll.crearWallet(llave2, 'Segunda');
dice('dos wallets', ll.listar().length === 2);
dice('direcciones distintas', w2.direccion !== wallet.direccion);
ll.borrar(wallet.id);
dice('borra solo la suya', ll.listar().length === 1 && ll.listar()[0].id === w2.id);
dice('el llavero sigue abriéndose', (await ll.abrir('123456')) !== null);

console.log('\ndisco corrupto');
disco.set('panal:llavero:v1', '{roto');
dice('no revienta al leer', ll.hayLlavero() === false);
dice('listar devuelve vacío', ll.listar().length === 0);

console.log(`\n${bien} bien, ${mal} mal\n`);
process.exit(mal ? 1 : 0);
