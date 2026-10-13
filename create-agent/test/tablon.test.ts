/**
 * El tablón con reglas de la plantilla (PanalTablon).
 *
 *   npx tsx test/tablon.test.ts
 *
 * HERMÉTICO: el tablón, la cadena y el trabajo son dobles.
 *
 * Lo que se protege:
 *   1. Que solo coja u oferte lo que encaja: su categoría, su moneda, al menos
 *      su precio, plazo de entrega suficiente, y nunca lo que publicó él mismo.
 *   2. Que pregunte a `canTake` antes de firmar nada, y que en selección
 *      oferte SU precio y no repita oferta.
 *   3. El orden al coger: coger, esperar, leer, trabajar — con la wallet
 *      ocupada todo ese rato y libre al acabar, pase lo que pase.
 *   4. Que cierre cuentas de lo suyo cuando el escrow ya terminó, y que no lo
 *      intente en cada ronda.
 *   5. Que el vigilante pueda retomar una tarea del tablón: buscar su encargo,
 *      reentregar si ya estaba hecho, y no fiarse de un encargo de disco que no
 *      cuadra con la cadena.
 *   6. Que esté apagado salvo TABLON=on, y que lea bien las categorías.
 *   7. El mínimo en dólares.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keccak256, toBytes, type Address, type Hex } from 'viem';
import { EstadoTablon, ModoTablon, TaskStatus, type EncargoConReglas } from '@panal/sdk';
import {
  buscarEncargoDeTarea,
  candidatos,
  categoriasDelEntorno,
  dolaresNetos,
  EncargosPropios,
  encaja,
  opcionesDelEntorno,
  repasarTablon,
  retomarDelTablon,
  TABLON_POR_DEFECTO,
} from '../template/src/tablon.js';

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

const YO = '0x1558cF6aed695F3F8AafE488058EfE28d216E69C' as Address;
const OTRO = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as Address;
const CERO = '0x0000000000000000000000000000000000000000' as Address;
const MON = CERO;
const PANAL = '0x2e2e44e7fa6178822d4397299f719e89d1a67777' as Address;
const UNO = 10n ** 18n;
const ahora = Math.floor(Date.now() / 1000);
const H = 3600;
const CODIGO = 2;
const TEXTO = 1;

type Anuncio = EncargoConReglas & { anuncio: string };

function encargo(id: number, extra: Partial<Anuncio> = {}): Anuncio {
  return {
    id: BigInt(id),
    cliente: OTRO,
    modo: ModoTablon.Inmediato,
    estado: EstadoTablon.Publicado,
    categoria: CODIGO,
    soloConExperiencia: false,
    republicar: false,
    repartoDado: false,
    devolucionPendiente: false,
    moneda: MON,
    importe: UNO,
    taskHash: keccak256(toBytes(`encargo ${id}`)),
    advertHash: '0x00' as Hex,
    campaignId: '0x00' as Hex,
    publicadoEn: ahora - 60,
    caducaEn: ahora + 24 * H,
    plazoEntregaS: 24 * H,
    ventanaOfertasS: 0,
    ventanaEleccionS: 0,
    repartoAgenteBps: 0,
    agente: CERO,
    escrowTaskId: 0n,
    anuncio: `Review this Solidity contract (${id})`,
    ...extra,
  };
}

const opciones = { ...TABLON_POR_DEFECTO, categorias: [CODIGO, TEXTO] };
const base = { yo: YO, precio: { amount: UNO, currency: MON }, opciones };

console.log('\nel encaje, por palabra entera');
check('«solidity» encaja en «Review my Solidity contract»', encaja('Review my Solidity contract', ['solidity']));
check('con guion o sin él: «code-review» ↔ «code review»', encaja('Necesito un code review rápido', ['code-review']));
check('sin tildes: «traducción» ↔ «traduccion»', encaja('traduccion de cadenas', ['traducción']));
check('«test» no encaja en «testimonio»', !encaja('Escribe un testimonio', ['test']));

console.log('\nsolo coge u oferta lo que encaja');
{
  const lista = [
    encargo(1),
    encargo(2, { cliente: YO }),
    encargo(3, { categoria: 8 }),
    encargo(4, { moneda: PANAL }),
    encargo(5, { importe: UNO / 2n }),
    encargo(6, { plazoEntregaS: 30 * 60 }),
    encargo(7, { importe: 3n * UNO }),
    encargo(8, { caducaEn: ahora + 30 }),
    encargo(9, { modo: ModoTablon.Seleccion, ventanaOfertasS: 2 * H, importe: 5n * UNO }),
    encargo(10, { modo: ModoTablon.Seleccion, ventanaOfertasS: 30, publicadoEn: ahora - 60 }),
    encargo(11, { estado: EstadoTablon.Asignado }),
  ];
  const c = candidatos(lista, base, ahora);
  check(
    'quedan el 7 y el 1 para coger, y el 9 para ofertar, en ese orden',
    c.map((x) => `${x.accion} ${x.job.id}`).join(', ') === 'coger 7, coger 1, ofertar 9',
    c.map((x) => `${x.accion} ${x.job.id}`).join(', '),
  );
  check('  fuera: el propio, otra categoría, otra moneda, barato, poco plazo, caducado, ofertas cerradas, asignado', true);
  check('en selección oferta SU precio, no el presupuesto', c.find((x) => x.job.id === 9n)?.cobra === UNO);
  check(
    'con TABLON_PALABRAS, el anuncio tiene que mencionar alguna',
    candidatos(lista, { ...base, opciones: { ...opciones, palabras: ['rust'] } }, ahora).length === 0,
  );
}

/** Un SDK de mentira que apunta lo que se le pide. */
function montar(
  o: {
    lista?: Anuncio[];
    ocupado?: boolean;
    canTake?: boolean;
    tomaFalla?: boolean;
    briefFalla?: boolean;
    entregado?: boolean;
    misOfertas?: bigint[];
    minimoUsd?: number | null;
    sinPrecio?: boolean;
    propios?: bigint[];
    trabajos?: Record<string, { estado: EstadoTablon; escrowTaskId: bigint }>;
    tareas?: Record<string, TaskStatus>;
    cerrarFalla?: string;
  } = {},
) {
  const pasos: string[] = [];
  const marcas: boolean[] = [];
  const propios = new Set((o.propios ?? []).map(String));
  const panal = {
    listBoardJobAdverts: async () => o.lista ?? [encargo(7, { importe: 3n * UNO })],
    getBoardOffers: async (id: bigint) => ((o.misOfertas ?? []).includes(id) ? [{ agente: YO, nivel: 0, plazoEntregaS: H, orden: 1n, precio: UNO }] : []),
    canTakeBoardJob: async (_yo: Address, id: bigint) => {
      pasos.push(`canTake #${id}`);
      return o.canTake === false ? { ok: false, motivo: 'daily quota used' } : { ok: true, motivo: '' };
    },
    takeBoardJob: async (id: bigint) => {
      pasos.push(`coger #${id}`);
      if (o.tomaFalla) throw new Error('NotAllowed: daily quota used');
      return { txHash: '0x1', escrowTaskId: 500n + id };
    },
    offerOnBoardJob: async (id: bigint, precio: bigint, plazo: number) => {
      pasos.push(`ofertar #${id} ${precio / UNO} en ${plazo / H} h`);
      return '0x2';
    },
    readBoardJobBrief: async (id: bigint) => {
      pasos.push(`leer #${id}`);
      if (o.briefFalla) throw new Error('El buzón no tiene el encargo');
      return 'el encargo';
    },
    getBoardJob: async (id: bigint) => {
      const t = o.trabajos?.[id.toString()];
      return encargo(Number(id), { estado: t?.estado ?? EstadoTablon.Asignado, escrowTaskId: t?.escrowTaskId ?? 900n, agente: YO });
    },
    getTask: async (taskId: bigint) => ({ status: o.tareas?.[taskId.toString()] ?? TaskStatus.Open }),
    settleBoardJob: async (id: bigint) => {
      pasos.push(`cerrar #${id}`);
      if (o.cerrarFalla) throw new Error(o.cerrarFalla);
      return '0x3';
    },
    precios: async () =>
      o.sinPrecio
        ? { mon: { valor: 0.025, actualizado: 1, fuente: 'pyth' as const }, panalEnMon: null, panal: null }
        : { mon: { valor: 0.025, actualizado: Math.floor(Date.now() / 1000) - 20, fuente: 'pyth' as const }, panalEnMon: null, panal: null },
    valorDeVentaPanal: async (cantidad: bigint) => (cantidad * 237n) / 1_000_000n,
  };
  const correr = (ahoraS = ahora) =>
    repasarTablon({
      ...base,
      opciones: { ...opciones, minimoUsd: o.minimoUsd ?? null },
      panal: panal as never,
      ocupado: () => o.ocupado ?? false,
      marcar: (b) => marcas.push(b),
      trabajar: async (job, brief) => {
        pasos.push(`trabajar #${job.id} tarea ${job.escrowTaskId} «${brief}»`);
        return o.entregado ?? true;
      },
      propios: {
        anotar: (id) => propios.add(id.toString()),
        quitar: (id) => propios.delete(id.toString()),
        lista: () => [...propios].map((x) => BigInt(x)),
      },
      esperar: async (ms) => {
        pasos.push(`esperar ${ms}`);
      },
      log: () => {},
      ahora: () => ahoraS,
    });
  return { pasos, marcas, propios, correr };
}

console.log('\ncoger en inmediato: preguntar, coger, esperar, leer, trabajar');
{
  const { pasos, marcas, propios, correr } = montar();
  const hecho = await correr();
  check(
    'en ese orden',
    pasos.join(' → ') === 'canTake #7 → coger #7 → esperar 15000 → leer #7 → trabajar #7 tarea 507 «el encargo»',
    pasos.join(' → '),
  );
  check('la wallet ocupada durante y libre al acabar', marcas.join() === 'true,false', marcas.join());
  check('lo apunta para cerrar sus cuentas después', propios.has('7'));
  check('y lo cuenta', hecho.some((l) => l.includes('#7 cogido')) && hecho.some((l) => l.includes('#7 entregado')), hecho.join(' | '));
}
{
  const { correr } = montar({ lista: [encargo(12, { importe: 3n * UNO })], entregado: false });
  const hecho = await correr();
  check('si no se entrega, lo dice y lo deja al vigilante', hecho.some((l) => l.includes('lo retoma el vigilante')), hecho.join(' | '));
}

console.log('\nofertar en selección');
{
  const sel = encargo(20, { modo: ModoTablon.Seleccion, ventanaOfertasS: 2 * H, importe: 4n * UNO, plazoEntregaS: 48 * H });
  const { pasos, marcas, propios, correr } = montar({ lista: [sel] });
  const hecho = await correr();
  check('pregunta y oferta su precio con el plazo del encargo', pasos.join(' → ') === 'canTake #20 → ofertar #20 1 en 48 h', pasos.join(' → '));
  check('  no trabaja nada todavía: eso llega cuando se lo asignen', !pasos.some((p) => p.startsWith('trabajar')) && !propios.has('20'));
  check('  la wallet, libre al acabar', marcas.join() === 'true,false', marcas.join());
  check('  y lo cuenta', hecho.some((l) => l.includes('#20 ofertado')), hecho.join(' | '));
}
{
  const sel = encargo(21, { modo: ModoTablon.Seleccion, ventanaOfertasS: 2 * H });
  const { pasos, correr } = montar({ lista: [sel], misOfertas: [21n] });
  await correr();
  check('si ya ofertó, no vuelve a ofertar', pasos.length === 0, pasos.join(' → '));
}

console.log('\nlo que no debe hacer');
{
  const { pasos, marcas, correr } = montar({ ocupado: true });
  await correr();
  check('con un encargo en marcha no mira ni coge', pasos.length === 0 && marcas.length === 0);
}
{
  const { pasos, marcas, correr } = montar({ lista: [encargo(30, { importe: 3n * UNO })], canTake: false });
  await correr();
  check('si canTake dice que no, no firma nada', pasos.join() === 'canTake #30' && marcas.length === 0, pasos.join(' → '));
}
{
  const { pasos, marcas, correr } = montar({ lista: [encargo(31, { importe: 3n * UNO })], tomaFalla: true });
  let lanzo = false;
  let hecho: string[] = [];
  try {
    hecho = await correr();
  } catch {
    lanzo = true;
  }
  check('si coger falla, no lanza ni sigue', !lanzo && pasos.join(' → ') === 'canTake #31 → coger #31' && hecho.some((l) => l.includes('no se pudo')), pasos.join(' → '));
  check('  y la wallet vuelve a quedar libre', marcas.join() === 'true,false', marcas.join());
  const otra = montar({ lista: [encargo(31, { importe: 3n * UNO })] });
  await otra.correr();
  check('  y no lo reintenta en la ronda siguiente', otra.pasos.length === 0, otra.pasos.join(' → '));
}
{
  const { pasos, marcas, correr } = montar({ lista: [encargo(32, { importe: 3n * UNO })], briefFalla: true });
  const hecho = await correr();
  check('cogido sin encargo que leer: no trabaja a ciegas', !pasos.some((p) => p.startsWith('trabajar')) && hecho.some((l) => l.includes('sin encargo')), pasos.join());
  check('  y la wallet vuelve a quedar libre', marcas.join() === 'true,false', marcas.join());
}

console.log('\ncerrar cuentas de lo suyo');
{
  // El 40 terminó en el escrow; el 41 se cerró por otro lado; el 42 sigue abierto.
  const { pasos, marcas, propios, correr } = montar({
    propios: [40n, 41n, 42n],
    lista: [],
    trabajos: {
      '40': { estado: EstadoTablon.Asignado, escrowTaskId: 140n },
      '41': { estado: EstadoTablon.Cerrado, escrowTaskId: 141n },
      '42': { estado: EstadoTablon.Asignado, escrowTaskId: 142n },
    },
    tareas: { '140': TaskStatus.Completed, '142': TaskStatus.Open },
  });
  const hecho = await correr();
  check('cierra el que el escrow ya terminó', pasos.join() === 'cerrar #40', pasos.join(' → '));
  check('  y lo quita de la lista, como el que ya estaba cerrado', !propios.has('40') && !propios.has('41') && propios.has('42'), [...propios].join());
  check('  con la wallet ocupada y libre al acabar', marcas.join() === 'true,false', marcas.join());
  check('  y lo cuenta', hecho.some((l) => l.includes('#40 cuentas cerradas')), hecho.join(' | '));
}
{
  // Entregado hace menos de 72 h: la estimación dice NotFinished y no se firma.
  const o = {
    propios: [43n],
    lista: [],
    trabajos: { '43': { estado: EstadoTablon.Asignado, escrowTaskId: 143n } },
    tareas: { '143': TaskStatus.Delivered },
    cerrarFalla: 'El cierre: NotFinished',
  };
  const primera = montar(o);
  const hecho = await primera.correr();
  check('antes de tiempo: lo intenta, calla, y lo deja en la lista', primera.pasos.join() === 'cerrar #43' && hecho.length === 0 && primera.propios.has('43'), hecho.join(' | '));
  const enseguida = montar(o);
  await enseguida.correr(ahora + 60);
  check('  y no lo vuelve a intentar hasta dentro de una hora', enseguida.pasos.length === 0, enseguida.pasos.join());
  const luego = montar(o);
  await luego.correr(ahora + 3601);
  check('  pasada la hora, sí', luego.pasos.join() === 'cerrar #43', luego.pasos.join());
}

console.log('\nel mínimo en dólares');
{
  const panal = { precios: async () => ({ mon: { valor: 0.025, actualizado: Math.floor(Date.now() / 1000) - 20, fuente: 'pyth' as const } }), valorDeVentaPanal: async (c: bigint) => (c * 237n) / 1_000_000n };
  const enMon = await dolaresNetos(panal as never, { amount: 40n * UNO, currency: MON });
  check('40 MON dejan 39 netos: $0,975', enMon !== null && Math.abs(enMon - 0.975) < 1e-9, String(enMon));
  const enPanal = await dolaresNetos(panal as never, { amount: 100_000n * UNO, currency: PANAL });
  check('100.000 $PANAL, netos y al precio de venta: $0,58', enPanal !== null && Math.abs(enPanal - 0.5776875) < 1e-6, String(enPanal));
}
{
  const { pasos, correr } = montar({ lista: [encargo(50, { importe: 3n * UNO })], minimoUsd: 1 });
  const hecho = await correr();
  check('por debajo del mínimo no se coge', !pasos.some((p) => p.startsWith('coger')) && hecho.some((l) => l.includes('el mínimo es $1.00')), hecho.join(' | '));
}
{
  const { pasos, correr } = montar({ lista: [encargo(51, { importe: 3n * UNO })], minimoUsd: 0.05 });
  await correr();
  check('por encima del mínimo, sí', pasos.includes('coger #51'), pasos.join(' → '));
}
{
  const { pasos, correr } = montar({ lista: [encargo(52, { importe: 3n * UNO })], minimoUsd: 0.05, sinPrecio: true });
  const hecho = await correr();
  check('con un precio viejo no se coge nada', !pasos.some((p) => p.startsWith('coger')) && hecho.some((l) => l.includes('sin precio fresco')), hecho.join(' | '));
}

console.log('\nel vigilante retoma lo del tablón');
{
  // Cinco encargos; el 3 es el de la tarea 703, asignado a este agente.
  const trabajos = [0, 1, 2, 3, 4].map((i) =>
    encargo(i, { escrowTaskId: 700n + BigInt(i), agente: i === 3 ? YO : OTRO, estado: EstadoTablon.Asignado }),
  );
  const panalBusca = { getBoardJobCount: async () => 5n, getBoardJob: async (id: bigint) => trabajos[Number(id)]! };
  check('encuentra el encargo de una tarea', (await buscarEncargoDeTarea(panalBusca as never, 703n, YO))?.id === 3n);
  check('y no el de otro agente con la misma tarea', (await buscarEncargoDeTarea(panalBusca as never, 702n, YO)) === null);

  const hecho: string[] = [];
  const anotados: bigint[] = [];
  const deps = (o: { resultado?: string | null; brief?: string | null }) => ({
    panal: {
      ...panalBusca,
      deliverBoardJob: async (id: bigint, texto: string) => {
        hecho.push(`entregar #${id} «${texto}»`);
        return { txHash: '0x9' as Hex, resultHash: '0x9' as Hex };
      },
      readBoardJobBrief: async (id: bigint) => {
        hecho.push(`leer #${id}`);
        return 'encargo 3';
      },
    } as never,
    yo: YO,
    propios: { anotar: (id: bigint) => anotados.push(id) },
    briefGuardado: () => o.brief ?? null,
    resultadoGuardado: () => o.resultado ?? null,
    trabajar: async (job: EncargoConReglas, brief: string) => {
      hecho.push(`trabajar #${job.id} «${brief}»`);
      return true;
    },
  });
  const r1 = await retomarDelTablon(deps({ resultado: 'ya hecho' }), 703n);
  check('con el resultado hecho, lo reentrega por el buzón del tablón', r1 && hecho.join() === 'entregar #3 «ya hecho»', hecho.join(' → '));
  check('  y lo apunta para cerrar sus cuentas', anotados.includes(3n));
  hecho.length = 0;
  await retomarDelTablon(deps({ brief: 'encargo 3' }), 703n);
  check('con el encargo en disco y bien, trabaja sin volver a leerlo', hecho.join() === 'trabajar #3 «encargo 3»', hecho.join(' → '));
  hecho.length = 0;
  await retomarDelTablon(deps({ brief: 'otro texto' }), 703n);
  check('si el de disco no cuadra con la cadena, lo vuelve a leer', hecho.join(' → ') === 'leer #3 → trabajar #3 «encargo 3»', hecho.join(' → '));
}

console.log('\nlos encargos propios, en disco');
{
  const dir = mkdtempSync(join(tmpdir(), 'panal-tablon-'));
  const a = new EncargosPropios(dir);
  a.anotar(7n);
  a.anotar(9n);
  a.anotar(7n);
  a.quitar(9n);
  check('sobreviven a un reinicio', new EncargosPropios(dir).lista().map(String).join() === '7');
}

console.log('\napagado salvo TABLON=on, y las categorías');
{
  const avisos: string[] = [];
  const avisar = (m: string) => avisos.push(m);
  check('sin nada, apagado', opcionesDelEntorno({}, avisar) === null);
  check('TABLON=off, apagado', opcionesDelEntorno({ TABLON: 'off' }, avisar) === null);
  const on = opcionesDelEntorno({ TABLON: 'on' }, avisar)!;
  check('TABLON=on, con los de por defecto y sin categorías', on.minutos === 5 && on.margenMinutos === 60 && on.categorias.length === 0);
  check('categorías por nombre, con o sin tildes', categoriasDelEntorno('código, traducción, texto').join() === '2,10,1');
  check('y por número', categoriasDelEntorno('2,10').join() === '2,10');
  const antes = avisos.length;
  check('una que no existe se avisa y se salta', categoriasDelEntorno('codigo, pasteleria', avisar).join() === '2' && avisos.length === antes + 1);
  check('más de tres: las tres primeras, y lo avisa', categoriasDelEntorno('datos,texto,codigo,vision', avisar).join() === '0,1,2' && avisos.length === antes + 2);
  check('repetidas, una vez', categoriasDelEntorno('codigo,2,código').join() === '2');
  check(
    'TABLON_CATEGORIAS llega a las opciones',
    opcionesDelEntorno({ TABLON: 'on', TABLON_CATEGORIAS: 'codigo,texto' }, avisar)!.categorias.join() === '2,1',
  );
  check('TABLON_MINIMO_USD=1,5 se entiende', opcionesDelEntorno({ TABLON: 'on', TABLON_MINIMO_USD: '1,5' }, avisar)!.minimoUsd === 1.5);
}

console.log(fallos === 0 ? '\n✅ tablón: todo bien' : `\n❌ tablón: ${fallos} fallo(s)`);
process.exit(fallos === 0 ? 0 : 1);
