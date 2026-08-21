/**
 * El historial de las conversaciones.
 *
 *     npx tsx scripts/test-historial.ts
 *
 * Lo que se comprueba es sobre todo el AISLAMIENTO: en Panal la wallet es la
 * identidad, así que cambiar de wallet tiene que ser cambiar de persona. Un
 * hilo que se cuele entre dos wallets no es un fallo de interfaz, es enseñarle
 * a alguien una conversación que no es suya.
 *
 * Hermético: `localStorage` se simula, no se toca ningún navegador.
 */

/** Un localStorage de mentira, con cuota, para probar también qué pasa al llenarse. */
class Almacen {
  private datos = new Map<string, string>();
  tope = Infinity;
  getItem(k: string): string | null {
    return this.datos.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    if (v.length > this.tope) throw new Error('QuotaExceededError');
    this.datos.set(k, v);
  }
  removeItem(k: string): void {
    this.datos.delete(k);
  }
}
const almacen = new Almacen();
(globalThis as { localStorage?: unknown }).localStorage = almacen;

const { leerHilo, anadirMensaje, listarHilos, borrarHilo, nuevoId } = await import('../src/lib/historial.js');

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

const YO = '0x69D084926e68af78cDa512eF1Bf2c3e7B4307CBf';
const OTRO = '0x1558cF6aed695F3F8AafE488058EfE28d216E69C';
const LINT = '0xAAaaAAaa00000000000000000000000000000001';
const I18N = '0xBBbbBBbb00000000000000000000000000000002';

const msg = (texto: string, de: 'yo' | 'agente' = 'yo') => ({ id: nuevoId(), de, texto, cuando: Date.now() });

console.log('\n── Guardar y leer ──\n');

check('un hilo nuevo está vacío', leerHilo(YO, LINT).length === 0);
const hilo = anadirMensaje(YO, LINT, msg('¿miras este contrato?'));
check('añadir devuelve el hilo ya actualizado', hilo.length === 1 && hilo[0]!.texto === '¿miras este contrato?');
anadirMensaje(YO, LINT, msg('Hay una reentrada.', 'agente'));
check('y se leen en orden', leerHilo(YO, LINT).map((m) => m.de).join(',') === 'yo,agente');

console.log('\n── Cada wallet ve lo suyo, y sólo lo suyo ──\n');

anadirMensaje(OTRO, LINT, msg('yo soy otra persona'));
check('otra wallet no ve el hilo ajeno', leerHilo(OTRO, LINT).length === 1, String(leerHilo(OTRO, LINT).length));
check('y el original sigue intacto', leerHilo(YO, LINT).length === 2);
check(
  'la bandeja de cada uno sólo lleva lo suyo',
  listarHilos(YO).length === 1 && listarHilos(OTRO).length === 1,
  `${listarHilos(YO).length} / ${listarHilos(OTRO).length}`,
);

// El mismo par escrito con otro checksum es el MISMO par: sin normalizar
// aparecerían dos conversaciones donde hay una.
check('la dirección en otro checksum es el mismo hilo', leerHilo(YO.toLowerCase(), LINT.toUpperCase()).length === 2);

console.log('\n── La bandeja ──\n');

anadirMensaje(YO, I18N, msg('tradúceme esto'));
const bandeja = listarHilos(YO);
check('lista los dos hilos', bandeja.length === 2, String(bandeja.length));
check('el más reciente primero', bandeja[0]!.agente === I18N.toLowerCase(), bandeja[0]!.agente);
check('con su último mensaje y su cuenta', bandeja[1]!.cuantos === 2 && bandeja[1]!.ultimo.de === 'agente');

console.log('\n── Cuando algo va mal ──\n');

borrarHilo(YO, I18N);
check('borrar quita el hilo', listarHilos(YO).length === 1);

// Cuota llena: se prefiere perder conversaciones viejas antes que perder la
// que se está teniendo. El mensaje ya está enviado y cobrado.
almacen.tope = 400;
let reventó = false;
try {
  for (let i = 0; i < 40; i++) anadirMensaje(YO, LINT, msg(`mensaje largo número ${i} `.repeat(4)));
} catch {
  reventó = true;
}
check('con la cuota llena no lanza', !reventó);
almacen.tope = Infinity;

// Un JSON corrupto no puede impedir mandar un mensaje.
almacen.setItem('panal:hilos:v1', '{esto no es json');
check('un historial ilegible se trata como vacío', leerHilo(YO, LINT).length === 0);
check('y se puede seguir escribiendo encima', anadirMensaje(YO, LINT, msg('otra vez')).length === 1);

console.log(
  fallos === 0
    ? '\n✅ Cada wallet ve sus conversaciones, y un almacenamiento roto no impide hablar\n'
    : `\n❌ ${fallos} comprobación(es) fallidas\n`,
);
process.exit(fallos === 0 ? 0 : 1);
