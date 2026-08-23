/**
 * Aplana los artboards del lienzo a HTML normal, para poder verlos aquí.
 *
 * Los .dc.html no son HTML corriente: llevan <x-dc>, <helmet>, <sc-if>,
 * <sc-for> y {{ variables }}, y el runtime que los interpreta (support.js)
 * vive en claude.ai, no en el disco. Abrir Panel.dc.html en un navegador
 * enseña todas las ramas del sc-if apiladas y las llaves en crudo.
 *
 * Esto los convierte en páginas sueltas que se abren con file://, resolviendo
 * cada condicional por su hint de diseño y repitiendo cada lista las veces que
 * dice su hint. Lo que era una variable sale como barra gris, igual que en el
 * lienzo: es un dato que pone el código, no una decisión de diseño.
 *
 *   node visor.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';

const RELLENO = '#6E6788';
const barra = (ancho) =>
  `<span style="display:inline-block;height:.72em;width:${ancho};min-width:2.5em;` +
  `border-radius:3px;background:currentColor;opacity:.2;vertical-align:-.08em"></span>`;

/** Corta el bloque de una etiqueta contando aperturas y cierres anidados. */
function bloque(html, desde, etiqueta) {
  const abre = new RegExp(`<${etiqueta}[\\s>]`, 'g');
  const cierra = new RegExp(`</${etiqueta}>`, 'g');
  const finApertura = html.indexOf('>', desde) + 1;
  let hondo = 1;
  let i = finApertura;
  while (hondo > 0) {
    abre.lastIndex = i;
    cierra.lastIndex = i;
    const a = abre.exec(html);
    const c = cierra.exec(html);
    if (!c) return null;
    if (a && a.index < c.index) {
      hondo++;
      i = a.index + 1;
    } else {
      hondo--;
      i = c.index + 1;
      if (hondo === 0) {
        return {
          apertura: html.slice(desde, finApertura),
          dentro: html.slice(finApertura, c.index),
          fin: c.index + `</${etiqueta}>`.length,
        };
      }
    }
  }
  return null;
}

/** sc-if: se queda con el interior solo si el hint dice true. */
function resolverCondicionales(html) {
  let i;
  while ((i = html.indexOf('<sc-if')) !== -1) {
    const b = bloque(html, i, 'sc-if');
    if (!b) break;
    const hint = /hint-placeholder-val="\{\{\s*(\w+)\s*\}\}"/.exec(b.apertura);
    const visible = hint ? hint[1] === 'true' : true;
    html = html.slice(0, i) + (visible ? b.dentro : '') + html.slice(b.fin);
  }
  return html;
}

/** sc-for: repite el cuerpo tantas veces como diga el hint. */
function resolverListas(html) {
  let i;
  while ((i = html.indexOf('<sc-for')) !== -1) {
    const b = bloque(html, i, 'sc-for');
    if (!b) break;
    const n = Number(/hint-placeholder-count="(\d+)"/.exec(b.apertura)?.[1] ?? 1);
    html = html.slice(0, i) + b.dentro.repeat(n) + html.slice(b.fin);
  }
  return html;
}

/** Las {{ }} que quedan son datos: gris en CSS, barra en texto. */
function resolverVariables(html) {
  // Manejadores: no hay nada que pulsar en una página quieta.
  html = html.replace(/\son[A-Z]\w*="\{\{[^}]*\}\}"/g, '');
  // Dentro de un atributo (style, sobre todo) va un color neutro.
  html = html.replace(/="[^"]*"/g, (attr) => attr.replace(/\{\{[^}]*\}\}/g, RELLENO));
  // En texto, una barra del ancho que insinúa el contenido.
  const anchos = { importe: '4.5em', estado: '6em', fecha: '5em', hash: '7em' };
  return html.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, v) => {
    const prop = v.split('.').pop();
    return barra(anchos[prop] ?? '6.5em');
  });
}

function aplanar(fuente, titulo) {
  const casco = /<helmet>([\s\S]*?)<\/helmet>/.exec(fuente)?.[1] ?? '';
  let cuerpo = /<x-dc>([\s\S]*?)<\/x-dc>/.exec(fuente)?.[1] ?? fuente;
  cuerpo = cuerpo.replace(/<helmet>[\s\S]*?<\/helmet>/, '');
  cuerpo = resolverCondicionales(cuerpo);
  cuerpo = resolverListas(cuerpo);
  cuerpo = resolverVariables(cuerpo);
  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8">
<title>${titulo}</title>
${casco.trim()}
</head><body style="margin:0">
${cuerpo.trim()}
</body></html>
`;
}

const lienzo = JSON.parse(readFileSync('canvas.json', 'utf8'));
mkdirSync('visor', { recursive: true });

const porArchivo = new Map(lienzo.artboards.map((a) => [a.file, a]));
let hechos = 0;
for (const archivo of readdirSync('.').filter((f) => f.endsWith('.dc.html'))) {
  const ficha = porArchivo.get(archivo);
  const salida = archivo.replace('.dc.html', '.html');
  let pagina = aplanar(readFileSync(archivo, 'utf8'), ficha?.title ?? archivo);
  if (archivo === 'Main.dc.html') pagina = pagina.replace('<body style="margin:0">', `<body style="margin:0">
<div style="position:fixed;inset:auto 0 0 0;z-index:99;background:#FBF3C4;color:#2B2823;
            padding:9px 14px;font:12.5px/1.5 ui-sans-serif,system-ui,sans-serif;border-top:1px solid #E4D68B">
  Este es el <b>recorrido pulsable</b>: aquí sale aplanado, con todas sus pantallas apiladas.
  Para recorrerlo hay que abrirlo en el lienzo. Las quietas se ven bien una a una.
</div>`);
  hechos++;
}
console.log(`${hechos} pantallas aplanadas en design/visor/`);

/* ── El índice: el lienzo entero, con sus notas ─────────────────────────── */

const escapar = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const paginas = lienzo.pages
  .map((p) => {
    const tablas = lienzo.artboards.filter((a) => a.page === p.id);
    const notas = (lienzo.annotations ?? []).filter((n) => n.page === p.id);
    if (!tablas.length && !notas.length) return '';

    const alto = Math.max(0, ...tablas.map((a) => a.y + a.h), ...notas.map((n) => n.y + 700));
    const ancho = Math.max(0, ...tablas.map((a) => a.x + a.w), ...notas.map((n) => n.x + n.w));

    const piezas = tablas
      .map(
        (a) => `      <div class="tabla" style="left:${a.x}px; top:${a.y}px; width:${a.w}px;">
        <div class="titulo">${escapar(a.title)} <span class="fuente">${a.file}</span></div>
        <iframe src="./visor/${a.file.replace('.dc.html', '.html')}"
                width="${a.w}" height="${a.h}" loading="lazy" title="${escapar(a.title)}"></iframe>
      </div>`,
      )
      .join('\n');

    const pegatinas = notas
      .map(
        (n) => `      <div class="nota" style="left:${n.x}px; top:${n.y}px; width:${n.w}px;">${escapar(
          n.text,
        )}</div>`,
      )
      .join('\n');

    return `  <section>
    <h2>${escapar(p.name)}</h2>
    <div class="lienzo"><div class="plano" style="width:${ancho}px; height:${alto}px;">
${piezas}
${pegatinas}
    </div></div>
  </section>`;
  })
  .join('\n');

writeFileSync(
  'visor.html',
  `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Panal · el diseño de la app</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; background: #EFEDE7; color: #1B1A17;
         font: 15px/1.55 ui-sans-serif, system-ui, "Segoe UI", sans-serif; }
  header { padding: 26px 32px 8px; }
  h1 { margin: 0; font-size: 25px; letter-spacing: -0.02em; }
  header p { margin: 8px 0 0; max-width: 62ch; color: #55514A; font-size: 14px; }
  header code { background: #E2DFD6; padding: 1px 5px; border-radius: 4px; font-size: 13px; }
  section { padding: 26px 32px; border-top: 1px solid #D9D5CA; }
  h2 { margin: 0 0 16px; font-size: 17px; letter-spacing: -0.01em; }
  .lienzo { overflow-x: auto; padding-bottom: 12px; }
  .plano { position: relative; }
  .tabla { position: absolute; }
  .titulo { font-size: 12.5px; color: #55514A; margin-bottom: 7px;
            display: flex; justify-content: space-between; gap: 10px; }
  .fuente { color: #8C877D; font-family: ui-monospace, monospace; font-size: 11.5px; }
  iframe { border: 1px solid #CFCABD; border-radius: 12px; background: #121019;
           display: block; box-shadow: 0 10px 26px -14px rgba(0,0,0,.45); }
  .nota { position: absolute; background: #FBF3C4; border: 1px solid #E4D68B;
          border-radius: 4px; padding: 14px 16px; font-size: 13px; line-height: 1.62;
          white-space: pre-wrap; color: #2B2823;
          box-shadow: 0 8px 20px -12px rgba(0,0,0,.35); }
</style>
</head><body>
<header>
  <h1>Panal · el diseño de la app</h1>
  <p>${lienzo.artboards.length} pantallas y ${(lienzo.annotations ?? []).length} notas.
     Esto se genera con <code>node visor.mjs</code> desde los <code>.dc.html</code>,
     que son la fuente. Las barras grises son datos que pone el código, no huecos del diseño;
     lo que hay que saber para escribirlos está en las notas amarillas.</p>
</header>
${paginas}
</body></html>
`,
);
console.log('visor.html escrito');
