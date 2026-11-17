/**
 * Instalar la versión nueva desde la app.
 *
 * Lo nativo (bajar, comprobar la firma, abrir el instalador) solo se puede
 * probar en un teléfono. Lo que se prueba aquí es lo que decide qué ve la
 * persona en el menú, con un plugin de mentira: que «Actualizar» solo salga
 * cuando la versión ya está bajada, que dos toques no lancen dos descargas,
 * que una versión rara no llegue al lado nativo, que el progreso se cuente
 * bien y que un fallo de firma no se confunda con uno de red, porque al de
 * red se le ofrece el navegador y al de firma no.
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
 * Un plugin de mentira. `descargar` e `instalar` se quedan esperando hasta que
 * el test los suelte con `terminar()` o `fallar(codigo)`, para poder mirar el
 * estado a mitad de camino.
 */
function fingePlugin({ preparada = false } = {}) {
  const espia = { descargas: [], instalaciones: [], miradas: 0, oyentes: [], quitados: 0 };
  let soltar;
  const esperar = () =>
    new Promise((resolver, rechazar) => {
      soltar = { resolver, rechazar };
    });
  const plugin = {
    descargar(o) {
      espia.descargas.push(o.version);
      return esperar();
    },
    instalar(o) {
      espia.instalaciones.push(o.version);
      return esperar();
    },
    async preparada() {
      espia.miradas++;
      return { lista: preparada };
    },
    async addListener(evento, oyente) {
      const entrada = { evento, oyente, vivo: true };
      espia.oyentes.push(entrada);
      return { remove: async () => { entrada.vivo = false; espia.quitados++; } };
    },
  };
  const progreso = (recibidos, total) => {
    for (const o of espia.oyentes) if (o.vivo && o.evento === 'progreso') o.oyente({ recibidos, total });
  };
  const terminar = () => soltar.resolver({ estado: 'ok' });
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
await m.instalador.descargar('2.6.0');
await m.instalador.mirar('2.6.0');
dice('y pedirle algo no hace nada', m.instalador.leer().fase === 'quieto');

console.log('\npaso 1: descargar, y «Actualizar» solo al terminar');
{
  const f = fingePlugin();
  const ins = m.crearInstalador(f.plugin);
  let avisos = 0;
  const quitar = ins.suscribir(() => avisos++);
  dice('empieza quieto (el menú dice «Descargar»)', ins.leer().fase === 'quieto');

  const hecho = ins.descargar('2.6.0');
  await espera();
  dice('pasa a bajando, todavía sin número', ins.leer().fase === 'bajando' && ins.leer().pct === null);
  dice('pide al lado nativo la versión exacta', f.espia.descargas.length === 1 && f.espia.descargas[0] === '2.6.0');
  dice('y NO abre el instalador', f.espia.instalaciones.length === 0);

  f.progreso(1_054_016, 4_216_061);
  dice('cuenta el progreso: 25 %', ins.leer().pct === 25);
  f.progreso(4_216_061, 4_216_061);
  dice('y llega a 100 %', ins.leer().pct === 100);
  dice('a 100 % todavía no dice «Actualizar»: falta comprobarla', ins.leer().fase === 'bajando');

  await ins.descargar('2.6.0');
  dice('un segundo toque a mitad NO lanza otra descarga', f.espia.descargas.length === 1);
  await ins.instalar('2.6.0');
  dice('ni abre el instalador a medias', f.espia.instalaciones.length === 0);

  f.terminar();
  await hecho;
  dice('al terminar queda «lista»: ahora sí sale «Actualizar»', ins.leer().fase === 'lista');
  dice('y deja de escuchar el progreso', f.espia.quitados === 1);
  dice('avisa a quien mira cada cambio', avisos >= 4);

  console.log('\npaso 2: actualizar');
  const abre = ins.instalar('2.6.0');
  await espera();
  dice('«Actualizar» abre el instalador con esa versión', f.espia.instalaciones[0] === '2.6.0');
  dice('sin volver a descargar', f.espia.descargas.length === 1);
  dice('y sin pasar por «bajando» si el archivo ya está', ins.leer().fase === 'lista');
  f.terminar();
  await abre;
  dice('queda «instalador»', ins.leer().fase === 'instalador');

  const otra = ins.instalar('2.6.0');
  await espera();
  dice('si se canceló, se puede volver a abrir', f.espia.instalaciones.length === 2);
  f.terminar();
  await otra;
  quitar();
}

console.log('\nsi la caché se vació, «Actualizar» la vuelve a bajar y se ve');
{
  const f = fingePlugin();
  const ins = m.crearInstalador(f.plugin);
  const d = ins.descargar('2.6.0');
  await espera();
  f.terminar();
  await d;
  const abre = ins.instalar('2.6.0');
  await espera();
  f.progreso(2_108_031, 4_216_061);
  dice('enseña el progreso de esa segunda descarga', ins.leer().fase === 'bajando' && ins.leer().pct === 50);
  f.terminar();
  await abre;
  dice('y acaba en el instalador', ins.leer().fase === 'instalador');
}

console.log('\nal abrir el menú con la versión ya bajada');
{
  const f = fingePlugin({ preparada: true });
  const ins = m.crearInstalador(f.plugin);
  await ins.mirar('2.6.0');
  dice('pregunta al lado nativo', f.espia.miradas === 1);
  dice('y ofrece «Actualizar» directamente', ins.leer().fase === 'lista');
  dice('sin descargar nada', f.espia.descargas.length === 0);
}
{
  const f = fingePlugin({ preparada: false });
  const ins = m.crearInstalador(f.plugin);
  await ins.mirar('2.6.0');
  dice('si no hay nada bajado, sigue en «Descargar»', ins.leer().fase === 'quieto');
}
{
  const f = fingePlugin({ preparada: true });
  const ins = m.crearInstalador(f.plugin);
  const d = ins.descargar('2.6.0');
  await espera();
  await ins.mirar('2.6.0');
  dice('a mitad de una descarga, mirar no pisa el progreso', ins.leer().fase === 'bajando' && f.espia.miradas === 0);
  f.terminar();
  await d;
}

console.log('\nlo que no es una versión no llega al teléfono');
{
  const f = fingePlugin();
  const ins = m.crearInstalador(f.plugin);
  for (const raro of ['../../etc/passwd', '2.6', '2.6.0.1', '2.6.0/x', 'https://otro.sitio/a.apk', '', '12345.0.0']) {
    await ins.mirar(raro);
    await ins.descargar(raro);
    await ins.instalar(raro);
  }
  dice('ninguna llamada al lado nativo', f.espia.descargas.length + f.espia.instalaciones.length + f.espia.miradas === 0);
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
  const hecho = ins.descargar('2.6.0');
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
