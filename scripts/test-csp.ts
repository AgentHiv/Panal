/**
 * Que la CSP de panal.lat deje correr lo nuestro y nada más.
 *
 *     pnpm exec vite build && npx tsx scripts/test-csp.ts
 *
 * ───────────────────────────────────────────────────────────────────────────
 * POR QUÉ HAY UNA REGLA PARA LOS SCRIPTS
 *
 * La forma habitual de vaciar una wallet conectada no es romper la wallet: es
 * colar un script en la web que le pide una firma. Así fue lo de Ledger Connect
 * Kit (diciembre de 2023): una librería comprometida descargaba un «drainer»
 * de fuera y las webs que la usaban lo ejecutaban como propio. Con
 * `script-src 'self'` el navegador no ejecuta un script que no venga de
 * panal.lat, venga de donde venga la orden de cargarlo.
 *
 * El único script que no es un archivo es el de `index.html` que enseña un
 * mensaje si la app no arranca. Va permitido por su huella (sha256), así que
 * CUALQUIER cambio en él cambia la huella, y si `public/_headers` no se
 * actualiza a la vez, el navegador lo bloquea en producción sin que nada
 * avise. Eso es lo que mira esto: lo construido contra lo que se va a servir.
 * ───────────────────────────────────────────────────────────────────────────
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';

type Nodo = DefaultTreeAdapterMap['node'];
type Elemento = DefaultTreeAdapterMap['element'];

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

if (!existsSync('dist/index.html')) {
  console.log('❌ Falta dist/index.html: esto mira lo construido, corre antes `pnpm exec vite build`');
  process.exit(1);
}

const cabeceras = readFileSync('public/_headers', 'utf8');

// La CSP que se sirve a todas las páginas (el bloque `/*`).
const csp = cabeceras.match(/^\s+Content-Security-Policy:\s*(.+)$/m)?.[1] ?? '';
const scriptSrc = csp
  .split(';')
  .map((d) => d.trim())
  .find((d) => d.startsWith('script-src '));

check('public/_headers lleva una CSP con script-src', !!scriptSrc, csp || 'sin Content-Security-Policy');
const fuentes = scriptSrc?.split(/\s+/).slice(1) ?? [];

check("script-src solo admite 'self' y huellas", fuentes.every((f) => f === "'self'" || /^'sha256-[A-Za-z0-9+/]+=*'$/.test(f)), fuentes.join(' '));

// El HTML se lee con parse5, que lo trocea como un navegador: mayúsculas,
// `</script >`, comentarios raros y todo lo demás que una expresión regular
// se deja. Lo que importa es qué ejecutaría el navegador, no qué parece.
const elementos: Elemento[] = [];
const recorrer = (n: Nodo): void => {
  if ('tagName' in n) elementos.push(n);
  const hijos = 'content' in n && n.nodeName === 'template' ? n.content.childNodes : 'childNodes' in n ? n.childNodes : [];
  for (const h of hijos) recorrer(h);
};
recorrer(parse(readFileSync('dist/index.html', 'utf8')));

const atributo = (e: Elemento, nombre: string): string | undefined => e.attrs.find((a) => a.name === nombre)?.value;

// Los tipos que el navegador ejecuta, o que la CSP trata como script. El resto
// —el JSON-LD para los buscadores— son datos: no corren y la CSP no los mira.
const EJECUTABLES = new Set(['', 'module', 'importmap', 'speculationrules', 'text/javascript', 'application/javascript', 'text/ecmascript', 'application/ecmascript']);
const scripts = elementos.filter((e) => e.tagName === 'script' && EJECUTABLES.has((atributo(e, 'type') ?? '').trim().toLowerCase()));

const externos = scripts.filter((e) => atributo(e, 'src') !== undefined);
for (const e of externos) {
  const src = atributo(e, 'src')!;
  check(`el script ${src} sale de panal.lat`, src.startsWith('/') && !src.startsWith('//'), `'self' lo bloquearía en producción`);
}

const enLinea = scripts.filter((e) => atributo(e, 'src') === undefined);
check('index.html tiene su script de arranque en línea', enLinea.length > 0, 'no se encontró ninguno');

for (const [i, e] of enLinea.entries()) {
  // El texto del script tal cual está en el archivo: es lo que hashea el navegador.
  const cuerpo = e.childNodes.map((h) => ('value' in h ? h.value : '')).join('');
  const huella = `'sha256-${createHash('sha256').update(cuerpo, 'utf8').digest('base64')}'`;
  check(
    `el script en línea nº ${i + 1} está permitido por su huella`,
    fuentes.includes(huella),
    `cambió y la CSP lo bloquearía. Pon ${huella} en script-src de public/_headers (y quita la vieja)`,
  );
}

// Cada huella de más es un script viejo que se sigue permitiendo.
const huellas = fuentes.filter((f) => f.startsWith("'sha256-"));
check('no sobra ninguna huella', huellas.length === enLinea.length, `${huellas.length} huellas para ${enLinea.length} script(s)`);

// Un `onclick="…"` o un `onerror="…"` tampoco correría con esta CSP.
const conManejador = elementos.find((e) => e.attrs.some((a) => a.name.startsWith('on')));
check(
  'ninguna etiqueta lleva un manejador en línea (on…=)',
  !conManejador,
  conManejador ? `<${conManejador.tagName} ${conManejador.attrs.map((a) => a.name).join(' ')}>` : '',
);

console.log(
  fallos === 0
    ? '\n✅ La CSP deja correr el código de Panal y nada que venga de fuera\n'
    : `\n❌ ${fallos} comprobación(es) fallidas: la CSP y lo construido no cuadran\n`,
);
process.exit(fallos === 0 ? 0 : 1);
