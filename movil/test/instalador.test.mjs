/**
 * Instalar la versión nueva desde la app.
 *
 * Lo nativo (bajar, comprobar la firma, abrir el instalador) solo se puede
 * probar en un teléfono. Lo que se prueba aquí es lo que decide qué ve la
 * persona en el menú, con un plugin de mentira: que dos toques no lancen dos
 * descargas, que una versión rara no llegue al lado nativo, que el progreso se
 * cuente bien y que un fallo de firma no se confunda con uno de red, porque
 * al de red se le ofrece el navegador y al de firma no.
 */
globalThis.localStorage = {
  _d: new Map(),
  getItem(k) { return this._d.has(k) ? this._d.get(k) : null; },
  setItem(k, v) { this._d.set(k, String(v)); },
  removeItem(k) { this._d.delete(k); },
};
globalThis.__VITE_ENV__ = { VITE_VERSION: '2.5.0' };

const m = await import('../src/lib/instalador.ts');

let bien = 0;
let mal = 0;
const dice = (que, cond) => {
  if (cond) { bien++; console.log('  ✅', que); }
  else { mal++; console.log('  ❌', que); }
};

/**
 * Un plugin de mentira. `instalar` se queda esperando hasta que el test lo
 * suelte con `terminar()` o `fallar(codigo)`, para poder mirar el estado a
 * mitad de la descarga.
 */
function fingePlugin() {
  const espia = { llamadas: [], oyentes: [], quitados: 0 };
  let soltar;
  const plugin = {
    instalar(o) {
      espia.llamadas.push(o.version);
      return new Promise((resolver, rechazar) => {
        soltar = { resolver, rechazar };
      });
    },
    async addListener(evento, oyente) {
      espia.oyentes.push({ evento, oyente });
      return { remove: async () => { espia.quitados++; } };
    },
  };
  const progreso = (recibidos, total) => {
    for (const o of espia.oyentes) if (o.evento === 'progreso') o.oyente({ recibidos, total });
  };
  const terminar = () => soltar.resolver({ estado: 'instalador' });
  const fallar = (code) => {
    const e = new Error('no');
    e.code = code;
    soltar.rechazar(e);
  };
  return { plugin, espia, progreso, terminar, fallar };
}

const espera = () => new Promise((r) => setTimeout(r, 0));

console.log('\nfuera del APK no hay actualizador');
dice('en Node (como en el navegador) no está disponible', m.instalador.disponible === false);
await m.instalador.instalar('2.6.0');
dice('y pedirle algo no hace nada', m.instalador.leer().fase === 'quieto');

console.log('\nel camino bueno');
{
  const f = fingePlugin();
  const ins = m.crearInstalador(f.plugin);
  let avisos = 0;
  const quitar = ins.suscribir(() => avisos++);
  dice('empieza quieto', ins.leer().fase === 'quieto');

  const hecho = ins.instalar('2.6.0');
  await espera();
  dice('pasa a bajando, todavía sin número', ins.leer().fase === 'bajando' && ins.leer().pct === null);
  dice('pide al lado nativo la versión exacta', f.espia.llamadas.length === 1 && f.espia.llamadas[0] === '2.6.0');

  f.progreso(1_054_016, 4_216_061);
  dice('cuenta el progreso: 25 %', ins.leer().pct === 25);
  f.progreso(4_216_061, 4_216_061);
  dice('y llega a 100 %', ins.leer().pct === 100);

  await ins.instalar('2.6.0');
  dice('un segundo toque a mitad NO lanza otra descarga', f.espia.llamadas.length === 1);

  f.terminar();
  await hecho;
  dice('termina con el instalador abierto', ins.leer().fase === 'instalador');
  dice('y deja de escuchar el progreso', f.espia.quitados === 1);
  dice('avisa a quien mira cada cambio', avisos >= 4);

  const otra = ins.instalar('2.6.0');
  await espera();
  dice('desde «instalador» se puede volver a pedir (si se canceló)', f.espia.llamadas.length === 2);
  f.terminar();
  await otra;
  quitar();
}

console.log('\nlo que no es una versión no llega al teléfono');
{
  const f = fingePlugin();
  const ins = m.crearInstalador(f.plugin);
  for (const raro of ['../../etc/passwd', '2.6', '2.6.0.1', '2.6.0/x', 'https://otro.sitio/a.apk', '', '12345.0.0']) {
    await ins.instalar(raro);
  }
  dice('ninguna llamada al lado nativo', f.espia.llamadas.length === 0);
  dice('y el estado sigue quieto', ins.leer().fase === 'quieto');
}

console.log('\nlos fallos, en sus dos clases');
for (const [codigo, motivo] of [
  ['FIRMA', 'noEsNuestra'],
  ['OTRA_APP', 'noEsNuestra'],
  ['RED', 'fallo'],
  ['CORRUPTO', 'fallo'],
  ['NO_ES_NUEVA', 'fallo'],
  ['GRANDE', 'fallo'],
  ['INSTALADOR', 'fallo'],
  [undefined, 'fallo'],
]) {
  const f = fingePlugin();
  const ins = m.crearInstalador(f.plugin);
  const hecho = ins.instalar('2.6.0');
  await espera();
  f.fallar(codigo);
  await hecho;
  const e = ins.leer();
  dice(`${codigo ?? 'sin código'} → ${motivo}`, e.fase === 'error' && e.motivo === motivo);
}

console.log('\nel porcentaje');
dice('sin tamaño no se inventa un número', m.porcentaje(1000, 0) === null);
dice('con un tamaño negativo tampoco', m.porcentaje(1000, -1) === null);
dice('redondea hacia abajo: 99,9 % es 99', m.porcentaje(999, 1000) === 99);
dice('nunca pasa de 100', m.porcentaje(2000, 1000) === 100);

console.log(`\n${bien} bien, ${mal} mal`);
if (mal > 0) process.exit(1);
