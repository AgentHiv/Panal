/**
 * Las cuentas del informe, sin red.
 *
 * Los números son los REALES de Audit en mainnet, agosto de 2026, sacados del
 * indexador. Existe por una razón concreta: el diseño iba a calcular el neto
 * como `bruto × 0,975 − devuelto`, y eso da 84.798,75 cuando lo que el escrow
 * tiene guardado para Audit son 85.361,25. Este archivo fija la diferencia.
 */
import { armar, enPeriodo, periodosDe } from '../src/lib/cuentas.ts';

let bien = 0, mal = 0;
const dice = (q, c) => { if (c) { bien++; console.log('  ✅', q); } else { mal++; console.log('  ❌', q); } };
const w = (n) => BigInt(Math.round(n * 1000)) * 10n ** 15n;

const AUDIT = '0x6cb87f2d0ea0b5d17f6e9a7e8735a93ef17b7367';
const OTRO = '0x7fb3fc7e8b8c0b1748fbb94e1cd5a9b5620296f6';
const CLI = '0x86622fcff353850c3b9aeca07160b0088927a77b';

const AGO = (dia) => Math.floor(new Date(Date.UTC(2026, 7, dia)).getTime() / 1000);
const JUL = (dia) => Math.floor(new Date(Date.UTC(2026, 6, dia)).getTime() / 1000);

const tarea = (id, cantidad, extra = {}) => ({
  taskId: id, client: CLI, worker: AUDIT, amount: w(cantidad).toString(),
  coin: '$PANAL', status: 'completed', createdTs: AGO(20), updatedTs: AGO(21),
  resultHash: `0xhash${id}`, rating: 5, ...extra,
});

const completado = (id, pagado, comision, ts = AGO(21)) => ({
  id: `0xtx${id}-1`, contract: 'escrow', event: 'TaskCompleted', blockNumber: 1, logIndex: 1,
  txHash: `0xtx${id}`, ts,
  args: { taskId: id, worker: AUDIT, workerPaid: w(pagado).toString(), fee: w(comision).toString(), rating: 5 },
});

const disputa = (id, pagado, devuelto, ts = AGO(21)) => ({
  id: `0xtx${id}-1`, contract: 'escrow', event: 'DisputeResolved', blockNumber: 1, logIndex: 1,
  txHash: `0xtx${id}`, ts,
  args: { taskId: id, workerPaid: w(pagado).toString(), clientRefunded: w(devuelto).toString() },
});

console.log('\nagosto de Audit, tal cual está en la cadena');
const tareas = [
  tarea('50', 50), tarea('51', 25000), tarea('52', 25000, { rating: 2 }),
  tarea('53', 15000), tarea('54', 15000), tarea('55', 15000), tarea('58', 15000),
];
const eventos = [
  completado('50', 48.75, 1.25), completado('51', 24375, 625),
  disputa('52', 2437.5, 22500),
  completado('53', 14625, 375), completado('54', 14625, 375),
  completado('55', 14625, 375), completado('58', 14625, 375),
];

let c = armar(tareas, eventos, AUDIT);
dice('una sola moneda', c.length === 1 && c[0].moneda === '$PANAL');
dice('siete líneas', c[0].lineas.length === 7);
dice('bruto = 110.050', c[0].bruto === w(110050));
dice('devuelto = 22.500', c[0].devuelto === w(22500));
dice('comisión = 2.188,75 (NO el 2,5 % de 110.050)', c[0].comision === w(2188.75));
dice('neto = 85.361,25, lo que el escrow le guarda', c[0].neto === w(85361.25));
dice('el atajo bruto×0,975−devuelto daría otra cosa', w(85361.25) !== w(110050 * 0.975 - 22500));
dice('bruto − comisión − devuelto cuadra con el neto',
  c[0].bruto - c[0].comision - c[0].devuelto === c[0].neto);

console.log('\nla comisión de una disputa sale de la parte del trabajador');
const d = c[0].lineas.find((l) => l.id === '52');
dice('la línea sabe que fue disputada', d.disputada === true);
dice('devolvió 22.500', d.devuelto === w(22500));
dice('cobró 2.437,50', d.pagado === w(2437.5));
dice('y la comisión fue 62,50, el 2,5 % de 2.500', d.comision === w(62.5));
dice('que no es el 2,5 % del bruto', d.comision !== w(625));

console.log('\nlo que NO entra');
c = armar([...tareas, { ...tarea('60', 100), worker: OTRO }], [...eventos, completado('60', 97.5, 2.5)], AUDIT);
dice('un encargo de otro agente no cuenta', c[0].lineas.length === 7);
c = armar(tareas, [...eventos, completado('99', 1000, 25)], AUDIT);
dice('un evento de una tarea que no está, tampoco', c[0].lineas.length === 7);
c = armar([...tareas, tarea('61', 900, { status: 'open' })], eventos, AUDIT);
dice('un encargo abierto no entra en caja', c[0].lineas.length === 7);
dice('ni suma al bruto', c[0].bruto === w(110050));

console.log('\ndos monedas no se suman');
c = armar(
  [...tareas, { ...tarea('62', 12), coin: 'MON' }],
  [...eventos, completado('62', 11.7, 0.3)],
  AUDIT,
);
dice('salen dos bloques', c.length === 2);
dice('el de más movimiento primero', c[0].moneda === '$PANAL');
dice('el de MON va aparte y con su neto', c[1].moneda === 'MON' && c[1].neto === w(11.7));
dice('y el de $PANAL no se ha enterado', c[0].neto === w(85361.25));

console.log('\nperiodos');
const conJulio = armar(
  [...tareas, tarea('40', 1000, { createdTs: JUL(3) })],
  [...eventos, completado('40', 975, 25, JUL(4))],
  AUDIT,
);
const ps = periodosDe(conJulio);
dice('dos meses', ps.length === 2);
dice('el más reciente primero', ps[0].clave > ps[1].clave);
dice('trae el año y el mes en crudo', ps[0].anio === 2026 && ps[0].mes >= 1 && ps[0].mes <= 12);
const soloAgosto = enPeriodo(conJulio, ps.find((p) => p.clave === '2026-08'));
dice('agosto trae siete', soloAgosto[0].lineas.length === 7);
dice('y su neto es el de agosto', soloAgosto[0].neto === w(85361.25));
const soloJulio = enPeriodo(conJulio, ps.find((p) => p.clave === '2026-07'));
dice('julio trae una', soloJulio[0].lineas.length === 1);
dice('con su propio neto', soloJulio[0].neto === w(975));
dice('sin periodo, todo junto', enPeriodo(conJulio, null)[0].lineas.length === 8);

console.log('\nrarezas');
c = armar(tareas, [disputa('51', 0, 25000)], AUDIT);
dice('una disputa que devuelve todo deja neto cero', c[0].neto === 0n);
dice('y comisión cero, no negativa', c[0].comision === 0n);
dice('pero la línea existe', c[0].lineas.length === 1);
dice('sin eventos no hay cuentas', armar(tareas, [], AUDIT).length === 0);
dice('sin tareas tampoco', armar([], eventos, AUDIT).length === 0);
dice('sin nada, ni periodos', periodosDe([]).length === 0);

console.log('\ncada línea lleva con qué comprobarse');
c = armar(tareas, eventos, AUDIT);
dice('todas con txHash', c[0].lineas.every((l) => l.txHash));
dice('todas con hash de entrega', c[0].lineas.every((l) => l.resultHash));
dice('todas con cliente', c[0].lineas.every((l) => l.cliente === CLI));
dice('ordenadas de más nueva a más vieja', c[0].lineas.every((l, i, a) => i === 0 || a[i - 1].ts >= l.ts));

console.log(`\n${bien} bien, ${mal} mal\n`);
process.exit(mal ? 1 : 0);
