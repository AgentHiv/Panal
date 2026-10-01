/**
 * La foto del mes: las cifras del mercado, guardadas en el repositorio.
 *
 *   pnpm foto                       → metrics/AAAA-MM.json del mes que acaba de terminar
 *   pnpm foto -- --mes 2026-09      → la de un mes concreto, ya terminado
 *   pnpm foto -- --seco             → la calcula y la enseña, sin escribir nada
 *
 * POR QUÉ EXISTE. ROADMAP.md lo pide como regla: «el último día de cada mes la
 * foto del indexador entra en el repo». Sin ella, el 1 de enero se enseña una
 * anécdota; con ella, una serie que cualquiera puede recalcular.
 *
 * DE DÓNDE SALE CADA NÚMERO, para que se pueda recalcular:
 *   - agentes y encargos: de la CADENA (registro y escrow), no del indexador;
 *   - días sin actividad: de los eventos del indexador, que es lo único que
 *     guarda la fecha de cada movimiento;
 *   - quién pagó cada encargo: el `client` de la tarea en la cadena, clasificado
 *     con la lista de `metrics/wallets.json`.
 *
 * EL CORTE ES LA MEDIANOCHE, NO LA HORA A LA QUE CORRE. Todo se lee en el
 * último bloque del mes —el último con fecha anterior al día 1 a las 00:00
 * UTC—, no en el bloque de ahora. La primera foto, la de septiembre, se sacó
 * leyendo «ahora» desde un cron de las 22:00 del día 29 que GitHub arrancó con
 * tres horas de retraso: ya era día 30, «mañana» era día 1, y la foto del mes
 * salió sin su último día. Con el corte fijo da igual cuándo corra: dos
 * ejecuciones del mismo mes leen el mismo bloque y escriben el mismo archivo.
 *
 * Eso exige que el RPC sirva estado pasado, y el de Monad lo guarda unos cinco
 * días (medido el 2026-10-02: 1,5 M de bloques atrás sí, 2 M ya no). Más allá,
 * la lectura falla con un error del RPC y no se escribe nada: una foto con el
 * estado de otro día sería peor que ninguna.
 *
 * La lista de wallets es la parte que NO sale de la cadena: nadie más que el
 * equipo sabe qué wallets son suyas. Por eso vive en un archivo aparte y se
 * guarda dentro de cada foto, tal como estaba ese día: si la lista cambia, las
 * fotos viejas siguen diciendo con qué lista se hicieron.
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { formatEther, getAddress, type Address } from 'viem';
import {
  createPanalClient,
  escrowAbi,
  registryAbi,
  TaskStatus,
  NATIVE_CURRENCY,
} from '../sdk/src/index.ts';

const RAIZ = join(import.meta.dirname, '..');
const DIR = join(RAIZ, 'metrics');
const INDEXADOR = process.env.INDEXER_URL?.trim() || 'https://api.panal.lat';
const args = process.argv.slice(2);
const seco = args.includes('--seco');
const mesArg = args[args.indexOf('--mes') + 1];

/** El mes que acaba de terminar, en UTC. */
function mesAnterior(ahora: Date): string {
  return new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
}
const mes = args.includes('--mes') && /^\d{4}-\d{2}$/.test(mesArg ?? '') ? mesArg! : mesAnterior(new Date());
const [anio, numMes] = mes.split('-').map(Number) as [number, number];
/** El día 1 del mes siguiente a las 00:00 UTC, en segundos: lo que ya NO entra. */
const corte = Date.UTC(anio, numMes, 1) / 1000;

type Categoria = 'team' | 'unconfirmed' | 'collaborator';
interface ListaWallets {
  _note?: string;
  team: { address: string; label: string }[];
  unconfirmed?: { address: string; label: string }[];
  collaborator?: { address: string; label: string }[];
}

const listaPath = process.env.WALLETS_FILE?.trim() || join(DIR, 'wallets.json');
const lista = JSON.parse(readFileSync(listaPath, 'utf8')) as ListaWallets;
const categoriaDe = new Map<string, Categoria>();
for (const cat of ['team', 'unconfirmed', 'collaborator'] as const) {
  for (const w of lista[cat] ?? []) categoriaDe.set(w.address.toLowerCase(), cat);
}

const panal = createPanalClient({ rpcUrl: process.env.RPC_URL?.trim() || undefined, indexerUrl: null });
const simbolo = (c: Address): string =>
  c.toLowerCase() === NATIVE_CURRENCY.toLowerCase()
    ? 'MON'
    : c.toLowerCase() === panal.addresses.panalToken.toLowerCase()
      ? '$PANAL'
      : c;

/** De a pocos: el RPC público corta a partir de ~15 llamadas por segundo. */
async function enTandas<T, R>(xs: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < xs.length; i += n) out.push(...(await Promise.all(xs.slice(i, i + n).map(f))));
  return out;
}

/**
 * El último bloque con fecha anterior al corte, por bisección.
 *
 * Los bloques de Monad salen cada ~0,3 s, así que se estima primero dónde cae y
 * se acota alrededor: unas 25 lecturas en vez de recorrer millones.
 */
async function ultimoBloqueAntesDe(segundos: number): Promise<{ number: bigint; timestamp: bigint }> {
  const cabeza = await panal.publicClient.getBlock();
  if (cabeza.timestamp < BigInt(segundos)) {
    throw new Error(`El mes ${mes} no ha terminado todavía: la foto se saca cuando acaba, no antes.`);
  }
  let bajo = 0n;
  let alto = cabeza.number; // invariante: timestamp(alto) >= corte
  while (alto - bajo > 1n) {
    const medio = (bajo + alto) / 2n;
    const b = await panal.publicClient.getBlock({ blockNumber: medio });
    if (b.timestamp < BigInt(segundos)) bajo = medio;
    else alto = medio;
  }
  const b = await panal.publicClient.getBlock({ blockNumber: bajo });
  return { number: b.number, timestamp: b.timestamp };
}

/** Una lectura de contrato fijada al bloque del corte. */
function leerEn(blockNumber: bigint) {
  return <T>(address: Address, abi: typeof escrowAbi | typeof registryAbi, functionName: string, args: unknown[] = []) =>
    panal.publicClient.readContract({ address, abi, functionName, args, blockNumber } as never) as Promise<T>;
}

async function main(): Promise<void> {
  const bloque = await ultimoBloqueAntesDe(corte);
  const cuando = new Date(Number(bloque.timestamp) * 1000);
  const leer = leerEn(bloque.number);

  // ---- Agentes, en el bloque del corte ------------------------------------
  // A mano y no con `panal.listAgents()`: el SDK lee siempre el último bloque.
  const numAgentes = Number(await leer<bigint>(panal.addresses.registry, registryAbi, 'getAgentCount'));
  const direcciones: Address[] = [];
  for (let desde = 0; desde < numAgentes; desde += 50) {
    direcciones.push(...(await leer<readonly Address[]>(panal.addresses.registry, registryAbi, 'getAgents', [BigInt(desde), 50n])));
  }
  const agentes = await enTandas(direcciones, 8, async (a) => ({
    address: a,
    ...(await leer<{ active: boolean }>(panal.addresses.registry, registryAbi, 'getAgent', [a])),
  }));
  const direccionesAgentes = new Set(agentes.map((a) => a.address.toLowerCase()));

  // ---- Encargos, en el bloque del corte -----------------------------------
  const cuantas = Number(await leer<bigint>(panal.addresses.escrow, escrowAbi, 'getTaskCount'));
  const tareas = await enTandas([...Array(cuantas).keys()], 8, (i) =>
    leer<{ client: Address; amount: bigint; status: number; currency: Address }>(panal.addresses.escrow, escrowAbi, 'tasks', [
      BigInt(i),
    ]),
  );

  const porEstado: Record<string, number> = {};
  const volumen: Record<string, bigint> = {};
  const porPagador = {
    team: { created: 0, completed: 0 },
    unconfirmed: { created: 0, completed: 0 },
    collaborator: { created: 0, completed: 0 },
    outside: { created: 0, completed: 0, byRegisteredAgents: 0, distinctWallets: 0 },
  };
  const walletsDeFuera = new Set<string>();
  for (const t of tareas) {
    const estado = TaskStatus[t.status] ?? String(t.status);
    porEstado[estado] = (porEstado[estado] ?? 0) + 1;
    const completada = t.status === TaskStatus.Completed;
    if (completada) volumen[simbolo(t.currency)] = (volumen[simbolo(t.currency)] ?? 0n) + t.amount;

    const quien = t.client.toLowerCase();
    const cat = categoriaDe.get(quien) ?? 'outside';
    porPagador[cat].created++;
    if (completada) porPagador[cat].completed++;
    if (cat === 'outside') {
      walletsDeFuera.add(quien);
      if (direccionesAgentes.has(quien)) porPagador.outside.byRegisteredAgents++;
    }
  }
  porPagador.outside.distinctWallets = walletsDeFuera.size;

  // ---- Días sin actividad, de los eventos del indexador ---------------------
  const eventos: { ts: number }[] = [];
  let antes: string | null = null;
  for (let i = 0; i < 50; i++) {
    const url = `${INDEXADOR}/index/events?limit=200${antes ? `&before=${encodeURIComponent(antes)}` : ''}`;
    const r = (await (await fetch(url)).json()) as { events: { ts: number }[]; next?: string | null };
    eventos.push(...r.events);
    if (!r.next) break;
    antes = r.next;
  }
  // Solo lo de antes del corte: lo que pasó después es del mes siguiente.
  const delMes = eventos.filter((e) => e.ts < corte);
  const dia = (s: number): string => new Date(s * 1000).toISOString().slice(0, 10);
  const conActividad = new Set(delMes.map((e) => dia(e.ts)));
  // Los 30 días que acaban el último día del mes, no los 30 hasta hoy.
  let sinNada = 0;
  for (let d = 1; d <= 30; d++) {
    if (!conActividad.has(dia(corte - d * 86_400))) sinNada++;
  }
  const ultimo = delMes.reduce((m, e) => Math.max(m, e.ts), 0);

  const foto = {
    month: mes,
    // El instante del bloque leído: el último antes de `cutoff`.
    takenAt: cuando.toISOString(),
    cutoff: new Date(corte * 1000).toISOString(),
    block: bloque.number.toString(),
    sources: {
      chain: 'Monad mainnet (143)',
      registry: panal.addresses.registry,
      escrow: panal.addresses.escrow,
      indexer: `${INDEXADOR}/index/events`,
    },
    agents: {
      registered: agentes.length,
      active: agentes.filter((a) => a.active).length,
    },
    tasks: {
      created: cuantas,
      byStatus: porEstado,
      completedVolume: Object.fromEntries(Object.entries(volumen).map(([k, v]) => [k, formatEther(v)])),
    },
    paidBy: porPagador,
    activity: {
      daysWithNothingInLast30: sinNada,
      lastEvent: ultimo ? new Date(ultimo * 1000).toISOString() : null,
    },
    // La lista con la que se clasificó, tal como estaba hoy.
    wallets: {
      team: (lista.team ?? []).map((w) => getAddress(w.address)),
      unconfirmed: (lista.unconfirmed ?? []).map((w) => getAddress(w.address)),
      collaborator: (lista.collaborator ?? []).map((w) => getAddress(w.address)),
    },
  };

  const texto = JSON.stringify(foto, null, 2) + '\n';
  if (seco) {
    console.log(texto);
    return;
  }
  mkdirSync(DIR, { recursive: true });
  writeFileSync(join(DIR, `${mes}.json`), texto);
  escribirSerie();
  console.log(`metrics/${mes}.json escrita · bloque ${foto.block}`);
}

/** metrics/README.md: la serie entera, rehecha a partir de todas las fotos. */
function escribirSerie(): void {
  const fotos = readdirSync(DIR)
    .filter((f) => /^\d{4}-\d{2}\.json$/.test(f))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')));
  const filas = fotos.map(
    (f) =>
      `| ${f.month} | ${f.agents.registered} | ${f.agents.active} | ${f.tasks.created} | ${f.tasks.byStatus.Completed ?? 0} | ` +
      `${f.paidBy.outside.created} (${f.paidBy.outside.distinctWallets} wallets) | ${f.paidBy.team.created} | ` +
      `${f.activity.daysWithNothingInLast30} | ${f.block} |`,
  );
  writeFileSync(
    join(DIR, 'README.md'),
    `# Panal, month by month

One snapshot at the end of every month, as ROADMAP.md commits to. Each row is
a file in this folder; every number in it can be recomputed.

- **Agents** and **tasks** are read from the chain — the registry and the escrow
  at the block in the last column, the last one before midnight UTC on the 1st
  of the next month — not from the indexer. It doesn't matter when the snapshot
  runs: the month is always cut at the same block.
- **Paid by outsiders** counts tasks whose client is not in the list of wallets
  the team knows to be its own (\`wallets.json\`). That list is the one thing the
  chain cannot tell, so each snapshot stores the list it was made with.
- **Days with nothing** counts, over the 30 days that end the month, the days
  without a single on-chain event, from the indexer's event log.

| Month | Agents registered | Active | Tasks | Completed | Paid by outsiders | Paid by the team | Days with nothing (of 30) | Block |
|---|---|---|---|---|---|---|---|---|
${filas.join('\n')}

Regenerated by \`pnpm foto\` (\`scripts/foto-del-mes.ts\`).
`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
