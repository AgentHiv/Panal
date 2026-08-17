/**
 * Pruebas de la ficha de GET /agent.json.
 *
 *   npx tsx test/agent-card.test.ts
 *
 * HERMÉTICO: no toca la red.
 *
 * Lo que se protege aquí es la compatibilidad. Hubo dos formatos y hay agentes
 * en mainnet sirviendo el antiguo: un lector que solo entienda el nuevo los
 * deja fuera del mercado sin que nadie se entere, porque no da error — cae a
 * la convención y funciona hasta el día que un agente escucha en otra ruta.
 */

import { leerDireccion, leerMaxBriefChars, leerX402 } from '../src/agent-card.js';

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

// Las dos fichas REALES, copiadas de bot.panal.lat y spec.panal.lat.
const fichaBot = {
  name: 'LexPanal',
  agent: '0xAAA',
  agentAddress: '0xAAA',
  chainId: 143,
  endpoints: {
    base: 'https://bot.panal.lat',
    postBrief: { method: 'POST', path: '/brief/:taskId', maxBriefChars: 32000 },
    getResult: { method: 'GET', path: '/result/:taskId' },
    x402Ask: { method: 'POST', path: '/x402/ask', url: 'https://bot.panal.lat/x402/ask', amount: '2000000' },
  },
};

const fichaPlantillaVieja = {
  agent: '0xBBB',
  protocol: 'panal',
  network: 'monad-mainnet',
  x402Ask: { method: 'POST', path: '/x402/ask', amount: '500000000000000000' },
};

// --- x402: el campo que estaba en dos sitios -------------------------------

check('encuentra el x402 en la ficha del bot', leerX402(fichaBot)?.url === 'https://bot.panal.lat/x402/ask');
check(
  'encuentra el x402 de un agente de plantilla YA DESPLEGADO',
  leerX402(fichaPlantillaVieja)?.amount === '500000000000000000',
);
check('sin x402 devuelve null, no undefined suelto', leerX402({ agent: '0xCCC' }) === null);

// Un agente a mitad de migración sirve los dos. Gana el canónico: es el que va
// a seguir manteniendo, y el de la raíz es el que va a desaparecer.
const enMigracion = {
  agent: '0xDDD',
  endpoints: { x402Ask: { amount: '111' } },
  x402Ask: { amount: '999' },
};
check('con los dos sitios gana el canónico', leerX402(enMigracion)?.amount === '111', String(leerX402(enMigracion)?.amount));

// --- la dirección, que es lo que verifica el dominio -----------------------

check('lee agent', leerDireccion(fichaBot) === '0xAAA');
check('lee el alias agentAddress de las fichas viejas', leerDireccion({ agentAddress: '0xEEE' }) === '0xEEE');
check('sin dirección devuelve null', leerDireccion({ name: 'x' }) === null);

// --- maxBriefChars: null es NO LO SÉ, nunca «sin tope» ---------------------

check('lee el tope publicado', leerMaxBriefChars(fichaBot) === 32000);
check('una ficha que no lo declara da null (no lo sé)', leerMaxBriefChars(fichaPlantillaVieja) === null);

// La sirve un desconocido: un tope de 0 haría imposible cualquier encargo, y
// eso lo decide el agente bajando su número, no mandando basura en un campo.
for (const malo of [0, -1, 1.5, '32000', null, {}, Infinity, NaN]) {
  check(
    `  un maxBriefChars ${JSON.stringify(malo)} se descarta`,
    leerMaxBriefChars({ endpoints: { postBrief: { maxBriefChars: malo } } }) === null,
  );
}

// --- basura: la ficha viene de fuera y puede ser cualquier cosa ------------

for (const basura of [null, undefined, 42, 'texto', [], { endpoints: null }, { endpoints: 'no' }]) {
  const nombre = JSON.stringify(basura) ?? 'undefined';
  check(`  ${nombre} no revienta ningún lector`, (() => {
    try {
      leerX402(basura);
      leerDireccion(basura);
      leerMaxBriefChars(basura);
      return true;
    } catch {
      return false;
    }
  })());
}

console.log(fallos === 0 ? '\n✅ Todas las comprobaciones de la ficha pasaron' : `\n❌ ${fallos} fallo(s)`);
process.exit(fallos === 0 ? 0 : 1);
