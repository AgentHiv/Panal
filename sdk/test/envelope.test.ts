/**
 * Pruebas del sobre que viaja entre agentes.
 *
 *   npx tsx test/envelope.test.ts
 *
 * HERMÉTICO: no toca la red. Simula cadenas de agentes en memoria, incluido el
 * ciclo A→B→C→A, que es el caso que sin esto se come el presupuesto dando
 * vueltas.
 *
 * Todo lo que se comprueba aquí protege dinero: cada salto de una cadena es un
 * pago real, así que un límite que falle en silencio es gasto que nadie
 * autorizó.
 */

import { parseEther } from 'viem';
import type { Address } from 'viem';
import {
  BudgetExhausted,
  DEFAULT_DEPTH,
  DepthExhausted,
  ENVELOPE_HEADERS,
  LoopDetected,
  MAX_DEPTH,
  assertCanServe,
  descend,
  envelopeHeaders,
  newEnvelope,
  parseEnvelope,
  remainingBudget,
} from '../src/index.js';

let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`✅ ${label}${detail ? `: ${detail}` : ''}`);
  else {
    failures += 1;
    console.error(`❌ ${label}${detail ? `: ${detail}` : ''}`);
  }
}

function throws(label: string, fn: () => unknown, type: new (...a: never[]) => Error): void {
  try {
    fn();
    check(label, false, 'no lanzó, y debía');
  } catch (err) {
    check(label, err instanceof type, err instanceof Error ? err.message.split(':')[0]! : String(err));
  }
}

const A = '0xAAAA000000000000000000000000000000000001' as Address;
const B = '0xbbbb000000000000000000000000000000000002' as Address;
const C = '0xCCcc000000000000000000000000000000000003' as Address;

console.log('── 1. Abrir una cadena ──');

const raiz = newEnvelope({ budget: parseEther('0.1') });
check('trae identificador de traza', raiz.trace.length > 0, raiz.trace);
check('profundidad por defecto', raiz.depth === DEFAULT_DEPTH, String(raiz.depth));
check('el path empieza vacío', raiz.path.length === 0);
// Sin tope duro, un agente hostil pediría mil saltos y cada uno cuesta dinero.
check('una profundidad absurda se recorta al tope', newEnvelope({ budget: 1n, depth: 9999 }).depth === MAX_DEPTH);
check('una profundidad negativa se queda en cero', newEnvelope({ budget: 1n, depth: -5 }).depth === 0);

console.log('\n── 2. Descender un salto ──');

const trasA = descend(raiz, A, parseEther('0.03'));
check('gasta un salto', trasA.depth === raiz.depth - 1, `${raiz.depth} → ${trasA.depth}`);
check('descuenta lo pagado del presupuesto', trasA.budget === parseEther('0.07'), trasA.budget.toString());
check('quien delega se añade al path', trasA.path.length === 1 && trasA.path[0]!.toLowerCase() === A.toLowerCase());
check('la traza se conserva por toda la cadena', trasA.trace === raiz.trace);

throws('sin presupuesto no se delega', () => descend(trasA, B, parseEther('99')), BudgetExhausted);

let agotado = raiz;
for (const quien of [A, B, C]) agotado = descend(agotado, quien, 1n);
check('tras tres saltos la profundidad es cero', agotado.depth === 0, String(agotado.depth));
throws('sin saltos no se delega más', () => descend(agotado, '0xdddd000000000000000000000000000000000004' as Address, 1n), DepthExhausted);

console.log('\n── 3. El ciclo A → B → C → A ──');

// Esto es lo que justifica todo el módulo. Sin el path, esta cadena giraría
// para siempre y cada vuelta sería un pago real.
let cadena = newEnvelope({ budget: parseEther('1'), depth: 8 });
cadena = descend(cadena, A, parseEther('0.01')); // A paga a B
cadena = descend(cadena, B, parseEther('0.01')); // B paga a C
check('el path recuerda por dónde ha pasado', cadena.path.length === 2, cadena.path.join(' → '));

throws('C no puede volver a A: se corta el bucle', () => descend(cadena, A, parseEther('0.01')), LoopDetected);
throws('y del lado servidor A rechaza atenderlo', () => assertCanServe(cadena, A), LoopDetected);
check('un agente nuevo sí puede atender', (() => {
  assertCanServe(cadena, C);
  return true;
})());
check('sin sobre no hay nada que vigilar', (() => {
  assertCanServe(null, A);
  return true;
})());

console.log('\n── 4. Las cabeceras van y vuelven ──');

const cabeceras = envelopeHeaders(cadena);
check('se emiten las cuatro cabeceras', Object.keys(cabeceras).length === 4, Object.keys(cabeceras).join(' '));
const devuelto = parseEnvelope(cabeceras)!;
check('ida y vuelta sin pérdida', devuelto.trace === cadena.trace && devuelto.depth === cadena.depth && devuelto.budget === cadena.budget);
check('el path sobrevive al viaje', devuelto.path.length === cadena.path.length);
check('sin cabecera de traza no hay sobre', parseEnvelope({}) === null);

console.log('\n── 5. Cabeceras hostiles: las escribe quien llama ──');

// Nada de esto debe lanzar: un sobre corrupto se sanea, no tumba al agente.
const basura = parseEnvelope({
  [ENVELOPE_HEADERS.trace]: 'x'.repeat(500),
  [ENVELOPE_HEADERS.depth]: '999999',
  [ENVELOPE_HEADERS.budget]: 'no-soy-un-numero',
  [ENVELOPE_HEADERS.path]: 'basura,0xnope,' + A,
})!;
check('una traza gigante se recorta', basura.trace.length === 128, String(basura.trace.length));
check('una profundidad enorme se limita al tope', basura.depth === MAX_DEPTH, String(basura.depth));
check('un presupuesto ilegible se queda en cero', basura.budget === 0n, basura.budget.toString());
check('las direcciones inválidas del path se descartan', basura.path.length === 1, basura.path.join(','));
check('un presupuesto negativo se queda en cero', parseEnvelope({ [ENVELOPE_HEADERS.trace]: 't', [ENVELOPE_HEADERS.budget]: '-5' })!.budget === 0n);

console.log('\n── 6. Heredar no puede ampliar lo autorizado ──');

// Un sobre que dice "tienes 100" no debe permitir gastar más de lo que el
// operador del agente permitió en su propia configuración.
check('manda el menor de los dos topes', remainingBudget({ ...raiz, budget: parseEther('100') }, parseEther('0.5')) === parseEther('0.5'));
check('y también al revés', remainingBudget({ ...raiz, budget: parseEther('0.2') }, parseEther('0.5')) === parseEther('0.2'));
check('sin sobre manda el tope propio', remainingBudget(null, parseEther('0.5')) === parseEther('0.5'));

console.log('');
if (failures === 0) console.log('✅ El sobre corta ciclos, acota la profundidad y no deja ampliar el presupuesto');
else {
  console.error(`❌ ${failures} comprobación(es) fallaron`);
  process.exitCode = 1;
}
