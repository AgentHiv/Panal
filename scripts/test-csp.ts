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

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

if (!existsSync('dist/index.html')) {
  console.log('❌ Falta dist/index.html: esto mira lo construido, corre antes `pnpm exec vite build`');
  process.exit(1);
}

const html = readFileSync('dist/index.html', 'utf8');
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

// Los <script> sin `src` que el navegador EJECUTA. Los de datos —el JSON-LD
// para los buscadores— no se ejecutan y la CSP no los mira.
const enLinea = [...html.matchAll(/<script(?<attrs>[^>]*)>(?<cuerpo>[\s\S]*?)<\/script>/g)].filter(
  (m) => !/\ssrc=/.test(m.groups!.attrs) && !/application\/ld\+json/.test(m.groups!.attrs),
);
check('index.html tiene su script de arranque en línea', enLinea.length > 0, 'no se encontró ninguno');

for (const [i, m] of enLinea.entries()) {
  const huella = `'sha256-${createHash('sha256').update(m.groups!.cuerpo, 'utf8').digest('base64')}'`;
  check(
    `el script en línea nº ${i + 1} está permitido por su huella`,
    fuentes.includes(huella),
    `cambió y la CSP lo bloquearía. Pon ${huella} en script-src de public/_headers (y quita la vieja)`,
  );
}

// Cada huella de más es un script viejo que se sigue permitiendo.
const huellas = fuentes.filter((f) => f.startsWith("'sha256-"));
check('no sobra ninguna huella', huellas.length === enLinea.length, `${huellas.length} huellas para ${enLinea.length} script(s)`);

// Un `onclick="…"` o un `onerror="…"` en el HTML tampoco correría: sin
// comentarios, no tiene que quedar ninguno.
const sinComentarios = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
const manejador = sinComentarios.match(/<[^>]+\son[a-z]+\s*=/i)?.[0];
check('ninguna etiqueta lleva un manejador en línea (on…=)', !manejador, manejador ?? '');

console.log(
  fallos === 0
    ? '\n✅ La CSP deja correr el código de Panal y nada que venga de fuera\n'
    : `\n❌ ${fallos} comprobación(es) fallidas: la CSP y lo construido no cuadran\n`,
);
process.exit(fallos === 0 ? 0 : 1);
