/**
 * Los niveles de un agente, leídos por los cuatro que los leen.
 *
 *     npx tsx scripts/test-niveles.ts
 *
 * Lo que un agente cobra por cada tamaño de encargo vive dentro del
 * `metadataURI`, que es UN campo de texto en el registro. Eso obliga a que todo
 * el que lo lea reparta igual: nombre, descripción, skills… y los tokens fuera.
 * Y lo leen cuatro capas que no comparten código a propósito:
 *
 *   - el marketplace   `src/lib/agentMetadata.ts`, que además los ESCRIBE
 *   - el SDK           `sdk/src/niveles.ts`, la referencia del formato
 *   - la app           `movil/src/lib/ficha.ts`
 *   - el bot           `bot/src/niveles.ts`, con su propio lockfile
 *
 * Lo que se rompe si se separan no da ningún error. Un token que una capa
 * reconoce y otra no CORRE LAS POSICIONES: el agente aparece en el mercado con
 * un `nivel:0.03|Un archivo` de skill suya, o con los tres pegados al final de
 * su descripción. Se ve mirando la web, no leyendo ninguno de los archivos.
 *
 * Y hay dos casos que importan más que el resto:
 *
 *   1. La descripción es texto libre. Alguien va a escribir «nivel: depende
 *      del encargo» ahí dentro, y esa frase NO puede convertirse en un nivel
 *      fantasma ni desaparecer de su ficha.
 *   2. La app no tiene formulario de niveles. Si al editar la descripción
 *      desde el teléfono no los vuelve a escribir, los borra — y lo siguiente
 *      es alguien pagando el precio pequeño por el encargo grande.
 */
import {
  componerNivel,
  conTextoDeLaFicha,
  esTokenDeNivel,
  leerNivelDeSegmento,
  leerNivelesDeMetadata,
  precioAWei,
  weiAPrecio,
} from '@panal/sdk';
import {
  aNivel,
  aNivelEditable,
  composeAgentMetadata,
  falloDeNivel,
  parseAgentMetadata,
  NIVEL_VACIO,
} from '../src/lib/agentMetadata';
import { armarFicha, partirFicha } from '../movil/src/lib/ficha';
import {
  esTokenDeNivel as esTokenDeNivelBot,
  leerNivelesDeMetadata as leerNivelesBot,
} from '../bot/src/niveles';

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

/** Una ficha real de mainnet, con niveles añadidos detrás. */
const FICHA =
  'Lint · Reviews source code and tells you what it does, what breaks, and the exact input that breaks it · ' +
  'code, review, security · bot:https://lint.panal.lat · logo:https://lint.panal.lat/logo.svg · ' +
  'github:AgentHiv/Panal · nivel:0.03|Un archivo|Un fichero o un fragmento · ' +
  'nivel:0.09|Un módulo|Varios ficheros relacionados|60000|60000|120000 · ' +
  'nivel:0.3|El repositorio|Un proyecto entero comprimido|120000|120000|200000';

console.log('\n─── las cuatro capas leen los mismos tres niveles ───');
const delSdk = leerNivelesDeMetadata(FICHA);
const delBot = leerNivelesBot(FICHA);
const delMercado = parseAgentMetadata(FICHA).niveles;
const deLaApp = partirFicha(FICHA).niveles;

const firma = (ns: { name: string | null; wei: bigint; maxBriefChars: number | null }[]): string =>
  ns.map((n) => `${n.name}@${n.wei}/${n.maxBriefChars ?? '-'}`).join(' · ');

check('el SDK lee tres', delSdk.length === 3, String(delSdk.length));
check('el bot lee lo MISMO', firma(delBot) === firma(delSdk), firma(delBot));
check('el mercado lee lo MISMO', firma(delMercado) === firma(delSdk), firma(delMercado));
check('la app lee lo MISMO', firma(deLaApp) === firma(delSdk), firma(deLaApp));

console.log('\n─── y ninguna se los come como skills ni como descripción ───');
const campos = parseAgentMetadata(FICHA);
check('el nombre es el nombre', campos.name === 'Lint', campos.name);
check(
  'la descripción no arrastra ningún nivel',
  !campos.description.includes('nivel:'),
  campos.description,
);
check(
  'las skills son tres y ninguna es un nivel',
  campos.skills.length === 3 && !campos.skills.some((s) => s.includes('nivel:')),
  campos.skills.join(' | '),
);
const app = partirFicha(FICHA);
check('el nombre en la app', app.nombre === 'Lint', app.nombre);
check(
  'y su descripción TAMPOCO los arrastra (aquí se une todo lo que sobra)',
  !app.descripcion.includes('nivel:'),
  app.descripcion,
);
check('el logo sigue leyéndose', campos.marca.logo === 'https://lint.panal.lat/logo.svg');
check('y el bot de siempre', campos.botUrl === 'https://lint.panal.lat');

console.log('\n─── LA TRAMPA: una descripción que habla de niveles ───');
const CONFRASE = 'Spec · Un caso, un módulo: el nivel: depende del encargo · tests, qa · bot:https://spec.panal.lat';
const conFrase = parseAgentMetadata(CONFRASE);
check('la frase se queda en su descripción', conFrase.description.includes('nivel: depende del encargo'), conFrase.description);
check('y NO se inventa un nivel', conFrase.niveles.length === 0, String(conFrase.niveles.length));
check('el bot opina igual', leerNivelesBot(CONFRASE).length === 0);
check('y la app también', partirFicha(CONFRASE).niveles.length === 0);
for (const capa of [esTokenDeNivel, esTokenDeNivelBot]) {
  check('«nivel: depende del encargo» no es un token', !capa('nivel: depende del encargo'));
  check('«Tiene tres niveles: mira la ficha» tampoco', !capa('Tiene tres niveles: mira la ficha'));
}

console.log('\n─── una ficha SIN niveles sigue leyéndose igual que siempre ───');
const VIEJA = 'LexPanal · Resume contratos en lenguaje claro · legal, resumen · bot:https://bot.panal.lat · x:panal_mon';
const vieja = parseAgentMetadata(VIEJA);
check('sin niveles es lista vacía, no un nivel inventado del precio', vieja.niveles.length === 0);
check('nombre intacto', vieja.name === 'LexPanal');
check('descripción intacta', vieja.description === 'Resume contratos en lenguaje claro');
check('skills intactas', vieja.skills.join(',') === 'legal,resumen');
check(
  'y recomponerla da EXACTAMENTE la misma cadena',
  composeAgentMetadata({ ...vieja, niveles: vieja.niveles }) === VIEJA,
  composeAgentMetadata({ ...vieja, niveles: vieja.niveles }),
);

console.log('\n─── ida y vuelta: lo que se firma es lo que se lee ───');
const recompuesta = composeAgentMetadata({ ...campos, niveles: campos.niveles });
check(
  'la ficha con niveles sobrevive entera',
  firma(parseAgentMetadata(recompuesta).niveles) === firma(campos.niveles),
  firma(parseAgentMetadata(recompuesta).niveles),
);
check('y el bot la sigue leyendo igual', firma(leerNivelesBot(recompuesta)) === firma(campos.niveles));

console.log('\n─── EDITAR DESDE EL TELÉFONO NO PUEDE BORRARLOS ───');
// La app no tiene formulario de niveles: los arrastra. Sin eso, cambiar una
// tilde en la descripción se lleva por delante los tres, sin avisar.
const editada = armarFicha(app.nombre, 'Revisa código y dice qué se rompe', 'https://lint.panal.lat', app.marca, app.niveles);
check(
  'los tres niveles siguen ahí tras editar la descripción',
  firma(leerNivelesDeMetadata(editada)) === firma(campos.niveles),
  firma(leerNivelesDeMetadata(editada)),
);
check('y la descripción nueva es la nueva', partirFicha(editada).descripcion === 'Revisa código y dice qué se rompe');
check(
  'olvidarse de arrastrarlos SÍ los borra (por eso existe esta prueba)',
  leerNivelesDeMetadata(armarFicha(app.nombre, 'x', 'https://lint.panal.lat', app.marca)).length === 0,
);

console.log('\n─── el formulario: qué deja firmar y qué no ───');
check('una fila vacía no es un error, es una fila vacía', falloDeNivel(NIVEL_VACIO) === null);
check(
  'nombre sin precio se canta',
  falloDeNivel({ ...NIVEL_VACIO, name: 'Un archivo' }) === 'incompleto',
);
check(
  'precio sin nombre también',
  falloDeNivel({ ...NIVEL_VACIO, precio: '0.03' }) === 'incompleto',
);
check(
  'un precio imposible',
  falloDeNivel({ ...NIVEL_VACIO, name: 'A', precio: 'gratis' }) === 'precio',
);
check(
  'un «·» en el nombre partiría la ficha en dos',
  falloDeNivel({ ...NIVEL_VACIO, name: 'Un · archivo', precio: '0.03' }) === 'separador',
);
check(
  'la coma decimal española vale',
  aNivel({ ...NIVEL_VACIO, name: 'Un archivo', precio: '0,03' })?.wei === 30000000000000000n,
);
check(
  'una fila a medias no llega a la ficha',
  aNivel({ ...NIVEL_VACIO, name: 'Un archivo' }) === null,
);

console.log('\n─── los topes de caracteres se arrastran aunque no se editen ───');
// Los declara el agente desde su código y el formulario no los enseña. Perderlos
// por corregir una tilde sería cambiarle a alguien lo que puede recibir.
const editable = aNivelEditable(campos.niveles[1]!);
check('se leen al abrir el formulario', editable.maxBriefChars === 60000, String(editable.maxBriefChars));
check('el precio se enseña en unidades, no en wei', editable.precio === '0.09', editable.precio);
const vueltos = aNivel({ ...editable, description: 'Otra descripción' });
check('y se vuelven a escribir al guardar', vueltos?.maxBriefChars === 60000);
check('con el texto nuevo', vueltos?.description === 'Otra descripción');

console.log('\n─── el precio, que es lo único que se cobra de verdad ───');
check('0,03 MON son 3e16 wei', precioAWei('0.03') === 30000000000000000n);
check('y vuelven a escribirse sin ceros de relleno', weiAPrecio(30000000000000000n) === '0.03');
check('un nivel gratis no es un nivel', precioAWei('0') === null);
check(
  'el orden es por precio, no por como esté escrito en la ficha',
  leerNivelesDeMetadata('A · b · nivel:0.3|Caro · nivel:0.03|Barato')
    .map((n) => n.name)
    .join(' < ') === 'Barato < Caro',
);
check(
  'y un nivel roto se cae solo, sin llevarse a los de al lado',
  leerNivelesDeMetadata('A · b · nivel:0.03|Bueno · nivel:XX|Malo · nivel:0.3|Otro').length === 2,
);
check('componer y leer un segmento suelto', leerNivelDeSegmento(componerNivel({ name: 'X', precio: '1' })!)?.wei === 10n ** 18n);


console.log('\n─── EL PRECIO DE LA CADENA, EL TEXTO DE LA FICHA ───');
// Caso real de mainnet: i18n tiene sus niveles en la cadena en español y sirve
// su ficha traducida al francés. Prefiriendo los de la cadena —que es lo que se
// hizo primero— el escaparate salía entero en francés y los tres niveles en
// español. Prefiriendo los de la ficha, un agente caído se queda sin niveles.
const enCadena = leerNivelesDeMetadata(
  'i18n · Traduce cadenas · i18n · bot:https://i18n.panal.lat · ' +
    'nivel:0.01|Un texto|Un texto o un fichero de cadenas · ' +
    'nivel:0.03|El lote|Varios ficheros · ' +
    'nivel:0.1|El proyecto|Se traduce entero|120000',
);
const enFrances = leerNivelesDeMetadata(
  'i18n · Traduit · i18n · nivel:0.01|Un texte|Un texte ou un fichier de chaînes · ' +
    'nivel:0.03|Le lot|Plusieurs fichiers · ' +
    'nivel:0.1|Le projet|Tout est traduit',
);
const juntos = conTextoDeLaFicha(enCadena, enFrances);
check(
  'el NOMBRE sale traducido',
  juntos.map((n) => n.name).join(' / ') === 'Un texte / Le lot / Le projet',
  juntos.map((n) => n.name).join(' / '),
);
check('y la descripción también', juntos[0]?.description === 'Un texte ou un fichier de chaînes');
check(
  'pero el PRECIO es el de la cadena, siempre',
  juntos.map((n) => n.wei.toString()).join() === enCadena.map((n) => n.wei.toString()).join(),
);
check(
  'y los topes también, que la ficha traducida no los trae',
  juntos[2]?.maxBriefChars === 120000,
  String(juntos[2]?.maxBriefChars),
);

console.log('\n─── y con la ficha caída no se pierde nada ───');
check('sin ficha, quedan los de la cadena', conTextoDeLaFicha(enCadena, []).length === 3);
check(
  'con su texto original',
  conTextoDeLaFicha(enCadena, []).map((n) => n.name).join(' / ') === 'Un texto / El lote / El proyecto',
);
check('sin niveles en la cadena, no se inventa ninguno', conTextoDeLaFicha([], enFrances).length === 0);

console.log('\n─── un nivel que la ficha no reconoce se queda como está ───');
// Si la ficha va atrasada —el dueño acaba de cambiar un precio y el bot aún no
// lo ha releído— hay niveles que no emparejan. Enseñar el nombre de uno junto
// al precio de otro sería peor que no traducirlo.
const desfasada = leerNivelesDeMetadata('x · y · nivel:0.99|Le vieux niveau|Otro precio');
const conDesfase = conTextoDeLaFicha(enCadena, desfasada);
check(
  'ninguno cambia de nombre por un precio que no es el suyo',
  conDesfase.map((n) => n.name).join(' / ') === 'Un texto / El lote / El proyecto',
  conDesfase.map((n) => n.name).join(' / '),
);

console.log(fallos === 0 ? '\nTodo bien.' : `\n${fallos} mal.`);
process.exit(fallos === 0 ? 0 : 1);
