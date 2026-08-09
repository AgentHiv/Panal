/**
 * Pruebas del conversor a texto plano (`src/format.ts`).
 *
 *   npx tsx scripts/test-format.ts     (o: pnpm test:format)
 *
 * HERMÉTICO: sin red, sin cadena.
 *
 * El primer bloque es el caso REAL que motivó todo esto: una entrega de
 * LexPanal que llegó al cliente con `**negrita**` y `## Título` en crudo,
 * porque ni el cuadro del dashboard ni Telegram renderizan Markdown.
 */

import { hasMarkdownArtifacts, toPlainText } from '../src/format.js';

let failures = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) console.log(`✅ ${label}${detail ? `: ${detail}` : ''}`);
  else {
    failures += 1;
    console.error(`❌ ${label}${detail ? ` → ${detail}` : ''}`);
  }
}

function eq(label: string, actual: string, expected: string): void {
  check(label, actual === expected, actual === expected ? '' : `esperado ${JSON.stringify(expected)}, salió ${JSON.stringify(actual)}`);
}

// ---------------------------------------------------------------------------

console.log('── 1. El caso real reportado ──');

const entregaReal = `# MONAD - Monadic Blockchain

MONAD es una **blockchain de capa 1** de alto rendimiento, compatible con la EVM.

## Características Clave

- **10,000 TPS** de rendimiento
- Finalidad de \`800ms\`
- Comisiones muy bajas

## ¿Está en el marketplace Panal?

Sí. Puedes consultarlo en [panal.lat](https://panal.lat).

---

*Usa la barra de búsqueda para encontrar más agentes.*`;

const limpio = toPlainText(entregaReal);
check('no queda ningún ** de negrita', !limpio.includes('**'), limpio.slice(0, 60));
check('no quedan encabezados con #', !/^#{1,6}\s/m.test(limpio));
check('el conversor no deja artefactos', !hasMarkdownArtifacts(limpio));
check('el contenido sobrevive', limpio.includes('MONAD - Monadic Blockchain') && limpio.includes('10,000 TPS'));
check('las viñetas se convierten', limpio.includes('• 10,000 TPS'), limpio.split('\n').find((l) => l.includes('TPS')) ?? '');
check('el enlace conserva texto y URL', limpio.includes('panal.lat (https://panal.lat)'));
check('el código en línea pierde las comillas', limpio.includes('800ms') && !limpio.includes('`'));

console.log('\n── 2. Lo que NO se debe tocar ──');

// La diferencia entre "# MONAD" (encabezado) y "#13" (número de tarea) es
// exactamente lo que separa arreglar el problema de crear otro.
eq('el número de tarea sobrevive', toPlainText('Entregada #13 correctamente'), 'Entregada #13 correctamente');
eq('la almohadilla pegada no es encabezado', toPlainText('Ticket #42: abierto'), 'Ticket #42: abierto');
eq('snake_case intacto', toPlainText('Configura BRIEF_WAIT_MS en el .env'), 'Configura BRIEF_WAIT_MS en el .env');
eq('guiones bajos de nombres intactos', toPlainText('la variable max_retries_count'), 'la variable max_retries_count');
eq('la multiplicación no es cursiva', toPlainText('el area es 3 * 4 * 5 metros'), 'el area es 3 * 4 * 5 metros');
eq('las listas numeradas conservan el número', toPlainText('1. Primero\n2. Segundo'), '1. Primero\n2. Segundo');
eq('una URL suelta no se toca', toPlainText('Ver https://panal.lat/agentes'), 'Ver https://panal.lat/agentes');

console.log('\n── 3. Sintaxis Markdown ──');

eq('negrita', toPlainText('esto es **importante** ahora'), 'esto es importante ahora');
eq('negrita con guiones bajos', toPlainText('esto es __importante__ ahora'), 'esto es importante ahora');
eq('cursiva', toPlainText('esto es *importante* ahora'), 'esto es importante ahora');
eq('negrita y cursiva', toPlainText('esto es ***clave*** ahora'), 'esto es clave ahora');
eq('tachado', toPlainText('precio ~~100~~ 80'), 'precio 100 80');
eq('encabezado h1', toPlainText('# Título'), 'Título');
eq('encabezado h3', toPlainText('### Sección menor'), 'Sección menor');
eq('encabezado con cierre', toPlainText('## Título ##'), 'Título');
eq('cita', toPlainText('> una cita textual'), 'una cita textual');
eq('viñeta con guion', toPlainText('- uno\n- dos'), '• uno\n• dos');
eq('viñeta con asterisco', toPlainText('* uno\n* dos'), '• uno\n• dos');
eq('viñeta anidada conserva sangría', toPlainText('- uno\n  - anidado'), '• uno\n  • anidado');

const conCodigo = toPlainText('Ejecuta esto:\n\n```bash\npnpm install\npnpm test\n```\n\nY listo.');
check('el bloque de código conserva su contenido', conCodigo.includes('pnpm install\npnpm test'), JSON.stringify(conCodigo));
check('el bloque de código pierde las vallas', !conCodigo.includes('```'));

const conRegla = toPlainText('arriba\n\n---\n\nabajo');
check('la regla horizontal se vuelve separador', conRegla.includes('─'), JSON.stringify(conRegla));

console.log('\n── 4. Limpieza ──');

eq('sin espacios al final de línea', toPlainText('hola   \nadios'), 'hola\nadios');
eq('máximo dos saltos seguidos', toPlainText('a\n\n\n\n\nb'), 'a\n\nb');
eq('recorta los extremos', toPlainText('\n\n  hola  \n\n'), 'hola');
eq('cadena vacía no rompe', toPlainText(''), '');
eq('asteriscos sueltos desaparecen', toPlainText('resto ** suelto'), 'resto  suelto');

console.log('\n── 5. Mensajes de Telegram del propio bot ──');

// Las plantillas del bot llevan *negrita* de Markdown. Sin parse_mode se verían
// los asteriscos, así que send() las pasa por aquí antes de mandarlas.
eq(
  'la plantilla de entrega queda limpia',
  toPlainText('✅ *Entregada #13* (resultado guardado en `results/13.md`).'),
  '✅ Entregada #13 (resultado guardado en results/13.md).',
);
eq(
  'la ayuda de comandos queda legible',
  toPlainText('⚠️ Formato: `/result #N` — ejemplo: `/result #3`'),
  '⚠️ Formato: /result #N — ejemplo: /result #3',
);
eq(
  'el aviso de brief conserva el número',
  toPlainText('📝 Brief guardado para la tarea *#7* (120 caracteres).'),
  '📝 Brief guardado para la tarea #7 (120 caracteres).',
);

console.log('\n── 6. Detector de artefactos ──');

check('detecta encabezados', hasMarkdownArtifacts('## Título'));
check('detecta negrita', hasMarkdownArtifacts('esto es **fuerte**'));
check('detecta viñetas sin convertir', hasMarkdownArtifacts('- uno'));
check('no marca texto ya limpio', !hasMarkdownArtifacts('Entregada #13\n\n• uno\n• dos'));
check('no marca snake_case', !hasMarkdownArtifacts('BRIEF_WAIT_MS vale 180000'));

// Idempotencia: pasar dos veces no debe cambiar nada.
const unaVez = toPlainText(entregaReal);
eq('convertir dos veces da lo mismo', toPlainText(unaVez), unaVez);

console.log('');
if (failures === 0) console.log('✅ Todas las comprobaciones de formato pasaron');
else {
  console.error(`❌ ${failures} comprobación(es) fallaron`);
  process.exitCode = 1;
}
