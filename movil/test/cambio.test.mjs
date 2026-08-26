/**
 * Cambiar de wallet dentro de la app.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * LO QUE ESTABA ROTO, Y NO ERA LA PANTALLA
 *
 * La app se quedaba con la primera wallet que crearas o importaras. Podías
 * crear cuatro más, se les veía el saldo en el llavero, y no había forma de
 * hablar con un agente ni encargarle nada desde ellas.
 *
 * Y debajo había algo peor que la falta de un botón: aunque se cambiara la
 * sesión, wagmi no se enteraba. Pregunta las cuentas UNA vez, al conectar, y
 * a partir de ahí trabaja con lo que guardó. Sin un aviso explícito, cambiar
 * de wallet dejaba la app FIRMANDO con la nueva y ENSEÑANDO la vieja: los
 * saldos, los encargos y el historial de una, la clave de otra.
 *
 * Por eso aquí no se comprueba «que se pueda cambiar», sino que después de un
 * cambio las tres cosas dicen lo mismo: la sesión, el proveedor EIP-1193 que
 * usa wagmi, y la dirección que se recupera de una firma de verdad.
 * ───────────────────────────────────────────────────────────────────────────
 */
import { webcrypto } from 'node:crypto';

globalThis.__VITE_ENV__ = { VITE_CHAIN: 'mainnet' };

const disco = new Map();
globalThis.localStorage = {
  getItem: (k) => (disco.has(k) ? disco.get(k) : null),
  setItem: (k, v) => disco.set(k, String(v)),
  removeItem: (k) => disco.delete(k),
};
if (!globalThis.crypto.randomUUID) globalThis.crypto.randomUUID = webcrypto.randomUUID.bind(webcrypto);
globalThis.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
globalThis.atob = (s) => Buffer.from(s, 'base64').toString('binary');

const { createWalletClient, custom, verifyMessage } = await import('viem');
const ll = await import('../src/lib/llavero.ts');
const ses = await import('../src/lib/sesion.ts');
const { ID_LLAVERO, PROVEEDOR, conectorLlavero } = await import('../src/lib/conector.ts');
const { activeChain } = await import('@/contracts/config');

let bien = 0;
let mal = 0;
const dice = (que, cond) => {
  if (cond) { bien++; console.log('  ✅', que); }
  else { mal++; console.log('  ❌', que); }
};

const cuentasDelProveedor = () => PROVEEDOR.request({ method: 'eth_accounts' });

/* ── un llavero con tres wallets, como el de quien se queja ───────────────── */

const llave = await ll.crearLlavero('123456');
const uno = (await ll.crearWallet(llave, 'Del día a día')).wallet;
const dos = (await ll.crearWallet(llave, 'La de los encargos')).wallet;
const tres = (await ll.crearWallet(llave, 'Ahorro')).wallet;

console.log('\ntres wallets distintas en el mismo teléfono');
dice('están las tres', ll.listar().length === 3);
dice(
  'y ninguna comparte dirección con otra',
  new Set(ll.listar().map((w) => w.direccion.toLowerCase())).size === 3,
);

/* ── el aviso que faltaba ─────────────────────────────────────────────────── */

const avisos = [];
const dejar = ses.alCambiarDeWallet((d) => avisos.push(d));

console.log('\nabrir con la primera no es cambiar de nada');
await ses.abrirSesion(llave, uno);
dice('la sesión queda abierta', ses.cuentaViva() !== null);
dice('con la primera', ses.walletViva().id === uno.id);
dice('y NO se avisa de un cambio que no ha habido', avisos.length === 0);

console.log('\nvolver a abrir la MISMA tampoco');
await ses.abrirSesion(llave, uno);
// Pasa de verdad: al desbloquear la app se reabre la de siempre. Avisar aquí
// movería a wagmi de sitio en cada arranque, sin que nada haya cambiado.
dice('sigue sin avisar', avisos.length === 0);

console.log('\ncambiar a la segunda');
await ses.abrirSesion(llave, dos);
dice('la sesión es ya la segunda', ses.walletViva().id === dos.id);
dice('se avisa una vez', avisos.length === 1);
dice('con la dirección NUEVA', avisos[0].toLowerCase() === dos.direccion.toLowerCase());
dice('y se recuerda cuál para la próxima', ses.idRecordado() === dos.id);

console.log('\ny a la tercera');
await ses.abrirSesion(llave, tres);
dice('otro aviso', avisos.length === 2);
dice('con la tercera', avisos[1].toLowerCase() === tres.direccion.toLowerCase());

console.log('\nsoltar el aviso deja de avisar');
dejar();
await ses.abrirSesion(llave, uno);
dice('ni un aviso más', avisos.length === 2);
dice('pero la sesión sí cambió', ses.walletViva().id === uno.id);

/* ── lo que ve wagmi ──────────────────────────────────────────────────────── */

console.log('\nel proveedor EIP-1193 va detrás de la sesión');
await ses.abrirSesion(llave, dos);
dice('dice la dirección de la segunda', (await cuentasDelProveedor())[0] === dos.direccion);
await ses.abrirSesion(llave, tres);
dice('y luego la de la tercera', (await cuentasDelProveedor())[0] === tres.direccion);

/**
 * El conector, montado como lo monta wagmi.
 *
 * `emitter.emit('change')` es exactamente lo que wagmi escucha para recolocar
 * la dirección conectada. Aquí se le pone un emisor de mentira que apunta lo
 * que sale: si esto deja de emitirse, la app vuelve a quedarse anclada y no lo
 * notaría ningún typecheck.
 */
const emitidos = [];
const conector = conectorLlavero()({
  chains: [activeChain],
  emitter: { emit: (evento, datos) => emitidos.push({ evento, datos }) },
});

console.log('\nel conector le cuenta a wagmi los cambios');
dice('se llama como espera la app', conector.id === ID_LLAVERO);
const conectado = await conector.connect();
dice('conecta con la que hay', conectado.accounts[0] === tres.direccion);
dice('y todavía no ha emitido nada', emitidos.length === 0);

await ses.abrirSesion(llave, uno);
dice('al cambiar emite un `change`', emitidos.length === 1 && emitidos[0].evento === 'change');
dice(
  'con la dirección nueva',
  emitidos[0].datos.accounts[0].toLowerCase() === uno.direccion.toLowerCase(),
);
dice('y en la red de Panal', emitidos[0].datos.chainId === activeChain.id);
dice('las cuentas del conector también', (await conector.getAccounts())[0] === uno.direccion);

console.log('\ndesconectar suelta el oyente');
await conector.disconnect();
dice('la sesión se cierra', ses.cuentaViva() === null);
await ses.abrirSesion(llave, dos);
await ses.abrirSesion(llave, tres);
// Sin soltarlo quedaría un oyente vivo por cada `connect`, y cada uno emitiría
// sobre un emisor que ya no le corresponde a nadie.
dice('y no emite nada más', emitidos.length === 1);

/* ── firmar con la que se cambió ──────────────────────────────────────────── */

console.log('\nse firma con la wallet que está puesta, no con la de antes');
await ses.abrirSesion(llave, dos);
const cliente = createWalletClient({
  account: dos.direccion,
  chain: activeChain,
  transport: custom(PROVEEDOR),
});
const mensaje = 'panal:result:42:1780000000';
const firma = await cliente.signMessage({ message: mensaje });
dice(
  'la dirección que sale de la firma es la de la segunda',
  await verifyMessage({ address: dos.direccion, message: mensaje, signature: firma }),
);
dice(
  'y NO la de la primera',
  !(await verifyMessage({ address: uno.direccion, message: mensaje, signature: firma })),
);

/* ── un cambio que falla no deja la app a medias ──────────────────────────── */

console.log('\nsi el cambio falla, se queda la que había');
const fantasma = { ...tres, id: 'una-que-ya-no-esta' };
let reventado = false;
try {
  await ses.abrirSesion(llave, fantasma);
} catch {
  reventado = true;
}
dice('falla en vez de tragárselo', reventado);
dice('la sesión sigue siendo la segunda', ses.walletViva().id === dos.id);
dice('y sigue firmando', ses.cuentaViva() !== null);

/* ── el nombre ────────────────────────────────────────────────────────────── */

console.log('\nponerle nombre a una wallet');
dice('devuelve el nombre que se ha guardado', ll.renombrar(dos.id, '  Nómina  ') === 'Nómina');
dice('y está en el disco', ll.listar().find((w) => w.id === dos.id).nombre === 'Nómina');
dice(
  'los saltos de línea se van',
  ll.renombrar(dos.id, 'Para\nlos\tencargos') === 'Para los encargos',
);
dice(
  'un nombre larguísimo se recorta',
  ll.renombrar(dos.id, 'x'.repeat(200)).length === ll.MAX_NOMBRE,
);
dice('en blanco no deja una fila sin nombre', ll.renombrar(dos.id, '   ').length > 0);
dice('renombrar una que no está devuelve null', ll.renombrar('no-existe', 'Hola') === null);

console.log('\ny el nombre nuevo llega a la sesión');
ll.renombrar(dos.id, 'Nómina');
ses.renombrarEnSesion(dos.id, 'Nómina');
dice('la wallet en uso ya se llama así', ses.walletViva().nombre === 'Nómina');
ses.renombrarEnSesion(tres.id, 'Otra cosa');
dice('renombrar otra no toca la que firma', ses.walletViva().nombre === 'Nómina');

console.log('\nel nombre automático no repite');
// Con tres wallets, borrar la de en medio y crear otra daba «Wallet 3»
// habiendo ya una «Wallet 3»: dos filas idénticas donde se elige con qué pagar.
ll.renombrar(uno.id, 'Wallet 1');
ll.renombrar(dos.id, 'Wallet 2');
ll.renombrar(tres.id, 'Wallet 3');
ll.borrar(dos.id);
dice('coge el primer hueco libre', ll.nombrePorDefecto() === 'Wallet 2');
const cuarta = (await ll.crearWallet(llave, ll.nombrePorDefecto())).wallet;
dice('y la nueva no se llama como ninguna', ll.nombrePorDefecto() === 'Wallet 4');
dice(
  'no hay dos wallets con el mismo nombre',
  new Set(ll.listar().map((w) => w.nombre)).size === ll.listar().length,
);
dice('la nueva se puede usar como cualquiera', cuarta.direccion !== uno.direccion);

console.log(`\n${bien} bien · ${mal} mal\n`);
process.exit(mal === 0 ? 0 : 1);
