/**
 * El reintento del envío del brief.
 *
 *     npx tsx scripts/test-brief-retry.ts
 *
 * Lo que se comprueba no es "reintenta", es CUÁNDO reintenta. Repetir un 403
 * o un 409 solo retrasa la misma noticia, y reenviar tras un fallo de red
 * puede duplicar un encargo que quizá ya entró. El único caso que se repite es
 * el 425, que es el agente diciendo «esa tarea aún no me consta».
 */
import { enviarBriefConReintento } from '../src/lib/botEndpoint.js';

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

const original = globalThis.fetch;
const sinEsperar = async (): Promise<void> => {};

/** Un fetch de mentira que devuelve los códigos que le pongas, en orden. */
function fetchFalso(codigos: number[]): { llamadas: () => number } {
  let i = 0;
  globalThis.fetch = (async () => {
    const code = codigos[Math.min(i, codigos.length - 1)]!;
    i++;
    return new Response(JSON.stringify({ code }), { status: code });
  }) as typeof fetch;
  return { llamadas: () => i };
}

try {
  // A la primera: una sola petición, sin esperas.
  let f = fetchFalso([200]);
  let res = await enviarBriefConReintento('http://x/brief/1', { method: 'POST' }, sinEsperar);
  check('un 200 no se reintenta', res.status === 200 && f.llamadas() === 1, `${f.llamadas()} llamadas`);

  // El caso real: el nodo del agente va por detrás y luego se pone al día.
  f = fetchFalso([425, 200]);
  res = await enviarBriefConReintento('http://x/brief/1', { method: 'POST' }, sinEsperar);
  check('un 425 se reintenta y acaba entregando', res.status === 200 && f.llamadas() === 2, `${f.llamadas()} llamadas`);

  // Un nodo muy rezagado: se intenta tres veces y se devuelve el último.
  f = fetchFalso([425]);
  res = await enviarBriefConReintento('http://x/brief/1', { method: 'POST' }, sinEsperar);
  check('un 425 persistente para en 3 intentos', res.status === 425 && f.llamadas() === 3, `${f.llamadas()} llamadas`);

  // Respuestas firmes. Repetirlas gasta tiempo del cliente para dar la misma
  // noticia, y con el pago ya bloqueado ese tiempo es plazo que se consume.
  for (const code of [401, 403, 409, 500]) {
    f = fetchFalso([code]);
    res = await enviarBriefConReintento('http://x/brief/1', { method: 'POST' }, sinEsperar);
    check(`  un ${code} NO se reintenta`, res.status === code && f.llamadas() === 1, `${f.llamadas()} llamadas`);
  }

  // Un fallo de red no se reintenta: no sabemos si el POST llegó, y reenviar a
  // ciegas un encargo que quizá ya entró es peor que avisar.
  globalThis.fetch = (async () => {
    throw new TypeError('Failed to fetch');
  }) as typeof fetch;
  let lanzo = false;
  try {
    await enviarBriefConReintento('http://x/brief/1', { method: 'POST' }, sinEsperar);
  } catch {
    lanzo = true;
  }
  check('un fallo de red se propaga, no se reenvía a ciegas', lanzo);
} finally {
  globalThis.fetch = original;
}

console.log(fallos === 0 ? '\n✅ Todas las comprobaciones del reintento pasaron' : `\n❌ ${fallos} fallo(s)`);
process.exit(fallos === 0 ? 0 : 1);
