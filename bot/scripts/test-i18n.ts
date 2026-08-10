/**
 * Paridad de los mensajes del bot en los 10 idiomas (`src/i18n.ts`).
 *
 *   npx tsx scripts/test-i18n.ts     (o: pnpm test:i18n)
 *
 * HERMÉTICO: no toca la red ni Telegram.
 *
 * El equivalente del frontend (`scripts/check-i18n.mjs`) apareció después de
 * descubrir que el panel de arbitraje llevaba toda su vida solo en español e
 * inglés sin que nada fallara. Aquí el riesgo es peor: Telegram RECHAZA el
 * mensaje con 400 si el HTML está mal formado, así que una etiqueta sin cerrar
 * en un idioma deja a ese operador sin avisos y solo se ve en los logs.
 *
 * Comprueba, para cada idioma:
 *   1. Están todas las claves del catálogo de referencia.
 *   2. Los placeholders {{...}} coinciden con la referencia.
 *   3. El HTML está balanceado y solo usa etiquetas que Telegram admite.
 *   4. `t()` escapa los valores interpolados (no se puede inyectar formato).
 */

import { readFileSync } from 'node:fs';
import { BOT_LANGS, DEFAULT_LANG, _CATALOG, escapeHtml, isBotLang, lines, t, telegramLangCode } from '../src/i18n.js';
import type { MsgKey } from '../src/i18n.js';

let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`✅ ${label}${detail ? `: ${detail}` : ''}`);
  else {
    failures += 1;
    console.error(`❌ ${label}${detail ? `: ${detail}` : ''}`);
  }
}

/** Etiquetas que la Bot API acepta en parse_mode HTML. */
const ALLOWED_TAGS = new Set(['b', 'i', 'u', 's', 'code', 'pre', 'a', 'blockquote', 'tg-spoiler']);

function placeholders(text: string): string {
  return [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!).sort().join(',');
}

/** Devuelve el error de balanceo, o null si el HTML está bien formado. */
function htmlProblem(text: string): string | null {
  const stack: string[] = [];
  for (const m of text.matchAll(/<(\/?)([a-z-]+)(\s[^>]*)?>/g)) {
    const closing = m[1] === '/';
    const tag = m[2]!;
    if (!ALLOWED_TAGS.has(tag)) return `etiqueta no soportada por Telegram: <${tag}>`;
    if (closing) {
      if (stack.pop() !== tag) return `</${tag}> sin su apertura`;
    } else {
      stack.push(tag);
    }
  }
  return stack.length ? `sin cerrar: <${stack.join('>, <')}>` : null;
}

const reference = _CATALOG[DEFAULT_LANG];
const refKeys = Object.keys(reference) as MsgKey[];

console.log(`── Catálogo de referencia (${DEFAULT_LANG}): ${refKeys.length} mensajes ──\n`);

console.log('── 1. Todos los idiomas, todas las claves ──');
for (const lang of BOT_LANGS) {
  const cat = _CATALOG[lang];
  const missing = refKeys.filter((k) => !cat[k]);
  const extra = (Object.keys(cat) as MsgKey[]).filter((k) => !reference[k]);
  check(
    `${lang}: ${refKeys.length} mensajes`,
    missing.length === 0 && extra.length === 0,
    missing.length ? `faltan ${missing.join(', ')}` : extra.length ? `sobran ${extra.join(', ')}` : '',
  );
}

console.log('\n── 2. Los placeholders sobreviven a la traducción ──');
for (const lang of BOT_LANGS) {
  if (lang === DEFAULT_LANG) continue;
  const bad = refKeys.filter((k) => _CATALOG[lang][k] && placeholders(_CATALOG[lang][k]) !== placeholders(reference[k]));
  check(
    `${lang}: interpolación intacta`,
    bad.length === 0,
    bad.map((k) => `${k} tiene {{${placeholders(_CATALOG[lang][k])}}} y no {{${placeholders(reference[k])}}}`).join(' · '),
  );
}

console.log('\n── 3. HTML válido para la Bot API ──');
// Telegram responde 400 y NO envía nada si el HTML está mal: en producción eso
// es un aviso perdido en silencio, visible solo en los logs del servidor.
for (const lang of BOT_LANGS) {
  const bad = refKeys
    .map((k) => [k, htmlProblem(_CATALOG[lang][k] ?? '')] as const)
    .filter(([, problem]) => problem !== null);
  check(`${lang}: HTML balanceado`, bad.length === 0, bad.map(([k, p]) => `${k}: ${p}`).join(' · '));
}

console.log('\n── 4. Los datos no pueden inyectar formato ──');
// El brief lo escribe el cliente y el error lo escribe una librería: si t() no
// los escapara, un "<b>" en un brief rompería el mensaje o lo falsearía.
const injected = t('es', 'cmd.brief.saved', { id: '<b>1</b>', chars: 10 });
check('los valores interpolados se escapan', injected.includes('&lt;b&gt;1&lt;/b&gt;'), injected);
check('el formato de la plantilla sí se conserva', injected.includes('<b>#&lt;b&gt;1&lt;/b&gt;</b>'));
check('escapeHtml cubre los tres caracteres', escapeHtml('<a & b>') === '&lt;a &amp; b&gt;');

const withHtml = t('es', 'worker.failed', { id: '3', error: 'fetch failed: <socket>' });
check('un error con < no rompe el HTML', htmlProblem(withHtml) === null, withHtml.slice(0, 60));

console.log('\n── 5. Detalles de la integración ──');
check('un placeholder sin valor se deja literal', t('es', 'cmd.brief.saved', {}).includes('{{id}}'));
check('idioma desconocido no es BotLang', !isBotLang('klingon'));
check('los 10 idiomas del frontend están cubiertos', BOT_LANGS.length === 10, BOT_LANGS.join(' '));
// Telegram no conoce "zh" a secas: espera zh-hans / zh-hant.
check('el código de idioma de Telegram se traduce', telegramLangCode('zh') === 'zh-hans');
check('los demás idiomas van tal cual', telegramLangCode('fr') === 'fr');
// lines() descarta condicionales pero conserva los separadores en blanco.
check('lines conserva la línea vacía', lines('a', '', 'b') === 'a\n\nb');
check('lines descarta lo condicional', lines('a', false, null, undefined, 'b') === 'a\nb');

console.log('\n── 6. Ningún mensaje se escapa del catálogo ──');
// Al pasar send() a HTML dejó de aplicarse toPlainText(), que hasta entonces
// borraba los asteriscos. Dos mensajes que no se migraron —el aviso de
// subcontratación y el de retirada automática— empezaron a enseñar su Markdown
// crudo en producción. Este chequeo recorre el código en vez de fiarse de que
// alguien se acuerde: cualquier `*negrita*` o backtick que llegue a send() falla.
const SOURCES = ['src/telegram.ts', 'src/notifier.ts', 'src/worker.ts', 'src/a2a.ts'];
const MARKDOWN_IN_SEND = /\.send\(\s*(?:[^;]|\n){0,600}?\);/g;
for (const file of SOURCES) {
  const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const offenders = [...src.matchAll(MARKDOWN_IN_SEND)]
    .map((m) => m[0])
    .filter((block) => /\*[^*\n]+\*|\\`/.test(block))
    .map((block) => block.replace(/\s+/g, ' ').slice(0, 70));
  check(`${file}: sin Markdown suelto`, offenders.length === 0, offenders.join(' · '));
}

console.log('');
if (failures === 0) console.log(`✅ Los ${BOT_LANGS.length} idiomas cuadran (${refKeys.length} mensajes cada uno)`);
else {
  console.error(`❌ ${failures} comprobación(es) fallaron`);
  process.exitCode = 1;
}
