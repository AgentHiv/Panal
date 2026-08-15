/**
 * El tope de brief que publica el agente: leerlo bien, y sobre todo distinguir
 * «no lo declara» de «no tiene tope».
 *
 * Confundir las dos cosas es lo que hace que un cliente descubra el límite
 * pagando: el encargo se entrega DESPUÉS de crear la tarea en la cadena, así
 * que un brief rechazado deja el dinero bloqueado hasta que vence el plazo.
 */
import { fetchAgentLimits, parseMaxBriefChars } from '../src/fetch-result.js';

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

// --- lectura de la tarjeta --------------------------------------------------

const conTope = (n: unknown) => ({ endpoints: { postBrief: { maxBriefChars: n } } });

check('lee el tope cuando el agente lo declara', parseMaxBriefChars(conTope(32_000)) === 32_000);

check(
  'una tarjeta sin endpoints es «no lo sé», no «sin tope»',
  parseMaxBriefChars({ agent: '0xabc', protocol: 'panal' }) === null,
);

check('una tarjeta sin postBrief tampoco inventa un tope', parseMaxBriefChars({ endpoints: {} }) === null);

// Un tope de 0 o negativo dejaría al agente incontratable. Si quiere no
// trabajar, se da de baja en el registry; no manda un campo imposible.
check('un tope de 0 se ignora', parseMaxBriefChars(conTope(0)) === null);
check('un tope negativo se ignora', parseMaxBriefChars(conTope(-5)) === null);
check('un tope no entero se ignora', parseMaxBriefChars(conTope(1.5)) === null);
check('un tope que llega como texto se ignora', parseMaxBriefChars(conTope('4000')) === null);
check('una tarjeta que no es objeto no rompe', parseMaxBriefChars(null) === null && parseMaxBriefChars(42) === null);

// --- contra los agentes de verdad -------------------------------------------

const url = process.env.TEST_AGENT_URL;
if (url) {
  const { maxBriefChars } = await fetchAgentLimits(url);
  check(
    `${url} contesta sin romper (tope: ${maxBriefChars ?? 'no declarado'})`,
    maxBriefChars === null || maxBriefChars > 0,
  );
}

// Una URL que el guard SSRF rechaza no puede tumbar un presupuesto: se queda
// sin comprobar, que es distinto de fallar.
const interna = await fetchAgentLimits('http://127.0.0.1:1/');
check('una URL interna no revienta, solo deja el tope sin saber', interna.maxBriefChars === null);

console.log(fallos === 0 ? '\n✅ Todas las comprobaciones de límites pasaron' : `\n❌ ${fallos} fallo(s)`);
process.exit(fallos === 0 ? 0 : 1);
