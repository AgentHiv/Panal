/**
 * Los encargos de ejemplo de un agente, leídos por las cuatro capas que los leen.
 *
 *     npx tsx scripts/test-ejemplos.ts
 *
 * Viven en el `metadataURI`, como los niveles y el tipo, así que el riesgo es
 * el mismo: un token que una capa reconoce y otra no CORRE LAS POSICIONES, y el
 * agente aparece en el mercado con «ejemplo:Revisa este contrato» de skill
 * suya, o pegado al final de su descripción en la app. Las cuatro capas no
 * comparten código a propósito:
 *
 *   - el marketplace   `src/lib/agentMetadata.ts`, que además los ESCRIBE
 *   - el SDK           `sdk/src/ejemplos.ts`, la referencia del formato
 *   - la app           `movil/src/lib/ficha.ts`, que también los escribe
 *   - el bot           `bot/src/ejemplos.ts`, con su propio lockfile
 *
 * Y dos casos que importan más que el resto:
 *
 *   1. La descripción es texto libre. «Ejemplo: traduzco tu web» tiene que
 *      seguir siendo descripción, no un botón.
 *   2. Editar la ficha desde cualquiera de los dos formularios no puede
 *      llevarse por delante los niveles ni el tipo que ya había.
 */
import {
  componerEjemplo,
  esTokenDeEjemplo,
  leerEjemplosDeMetadata,
  leerNivelesDeMetadata,
  leerTipo,
} from '@panal/sdk';
import { composeAgentMetadata, parseAgentMetadata } from '../src/lib/agentMetadata';
import { armarFicha, partirFicha } from '../movil/src/lib/ficha';
import {
  esTokenDeEjemplo as esTokenDeEjemploBot,
  leerEjemplosDeMetadata as leerEjemplosBot,
} from '../bot/src/ejemplos';

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

/** Una ficha de mainnet con todo lo que puede llevar, y tres ejemplos detrás. */
const FICHA =
  'Lint · Reviews source code and tells you what it does, what breaks, and the exact input that breaks it · ' +
  'code, review, security · bot:https://lint.panal.lat · logo:https://lint.panal.lat/logo.svg · ' +
  'nivel:0.03|Un archivo|Un fichero o un fragmento · ' +
  'ejemplo:Review this Solidity contract and tell me what breaks · ' +
  'ejemplo:Is this function safe against reentrancy? · ' +
  'ejemplo:Find the input that crashes this parser';

console.log('\n─── las cuatro capas leen los mismos tres ejemplos ───');
const delSdk = leerEjemplosDeMetadata(FICHA);
const delBot = leerEjemplosBot(FICHA);
const delMercado = parseAgentMetadata(FICHA).ejemplos;
const deLaApp = partirFicha(FICHA).ejemplos;
const firma = (xs: string[]): string => xs.join(' | ');

check('el SDK lee tres', delSdk.length === 3, String(delSdk.length));
check('el bot lee lo MISMO', firma(delBot) === firma(delSdk), firma(delBot));
check('el mercado lee lo MISMO', firma(delMercado) === firma(delSdk), firma(delMercado));
check('la app lee lo MISMO', firma(deLaApp) === firma(delSdk), firma(deLaApp));

console.log('\n─── y ninguna se los come como skills ni como descripción ───');
const campos = parseAgentMetadata(FICHA);
check('el nombre es el nombre', campos.name === 'Lint', campos.name);
check('la descripción no arrastra ningún ejemplo', !campos.description.includes('ejemplo:'), campos.description);
check(
  'las skills son tres y ninguna es un ejemplo',
  campos.skills.length === 3 && !campos.skills.some((s) => s.includes('ejemplo:')),
  campos.skills.join(' | '),
);
const app = partirFicha(FICHA);
check('en la app, la descripción tampoco (aquí se une todo lo que sobra)', !app.descripcion.includes('ejemplo:'), app.descripcion);
check('los niveles siguen ahí', campos.niveles.length === 1);
check('y el logo', campos.marca.logo === 'https://lint.panal.lat/logo.svg');

console.log('\n─── LA TRAMPA: una descripción que empieza por «Ejemplo:» ───');
const CONFRASE = 'Babel · Ejemplo: traduzco tu web en un día · traducción · bot:https://babel.example';
check('la frase se queda en su descripción', parseAgentMetadata(CONFRASE).description.startsWith('Ejemplo: traduzco'));
check('y no sale ningún ejemplo en el mercado', parseAgentMetadata(CONFRASE).ejemplos.length === 0);
check('ni en la app', partirFicha(CONFRASE).ejemplos.length === 0);
check('ni en el bot', leerEjemplosBot(CONFRASE).length === 0);
for (const capa of [esTokenDeEjemplo, esTokenDeEjemploBot]) {
  check('«Ejemplo:traduzco» con mayúscula no es token', !capa('Ejemplo:traduzco'));
  check('«ejemplo: traduzco» con espacio tampoco', !capa('ejemplo: traduzco'));
}

console.log('\n─── una ficha SIN ejemplos se escribe igual que siempre ───');
const VIEJA = 'LexPanal · Resume contratos en lenguaje claro · legal, resumen · bot:https://bot.panal.lat · x:panal_mon';
const vieja = parseAgentMetadata(VIEJA);
check('sin ejemplos es lista vacía', vieja.ejemplos.length === 0);
check(
  'y recomponerla da EXACTAMENTE la misma cadena',
  composeAgentMetadata({ ...vieja }) === VIEJA,
  composeAgentMetadata({ ...vieja }),
);
check(
  'en la app también',
  armarFicha('LexPanal', 'Resume contratos en lenguaje claro · legal, resumen', 'https://bot.panal.lat', vieja.marca) ===
    VIEJA,
  armarFicha('LexPanal', 'Resume contratos en lenguaje claro · legal, resumen', 'https://bot.panal.lat', vieja.marca),
);

console.log('\n─── ida y vuelta desde los dos formularios ───');
const web = composeAgentMetadata({ ...campos, ejemplos: ['Revisa esto', '', '¿Tiene reentrancy?'] });
check('la web escribe los rellenos y salta el vacío', firma(leerEjemplosDeMetadata(web)) === 'Revisa esto | ¿Tiene reentrancy?', firma(leerEjemplosDeMetadata(web)));
check('sin tocar los niveles', leerNivelesDeMetadata(web).length === 1);
check('y el bot lo lee igual', firma(leerEjemplosBot(web)) === firma(leerEjemplosDeMetadata(web)));
const movil = armarFicha(app.nombre, app.descripcion, 'https://lint.panal.lat', app.marca, app.niveles, 'persona', [
  'Uno nuevo',
]);
check('la app escribe el suyo', firma(leerEjemplosDeMetadata(movil)) === 'Uno nuevo', firma(leerEjemplosDeMetadata(movil)));
check('arrastrando los niveles', leerNivelesDeMetadata(movil).length === 1);
check('y el tipo', leerTipo(movil) === 'persona');
check('un ejemplo con «·» no se escribe nunca', componerEjemplo('uno · dos') === null);
check(
  'ni desde la web, aunque llegue hasta aquí',
  !composeAgentMetadata({ ...vieja, ejemplos: ['uno · dos'] }).includes('ejemplo:'),
);

console.log(fallos === 0 ? '\nTodo bien.\n' : `\n${fallos} fallo(s).\n`);
process.exit(fallos === 0 ? 0 : 1);
