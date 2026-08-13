/**
 * Pruebas del índice de nombres de PanalNames (`src/indexer-store.ts`).
 *
 *   npx tsx scripts/test-indexer-nombres.ts
 *
 * HERMÉTICO: sin red, sin cadena. Los eventos se escriben a mano aquí, que es
 * la única forma de probarlo hoy — el contrato no está desplegado todavía.
 *
 * Lo que importa no es tanto QUIÉN tiene cada nombre como CÓMO lo consiguió.
 * En una venta lo único que viaja es el nombre: la reputación, el historial y
 * la verificación del dominio se quedan en la dirección del vendedor. Quien
 * busca a `lint` por su nombre merece saber que el `lint` de hoy no es el que
 * hizo esas 200 tareas, y para eso el índice tiene que distinguir un nombre
 * reclamado de cero de uno comprado la semana pasada.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IndexStore, type IndexedEvent } from '../src/indexer-store.js';

let failures = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) console.log(`✅ ${label}${detail ? `: ${detail}` : ''}`);
  else {
    failures += 1;
    console.error(`❌ ${label}${detail ? `: ${detail}` : ''}`);
  }
}

const PANAL = '0x2e2e44e7fa6178822d4397299f719e89d1a67777';
const ANA = '0xAaaa000000000000000000000000000000000001';
const BEA = '0xBbbb000000000000000000000000000000000002';
const CARLOS = '0xCccc000000000000000000000000000000000003';

const T0 = 1_780_000_000;

let n = 0;
function ev(event: string, args: Record<string, string | number>, ts = T0): IndexedEvent {
  n += 1;
  return {
    id: `0x${n.toString(16).padStart(64, '0')}-0`,
    contract: 'names',
    event,
    blockNumber: n,
    logIndex: 0,
    txHash: `0x${n.toString(16).padStart(64, '0')}`,
    ts,
    args,
  };
}

const dir = mkdtempSync(join(tmpdir(), 'panal-nombres-'));
const store = new IndexStore(dir, PANAL);

console.log('── Reclamar ──');

store.append([ev('Reclamado', { hash: '0x01', nombre: 'traductor', dueno: ANA, pagado: '1000000000000000000' })]);

const deAna = store.nombre(ANA);
check('el nombre queda apuntado a quien lo reclamó', deAna?.nombre === 'traductor', deAna?.nombre);
check('y consta que lo reclamó, no que lo compró', deAna?.origen === 'reclamado', deAna?.origen);
check('la dirección vale en mayúsculas o minúsculas', store.nombre(ANA.toLowerCase())?.nombre === 'traductor');
check('quien no tiene nombre devuelve null', store.nombre(CARLOS) === null);

console.log('\n── Venta: lo que viaja y lo que se queda ──');

store.append([
  ev(
    'Vendido',
    { hash: '0x01', nombre: 'traductor', de: ANA, a: BEA, precio: '500000000000000000000', comision: '2500000000000000000' },
    T0 + 86_400,
  ),
]);

check('el comprador se queda con el nombre', store.nombre(BEA)?.nombre === 'traductor');
check('y consta que lo COMPRÓ', store.nombre(BEA)?.origen === 'comprado', store.nombre(BEA)?.origen);
check('con el precio que pagó', store.nombre(BEA)?.precio === '500000000000000000000');
check('la fecha es la de la venta, no la del reclamo', store.nombre(BEA)?.desdeTs === T0 + 86_400);

// Esto es lo que hace que el aviso de la web sea honesto: si al vendedor le
// quedara el nombre apuntando, dos agentes se llamarían igual en el catálogo.
check('el VENDEDOR se queda sin nombre', store.nombre(ANA) === null);

console.log('\n── Regalo ──');

store.append([ev('Transferido', { hash: '0x01', nombre: 'traductor', de: BEA, a: CARLOS }, T0 + 172_800)]);

check('pasa al que lo recibe', store.nombre(CARLOS)?.nombre === 'traductor');
check('y se distingue de una compra', store.nombre(CARLOS)?.origen === 'recibido', store.nombre(CARLOS)?.origen);
check('sin precio, porque no lo hubo', store.nombre(CARLOS)?.precio === undefined);
check('el anterior se queda sin nombre', store.nombre(BEA) === null);

console.log('\n── Liberar ──');

store.append([ev('Liberado', { hash: '0x01', nombre: 'traductor', dueno: CARLOS }, T0 + 200_000)]);
check('soltarlo lo borra del índice', store.nombre(CARLOS) === null);

console.log('\n── Sobrevive al reinicio ──');

// El índice se reconstruye rejugando events.jsonl. Los nombres SÍ salen del
// log —al revés que las fichas del registry—, así que rejugar tiene que
// devolver exactamente el mismo estado, incluido el «cómo lo consiguió».
store.append([
  ev('Reclamado', { hash: '0x02', nombre: 'revisor', dueno: ANA, pagado: '1000000000000000000' }, T0 + 300_000),
  ev(
    'Vendido',
    { hash: '0x02', nombre: 'revisor', de: ANA, a: BEA, precio: '10000000000000000000', comision: '50000000000000000' },
    T0 + 400_000,
  ),
]);

const store2 = new IndexStore(dir, PANAL);
check('tras releer el log, el nombre sigue siendo del comprador', store2.nombre(BEA)?.nombre === 'revisor');
check('y sigue constando como comprado', store2.nombre(BEA)?.origen === 'comprado');
check('y el vendedor sigue sin nombre', store2.nombre(ANA) === null);

console.log('\n── El catálogo lo lleva encima ──');

store2.upsertProfile({
  address: BEA,
  owner: BEA,
  name: 'Revisor',
  description: '',
  skills: ['review'],
  botUrl: 'https://ejemplo.test',
  pricePerTask: '1000000000000000000',
  currency: '0x0000000000000000000000000000000000000000',
  coin: 'MON',
  active: true,
  registeredAt: T0,
  fetchedTs: T0,
});

const { agents } = store2.catalogo({});
const ficha = agents.find((a) => a.address.toLowerCase() === BEA.toLowerCase());
check('la ficha del catálogo trae el nombre', ficha?.nombre?.nombre === 'revisor');
check('con su origen, que es lo que dispara el aviso', ficha?.nombre?.origen === 'comprado');

rmSync(dir, { recursive: true, force: true });

console.log('');
if (failures > 0) {
  console.error(`❌ ${failures} comprobacion(es) fallaron`);
  process.exit(1);
}
console.log('✅ El índice distingue un nombre reclamado de uno que cambió de manos');
