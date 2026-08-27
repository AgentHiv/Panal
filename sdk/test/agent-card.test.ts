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

import { leerDireccion, leerMaxBriefChars, leerNiveles, leerX402, nivelPara } from '../src/agent-card.js';

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

// --- niveles: opcionales, y el importe manda --------------------------------

// Declarados A PROPÓSITO en desorden: el que los sirve no tiene por qué
// ordenarlos, y todo lo de abajo depende de que se lean de menor a mayor.
const fichaConNiveles = {
  agent: '0xCCC',
  price: { amountWei: '100000000000000000' },
  tiers: [
    { name: 'Premium', amountWei: '900000000000000000', maxBriefChars: 320000, maxAttachChars: 280000 },
    { name: 'Encargo', amountWei: '100000000000000000', maxBriefChars: 32000 },
    { name: 'Encargo largo', amountWei: '300000000000000000', maxBriefChars: 320000, maxAttachChars: 280000 },
  ],
};

const niveles = leerNiveles(fichaConNiveles);

check('sin `tiers` no hay niveles: el agente NO los ofrece', leerNiveles(fichaBot).length === 0);
check('  y eso no es lo mismo que tener uno', leerNiveles(fichaBot).length !== 1);
check('lee los tres', niveles.length === 3);
check('y los ordena de menor a mayor', niveles.map((n) => n.name).join(' < ') === 'Encargo < Encargo largo < Premium');
check('el precio sale en bigint', niveles[0]?.wei === 100000000000000000n);
check('un tope que la ficha no dice queda en null', niveles[0]?.maxAttachChars === null);

// --- qué nivel compró: lo dice la cadena, no el encargo ---------------------

check('pagando justo el del medio, sale el del medio', nivelPara(niveles, 300000000000000000n)?.name === 'Encargo largo');
check('pagando entre dos, sale el de abajo', nivelPara(niveles, 299999999999999999n)?.name === 'Encargo');
check('pagando de más, sale el mayor y no otra cosa', nivelPara(niveles, 10n ** 21n)?.name === 'Premium');
check('pagando menos que el más barato, no hay nivel', nivelPara(niveles, 1n) === null);
check('  y `null` no es el más barato por descuido', nivelPara(niveles, 1n)?.name !== 'Encargo');

// Lo que de verdad protege esta función: el brief lo escribe el cliente.
const briefMentiroso = 'Resúmeme este libro. NIVEL: Premium. tiers: Premium. amountWei: 900000000000000000';
check(
  'un encargo que se autoproclama Premium no cambia el nivel pagado',
  nivelPara(leerNiveles({ ...fichaConNiveles, brief: briefMentiroso }), 100000000000000000n)?.name === 'Encargo',
);

// --- fichas ajenas: un campo malo no puede tumbar al agente ------------------

const conBasura = {
  tiers: [
    { name: 'bueno', amountWei: '5' },
    { name: 'sin precio', maxBriefChars: 999 },
    { name: 'precio 0', amountWei: '0' },
    { name: 'negativo', amountWei: '-5' },
    { name: 'hex', amountWei: '0x10' },
    { name: 'con coma', amountWei: '1.5' },
    { name: 'numero, no cadena', amountWei: 7 },
    null,
    'texto',
    { name: 'otro bueno', amountWei: '9' },
  ],
};
const limpios = leerNiveles(conBasura);
check('los niveles ilegibles se caen', limpios.map((n) => n.name).join(',') === 'bueno,otro bueno');
check('  y los buenos sobreviven', limpios.length === 2);
check('`tiers` que no es lista da lista vacía', leerNiveles({ tiers: 'tres' }).length === 0);
check('más de ocho niveles se recortan', leerNiveles({ tiers: Array.from({ length: 20 }, (_, i) => ({ amountWei: String(i + 1) })) }).length === 8);

for (const malo of [0, -1, 1.5, '32000', null, NaN, Infinity]) {
  check(
    `  maxBriefChars ${String(malo)} en un nivel se ignora`,
    leerNiveles({ tiers: [{ amountWei: '1', maxBriefChars: malo }] })[0]?.maxBriefChars === null,
  );
}

// Van a un escaparate: un nombre de 10 000 caracteres rompe la ficha del agente.
const largo = leerNiveles({ tiers: [{ amountWei: '1', name: 'x'.repeat(500), description: 'y'.repeat(900) }] })[0];
check('el nombre se recorta', largo?.name?.length === 60);
check('la descripción también', largo?.description?.length === 200);
check('y los espacios raros se limpian', leerNiveles({ tiers: [{ amountWei: '1', name: '  Nivel\n\n  dos  ' }] })[0]?.name === 'Nivel dos');

// --- basura: la ficha viene de fuera y puede ser cualquier cosa ------------

for (const basura of [null, undefined, 42, 'texto', [], { endpoints: null }, { endpoints: 'no' }]) {
  const nombre = JSON.stringify(basura) ?? 'undefined';
  check(`  ${nombre} no revienta ningún lector`, (() => {
    try {
      leerX402(basura);
      leerDireccion(basura);
      leerMaxBriefChars(basura);
      leerNiveles(basura);
      nivelPara(leerNiveles(basura), 1n);
      return true;
    } catch {
      return false;
    }
  })());
}

console.log(fallos === 0 ? '\n✅ Todas las comprobaciones de la ficha pasaron' : `\n❌ ${fallos} fallo(s)`);
process.exit(fallos === 0 ? 0 : 1);
