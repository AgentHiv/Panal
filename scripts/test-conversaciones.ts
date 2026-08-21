/**
 * Una conversación son las dos cosas: lo hablado y lo encargado.
 *
 *     npx tsx scripts/test-conversaciones.ts
 *
 * Este archivo nace de un fallo concreto y su primera comprobación es ese
 * fallo: se contrataba a un agente por el escrow —firma, pago bloqueado,
 * brief enviado— y la bandeja seguía diciendo "todavía no has hablado con
 * ningún agente". Encargar no escribía historial, y con los agentes que sólo
 * aceptan encargos no había forma de que apareciera nada.
 *
 * Hermético: sólo datos. Ni cadena, ni red, ni `localStorage`.
 */

import type { Mensaje } from '../src/lib/historial.js';
import {
  ESTADO,
  actividadDe,
  claveDeEntrada,
  encargosDelCliente,
  fusionarBandeja,
  fusionarHilo,
  type TareaCruda,
} from '../src/lib/conversaciones.js';

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

/** El mismo agente escrito como lo escribe cada mitad del sistema. */
const AUDIT_CHECKSUM = '0x6cb87f2D0ea0B5D17F6e9a7e8735A93ef17B7367';
const AUDIT_MINUSCULAS = AUDIT_CHECKSUM.toLowerCase();
const LINT = '0x1558cF6aed695F3F8AafE488058EfE28d216E69C';

const S = 1000;
const AYER = Date.now() - 24 * 3600 * S;

const msg = (texto: string, cuando: number, de: 'yo' | 'agente' = 'yo'): Mensaje => ({
  id: `${cuando}`,
  de,
  texto,
  cuando,
});

const tarea = (p: Partial<TareaCruda> & { id: bigint }): TareaCruda => ({
  worker: AUDIT_CHECKSUM,
  amountWei: 15_000n * 10n ** 18n,
  taskHash: `0xhash${p.id}`,
  currency: '0x2e2e44e7fa6178822d4397299f719e89d1a67777',
  createdAt: BigInt(Math.floor(AYER / 1000)),
  status: ESTADO.Abierto,
  role: 'client',
  ...p,
});

const simbolo = () => '$PANAL';
const sinBrief = () => null;

console.log('\n── El fallo que trajo este archivo ──\n');

const soloEncargo = encargosDelCliente([tarea({ id: 55n })], simbolo, () => 'Audita este contrato');
const bandeja = fusionarBandeja([], soloEncargo);
check(
  'un agente al que sólo le has ENCARGADO aparece en la bandeja',
  bandeja.length === 1 && bandeja[0]!.agente === AUDIT_MINUSCULAS,
  `${bandeja.length} filas`,
);
check(
  'y el adelanto es el encargo, con su texto',
  bandeja[0]?.adelanto.clase === 'encargo' && bandeja[0].adelanto.encargo.brief === 'Audita este contrato',
);

console.log('\n── Sin romper lo que ya iba ──\n');

const soloChat = fusionarBandeja(
  [{ agente: LINT, ultimo: msg('gracias', AYER + 60 * S, 'agente'), cuantos: 4 }],
  [],
);
check('un agente con quien sólo has HABLADO sigue apareciendo', soloChat.length === 1);
check('con su último mensaje', soloChat[0]?.adelanto.clase === 'mensaje');

console.log('\n── Un agente, UNA fila ──\n');

// El historial guarda la dirección en minúsculas; el escrow la devuelve en
// checksum. Sin normalizar, el mismo agente sale dos veces.
const mezclado = fusionarBandeja(
  [{ agente: AUDIT_MINUSCULAS, ultimo: msg('¿cuánto cobras?', AYER - 3600 * S), cuantos: 2 }],
  encargosDelCliente([tarea({ id: 55n })], simbolo, sinBrief),
);
check('hablar y encargar al mismo agente no lo duplica', mezclado.length === 1, `${mezclado.length} filas`);
check('y se cuentan las dos mitades', mezclado[0]?.mensajes === 2 && mezclado[0]?.encargos === 1);
check('el adelanto es lo más reciente de las dos', mezclado[0]?.adelanto.clase === 'encargo');

console.log('\n── Lo que sube una conversación ──\n');

const entregado = encargosDelCliente(
  [
    tarea({
      id: 55n,
      status: ESTADO.Entregado,
      deliveredAt: BigInt(Math.floor((AYER + 7200 * S) / 1000)),
    }),
  ],
  simbolo,
  sinBrief,
);
check(
  'un encargo entregado cuenta por su ENTREGA, no por su creación',
  actividadDe(entregado[0]!) > entregado[0]!.cuando,
);

const dos = fusionarBandeja(
  [{ agente: LINT, ultimo: msg('vale', AYER + 3600 * S), cuantos: 1 }],
  entregado,
);
check('y por eso la entrega de ayer va por delante del chat de ayer', dos[0]?.agente === AUDIT_MINUSCULAS);

console.log('\n── Lo que NO es una conversación tuya ──\n');

const comoTrabajador = encargosDelCliente(
  [tarea({ id: 90n, role: 'worker' }), tarea({ id: 91n })],
  simbolo,
  sinBrief,
);
check('los encargos que TÚ trabajas no son conversaciones tuyas', comoTrabajador.length === 1);
check('sólo queda el que encargaste', comoTrabajador[0]?.id === '91');

console.log('\n── Pendientes ──\n');

const varios = fusionarBandeja(
  [],
  encargosDelCliente(
    [
      tarea({ id: 1n, status: ESTADO.Abierto }),
      tarea({ id: 2n, status: ESTADO.Entregado }),
      tarea({ id: 3n, status: ESTADO.Completado }),
      tarea({ id: 4n, status: ESTADO.Cancelado }),
    ],
    simbolo,
    sinBrief,
  ),
);
check('se cuentan los cuatro encargos', varios[0]?.encargos === 4);
check('y sólo dos siguen pidiendo algo', varios[0]?.abiertos === 2, String(varios[0]?.abiertos));

console.log('\n── Dentro del hilo ──\n');

const hilo = fusionarHilo(
  [msg('hola', AYER), msg('¿lo miras?', AYER + 600 * S)],
  encargosDelCliente([tarea({ id: 55n, createdAt: BigInt(Math.floor((AYER + 300 * S) / 1000)) })], simbolo, sinBrief),
);
check('mensajes y encargos salen en orden cronológico', hilo.length === 3 && hilo[1]?.clase === 'encargo');
check(
  'el encargo se coloca por cuando se PIDIÓ',
  hilo[0]?.clase === 'mensaje' && hilo[2]?.clase === 'mensaje',
);
check(
  'y las keys de React no chocan entre las dos clases',
  new Set(hilo.map(claveDeEntrada)).size === 3,
);

console.log('\n── Bandeja vacía de verdad ──\n');

check('sin nada, no se inventa nada', fusionarBandeja([], []).length === 0);

console.log(
  fallos === 0
    ? '\n✅ Encargar cuenta como conversación, y hablar y encargar al mismo agente es un solo hilo\n'
    : `\n❌ ${fallos} comprobación(es) fallidas\n`,
);
process.exit(fallos === 0 ? 0 : 1);
