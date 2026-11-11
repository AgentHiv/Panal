/**
 * La reputación que se enseña y con la que se ordena el mercado
 * (`src/lib/reputacion.ts`): la nota cuenta a cada cliente una vez, y lo que la
 * respalda son clientes distintos, no reseñas.
 *
 *   pnpm exec tsx scripts/test-reputacion.ts
 *
 * El caso de noviembre de 2026, con sus números: un agente nuevo con veinte
 * encargos casi todos de la misma wallet y cinco estrellas en cada uno, frente
 * a agentes con menos estrellas pero de gente distinta.
 */

import type { Agent } from '../src/data/agents';
import type { AgentStats } from '../src/lib/indexer';
import { casiDeUnCliente, porReputacion, reputacionDeStats } from '../src/lib/reputacion';

let fallos = 0;
const check = (nombre: string, ok: boolean, detalle = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
  if (!ok) fallos++;
};

const stats = (c: Partial<AgentStats>): AgentStats => ({
  address: '0x0',
  tasks: 0,
  completed: 0,
  avgRating: null,
  ratingCount: 0,
  volume: {},
  firstSeenTs: 0,
  lastSeenTs: 0,
  ...c,
});
const agente = (id: string, st: AgentStats): Agent =>
  ({ id, name: id, tasksCompleted: st.completed, ...reputacionDeStats(st) }) as unknown as Agent;

console.log('\n─── lo que se enseña ───');
{
  const r = reputacionDeStats(stats({ completed: 18, avgRating: 4.5, ratingCount: 18, clients: 5, ratedClients: 5, clientRating: 3.9, topClientShare: 0.39 }));
  check('la nota es la de por cliente', r.rating === 3.9 && r.chainRating === 4.5 && r.clients === 5, JSON.stringify(r));
  const viejo = reputacionDeStats(stats({ completed: 3, avgRating: 4.2, ratingCount: 3 }));
  check('con un indexador anterior, la media simple, como antes', viejo.rating === 4.2 && viejo.clients === undefined);
  check('sin stats, cero', reputacionDeStats(null).rating === 0 && reputacionDeStats(null).reviews === 0);
}

console.log('\n─── el aviso de «casi todo de un cliente» ───');
{
  // yarbox el 11 de noviembre: 5 completadas, 2 clientes, el 80 % de uno.
  const yarbox = agente('yarbox', stats({ completed: 5, avgRating: 5, ratingCount: 5, clients: 2, ratedClients: 2, clientRating: 5, topClientShare: 0.8 }));
  check('cinco completadas de dos clientes: avisa', casiDeUnCliente(yarbox));
  const pocas = agente('nuevo', stats({ completed: 2, avgRating: 5, ratingCount: 2, clients: 1, ratedClients: 1, clientRating: 5, topClientShare: 1 }));
  check('con menos de cinco no dice nada todavía', !casiDeUnCliente(pocas));
  const lint = agente('lint', stats({ completed: 6, avgRating: 4.17, ratingCount: 6, clients: 6, ratedClients: 6, clientRating: 4.17, topClientShare: 0.17 }));
  check('seis completadas de seis clientes: no avisa', !casiDeUnCliente(lint));
  const fiel = agente('fiel', stats({ completed: 20, avgRating: 4.8, ratingCount: 20, clients: 4, ratedClients: 4, clientRating: 4.7, topClientShare: 0.85 }));
  check('el 85 % de uno, aunque haya cuatro: avisa', casiDeUnCliente(fiel));
  const viejo = agente('viejo', stats({ completed: 30, avgRating: 5, ratingCount: 30 }));
  check('sin las cifras de clientes no se inventa el aviso', !casiDeUnCliente(viejo));
}

console.log('\n─── el orden del mercado ───');
{
  // Veinte cinco-estrellas de la misma wallet contra notas más bajas de gente distinta.
  const comprado = agente('comprado', stats({ completed: 20, avgRating: 5, ratingCount: 20, clients: 1, ratedClients: 1, clientRating: 5, topClientShare: 1 }));
  const variado = agente('variado', stats({ completed: 10, avgRating: 4.5, ratingCount: 10, clients: 8, ratedClients: 8, clientRating: 4.5, topClientShare: 0.2 }));
  const otro = agente('otro', stats({ completed: 6, avgRating: 4.3, ratingCount: 6, clients: 6, ratedClients: 6, clientRating: 4.3, topClientShare: 0.17 }));
  const lista = [comprado, variado, otro];
  const orden = [...lista].sort(porReputacion(lista)).map((a) => a.id);
  check('veinte reseñas de una wallet pesan como una: el de ocho clientes va primero', orden[0] === 'variado', orden.join(' > '));
  check('y el comprado no sube por encima de otro respaldado por seis', orden.indexOf('otro') < orden.indexOf('comprado'), orden.join(' > '));

  const nuevoHonesto = agente('nuevo', stats({ completed: 1, avgRating: 5, ratingCount: 1, clients: 1, ratedClients: 1, clientRating: 5, topClientShare: 1 }));
  const conNuevo = [comprado, nuevoHonesto, variado];
  const ordenNuevo = [...conNuevo].sort(porReputacion(conNuevo)).map((x) => x.id);
  check('uno de una reseña y otro de veinte de la misma wallet, empatados: los dos son un cliente', ordenNuevo.slice(1).sort().join() === 'comprado,nuevo', ordenNuevo.join(' > '));

  // Con un indexador anterior (sin clientes), el orden de siempre: por reseñas,
  // acercando cada media a la del mercado.
  const a = agente('a', stats({ completed: 30, avgRating: 4.6, ratingCount: 30 }));
  const b = agente('b', stats({ completed: 3, avgRating: 5, ratingCount: 3 }));
  const c = agente('c', stats({ completed: 10, avgRating: 3.5, ratingCount: 10 }));
  const viejos = [a, b, c];
  const ordenViejo = [...viejos].sort(porReputacion(viejos)).map((x) => x.id);
  check('sin cifras de clientes, como antes: treinta reseñas pesan más que tres', ordenViejo[0] === 'a', ordenViejo.join(' > '));
}

console.log(fallos === 0 ? '\n✅ La nota cuenta a cada cliente una vez, y el mercado ordena por clientes\n' : `\n❌ ${fallos} comprobación(es) fallidas\n`);
process.exit(fallos === 0 ? 0 : 1);
