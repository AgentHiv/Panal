/**
 * La foto del mes: las cifras del mercado, guardadas en el repositorio.
 *
 *   pnpm foto                       → metrics/AAAA-MM.json del mes en curso
 *   pnpm foto -- --mes 2026-09      → la de un mes concreto (el nombre del archivo)
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
 * La lista de wallets es la parte que NO sale de la cadena: nadie más que el
 * equipo sabe qué wallets son suyas. Por eso vive en un archivo aparte y se
 * guarda dentro de cada foto, tal como estaba ese día: si la lista cambia, las
 * fotos viejas siguen diciendo con qué lista se hicieron.
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { formatEther, getAddress, type Address } from 'viem';
import { createPanalClient, TaskStatus, NATIVE_CURRENCY } from '../sdk/src/index.ts';

const RAIZ = join(import.meta.dirname, '..');
const DIR = join(RAIZ, 'metrics');
const INDEXADOR = process.env.INDEXER_URL?.trim() || 'https://api.panal.lat';
const args = process.argv.slice(2);
const seco = args.includes('--seco');
const mesArg = args[args.indexOf('--mes') + 1];
const mes = args.includes('--mes') && /^\d{4}-\d{2}$/.test(mesArg ?? '') ? mesArg! : new Date().toISOString().slice(0, 7);

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

async function main(): Promise<void> {
  const bloque = await panal.publicClient.getBlock();
  const cuando = new Date(Number(bloque.timestamp) * 1000);

  // ---- Agentes ------------------------------------------------------------
  const agentes = await panal.listAgents();
  const direccionesAgentes = new Set(agentes.map((a) => a.address.toLowerCase()));

  // ---- Encargos -----------------------------------------------------------
  const cuantas = Number(await panal.getTaskCount());
  const tareas = await enTandas([...Array(cuantas).keys()], 8, (i) => panal.getTask(BigInt(i)));

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
  const dia = (s: number): string => new Date(s * 1000).toISOString().slice(0, 10);
  const conActividad = new Set(eventos.map((e) => dia(e.ts)));
  let sinNada = 0;
  for (let d = 0; d < 30; d++) {
    if (!conActividad.has(new Date(cuando.getTime() - d * 86_400_000).toISOString().slice(0, 10))) sinNada++;
  }
  const ultimo = eventos.reduce((m, e) => Math.max(m, e.ts), 0);

  const foto = {
    month: mes,
    takenAt: cuando.toISOString(),
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
  at the block in the last column — not from the indexer.
- **Paid by outsiders** counts tasks whose client is not in the list of wallets
  the team knows to be its own (\`wallets.json\`). That list is the one thing the
  chain cannot tell, so each snapshot stores the list it was made with.
- **Days with nothing** counts, over the last 30 days, the days without a single
  on-chain event, from the indexer's event log.

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
