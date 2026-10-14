/**
 * Pruebas del tablón con reglas en el SDK: lo que se calcula sin la cadena.
 *
 *   npx tsx test/tablon-reglas.test.ts
 *
 * HERMÉTICO. Lo que se protege:
 *   1. Que la clave de una campaña sea la del contrato BYTE A BYTE
 *      (`keccak256(abi.encode(publicador, id))`): con otra, `campaignTaken` y
 *      `campaignCap` se leerían de una campaña que no existe.
 *   2. Que el cupo que le queda a un agente se cuente igual que en `_check`:
 *      el día UTC, los abiertos, los de novato de uno en uno.
 *   3. Que las comprobaciones antes de firmar digan el motivo de lo que el
 *      contrato rechazaría.
 *   4. Que un cliente sin PanalTablon desplegado lo diga, en vez de mandar
 *      nada a la dirección cero.
 *
 * La parte contra la cadena está en tablon-fork.ts: necesita anvil.
 */

import type { Address } from 'viem';
import { createPanalClient } from '../src/client.js';
import { NATIVE_CURRENCY } from '../src/chains.js';
import {
  CATEGORIAS_TABLON,
  MAX_ANUNCIO,
  MAX_TEXTO_ANUNCIO,
  ModoTablon,
  anuncioPara,
  audienciaAdmite,
  categoriaDelTablon,
  categoriasDeMascara,
  claveDeCampana,
  idDeCampana,
  leerAnuncio,
  MAX_ARCHIVOS_TABLON,
  problemaAlPublicar,
  problemaConArchivos,
  tablonArchivoSignMessage,
  situacionDe,
  tablonEncargoSignMessage,
  tablonEntregaSignMessage,
  tablonResultadoSignMessage,
  type PublicarEnElTablon,
} from '../src/tablon-reglas.js';

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

console.log('\nla clave de una campaña, la del contrato');
{
  // Calculada con `cast keccak $(cast abi-encode "f(address,bytes32)" …)`.
  const id = idDeCampana('evento-octubre');
  check('el id es keccak256 del nombre', id === '0xc8e4e9c1a06629e509692479a42ee41d208595e66c42375387882931cbc01a4b', id);
  const clave = claveDeCampana('0x70997970C51812dc3A010C7d01b50e0d17dc79C8', id);
  check(
    'keccak256(abi.encode(publicador, id))',
    clave === '0xff52237ba3f72d16fe17be8086faf362513d640be2eaef7a2189fbc9748b6323',
    clave,
  );
  check(
    'otro publicador, otra campaña',
    claveDeCampana('0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC', id) !== clave,
  );
}

console.log('\nlos mensajes del buzón, idénticos a los de bot/src/buzon.ts');
check('encargo', tablonEncargoSignMessage(7n, 1700000000) === 'Panal tablón con reglas · encargo #7 · 1700000000');
check(
  'entrega, con el hash del texto dentro',
  tablonEntregaSignMessage(7n, `0x${'AB'.repeat(32)}`, 1700000000) ===
    `Panal tablón con reglas · entrega #7 · 0x${'ab'.repeat(32)} · 1700000000`,
);
check('resultado', tablonResultadoSignMessage(7n, 1700000000) === 'Panal tablón con reglas · resultado #7 · 1700000000');

console.log('\nlas categorías de la máscara');
check('0, 9 y 255', categoriasDeMascara(1n | (1n << 9n) | (1n << 255n)).join() === '0,9,255');
check('ninguna', categoriasDeMascara(0n).length === 0);

console.log('\nel cupo, contado como el contrato');
{
  const ahora = 1_800_000_000; // 2027-01-15 08:00 UTC
  const hoy = Math.floor(ahora / 86_400);
  const stats = (o: Partial<{ day: number; takenToday: number; open: number; newcomerUsed: number; suspendedUntil: number }>) => ({
    day: hoy,
    takenToday: 0,
    open: 0,
    newcomerUsed: 0,
    suspendedUntil: 0,
    ...o,
  });
  const nivel2 = situacionDe({ nivel: 2, cupoDiario: 5, stats: stats({ takenToday: 3, open: 2 }), encargosDeNovato: 2, mascara: 1n }, ahora);
  check('nivel 2 con 3 hoy y 2 abiertos: le quedan 2 hoy y 3 abiertos', nivel2.hoyLibres === 2 && nivel2.abiertosLibres === 3);
  const ayer = situacionDe({ nivel: 2, cupoDiario: 5, stats: stats({ day: hoy - 1, takenToday: 5 }), encargosDeNovato: 2, mascara: 1n }, ahora);
  check('lo de ayer no cuenta hoy', ayer.cogidosHoy === 0 && ayer.hoyLibres === 5);
  const novato = situacionDe({ nivel: 0, cupoDiario: 0, stats: stats({ newcomerUsed: 1 }), encargosDeNovato: 2, mascara: 0n }, ahora);
  check('novato con uno gastado y nada abierto: puede uno', novato.hoyLibres === 1 && novato.novatoLibres === 1);
  const novatoAbierto = situacionDe({ nivel: 0, cupoDiario: 0, stats: stats({ newcomerUsed: 1, open: 1 }), encargosDeNovato: 2, mascara: 0n }, ahora);
  check('novato con uno abierto: de uno en uno', novatoAbierto.hoyLibres === 0);
  const gastado = situacionDe({ nivel: 0, cupoDiario: 0, stats: stats({ newcomerUsed: 2 }), encargosDeNovato: 2, mascara: 0n }, ahora);
  check('novato con los dos gastados: ninguno', gastado.hoyLibres === 0 && gastado.novatoLibres === 0);
  const suspendido = situacionDe({ nivel: 1, cupoDiario: 1, stats: stats({ suspendedUntil: ahora + 100 }), encargosDeNovato: 2, mascara: 1n }, ahora);
  check('una suspensión vigente se ve', suspendido.suspendidoHasta === ahora + 100);
  const pasada = situacionDe({ nivel: 1, cupoDiario: 1, stats: stats({ suspendedUntil: ahora - 1 }), encargosDeNovato: 2, mascara: 1n }, ahora);
  check('una que ya pasó, no', pasada.suspendidoHasta === 0);
}

console.log('\nantes de firmar, el motivo');
{
  const bien: PublicarEnElTablon = {
    encargo: 'Traduce este README al francés',
    anuncio: 'Traducción ES→FR, 2.000 palabras',
    categoria: 2,
    importe: 10n ** 18n,
    plazoEntregaS: 24 * 3600,
    caducaEnS: 7 * 24 * 3600,
    modo: ModoTablon.Seleccion,
    ventanaOfertasS: 2 * 3600,
    ventanaEleccionS: 24 * 3600,
  };
  check('un encargo bien hecho pasa', problemaAlPublicar(bien) === null, String(problemaAlPublicar(bien)));
  const casos: [string, Partial<PublicarEnElTablon>, string][] = [
    ['sin anuncio', { anuncio: '  ' }, 'anuncio'],
    ['menos de una hora para entregar (F2)', { plazoEntregaS: 3599 }, 'una hora'],
    ['más de 7 días para elegir (F6)', { ventanaEleccionS: 7 * 24 * 3600 + 1, caducaEnS: 30 * 24 * 3600 }, '7 días'],
    ['caduca antes de elegir', { caducaEnS: 3 * 3600 }, 'Caduca antes'],
    ['selección sin tiempo de ofertas', { ventanaOfertasS: 0 }, 'ofertar'],
    ['campaña con tope 0', { campana: { id: idDeCampana('x'), topePorAgente: 0 } }, 'tope'],
    ['categoría 256', { categoria: 256 }, 'categoría'],
  ];
  for (const [nombre, cambio, esperado] of casos) {
    const p = problemaAlPublicar({ ...bien, ...cambio });
    check(nombre, p !== null && p.includes(esperado), String(p));
  }
  check('en inmediato no hacen falta ventanas', problemaAlPublicar({ ...bien, modo: ModoTablon.Inmediato, ventanaOfertasS: 0 }) === null);
  // Lo que el buzón no guardaría: el encargo quedaría pagado y sin anuncio.
  check('un anuncio de más de 500 no se publica', problemaAlPublicar({ ...bien, anuncio: 'x'.repeat(MAX_ANUNCIO + 1) })?.includes('500') === true);
  check('con la marca sola no hay anuncio', problemaAlPublicar({ ...bien, anuncio: 'para:personas · ' })?.includes('anuncio') === true);
}

console.log('\narchivos en el tablón');
{
  const uno = (name: string, n = 10) => ({ name, bytes: new Uint8Array(n).fill(7) });
  check('el mensaje es el que comprueba el buzón', tablonArchivoSignMessage(7n, 1700000000) === 'Panal tablón con reglas · archivo #7 · 1700000000');
  check('unos pocos archivos pasan', problemaConArchivos([uno('a.pdf'), uno('b.png')]) === null);
  check('más de los que caben, no', problemaConArchivos(Array.from({ length: MAX_ARCHIVOS_TABLON + 1 }, (_, i) => uno(`${i}.txt`)))?.includes('Como mucho') === true);
  check('uno vacío, no', problemaConArchivos([uno('a.pdf', 0)])?.includes('vacío') === true);
  check('uno de más de 25 MB, no', problemaConArchivos([{ name: 'v.mp4', bytes: new Uint8Array(25 * 1024 * 1024 + 1) }])?.includes('25 MB') === true);
  check(
    'entre todos más de 30 MB, no',
    problemaConArchivos([{ name: 'a.bin', bytes: new Uint8Array(20 * 1024 * 1024) }, { name: 'b.bin', bytes: new Uint8Array(11 * 1024 * 1024) }])?.includes('30 MB') === true,
  );
  check('dos con el mismo nombre, no: se piden por nombre', problemaConArchivos([uno('x/a.pdf'), uno('a.pdf')])?.includes('mismo nombre') === true);
  check('un nombre inservible, no', problemaConArchivos([uno('...')])?.includes('nombre') === true);
  const bien: PublicarEnElTablon = {
    encargo: 'Revisa la hoja', anuncio: 'Revisar una hoja de cálculo', categoria: 0, importe: 10n ** 18n,
    plazoEntregaS: 24 * 3600, caducaEnS: 7 * 24 * 3600, modo: ModoTablon.Inmediato,
  };
  check('publicar con adjuntos que caben pasa', problemaAlPublicar({ ...bien, adjuntos: [uno('hoja.csv')] }) === null);
  check('y con uno vacío dice por qué antes de pagar', problemaAlPublicar({ ...bien, adjuntos: [uno('hoja.csv', 0)] })?.includes('vacío') === true);
}

console.log('\npara quién es el encargo');
{
  check('sin marca, para todos', leerAnuncio('Traducir un menú').audiencia === 'todos');
  const p = leerAnuncio('para:personas · Traducir un menú');
  check('para personas, y el texto sin la marca', p.audiencia === 'personas' && p.texto === 'Traducir un menú', JSON.stringify(p));
  check('para agentes', leerAnuncio('para:agentes · Revisar código').audiencia === 'agentes');
  check('la marca solo cuenta al principio', leerAnuncio('Ojo: para:personas · no').audiencia === 'todos');
  check('anuncioPara pone la marca', anuncioPara('personas', '  Traducir  ') === 'para:personas · Traducir');
  check('y para todos no pone nada', anuncioPara('todos', 'Traducir') === 'Traducir');
  check('nunca dos marcas', anuncioPara('agentes', 'para:personas · Traducir') === 'para:agentes · Traducir');
  check('lo que se escribe más la marca cabe en el buzón', anuncioPara('personas', 'x'.repeat(MAX_TEXTO_ANUNCIO)).length <= MAX_ANUNCIO);
  check('una persona entra en uno para personas', audienciaAdmite('personas', 'persona'));
  check('  un programa, no', !audienciaAdmite('personas', 'bot'));
  check('un programa entra en uno para agentes', audienciaAdmite('agentes', 'bot'));
  check('  una persona, no', !audienciaAdmite('agentes', 'persona'));
  check('en uno para todos, los dos', audienciaAdmite('todos', 'persona') && audienciaAdmite('todos', 'bot'));
  const bien: PublicarEnElTablon = {
    encargo: 'Recoger un paquete', anuncio: anuncioPara('personas', 'Recoger un paquete en Madrid'), categoria: 7,
    importe: 10n ** 18n, plazoEntregaS: 24 * 3600, caducaEnS: 7 * 24 * 3600, modo: ModoTablon.Seleccion,
    ventanaOfertasS: 2 * 3600, ventanaEleccionS: 24 * 3600,
  };
  check('solo personas en selección pasa', problemaAlPublicar(bien) === null, String(problemaAlPublicar(bien)));
  check(
    'solo personas en inmediato no: lo cogería el primero que pase las reglas',
    problemaAlPublicar({ ...bien, modo: ModoTablon.Inmediato })?.includes('selección') === true,
  );
  check('solo agentes en inmediato sí', problemaAlPublicar({ ...bien, anuncio: anuncioPara('agentes', 'Revisar código'), modo: ModoTablon.Inmediato }) === null);
}

console.log('\ncategorías');
{
  // El número es el `category` de la cadena: cambiar el orden reetiqueta encargos ya publicados.
  check('16, cerrada (decisión 6)', CATEGORIAS_TABLON.length === 16);
  check('sin repetir', new Set(CATEGORIAS_TABLON).size === CATEGORIAS_TABLON.length);
  check(
    'las ocho del marketplace primero, en su orden',
    CATEGORIAS_TABLON.slice(0, 8).join() === 'datos,texto,codigo,vision,legal,defi,creativo,humanos',
  );
  check('el 10 es traducción', categoriaDelTablon(10) === 'traduccion');
  check('fuera de la lista, null', categoriaDelTablon(16) === null && categoriaDelTablon(255) === null);
}

console.log('\nsin PanalTablon desplegado');
{
  check('en mainnet está', createPanalClient({ rpcUrl: 'http://127.0.0.1:1' }).boardJobsAvailable === true);
  // Una red sin él: la dirección a cero, como en testnet.
  const panal = createPanalClient({ rpcUrl: 'http://127.0.0.1:1', addresses: { tablon: NATIVE_CURRENCY } });
  check('no está disponible', panal.boardJobsAvailable === false);
  let msg = '';
  try {
    await panal.getBoardJob(0n);
  } catch (e) {
    msg = e instanceof Error ? e.message : String(e);
  }
  check('y lo dice, sin llamar a la dirección cero', msg.includes('todavía no está desplegado'), msg);
  const conDireccion = createPanalClient({
    rpcUrl: 'http://127.0.0.1:1',
    addresses: { tablon: '0x00000000000000000000000000000000000000aa' as Address },
  });
  check('con su dirección en `addresses`, sí', conDireccion.boardJobsAvailable === true);
}

if (fallos) {
  console.error(`\n❌ tablón con reglas: ${fallos} fallo(s)`);
  process.exit(1);
}
console.log('\n✅ tablón con reglas: todo bien');
