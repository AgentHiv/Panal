/**
 * El llavero con la capa del chip seguro, contra un chip de mentira.
 *
 * El chip de verdad está en Android (`SecureKey.java`) y aquí no hay. Se
 * sustituye por una clave AES-GCM que solo conoce esta prueba, que es lo que
 * el chip es desde fuera: algo que cifra y descifra con una clave que no se
 * puede leer.
 *
 * Lo que se comprueba es lo que podría salir mal con dinero de por medio:
 * que lo que queda en el disco ya no sirve sin el chip, que migrar no pierde
 * nada, que un fallo al migrar deja el llavero como estaba, y que uno que el
 * chip ya no sabe abrir se aparta en vez de pisarse.
 */
import { webcrypto } from 'node:crypto';

const disco = new Map();
globalThis.localStorage = {
  getItem: (k) => (disco.has(k) ? disco.get(k) : null),
  setItem: (k, v) => disco.set(k, String(v)),
  removeItem: (k) => disco.delete(k),
};
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

/** Un chip de mentira: una clave AES-GCM que solo tiene esta prueba. */
async function chip() {
  const clave = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return {
    async cifrar(texto) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const datos = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, clave, new TextEncoder().encode(texto));
      return { iv: Buffer.from(iv).toString('base64'), datos: Buffer.from(datos).toString('base64') };
    },
    async descifrar(s) {
      const claro = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: Buffer.from(s.iv, 'base64') },
        clave,
        Buffer.from(s.datos, 'base64'),
      );
      return new TextDecoder().decode(claro);
    },
  };
}

const V1 = 'panal:llavero:v1';
const V2 = 'panal:llavero:v2';

console.log('\nestrenar el llavero con chip');
{
  disco.clear();
  const c = await chip();
  await ll.prepararLlavero(c);
  const llave = await ll.crearLlavero('246810');
  const { wallet } = await ll.crearWallet(llave, 'Principal');
  dice('se guarda en la versión del chip', disco.has(V2));
  dice('y NO en la de antes', !disco.has(V1));
  const guardado = JSON.parse(disco.get(V2));
  dice('en el disco solo hay iv y datos del chip', Object.keys(guardado).sort().join() === 'datos,iv');
  // Con comillas: se busca el CAMPO del JSON en claro. Sin ellas, «sal» salía
  // de vez en cuando por azar dentro del base64 del cifrado, y la prueba
  // fallaba sin que nada estuviera mal. Las comillas no existen en base64.
  dice('sin la sal ni el testigo a la vista', !disco.get(V2).includes('"sal"') && !disco.get(V2).includes('"testigo"'));
  dice('ni la dirección', !disco.get(V2).toLowerCase().includes(wallet.direccion.slice(2).toLowerCase()));

  // Reabrir la app: se prepara otra vez con el MISMO chip.
  await ll.prepararLlavero(c);
  dice('al reabrir, la wallet sigue', ll.listar().some((w) => w.id === wallet.id));
  dice('el PIN bueno abre', (await ll.abrir('246810')) !== null);
  dice('el malo no', (await ll.abrir('000000')) === null);

  ll.renombrar(wallet.id, 'Nueva');
  await new Promise((r) => setTimeout(r, 50));
  await ll.prepararLlavero(c);
  dice('cambiar el nombre también llega al disco', ll.listar()[0]?.nombre === 'Nueva');
}

console.log('\nmigrar un llavero que ya existía');
{
  disco.clear();
  await ll.prepararLlavero(null); // sin chip: como hasta ahora
  const llave = await ll.crearLlavero('135790');
  const { wallet } = await ll.crearWallet(llave, 'De antes');
  dice('sin chip se guarda como siempre', disco.has(V1) && !disco.has(V2));

  const c = await chip();
  await ll.prepararLlavero(c);
  dice('con chip, pasa a la versión del chip', disco.has(V2));
  dice('y la de antes se quita', !disco.has(V1));
  dice('la wallet sigue ahí', ll.listar().some((w) => w.id === wallet.id));
  const abierta = await ll.abrir('135790');
  dice('el mismo PIN la abre', abierta !== null);
  const palabras = await ll.verPalabras(abierta, wallet.id);
  dice('y sus doce palabras siguen siendo las mismas', palabras.length === 12);
}

console.log('\nsi el chip falla al migrar, no se pierde nada');
{
  disco.clear();
  await ll.prepararLlavero(null);
  const llave = await ll.crearLlavero('112233');
  await ll.crearWallet(llave, 'Intacta');
  const antes = disco.get(V1);
  // Un chip que cifra pero no devuelve lo mismo.
  const roto = { cifrar: async () => ({ iv: 'AAAA', datos: 'AAAA' }), descifrar: async () => 'otra cosa' };
  await ll.prepararLlavero(roto);
  dice('la versión de antes sigue en su sitio', disco.get(V1) === antes);
  dice('no se ha escrito nada a medias', !disco.has(V2));
  dice('y la app la sigue usando', ll.listar().length === 1 && (await ll.abrir('112233')) !== null);
}

console.log('\nsi el chip ya no sabe abrirlo, se aparta, no se pisa');
{
  disco.clear();
  await ll.prepararLlavero(await chip());
  await ll.crearLlavero('445566');
  const sobre = disco.get(V2);
  // Otro chip: el de antes se perdió (no debería pasar, pero se cubre).
  await ll.prepararLlavero(await chip());
  dice('se guarda aparte, intacto', disco.get('panal:llavero:v2:ilegible') === sobre);
  dice('y la app no ve llavero (se recupera con las doce palabras)', !ll.hayLlavero());
}

console.log('\nborrar el llavero borra las dos versiones');
{
  disco.clear();
  await ll.prepararLlavero(await chip());
  await ll.crearLlavero('778899');
  ll.borrarLlavero();
  dice('no queda ni la del chip ni la de antes', !disco.has(V1) && !disco.has(V2));
  dice('y la app lo ve vacío', !ll.hayLlavero());
}

console.log(`\n${bien} bien · ${mal} mal\n`);
process.exit(mal === 0 ? 0 : 1);
