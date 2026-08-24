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

console.log('\ntraer una wallet de fuera');
const FRASE = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
// La clave de la cuenta 0 de Hardhat, publicada en su documentación desde
// siempre. Está aquí porque su dirección es conocida y se puede comprobar, y
// porque escribir una de verdad en un test sería exactamente lo que no hay que
// hacer. No tiene nada, en ninguna red.
const CLAVE = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const llave3 = await ll.abrir('123456');

const conPalabras = await ll.importarWallet(llave3, 'De fuera', FRASE);
dice('entra con doce palabras', conPalabras.ok === true);
dice(
  'y da la dirección de esa frase',
  conPalabras.ok && conPalabras.wallet.direccion === '0x58A57ed9d8d624cBD12e2C467D34787555bB1b25',
);
dice('queda marcada como importada', conPalabras.ok && conPalabras.wallet.importada === true);
dice(
  'y como ya copiada: su copia estaba fuera desde antes',
  conPalabras.ok && conPalabras.wallet.copiada === true,
);
dice(
  'las palabras vuelven a salir',
  (await ll.verPalabras(llave3, conPalabras.wallet.id)).join(' ') === FRASE,
);

const repetida = await ll.importarWallet(llave3, 'La misma', FRASE.toUpperCase());
dice('la misma wallet dos veces se rechaza', repetida.ok === false);
dice('y lo dice sin lanzar nada', !repetida.ok && repetida.pega === 'repetida');

const numerada = await ll.importarWallet(
  llave3,
  'Pegada de una lista',
  FRASE.split(' ').map((p, i) => `${i + 1}. ${p}`).join('\n'),
);
dice('pegada con numeración se rechaza por repetida, no por ilegible', numerada.pega === 'repetida');

const rota = await ll.importarWallet(llave3, 'Rota', FRASE.replace(/yellow$/, 'zoo'));
dice('doce palabras con la suma de control mal NO entran', rota.ok === false);
dice('y lo dice por las palabras', !rota.ok && rota.pega === 'palabras-no-cuadran');

const basura = await ll.importarWallet(llave3, 'Basura', 'hola qué tal');
dice('cualquier cosa se rechaza', basura.ok === false);

const conClave = await ll.importarWallet(llave3, 'Del .env', CLAVE);
dice('entra con una clave privada', conClave.ok === true);
dice(
  'y da su dirección',
  conClave.ok && conClave.wallet.direccion === '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
);
dice('se guarda como clave, no como palabras', conClave.ok && conClave.wallet.tipo === 'clave');
let sinPalabras = false;
try { await ll.verPalabras(llave3, conClave.wallet.id); } catch { sinPalabras = true; }
dice('y no promete doce palabras que no tiene', sinPalabras);
dice(
  'la clave vuelve a salir entera',
  (await ll.verSecreto(llave3, conClave.wallet.id)).texto === CLAVE,
);

console.log('\nfirmar con lo guardado');
const cuentaPalabras = await ll.cuentaDe(llave3, conPalabras.wallet.id);
dice('la cuenta de la frase es la de su dirección', cuentaPalabras.address === conPalabras.wallet.direccion);
const cuentaClave = await ll.cuentaDe(llave3, conClave.wallet.id);
dice('la cuenta de la clave, también', cuentaClave.address === conClave.wallet.direccion);
dice('y sabe firmar', typeof cuentaClave.signMessage === 'function');

console.log('\nlo importado tampoco queda en claro');
const crudo2 = disco.get('panal:llavero:v1');
dice('no está la frase importada', !crudo2.includes(FRASE));
dice('no está la clave importada', !crudo2.includes(CLAVE.slice(2)));

console.log('\nwallets escritas por la versión anterior');
const anterior = JSON.parse(crudo2);
delete anterior.wallets[0].tipo;
delete anterior.wallets[0].importada;
disco.set('panal:llavero:v1', JSON.stringify(anterior));
dice('sin `tipo` se leen como palabras', ll.listar()[0].tipo === 'palabras');
dice('y como creadas aquí', ll.listar()[0].importada === false);

console.log('\ndisco corrupto');
disco.set('panal:llavero:v1', '{roto');
dice('no revienta al leer', ll.hayLlavero() === false);
dice('listar devuelve vacío', ll.listar().length === 0);

console.log(`\n${bien} bien, ${mal} mal\n`);
process.exit(mal ? 1 : 0);
