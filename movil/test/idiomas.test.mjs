/**
 * Los cuatro idiomas, comparados entre sí.
 *
 * El typecheck ya obliga a que no falte ninguna clave —cada tabla se declara
 * `: Textos`— así que esto comprueba lo que el typecheck NO ve:
 *
 *   · que ninguna traducción se dejó el español puesto por descuido,
 *   · que las funciones aceptan los mismos argumentos y devuelven algo,
 *   · que nadie se comió un dato al traducir: si la frase española mete un
 *     importe, la inglesa también tiene que meterlo. Es el fallo silencioso
 *     de traducir a mano, y el que más caro sale cuando lo que falta es una
 *     cantidad de dinero.
 */
globalThis.localStorage = {
  _d: new Map(),
  getItem(k) { return this._d.has(k) ? this._d.get(k) : null; },
  setItem(k, v) { this._d.set(k, String(v)); },
  removeItem(k) { this._d.delete(k); },
};

const { es } = await import('../src/i18n/es.ts');
const { en } = await import('../src/i18n/en.ts');
const { pt } = await import('../src/i18n/pt.ts');
const { zh } = await import('../src/i18n/zh.ts');
const { IDIOMAS, cambiarIdioma, idioma, textos, etiquetaIdioma } = await import('../src/i18n/idiomas.ts');

let bien = 0;
let mal = 0;
const dice = (que, cond) => {
  if (cond) { bien++; console.log('  ✅', que); }
  else { mal++; console.log('  ❌', que); }
};

const TABLAS = { es, en, pt, zh };

/** Recorre una tabla y devuelve `ruta -> valor` de todas las hojas. */
function aplanar(o, prefijo = '') {
  const salida = {};
  for (const [k, v] of Object.entries(o)) {
    const ruta = prefijo ? `${prefijo}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof v !== 'function') {
      Object.assign(salida, aplanar(v, ruta));
    } else {
      salida[ruta] = v;
    }
  }
  return salida;
}

const planas = Object.fromEntries(Object.entries(TABLAS).map(([c, t]) => [c, aplanar(t)]));
const rutasEs = Object.keys(planas.es);

console.log('\nlas cuatro tablas tienen lo mismo');
dice('el índice las declara todas', IDIOMAS.length === 4);
dice('y son las cuatro que hay', IDIOMAS.every((i) => i.codigo in TABLAS));
for (const c of ['en', 'pt', 'zh']) {
  const faltan = rutasEs.filter((r) => !(r in planas[c]));
  const sobran = Object.keys(planas[c]).filter((r) => !rutasEs.includes(r));
  dice(`${c}: no le falta ninguna clave`, faltan.length === 0);
  dice(`${c}: ni le sobra ninguna`, sobran.length === 0);
  if (faltan.length) console.log('     faltan:', faltan.slice(0, 5));
  if (sobran.length) console.log('     sobran:', sobran.slice(0, 5));
}

console.log('\nlas mismas rutas son del mismo tipo');
for (const c of ['en', 'pt', 'zh']) {
  const distintas = rutasEs.filter((r) => typeof planas[c][r] !== typeof planas.es[r]);
  dice(`${c}: función donde hay función, texto donde hay texto`, distintas.length === 0);
  if (distintas.length) console.log('     ', distintas.slice(0, 5));
}

console.log('\ny los arrays miden lo mismo');
for (const c of ['en', 'pt', 'zh']) {
  const cortos = rutasEs.filter(
    (r) => Array.isArray(planas.es[r]) && planas[c][r]?.length !== planas.es[r].length,
  );
  dice(`${c}: ningún array se quedó corto`, cortos.length === 0);
  if (cortos.length) console.log('     ', cortos);
}

/* ── lo que el typecheck no ve ────────────────────────────────────────────── */

/** Llama una función de texto con argumentos de mentira, según su aridad. */
function llamar(f) {
  const args = Array.from({ length: f.length }, (_, i) => (i === 0 ? 7 : `X${i}`));
  // Casi todas toman un número o una cadena; si la primera no cuela, se prueba
  // con cadena, que es el otro caso.
  try {
    return String(f(...args));
  } catch {
    return String(f(...args.map((_, i) => `X${i}`)));
  }
}

/**
 * Frases que en dos idiomas se escriben igual, y está bien.
 *
 * El español y el portugués se parecen lo bastante para que algunas coincidan
 * de verdad. Va como lista explícita y no aflojando la comprobación: cada una
 * está aquí porque alguien la miró y decidió que es correcta, y añadir una
 * nueva obliga a mirarla también.
 */
const IGUALES_A_PROPOSITO = {
  pt: [
    'encargar.protocolo', // «Protocolo · 2,5 %» se escribe igual
    'revisar.protocolo',
    'revisar.abrirDisputa', // «Abrir disputa» es lo mismo en portugués
    'recibo.csv.hashEntrega', // cabecera de CSV, sin acentos ni artículos
    'llavero.usarEsta', // «Usar esta wallet» se escribe igual en portugués
  ],
  en: [],
  zh: [],
};

console.log('\nninguna traducción se dejó el español');
for (const c of ['en', 'pt', 'zh']) {
  const iguales = rutasEs.filter((r) => {
    if (typeof planas.es[r] !== 'string') return false;
    const a = planas.es[r];
    // Se ignora lo que es igual a propósito: nombres, siglas y símbolos.
    if (a.length < 12) return false;
    if (/^[\s\d\p{P}$]*$/u.test(a)) return false;
    if (IGUALES_A_PROPOSITO[c].includes(r)) return false;
    return planas[c][r] === a;
  });
  dice(
    `${c}: ninguna frase larga quedó sin traducir (${IGUALES_A_PROPOSITO[c].length} iguales a propósito)`,
    iguales.length === 0,
  );
  if (iguales.length) console.log('     ', iguales.slice(0, 8));
}

console.log('\nlas funciones colocan los datos que reciben');
for (const c of ['en', 'pt', 'zh']) {
  const perdidos = [];
  for (const r of rutasEs) {
    if (typeof planas.es[r] !== 'function') continue;
    let base;
    let otra;
    try {
      base = llamar(planas.es[r]);
      otra = llamar(planas[c][r]);
    } catch {
      perdidos.push(`${r} (revienta)`);
      continue;
    }
    // Lo que se le pasó tiene que salir en las dos. Es lo que descubre que
    // alguien tradujo «Cobrar 5 MON» como «Withdraw» y se dejó la cantidad.
    for (const dato of ['7', 'X1', 'X2']) {
      if (base.includes(dato) && !otra.includes(dato)) perdidos.push(`${r} pierde «${dato}»`);
    }
  }
  dice(`${c}: no se pierde ningún dato por el camino`, perdidos.length === 0);
  if (perdidos.length) console.log('     ', perdidos.slice(0, 8));
}

console.log('\ncambiar de idioma');
cambiarIdioma('en');
dice('el idioma cambia', idioma() === 'en');
dice('los textos también', textos().pestanas.saldo === en.pestanas.saldo);
dice('y la etiqueta de fechas', etiquetaIdioma() === 'en-GB');
cambiarIdioma('zh');
dice('en chino igual', textos().pestanas.saldo === zh.pestanas.saldo);
dice('con su etiqueta', etiquetaIdioma() === 'zh-CN');
cambiarIdioma('es');
dice('y vuelve', textos().pestanas.saldo === es.pestanas.saldo);
dice('queda guardado para la próxima', localStorage.getItem('panal:idioma:v1') === 'es');

console.log(`\n${rutasEs.length} cadenas por idioma · ${bien} bien · ${mal} mal\n`);
process.exit(mal === 0 ? 0 : 1);
