// Que la CSP de la app siga diciendo lo que dice index.html: solo código del paquete,
// sin plugins y sin <base>. Mira el HTML fuente y, si existe, el construido.
import { existsSync, readFileSync } from 'node:fs';

let bien = 0, mal = 0;
const dice = (q, c) => { if (c) { bien++; console.log('  ✅', q); } else { mal++; console.log('  ❌', q); } };

function politica(ruta) {
  const html = readFileSync(ruta, 'utf8');
  const m = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i);
  return m ? Object.fromEntries(m[1].split(';').map((d) => d.trim().split(/\s+/)).filter((p) => p[0]).map(([k, ...v]) => [k, v])) : null;
}

for (const ruta of ['index.html', 'dist/index.html']) {
  if (!existsSync(new URL(`../${ruta}`, import.meta.url))) continue;
  console.log(`\n${ruta}`);
  const p = politica(new URL(`../${ruta}`, import.meta.url));
  dice('lleva una CSP', p !== null);
  if (!p) continue;
  const scripts = p['script-src'] ?? [];
  dice('los scripts solo del propio paquete', scripts.includes("'self'"));
  dice('ningún dominio de fuera puede servir scripts', !scripts.some((s) => /^(https?:|\*|data:|blob:)/.test(s) || /\./.test(s)));
  dice('nada de eval', !scripts.includes("'unsafe-eval'"));
  // Una huella haría que el navegador ignore 'unsafe-inline', y Capacitor lo necesita.
  dice('sin huellas que anulen el inline del puente de Capacitor', !scripts.some((s) => s.startsWith("'sha")));
  dice('sin plugins', (p['object-src'] ?? []).join(' ') === "'none'");
  dice('y sin <base> de fuera', (p['base-uri'] ?? []).join(' ') === "'self'");
}

console.log(`\n${bien} bien, ${mal} mal`);
if (mal) process.exit(1);
