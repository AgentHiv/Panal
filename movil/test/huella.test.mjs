/**
 * Abrir el llavero con la huella.
 *
 * El diálogo del sistema y la clave del chip solo se prueban en un teléfono.
 * Aquí, con un plugin de mentira, lo que decide la app: que se guarde el PIN
 * y se devuelva el mismo, que cancelar no desactive nada, que unas huellas
 * cambiadas la desactiven (y borren la clave), que un guardado roto no llegue
 * nunca a teclearse como PIN, que dos peticiones seguidas no abran dos
 * diálogos, que «ahora no» no se vuelva a ofrecer y que borrar el llavero se
 * lleve también la huella.
 */
globalThis.localStorage = {
  _d: new Map(),
  getItem(k) { return this._d.has(k) ? this._d.get(k) : null; },
  setItem(k, v) { this._d.set(k, String(v)); },
  removeItem(k) { this._d.delete(k); },
  clear() { this._d.clear(); },
};

const m = await import('../src/lib/huella.ts');

let bien = 0;
let mal = 0;
const dice = (que, cond) => {
  if (cond) { bien++; console.log('  ✅', que); }
  else { mal++; console.log('  ❌', que); }
};

const TEXTOS = { titulo: 'Abrir Panal', subtitulo: 'Pon el dedo', cancelar: 'Usar el PIN' };

/** Un plugin de mentira: «cifra» poniendo una marca delante. */
function falso({ disponible = true } = {}) {
  const p = {
    disponible,
    llamadas: { activar: 0, abrir: 0, olvidar: 0 },
    siguienteFallo: null,
    trucar: null,
    textos: null,
    async estado() { return { disponible: p.disponible }; },
    async activar({ datos, ...t }) {
      p.llamadas.activar++;
      p.textos = t;
      if (p.siguienteFallo) { const c = p.siguienteFallo; p.siguienteFallo = null; throw Object.assign(new Error(c), { code: c }); }
      return { iv: 'IV', datos: 'X' + datos };
    },
    async abrir({ iv, datos, ...t }) {
      p.llamadas.abrir++;
      p.textos = t;
      await new Promise((r) => setTimeout(r, 5));
      if (p.siguienteFallo) { const c = p.siguienteFallo; p.siguienteFallo = null; throw Object.assign(new Error(c), { code: c }); }
      if (p.trucar) return { datos: p.trucar };
      return { datos: datos.slice(1) };
    },
    async olvidar() { p.llamadas.olvidar++; },
  };
  return p;
}

console.log('\nSin plugin (navegador, Play sin sensor):');
{
  localStorage.clear();
  const h = m.crearHuella(null);
  dice('no está disponible', (await h.disponible()) === false);
  dice('no está activada', h.activada() === false);
  dice('activar no hace nada', (await h.activar('123456', TEXTOS)) === 'fallo' && localStorage.getItem(m.CLAVE_HUELLA) === null);
  dice('no se ofrece', (await h.ofrecer()) === false);
  localStorage.setItem(m.CLAVE_HUELLA, JSON.stringify({ iv: 'a', datos: 'b' }));
  dice('aunque haya algo guardado, sin plugin no cuenta como activada', h.activada() === false);
}

console.log('\nActivar y abrir:');
{
  localStorage.clear();
  const p = falso();
  const h = m.crearHuella(p);
  let avisos = 0;
  h.suscribir(() => avisos++);
  dice('se ofrece en un teléfono con huella', (await h.ofrecer()) === true);
  dice('activar con un PIN de 6 cifras dice ok', (await h.activar('042917', TEXTOS)) === 'ok');
  dice('el diálogo lleva los textos de la app', p.textos?.titulo === 'Abrir Panal' && p.textos?.cancelar === 'Usar el PIN');
  dice('queda activada y avisa', h.activada() && avisos === 1);
  dice('lo guardado es el sobre, no el PIN en claro', !localStorage.getItem(m.CLAVE_HUELLA).includes('042917'));
  const r = await h.pin(TEXTOS);
  dice('el dedo devuelve el mismo PIN', r.pin === '042917');
  dice('ya activada, no se vuelve a ofrecer', (await h.ofrecer()) === false);
  dice('un PIN que no es de 6 cifras ni llega al chip', (await h.activar('12345', TEXTOS)) === 'fallo' && p.llamadas.activar === 1);
}

console.log('\nCancelar y fallos:');
{
  localStorage.clear();
  const p = falso();
  const h = m.crearHuella(p);
  await h.activar('111111', TEXTOS);

  p.siguienteFallo = 'CANCELADO';
  let r = await h.pin(TEXTOS);
  dice('cancelar devuelve «cancelado»', r.fallo === 'cancelado');
  dice('y la huella sigue activada', h.activada() && p.llamadas.olvidar === 0);

  p.siguienteFallo = 'BLOQUEADA';
  r = await h.pin(TEXTOS);
  dice('demasiados intentos devuelve «bloqueada» sin desactivar', r.fallo === 'bloqueada' && h.activada());

  p.siguienteFallo = 'RARO';
  r = await h.pin(TEXTOS);
  dice('un fallo cualquiera devuelve «fallo» sin desactivar', r.fallo === 'fallo' && h.activada());

  p.siguienteFallo = 'INVALIDADA';
  r = await h.pin(TEXTOS);
  dice('huellas cambiadas devuelve «invalidada»', r.fallo === 'invalidada');
  dice('y la desactiva, borrando también la clave del chip', !h.activada() && p.llamadas.olvidar === 1);

  await h.activar('111111', TEXTOS);
  p.siguienteFallo = 'SIN_CLAVE';
  r = await h.pin(TEXTOS);
  dice('sin clave en el chip cuenta como invalidada', r.fallo === 'invalidada' && !h.activada());

  p.siguienteFallo = 'CANCELADO';
  dice('cancelar al activar no deja nada guardado', (await h.activar('111111', TEXTOS)) === 'cancelado' && !h.activada());
}

console.log('\nGuardado roto:');
{
  localStorage.clear();
  const p = falso();
  const h = m.crearHuella(p);
  await h.activar('222222', TEXTOS);
  p.trucar = btoa('hola');
  const r = await h.pin(TEXTOS);
  dice('lo que no es un PIN no se devuelve como PIN', r.fallo === 'fallo' && !('pin' in r));
  dice('y la huella se desactiva', !h.activada());
  localStorage.setItem(m.CLAVE_HUELLA, '{no es json');
  dice('un guardado ilegible no cuenta como activada', !h.activada());
  const r2 = await h.pin(TEXTOS);
  dice('y pedir el PIN con él no llega al chip', r2.fallo === 'fallo' && p.llamadas.abrir === 1);
}

console.log('\nUn diálogo cada vez:');
{
  localStorage.clear();
  const p = falso();
  const h = m.crearHuella(p);
  await h.activar('333333', TEXTOS);
  const [a, b] = await Promise.all([h.pin(TEXTOS), h.pin(TEXTOS)]);
  dice('dos peticiones seguidas abren UN diálogo', p.llamadas.abrir === 1);
  dice('y las dos reciben el PIN', a.pin === '333333' && b.pin === '333333');
  await h.pin(TEXTOS);
  dice('terminado, la siguiente abre otro', p.llamadas.abrir === 2);
}

console.log('\nOfrecerla:');
{
  localStorage.clear();
  const sinSensor = m.crearHuella(falso({ disponible: false }));
  dice('sin huella en el teléfono no se ofrece', (await sinSensor.ofrecer()) === false);
  const h = m.crearHuella(falso());
  h.noOfrecer();
  dice('después de «ahora no» no se ofrece', (await h.ofrecer()) === false);
  dice('pero se puede activar a mano', (await h.activar('444444', TEXTOS)) === 'ok');
}

console.log('\nDesactivar y borrar el llavero:');
{
  localStorage.clear();
  const p = falso();
  const h = m.crearHuella(p);
  await h.activar('555555', TEXTOS);
  h.desactivar();
  await new Promise((r) => setTimeout(r, 1));
  dice('desactivar borra lo guardado y la clave', !h.activada() && p.llamadas.olvidar === 1);
  const r = await h.pin(TEXTOS);
  dice('y el dedo ya no da nada', r.fallo === 'fallo');

  await h.activar('555555', TEXTOS);
  const { borrarLlavero } = await import('../src/lib/llavero.ts');
  borrarLlavero();
  dice('borrar el llavero se lleva la huella', localStorage.getItem(m.CLAVE_HUELLA) === null && !h.activada());
}

console.log(`\n${bien} bien, ${mal} mal`);
if (mal > 0) process.exit(1);
