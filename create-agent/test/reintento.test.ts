/**
 * Aguantar a un proveedor con hipo.
 *
 *     npx tsx test/reintento.test.ts     (o: npm test)
 *
 * Hermético: `fetch` se sustituye por uno de mentira y las esperas se saltan,
 * así que no toca la red ni tarda quince segundos en pasar.
 *
 * Lo que se comprueba de verdad es QUÉ NO SE REINTENTA. Reintentar un 429 sólo
 * cuesta unos segundos; reintentar un 401 gasta cuatro llamadas para llegar a
 * la misma respuesta y retrasa la única noticia útil —que la clave está mal—
 * hasta que se agotan los intentos.
 */

import { esReintentable, fetchModelo } from '../template/src/reintento.js';

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

/** Sin esperas: el test no tiene por qué durar lo que duraría en producción. */
const sinDormir = async (): Promise<void> => {};

/** Un `fetch` que devuelve lo que se le diga, y cuenta cuántas veces le llaman. */
function fetchDeMentira(respuestas: (number | Error)[]): { llamadas: () => number } {
  let i = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    const r = respuestas[Math.min(i, respuestas.length - 1)]!;
    i++;
    if (r instanceof Error) throw r;
    return new Response('{}', { status: r });
  }) as typeof fetch;
  restaurar = () => {
    globalThis.fetch = original;
  };
  return { llamadas: () => i };
}
let restaurar = (): void => {};

console.log('\n── Qué se reintenta y qué no ──\n');

check('un 429 sí', esReintentable(429));
check('un 503 sí', esReintentable(503));
check('un 500 sí', esReintentable(500));
check('un 401 NO: la clave no mejora repitiendo', !esReintentable(401));
check('un 400 NO: la petición está mal formada', !esReintentable(400));
check('un 404 NO: ese modelo no existe', !esReintentable(404));
check('un 200 NO', !esReintentable(200));

console.log('\n── Lo que pasa de verdad ──\n');

let f = fetchDeMentira([200]);
let res = await fetchModelo('https://ejemplo', {}, sinDormir);
check('a la primera, una sola llamada', f.llamadas() === 1 && res.status === 200, String(f.llamadas()));
restaurar();

f = fetchDeMentira([429, 200]);
res = await fetchModelo('https://ejemplo', {}, sinDormir);
check('un 429 pasajero se supera', res.status === 200 && f.llamadas() === 2, `${f.llamadas()} llamadas`);
restaurar();

f = fetchDeMentira([503, 503, 200]);
res = await fetchModelo('https://ejemplo', {}, sinDormir);
check('y dos seguidos también', res.status === 200 && f.llamadas() === 3, `${f.llamadas()} llamadas`);
restaurar();

f = fetchDeMentira([401]);
res = await fetchModelo('https://ejemplo', {}, sinDormir);
check(
  'una clave mala se sabe A LA PRIMERA, no cuatro intentos después',
  res.status === 401 && f.llamadas() === 1,
  `${f.llamadas()} llamadas`,
);
restaurar();

f = fetchDeMentira([429]);
res = await fetchModelo('https://ejemplo', {}, sinDormir);
check(
  'un proveedor caído se rinde y DEVUELVE la respuesta, no revienta',
  res.status === 429 && f.llamadas() === 4,
  `${f.llamadas()} llamadas, status ${res.status}`,
);
restaurar();

console.log('\n── Cuando no hay ni respuesta ──\n');

f = fetchDeMentira([new Error('ECONNRESET'), 200]);
res = await fetchModelo('https://ejemplo', {}, sinDormir);
check('un corte de red pasajero se supera', res.status === 200 && f.llamadas() === 2);
restaurar();

f = fetchDeMentira([new Error('ECONNRESET')]);
let lanzo = '';
try {
  await fetchModelo('https://ejemplo', {}, sinDormir);
} catch (err) {
  lanzo = err instanceof Error ? err.message : String(err);
}
check('si la red nunca vuelve, se lanza el error real', lanzo === 'ECONNRESET', lanzo || 'no lanzó');
restaurar();

console.log(
  fallos === 0
    ? '\n✅ Un proveedor saturado no mata la tarea, y una clave mala no cuesta cuatro llamadas\n'
    : `\n❌ ${fallos} comprobación(es) fallidas\n`,
);
process.exit(fallos === 0 ? 0 : 1);
