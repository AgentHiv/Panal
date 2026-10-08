/**
 * Si un agente contesta, dicho igual por el mercado y por la hoja de contratar.
 *
 *     npx tsx scripts/test-responde.ts
 *
 * ───────────────────────────────────────────────────────────────────────────
 * LO QUE ESTABA ROTO
 *
 * El mercado pintaba «En línea» a todo agente marcado activo en la cadena, y
 * esa marca solo la quita su dueño. Audit, Lente y Traza llevaban días con el
 * servidor apagado y seguían en el podio; contratarlos bloqueaba el pago en el
 * escrow para un encargo que no iba a llegar a nadie.
 *
 * Ahora la lista lee lo que vio el indexador al verificar el dominio, y la hoja
 * de contratar pregunta al agente antes de dejar pagar. Esto comprueba las dos
 * cosas: qué motivos del indexador cuentan como «no contesta» (un 404 no: ahí
 * hay un servidor), que un dato viejo no acuse a nadie, y que la pregunta
 * directa distinga un servidor que contesta de uno caído o colgado.
 * ───────────────────────────────────────────────────────────────────────────
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { losQueRespondenPrimero, noRespondeSegunIndexador, respondeElAgente } from '../src/lib/reachability.js';

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

const ahora = 1_800_000_000;
const visto = (verificadoMotivo: string, haceS = 3600, verificado: boolean | 'sin-dominio' = false) => ({
  verificado,
  verificadoMotivo,
  verificadoTs: ahora - haceS,
});

console.log('\nlo que dijo el indexador');
check('«el endpoint no responde» → no contesta', noRespondeSegunIndexador(visto('el endpoint no responde'), ahora));
check('«el dominio no resuelve» → no contesta', noRespondeSegunIndexador(visto('el dominio no resuelve'), ahora));
check('un 502 → no contesta', noRespondeSegunIndexador(visto('el endpoint responde 502'), ahora));
check('un 404 → SÍ hay servidor', !noRespondeSegunIndexador(visto('el endpoint responde 404'), ahora));
check(
  'una tarjeta que no declara su dirección → SÍ hay servidor',
  !noRespondeSegunIndexador(visto('la tarjeta no declara esta direccion'), ahora),
);
check('verificado → contesta', !noRespondeSegunIndexador(visto('', 3600, true), ahora));
check('en el buzón de Panal → contesta', !noRespondeSegunIndexador(visto('recibe en el buzon de Panal', 3600, 'sin-dominio'), ahora));
check('sin mirar todavía → no se acusa', !noRespondeSegunIndexador({}, ahora));
check('mirado hace dos días → ya no vale', !noRespondeSegunIndexador(visto('el endpoint no responde', 2 * 86_400), ahora));

console.log('\nel orden');
const orden = losQueRespondenPrimero([
  { n: 'a', status: 'no-responde' },
  { n: 'b', status: 'en-linea' },
  { n: 'c', status: 'no-responde' },
  { n: 'd', status: 'en-linea' },
]).map((x) => x.n);
check('los que contestan delante, sin perder su orden', orden.join('') === 'bdac', orden.join(''));

console.log('\npreguntarle al agente');
const escuchar = (s: Server): Promise<string> =>
  new Promise((ok) => s.listen(0, '127.0.0.1', () => ok(`http://127.0.0.1:${(s.address() as AddressInfo).port}`)));

const vivo = createServer((_, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end('{}');
});
// Uno que contesta sin tarjeta ni CORS: contesta, aunque un fetch normal no
// podría leerlo desde la web.
const sinTarjeta = createServer((_, res) => {
  res.writeHead(404);
  res.end();
});
// Uno que acepta la conexión y no dice nada: el caso que solo para el plazo.
const colgado = createServer(() => {});
const urlVivo = await escuchar(vivo);
const urlSinTarjeta = await escuchar(sinTarjeta);
const urlColgado = await escuchar(colgado);
// Un puerto que se abre y se cierra: ahí ya no escucha nadie.
const cerrado = createServer();
const urlCerrado = await escuchar(cerrado);
await new Promise((ok) => cerrado.close(ok));

check('uno que contesta → sí', await respondeElAgente(urlVivo, 2_000));
check('uno que contesta un 404 → sí (hay servidor)', await respondeElAgente(`${urlSinTarjeta}/`, 2_000));
check('un puerto donde no escucha nadie → no', !(await respondeElAgente(urlCerrado, 2_000)));
const t0 = Date.now();
check('uno que se queda colgado → no, al vencer el plazo', !(await respondeElAgente(urlColgado, 800)));
check('y no espera más de lo pedido', Date.now() - t0 < 3_000, `${Date.now() - t0} ms`);

colgado.closeAllConnections();
for (const s of [vivo, sinTarjeta, colgado]) s.close();

console.log(
  fallos === 0
    ? '\n✅ El mercado y la hoja de contratar dicen lo mismo de quién contesta\n'
    : `\n❌ ${fallos} comprobación(es) fallidas\n`,
);
process.exit(fallos === 0 ? 0 : 1);
