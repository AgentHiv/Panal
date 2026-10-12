/**
 * El tablón automático de la plantilla.
 *
 *   npx tsx test/tablon.test.ts
 *
 * HERMÉTICO: el tablón, la cadena y el trabajo son dobles.
 *
 * Lo que se protege:
 *   1. Que solo coja lo que encaja: moneda, precio, plazo, habilidades, y nunca
 *      lo que publicó él mismo.
 *   2. Que el encaje sea por palabra entera, sin tildes ni guiones de por medio.
 *   3. El orden: coger, esperar, leer, trabajar — y la wallet marcada ocupada
 *      todo ese rato, y libre al acabar, pase lo que pase.
 *   4. Que no toque nada con un encargo en marcha, y que nada lance.
 *   5. Que esté apagado salvo TABLON=on.
 *   6. El mínimo en dólares: neto de comisión, $PANAL al precio de venta, y
 *      sin precio reciente no se coge nada.
 */

import type { Address } from 'viem';
import { candidatos, dolaresNetos, encaja, opcionesDelEntorno, repasarTablon, TABLON_POR_DEFECTO } from '../template/src/tablon.js';

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

const YO = '0x1558cF6aed695F3F8AafE488058EfE28d216E69C' as Address;
const OTRO = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as Address;
const MON = '0x0000000000000000000000000000000000000000' as Address;
const PANAL = '0x2e2e44e7fa6178822d4397299f719e89d1a67777' as Address;
const UNO = 10n ** 18n;
const ahora = Math.floor(Date.now() / 1000);

const anuncio = (id: number, texto: string, extra: Partial<{ amount: bigint; currency: Address; cliente: Address; horas: number }> = {}) => ({
  taskId: BigInt(id),
  anuncio: texto,
  cliente: extra.cliente ?? OTRO,
  amount: extra.amount ?? UNO,
  currency: extra.currency ?? MON,
  deadline: BigInt(ahora + (extra.horas ?? 24) * 3600),
  taskHash: '0x00' as `0x${string}`,
  publicada: Date.now(),
});

const base = { yo: YO, precio: { amount: UNO, currency: MON }, habilidades: ['code-review', 'solidity', 'tests'], opciones: TABLON_POR_DEFECTO };

console.log('\nel encaje, por palabra entera');
check('«solidity» encaja en «Review my Solidity contract»', encaja('Review my Solidity contract', ['solidity']));
check('con guion o sin él: «code-review» ↔ «code review»', encaja('Necesito un code review rápido', ['code-review']));
check('sin tildes: «traducción» ↔ «traduccion»', encaja('traduccion de cadenas', ['traducción']));
check('«test» no encaja en «testimonio»', !encaja('Escribe un testimonio', ['test']));
check('menos de tres letras no cuenta', !encaja('ai for everything', ['ai']));

console.log('\nsolo coge lo que encaja');
{
  const lista = [
    anuncio(1, 'Review this Solidity contract'),
    anuncio(2, 'Review this Solidity contract', { cliente: YO }),
    anuncio(3, 'Review this Solidity contract', { currency: PANAL }),
    anuncio(4, 'Review this Solidity contract', { amount: UNO / 2n }),
    anuncio(5, 'Review this Solidity contract', { horas: 0.25 }),
    anuncio(6, 'Paint me a cat'),
    anuncio(7, 'Write tests for my API', { amount: 3n * UNO }),
  ];
  const c = candidatos(lista, base, ahora);
  check('quedan el 7 y el 1, del que más paga al que menos', c.map((e) => e.taskId).join() === '7,1', c.map((e) => e.taskId).join());
  check('  fuera: el propio, otra moneda, barato, sin plazo y sin encaje', !c.some((e) => [2n, 3n, 4n, 5n, 6n].includes(e.taskId)));
}
{
  const c = candidatos([anuncio(1, 'Paint me a cat')], { ...base, opciones: { ...TABLON_POR_DEFECTO, palabras: ['cat'] } }, ahora);
  check('TABLON_PALABRAS amplía el encaje', c.length === 1);
}

/** MON a $0,025 hace 20 s; vender $PANAL da 0,000237 MON cada uno. */
const preciosFrescos = () => ({
  mon: { valor: 0.025, actualizado: Math.floor(Date.now() / 1000) - 20, fuente: 'pyth' as const },
  panalEnMon: null,
  panal: null,
});

function montar(
  o: {
    lista?: ReturnType<typeof anuncio>[];
    ocupado?: boolean;
    claimFalla?: boolean;
    briefFalla?: boolean;
    resultado?: string;
    minimoUsd?: number | null;
    sinPrecio?: boolean;
  } = {},
) {
  const pasos: string[] = [];
  const marcas: boolean[] = [];
  const panal = {
    listBoard: async () => o.lista ?? [anuncio(7, 'Write tests for my API', { amount: 3n * UNO })],
    claimTask: async (id: bigint) => {
      pasos.push(`claim #${id}`);
      if (o.claimFalla) throw new Error('La tarea #7 ya la cogió 0xabc.');
      return { txHash: '0x1' };
    },
    readBoardBrief: async (id: bigint) => {
      pasos.push(`leer #${id}`);
      if (o.briefFalla) throw new Error('El buzón no tiene el encargo');
      return 'el encargo';
    },
    precios: async () =>
      o.sinPrecio
        ? { mon: { valor: 0.025, actualizado: 1, fuente: 'pyth' as const }, panalEnMon: null, panal: null }
        : preciosFrescos(),
    valorDeVentaPanal: async (cantidad: bigint) => (cantidad * 237n) / 1_000_000n,
  };
  const correr = () =>
    repasarTablon({
      ...base,
      opciones: { ...TABLON_POR_DEFECTO, minimoUsd: o.minimoUsd ?? null },
      panal: panal as never,
      ocupado: () => o.ocupado ?? false,
      marcar: (b) => marcas.push(b),
      trabajar: async (id, brief) => {
        pasos.push(`trabajar #${id} «${brief}»`);
        return o.resultado ?? 'entregada';
      },
      esperar: async (ms) => {
        pasos.push(`esperar ${ms}`);
      },
      log: () => {},
    });
  return { pasos, marcas, correr };
}

console.log('\nel orden: coger, esperar, leer, trabajar');
{
  const { pasos, marcas, correr } = montar();
  const hecho = await correr();
  check('en ese orden', pasos.join(' → ') === 'claim #7 → esperar 15000 → leer #7 → trabajar #7 «el encargo»', pasos.join(' → '));
  check('la wallet ocupada durante y libre al acabar', marcas.join() === 'true,false', marcas.join());
  check('y lo cuenta', hecho.some((l) => l.includes('#7 cogido')) && hecho.some((l) => l.includes('#7 entregado')), hecho.join(' | '));
}
{
  const { pasos, correr } = montar({ resultado: 'fallo' });
  const hecho = await correr();
  check('si no se entrega, lo dice y lo deja al vigilante', hecho.some((l) => l.includes('lo retoma el vigilante')) && pasos.length === 4, hecho.join(' | '));
}

console.log('\nlo que no debe hacer');
{
  const { pasos, marcas, correr } = montar({ ocupado: true });
  await correr();
  check('con un encargo en marcha no mira ni coge', pasos.length === 0 && marcas.length === 0);
}
{
  const { pasos, correr } = montar({ lista: [anuncio(6, 'Paint me a cat')] });
  await correr();
  check('si nada encaja, no coge nada', pasos.length === 0);
}
{
  const { pasos, marcas, correr } = montar({ claimFalla: true });
  let lanzo = false;
  let hecho: string[] = [];
  try {
    hecho = await correr();
  } catch {
    lanzo = true;
  }
  check('si otro lo cogió antes, no lanza ni sigue', !lanzo && pasos.join() === 'claim #7' && hecho.some((l) => l.includes('no se pudo coger')), pasos.join());
  check('  y la wallet vuelve a quedar libre', marcas.join() === 'true,false', marcas.join());
}
{
  const { pasos, marcas, correr } = montar({ briefFalla: true });
  const hecho = await correr();
  check('cogido sin encargo que leer: no trabaja a ciegas', !pasos.some((p) => p.startsWith('trabajar')) && hecho.some((l) => l.includes('sin encargo')), pasos.join());
  check('  y la wallet vuelve a quedar libre', marcas.join() === 'true,false', marcas.join());
}

console.log('\nel mínimo en dólares');
{
  const panal = { precios: async () => preciosFrescos(), valorDeVentaPanal: async (c: bigint) => (c * 237n) / 1_000_000n };
  const enMon = await dolaresNetos(panal as never, { amount: 40n * UNO, currency: MON });
  check('40 MON dejan 39 netos: $0,975', enMon !== null && Math.abs(enMon - 0.975) < 1e-9, String(enMon));
  const enPanal = await dolaresNetos(panal as never, { amount: 100_000n * UNO, currency: PANAL });
  // 97.500 $PANAL netos × 0,000237 MON al venderlos × $0,025
  check('100.000 $PANAL, netos y al precio de venta: $0,58', enPanal !== null && Math.abs(enPanal - 0.5776875) < 1e-6, String(enPanal));
}
{
  // 3 MON netos son 2,925 MON: $0,073. Con un mínimo de $1 no llega.
  const { pasos, correr } = montar({ minimoUsd: 1 });
  const hecho = await correr();
  check('por debajo del mínimo no se coge', pasos.length === 0 && hecho.some((l) => l.includes('el mínimo es $1.00')), hecho.join(' | '));
}
{
  const { pasos, correr } = montar({ minimoUsd: 0.05 });
  await correr();
  check('por encima del mínimo, sí', pasos[0] === 'claim #7', pasos.join(' → '));
}
{
  const { pasos, correr } = montar({ minimoUsd: 0.05, sinPrecio: true });
  const hecho = await correr();
  check('con un precio viejo no se coge nada', pasos.length === 0 && hecho.some((l) => l.includes('sin precio fresco')), hecho.join(' | '));
}
{
  const { pasos, correr } = montar({ sinPrecio: true });
  await correr();
  check('sin mínimo, el precio da igual', pasos[0] === 'claim #7', pasos.join(' → '));
}

console.log('\napagado salvo TABLON=on');
{
  const avisos: string[] = [];
  const avisar = (m: string) => avisos.push(m);
  check('sin nada, apagado', opcionesDelEntorno({}, avisar) === null);
  check('TABLON=off, apagado', opcionesDelEntorno({ TABLON: 'off' }, avisar) === null);
  const on = opcionesDelEntorno({ TABLON: 'on' }, avisar)!;
  check('TABLON=on, con los de por defecto', on.minutos === 5 && on.margenMinutos === 30 && on.palabras.length === 0);
  const propias = opcionesDelEntorno({ TABLON: 'on', TABLON_MINUTOS: '2', TABLON_MARGEN_MINUTOS: '60', TABLON_PALABRAS: 'cat, dog ,' }, avisar)!;
  check('se pueden cambiar', propias.minutos === 2 && propias.margenMinutos === 60 && propias.palabras.join() === 'cat,dog');
  const malas = opcionesDelEntorno({ TABLON: 'on', TABLON_MINUTOS: '0', TABLON_MARGEN_MINUTOS: 'ya' }, avisar)!;
  check('una errata vuelve al defecto y lo avisa', malas.minutos === 5 && malas.margenMinutos === 30 && avisos.length === 2, avisos.join(' | '));
  check('sin TABLON_MINIMO_USD, sin mínimo', on.minimoUsd === null);
  check('TABLON_MINIMO_USD=1,5 se entiende', opcionesDelEntorno({ TABLON: 'on', TABLON_MINIMO_USD: '1,5' }, avisar)!.minimoUsd === 1.5);
  const antes = avisos.length;
  check(
    'TABLON_MINIMO_USD que no es un número: sin mínimo, y lo avisa',
    opcionesDelEntorno({ TABLON: 'on', TABLON_MINIMO_USD: 'mucho' }, avisar)!.minimoUsd === null && avisos.length === antes + 1,
  );
}

console.log(fallos === 0 ? '\n✅ tablón: todo bien' : `\n❌ tablón: ${fallos} fallo(s)`);
process.exit(fallos === 0 ? 0 : 1);
