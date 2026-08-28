/**
 * El aviso de versión nueva.
 *
 * Se prueba aquí y no a ojo porque los tres fallos que tiene esto por dentro
 * son silenciosos: comparar versiones como texto (y entonces la 2.10 nunca se
 * anuncia), preguntarle a GitHub cada vez que se abre el menú, y creerse
 * cualquier etiqueta que venga de la red. Ninguno da error: simplemente el
 * aviso no sale, o sale cuando no debe, y eso solo se descubre meses después.
 */
globalThis.localStorage = {
  _d: new Map(),
  getItem(k) { return this._d.has(k) ? this._d.get(k) : null; },
  setItem(k, v) { this._d.set(k, String(v)); },
  removeItem(k) { this._d.delete(k); },
};
globalThis.__VITE_ENV__ = { VITE_VERSION: '2.5.0' };

const a = await import('../src/lib/actualizacion.ts');

let bien = 0;
let mal = 0;
const dice = (que, cond) => {
  if (cond) { bien++; console.log('  ✅', que); }
  else { mal++; console.log('  ❌', que); }
};

/** Un `fetch` de mentira que cuenta las llamadas. */
function fingeGitHub(respuesta) {
  const espia = { llamadas: 0 };
  globalThis.fetch = async () => {
    espia.llamadas++;
    if (respuesta instanceof Error) throw respuesta;
    return {
      ok: respuesta.ok ?? true,
      json: async () => respuesta.cuerpo,
    };
  };
  return espia;
}

const olvida = () => globalThis.localStorage._d.clear();

console.log('\ncomparar versiones, que es donde esto se rompe');
dice('2.5.1 es más nueva que 2.5.0', a.esMasNueva('2.5.1', '2.5.0'));
dice('2.6.0 es más nueva que 2.5.9', a.esMasNueva('2.6.0', '2.5.9'));
dice('3.0.0 es más nueva que 2.99.99', a.esMasNueva('3.0.0', '2.99.99'));
dice(
  'LA TRAMPA: 2.10.0 es más nueva que 2.9.0 (como texto sería falso)',
  a.esMasNueva('2.10.0', '2.9.0'),
);
dice('la misma no es más nueva', !a.esMasNueva('2.5.0', '2.5.0'));
dice('una anterior no es más nueva', !a.esMasNueva('2.4.9', '2.5.0'));
dice('no se anuncia una vuelta atrás', !a.esMasNueva('1.0.0', '2.5.0'));
dice('basura, que no', !a.esMasNueva('dos punto cinco', '2.5.0'));
dice('ni con una versión de dos trozos', !a.esMasNueva('2.6', '2.5.0'));

console.log('\nel enlace se arma con el número, no con lo que diga la red');
dice(
  'lleva a la etiqueta de esa versión',
  a.enlaceDeVersion('2.5.1') === 'https://github.com/AgentHiv/Panal/releases/tag/apk-v2.5.1',
);

console.log('\nqué versión se cree que tiene instalada');
dice('la que le pasa el flujo del APK', a.versionInstalada() === '2.5.0');
globalThis.__VITE_ENV__ = { VITE_VERSION: '0.0-dev' };
dice(
  'una compilación a mano NO tiene versión, así que no dará la lata',
  a.versionInstalada() === null,
);
globalThis.__VITE_ENV__ = {};
dice('sin VITE_VERSION tampoco', a.versionInstalada() === null);
globalThis.__VITE_ENV__ = { VITE_VERSION: '2.5.0' };

console.log('\npreguntarle a GitHub');
olvida();
let espia = fingeGitHub({ cuerpo: { tag_name: 'apk-v2.6.0' } });
dice('lee la versión de la etiqueta', (await a.ultimaPublicada()) === '2.6.0');
dice('y preguntó una vez', espia.llamadas === 1);

dice('la segunda vez contesta sin preguntar', (await a.ultimaPublicada()) === '2.6.0');
dice('o sea que sigue habiendo UNA llamada', espia.llamadas === 1);

console.log('\ny pasado un día vuelve a preguntar');
const g = JSON.parse(globalThis.localStorage.getItem('panal:ultima-version:v1'));
globalThis.localStorage.setItem(
  'panal:ultima-version:v1',
  JSON.stringify({ ...g, visto: Date.now() - 25 * 60 * 60 * 1000 }),
);
espia = fingeGitHub({ cuerpo: { tag_name: 'apk-v2.7.0' } });
dice('con lo caducado sí pregunta', (await a.ultimaPublicada()) === '2.7.0');
dice('una llamada nueva', espia.llamadas === 1);

console.log('\nlo que llega de la red no se cree sin mirarlo');
olvida();
fingeGitHub({ cuerpo: { tag_name: 'sdk-v0.15.1' } });
dice('una release que no es un APK no cuenta', (await a.ultimaPublicada()) === null);
olvida();
fingeGitHub({ cuerpo: { tag_name: 'apk-v2.5' } });
dice('una etiqueta a medias tampoco', (await a.ultimaPublicada()) === null);
olvida();
fingeGitHub({ cuerpo: { tag_name: 'apk-v../../otra-cosa' } });
dice('ni una que intente colar una ruta', (await a.ultimaPublicada()) === null);
olvida();
fingeGitHub({ cuerpo: {} });
dice('sin etiqueta, nada', (await a.ultimaPublicada()) === null);

console.log('\ncuando falla no se dice nada, y menos un error');
olvida();
fingeGitHub({ ok: false, cuerpo: {} });
dice('un 403 por límite de peticiones se traga', (await a.ultimaPublicada()) === null);
olvida();
fingeGitHub(new Error('sin red'));
dice('sin red también', (await a.ultimaPublicada()) === null);

console.log('\ny lo de ayer vale más que nada');
olvida();
globalThis.localStorage.setItem(
  'panal:ultima-version:v1',
  JSON.stringify({ visto: Date.now() - 25 * 60 * 60 * 1000, version: '2.6.0' }),
);
fingeGitHub(new Error('sin red'));
dice(
  'si la pregunta falla se usa lo guardado, aunque esté caducado',
  (await a.ultimaPublicada()) === '2.6.0',
);

console.log('\nlo guardado tampoco se cree sin mirarlo');
olvida();
globalThis.localStorage.setItem('panal:ultima-version:v1', 'esto no es json');
espia = fingeGitHub({ cuerpo: { tag_name: 'apk-v2.6.0' } });
dice('un guardado roto se ignora y se pregunta', (await a.ultimaPublicada()) === '2.6.0');
olvida();
globalThis.localStorage.setItem(
  'panal:ultima-version:v1',
  JSON.stringify({ visto: Date.now(), version: 'lo que sea' }),
);
espia = fingeGitHub({ cuerpo: { tag_name: 'apk-v2.6.0' } });
dice('y un guardado con una versión imposible, igual', (await a.ultimaPublicada()) === '2.6.0');

console.log(`\n${bien} bien · ${mal} mal`);
if (mal > 0) process.exit(1);
