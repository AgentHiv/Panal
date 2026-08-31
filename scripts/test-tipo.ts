/**
 * Quién hay al otro lado, leído por las cuatro capas que leen la ficha.
 *
 *     npx tsx scripts/test-tipo.ts
 *
 * `tipo:persona` es el tercer token que vive dentro del `metadataURI`, junto a
 * `bot:`, los de marca y los de nivel. Y como los otros dos, lo reparten
 * CUATRO implementaciones que no comparten código a propósito: el marketplace
 * (`src/lib/agentMetadata.ts`), el SDK (`sdk/src/tipo.ts` y `types.ts`), el
 * bot (`bot/src/tipo.ts`, con su propio lockfile) y la app.
 *
 * Lo que se rompe si se separan no da ningún error. Un token que una capa
 * reconoce y otra no CORRE LAS POSICIONES: el agente aparece con
 * «tipo:persona» de skill suya y su descripción donde iba el nombre. Se ve
 * mirando la web, no leyendo ninguno de los cuatro archivos.
 *
 * Y hay algo más que aquí muerde y en los niveles no: este token decide EN QUÉ
 * MERCADO sale un agente. Si la app o el panel dejaran de arrastrarlo al
 * guardar, una persona que corrige una tilde de su descripción reaparecería en
 * el mercado de programas —comparada por tiempo de respuesta con bots que
 * contestan en segundos— y no se enteraría hasta dejar de recibir encargos.
 */
import {
  esTokenDeTipo,
  leerTipo,
  leerTipoDeSegmento,
  parseAgentMetadata as parseSdk,
  tokenDeTipo,
} from '@panal/sdk';
import { composeAgentMetadata, parseAgentMetadata } from '../src/lib/agentMetadata';
import { armarFicha, partirFicha } from '../movil/src/lib/ficha';
import {
  esTokenDeTipo as esTokenBot,
  leerTipo as leerTipoBot,
  tokenDeTipo as tokenDeTipoBot,
} from '../bot/src/tipo';

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

/** Una ficha de persona, con todo lo demás que hoy le cabe. */
const DE_PERSONA =
  'Marta · Traduce contratos ES⇄FR · traducción, jurídico · ' +
  'bot:https://api.panal.lat/buzon/0x1558cF6a5d9C4d6C0dE7b4b0a2b1D8a3f5E6c7B8 · ' +
  'tipo:persona · logo:https://marta.dev/logo.png · nivel:5|Urgente|En 24 h|4000||';

/** La misma sin el token: es lo que son los diez agentes ya registrados. */
const DE_BOT = 'Lint · Revisa código TypeScript · lint, typescript · bot:https://lint.panal.lat';

/* ── qué dice cada segmento ──────────────────────────────────────────────── */

console.log('\n── Un tipo solo cuenta si dice algo ──\n');

for (const [seg, esperado] of [
  ['tipo:persona', 'persona'],
  ['tipo:bot', 'bot'],
  ['  TIPO:Persona  ', 'persona'],
] as const) {
  check(`«${seg.trim()}» → ${esperado}`, leerTipoDeSegmento(seg) === esperado);
  check('  y el bot lo lee igual', esTokenBot(seg) === true);
}

// `tipo:` con cualquier otra cosa detrás NO es un token: es texto que alguien
// escribió, y apartarlo se lo borraría de su descripción sin decírselo.
for (const seg of ['tipo:', 'tipo:empresa', 'tipo de servicio: rápido', 'prototipo:algo']) {
  check(`«${seg}» no es un tipo`, leerTipoDeSegmento(seg) === null && !esTokenDeTipo(seg));
  check('  el bot tampoco lo aparta', !esTokenBot(seg));
}

/* ── qué dice la ficha entera ────────────────────────────────────────────── */

console.log('\n── Y lo leen igual las cuatro capas ──\n');

check('el SDK ve a la persona', leerTipo(DE_PERSONA) === 'persona');
check('el bot también', leerTipoBot(DE_PERSONA) === 'persona');
check('el marketplace también', parseAgentMetadata(DE_PERSONA).tipo === 'persona');
check('y la app también', partirFicha(DE_PERSONA).tipo === 'persona');

check('sin token es un programa (SDK)', leerTipo(DE_BOT) === 'bot');
check('  el bot igual', leerTipoBot(DE_BOT) === 'bot');
check('  el marketplace igual', parseAgentMetadata(DE_BOT).tipo === 'bot');
check('  la app igual', partirFicha(DE_BOT).tipo === 'bot');
check('y una ficha vacía no es nadie raro', leerTipo('') === 'bot' && leerTipoBot('') === 'bot');

/* ── y ninguna lo confunde con texto de la ficha ─────────────────────────── */

console.log('\n── El token no acaba escrito en la tarjeta de nadie ──\n');

const web = parseAgentMetadata(DE_PERSONA);
check('el marketplace no lo mete de skill', !web.skills.some((s) => s.toLowerCase().includes('tipo:')));
check('  ni en la descripción', !web.description.toLowerCase().includes('tipo:'));
check('  y el nombre sigue siendo el nombre', web.name === 'Marta');

const sdk = parseSdk(DE_PERSONA);
check('el SDK tampoco', !sdk.skills.some((s) => s.toLowerCase().includes('tipo:')) && sdk.name === 'Marta');

const app = partirFicha(DE_PERSONA);
check(
  'y la app tampoco, que arma la descripción con TODO lo que sobra',
  !app.descripcion.toLowerCase().includes('tipo:') && app.nombre === 'Marta',
  app.descripcion,
);

/* ── y sobrevive a que lo editen ─────────────────────────────────────────── */

console.log('\n── Editar la descripción no cambia de mercado a nadie ──\n');

// El panel de la web: se lee, se cambia la descripción, se vuelve a escribir.
const editadaWeb = composeAgentMetadata({
  name: web.name,
  description: 'Traduce contratos ES⇄FR, y ahora también DE',
  skills: web.skills,
  botUrl: web.botUrl,
  marca: web.marca,
  niveles: web.niveles,
  tipo: web.tipo,
});
check('el panel la devuelve como persona', leerTipo(editadaWeb) === 'persona', editadaWeb);
check('  con su nivel intacto', parseAgentMetadata(editadaWeb).niveles.length === 1);

// La app, que no tiene formulario para esto y lo arrastra tal cual.
const editadaApp = armarFicha(
  app.nombre,
  'Traduce contratos ES⇄FR, y ahora también DE',
  'https://api.panal.lat/buzon/0x1558cF6a5d9C4d6C0dE7b4b0a2b1D8a3f5E6c7B8',
  app.marca,
  app.niveles,
  app.tipo,
);
check('la app también', leerTipo(editadaApp) === 'persona', editadaApp);
check('  y el bot lee lo que escribió la app', leerTipoBot(editadaApp) === 'persona');

/* ── un programa no paga por decir que lo es ─────────────────────────────── */

console.log('\n── Y la ficha de un programa no engorda ──\n');

check('«bot» no escribe token (SDK)', tokenDeTipo('bot') === null);
check('  ni en el bot', tokenDeTipoBot('bot') === null);
check('«persona» sí', tokenDeTipo('persona') === 'tipo:persona' && tokenDeTipoBot('persona') === 'tipo:persona');

const bot = parseAgentMetadata(DE_BOT);
const recompuesta = composeAgentMetadata({
  name: bot.name,
  description: bot.description,
  skills: bot.skills,
  botUrl: bot.botUrl,
  marca: bot.marca,
  niveles: bot.niveles,
  tipo: bot.tipo,
});
check(
  'y su ficha sale carácter por carácter como estaba',
  recompuesta === DE_BOT,
  `\n    antes: ${DE_BOT}\n    ahora: ${recompuesta}`,
);

console.log(
  fallos === 0
    ? '\n✅ Las cuatro capas dicen quién hay al otro lado, y nadie cambia de mercado por editar una tilde\n'
    : `\n❌ ${fallos} comprobación(es) fallidas: las implementaciones se han separado\n`,
);
process.exit(fallos === 0 ? 0 : 1);
