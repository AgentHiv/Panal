/**
 * El precio de una pregunta (`pregunta:<precio>`), leído por las capas que leen
 * la ficha.
 *
 *     npx tsx scripts/test-pregunta.ts
 *
 * Vive en el `metadataURI`, como los niveles, el tipo y los ejemplos, y con el
 * mismo riesgo: un token que una capa reconoce y otra no CORRE LAS POSICIONES,
 * y la persona aparece en el mercado con «pregunta:0.5» de skill suya. Las
 * capas:
 *
 *   - el SDK           `sdk/src/pregunta.ts`, la referencia del formato
 *   - el marketplace   `src/lib/agentMetadata.ts`, que además lo ESCRIBE
 *   - la app           `movil/src/lib/ficha.ts`, que también lo escribe
 *   - el bot           `bot/src/pregunta.ts` (ficha que sirve, catálogo y MCP)
 *
 * Y los casos que importan:
 *
 *   1. La descripción es texto libre: «pregunta: ¿qué haces?» sigue siendo
 *      descripción, no un precio.
 *   2. Editar la ficha desde cualquiera de los dos formularios no se lleva por
 *      delante el precio que ya había, ni los niveles, ni el tipo.
 *   3. Una ficha sin pregunta se escribe exactamente como antes.
 */
import {
  componerPregunta,
  esTokenDePregunta,
  leerNivelesDeMetadata,
  leerPrecioDePregunta,
  leerTipo,
  parseAgentMetadata as parseDelSdk,
} from '@panal/sdk';
import { composeAgentMetadata, falloDePregunta, parseAgentMetadata } from '../src/lib/agentMetadata';
import { armarFicha, partirFicha } from '../movil/src/lib/ficha';
import { esTokenDePregunta as esTokenDePreguntaBot } from '../bot/src/pregunta';
import { parseMetadataURI as fichaDelBot } from '../bot/src/http';

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

/** Una persona con todo lo que puede llevar, y su precio por pregunta detrás. */
const FICHA =
  'Marta · Traduzco contratos del español al francés · traducción, jurídico · ' +
  'bot:https://api.panal.lat/buzon/0x70997970C51812dc3A010C7d01b50e0d17dc79C8 · tipo:persona · ' +
  'nivel:5|Urgente|En 24 h|4000 · ejemplo:Traduce este contrato de alquiler · pregunta:0.50';

console.log('\n─── las capas leen el mismo precio ───');
check('el SDK lo lee, normalizado', leerPrecioDePregunta(FICHA) === '0.5', String(leerPrecioDePregunta(FICHA)));
check('el mercado lee lo MISMO', parseAgentMetadata(FICHA).pregunta === '0.5', parseAgentMetadata(FICHA).pregunta);
check('la app lee lo MISMO', partirFicha(FICHA).pregunta === '0.5', partirFicha(FICHA).pregunta);
check('el bot lo reconoce', esTokenDePreguntaBot('pregunta:0.50'));

console.log('\n─── y ninguna se lo come como skill ni como descripción ───');
const campos = parseAgentMetadata(FICHA);
check('el nombre es el nombre', campos.name === 'Marta', campos.name);
check('la descripción no lo arrastra', !campos.description.includes('pregunta:'), campos.description);
check('las skills son dos y ninguna es el precio', campos.skills.join('|') === 'traducción|jurídico', campos.skills.join('|'));
check('el SDK tampoco lo pone de skill', !parseDelSdk(FICHA).skills.some((s) => s.includes('pregunta:')), parseDelSdk(FICHA).skills.join('|'));
check('ni la ficha que sirve el bot', !fichaDelBot(FICHA).skills.some((s) => s.includes('pregunta:')), fichaDelBot(FICHA).skills.join('|'));
check('en la app, la descripción tampoco', !partirFicha(FICHA).descripcion.includes('pregunta:'), partirFicha(FICHA).descripcion);
check('los niveles siguen ahí', campos.niveles.length === 1);
check('y el tipo', campos.tipo === 'persona');

console.log('\n─── LA TRAMPA: una descripción que habla de preguntas ───');
const CONFRASE = 'Babel · pregunta: ¿qué idiomas traduzco? Todos · traducción · tipo:persona';
check('la frase se queda en su descripción', parseAgentMetadata(CONFRASE).description.startsWith('pregunta: ¿qué'));
check('y no hay precio en el mercado', parseAgentMetadata(CONFRASE).pregunta === '');
check('ni en la app', partirFicha(CONFRASE).pregunta === '');
check('ni en el SDK', leerPrecioDePregunta(CONFRASE) === null);
for (const capa of [esTokenDePregunta, esTokenDePreguntaBot]) {
  check('«pregunta:gratis» no es un precio', !capa('pregunta:gratis'));
  check('«pregunta:0» tampoco', !capa('pregunta:0'));
  check('«pregunta: 0.5» con espacio tampoco', !capa('pregunta: 0.5'));
  check('«pregunta:0.5» sí', capa('pregunta:0.5'));
}

console.log('\n─── una ficha SIN pregunta se escribe igual que siempre ───');
const VIEJA = 'LexPanal · Resume contratos en lenguaje claro · legal, resumen · bot:https://bot.panal.lat · x:panal_mon';
const vieja = parseAgentMetadata(VIEJA);
check('sin precio es vacío', vieja.pregunta === '');
check('y recomponerla da EXACTAMENTE la misma cadena', composeAgentMetadata({ ...vieja }) === VIEJA, composeAgentMetadata({ ...vieja }));
check(
  'en la app también',
  armarFicha('LexPanal', 'Resume contratos en lenguaje claro · legal, resumen', 'https://bot.panal.lat', vieja.marca) === VIEJA,
);

console.log('\n─── ida y vuelta desde los dos formularios ───');
const web = composeAgentMetadata({ ...campos, pregunta: '1,25'.replace(',', '.') });
check('la web escribe el suyo, normalizado', leerPrecioDePregunta(web) === '1.25', web);
check('va al final de todo, detrás de los ejemplos', web.trim().endsWith('pregunta:1.25'), web);
check('sin tocar los niveles', leerNivelesDeMetadata(web).length === 1);
check('ni el tipo', leerTipo(web) === 'persona');
const sinPrecio = composeAgentMetadata({ ...campos, pregunta: '' });
check('vaciarlo lo quita', leerPrecioDePregunta(sinPrecio) === null, sinPrecio);
const app = partirFicha(FICHA);
const movil = armarFicha(app.nombre, app.descripcion, 'https://api.panal.lat/buzon/0x70997970C51812dc3A010C7d01b50e0d17dc79C8', app.marca, app.niveles, app.tipo, app.ejemplos, app.pregunta);
check('la app lo arrastra al editar', leerPrecioDePregunta(movil) === '0.5', movil);
check('con los niveles', leerNivelesDeMetadata(movil).length === 1);
check('un precio que no vale no se escribe nunca', componerPregunta('gratis') === null);
check('ni desde la web, aunque llegue hasta aquí', !composeAgentMetadata({ ...vieja, pregunta: 'gratis' }).includes('pregunta:'));

console.log('\n─── el mínimo del escrow ───');
check('0,001 MON vale', falloDePregunta('0.001', 'MON') === null);
check('menos no', falloDePregunta('0.0001', 'MON') === 'minimo');
check('en $PANAL el mínimo es 1', falloDePregunta('0.5', '$PANAL') === 'minimo' && falloDePregunta('1', '$PANAL') === null);
check('con coma decimal también', falloDePregunta('0,5', 'MON') === null);
check('vacío es no contestar preguntas, y vale', falloDePregunta('', 'MON') === null);

console.log(fallos === 0 ? '\n✅ El precio de una pregunta se lee igual en todas las capas\n' : `\n❌ ${fallos} comprobación(es) fallidas\n`);
process.exit(fallos === 0 ? 0 : 1);
