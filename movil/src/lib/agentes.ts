/**
 * Panal — administrar y seguir agentes desde el teléfono.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * EL MURO, y decide la forma de todo lo que hay debajo.
 *
 * `registerAgent`, `updatePrice`, `updateMetadata` y `setActive` NO reciben
 * ninguna dirección de agente: actúan sobre `msg.sender`. En mainnet los nueve
 * agentes registrados tienen como dueño su propia dirección, sin una excepción.
 *
 * O sea que una wallet solo puede administrarse a sí misma. «Mis agentes» en
 * plural NO existe hoy, y para mandar sobre uno desde el móvil hay que conectar
 * SU wallet — la que está corriendo su bot, con su clave en un `.env`.
 *
 * De ahí los dos modos, y de ahí que el que viene puesto sea SEGUIR: mirar no
 * necesita firmar nada, así que la clave del agente puede quedarse en el
 * servidor. Administrar es una decisión aparte y la pantalla la nombra.
 * ───────────────────────────────────────────────────────────────────────────
 */

import { useQuery } from '@tanstack/react-query';
import type { Address, Hex } from 'viem';
import { panalEscrowV2Abi, panalRegistryV2Abi } from '@/contracts/abis';
import {
  NATIVE_CURRENCY,
  PANAL_ESCROW_V2_ADDRESS,
  PANAL_REGISTRY_V2_ADDRESS,
  PANAL_TOKEN_ADDRESS,
  activeChain,
  publicClient,
} from '@/contracts/config';
import { extractBotUrl } from '@/lib/botEndpoint';
import { esDireccion, partirFicha } from '~/lib/ficha';
import type { FilaCartera } from '~/lib/cartera';
import { fetchTaskIdsOf } from '@/lib/indexer';

export { armarFicha, dejarDeSeguir, esDireccion, partirFicha, seguidos, seguir } from '~/lib/ficha';

/* ── la ficha del agente, tal y como está en el registro ─────────────────── */

export interface Ficha {
  /** `false` cuando esa dirección no está registrada como agente. */
  registrado: boolean;
  dueno: Address;
  metadataURI: string;
  nombre: string;
  descripcion: string;
  botUrl: string | null;
  precio: bigint;
  moneda: Address;
  activo: boolean;
  desde: number;
}

export function useFicha(direccion: string | undefined) {
  return useQuery<Ficha>({
    queryKey: ['ficha-agente', activeChain.id, direccion?.toLowerCase()],
    enabled: !!direccion && esDireccion(direccion),
    staleTime: 20_000,
    queryFn: async () => {
      const f = (await publicClient.readContract({
        address: PANAL_REGISTRY_V2_ADDRESS,
        abi: panalRegistryV2Abi,
        functionName: 'getAgent',
        args: [direccion as Address],
      })) as {
        owner: Address;
        metadataURI: string;
        pricePerTask: bigint;
        active: boolean;
        registeredAt: bigint;
        currency: Address;
      };

      const { nombre, descripcion } = partirFicha(f.metadataURI ?? '');
      return {
        // `getAgent` de una dirección sin registrar devuelve la tupla a cero.
        // Es `registeredAt` lo que lo distingue, no el nombre.
        registrado: f.registeredAt > 0n,
        dueno: f.owner,
        metadataURI: f.metadataURI ?? '',
        nombre: nombre || `${direccion!.slice(0, 6)}…${direccion!.slice(-4)}`,
        descripcion,
        botUrl: extractBotUrl(f.metadataURI),
        precio: f.pricePerTask,
        moneda: f.currency,
        activo: f.active,
        desde: Number(f.registeredAt) * 1000,
      };
    },
  });
}

/* ── lo ganado y sin cobrar ──────────────────────────────────────────────── */

export interface Pendiente {
  panal: bigint;
  mon: bigint;
  hay: boolean;
}

/**
 * Lo que el escrow le debe al agente y todavía está dentro.
 *
 * Son DOS lecturas porque `pendingWithdrawals(token, cuenta)` recibe un token,
 * y por lo mismo sacarlo son dos firmas. Eso sale escrito en la pantalla:
 * esconderlo haría que la segunda petición pareciera un fallo.
 */
export function usePendiente(direccion: string | undefined) {
  return useQuery<Pendiente>({
    queryKey: ['pendiente', activeChain.id, direccion?.toLowerCase()],
    enabled: !!direccion && esDireccion(direccion),
    staleTime: 10_000,
    refetchInterval: 20_000,
    queryFn: async () => {
      const leer = (token: Address): Promise<bigint> =>
        publicClient.readContract({
          address: PANAL_ESCROW_V2_ADDRESS,
          abi: panalEscrowV2Abi,
          functionName: 'pendingWithdrawals',
          args: [token, direccion as Address],
        }) as Promise<bigint>;

      const [panal, mon] = await Promise.all([leer(PANAL_TOKEN_ADDRESS), leer(NATIVE_CURRENCY)]);
      return { panal, mon, hay: panal > 0n || mon > 0n };
    },
  });
}

/* ── los encargos de un agente, sea o no el que firma ────────────────────── */

export interface TareaDeAgente {
  id: bigint;
  client: Address;
  worker: Address;
  amountWei: bigint;
  taskHash: Hex;
  resultHash: Hex;
  deadline: bigint;
  createdAt: bigint;
  status: number;
  currency: Address;
  deliveredAt?: bigint;
}

const LOTE = 5;
const RESPIRO_MS = 300;
const VENTANA_RECIENTE = 25;
const TOPE_ESCANEO = 200;
/** Cuántas tareas del final se miran para contar los encargos abiertos. */
const VENTANA_CARTERA = 120;

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Las tareas en las que una dirección es el TRABAJADOR.
 *
 * `useMyTasks` hace esto mismo pero solo para la wallet conectada, y aquí hace
 * falta para una dirección cualquiera: en modo «seguir» se mira un agente que
 * no eres tú. Se repite el planteamiento —ids del indexador, datos de la
 * cadena, ventana reciente por si el indexador va atrasado, escaneo de
 * respaldo— en vez de tocar el hook de la web, que la app no debe cambiar.
 */
async function tareasDe(direccion: Address): Promise<TareaDeAgente[]> {
  const total = Number(
    (await publicClient.readContract({
      address: PANAL_ESCROW_V2_ADDRESS,
      abi: panalEscrowV2Abi,
      functionName: 'getTaskCount',
    })) as bigint,
  );
  if (total === 0) return [];

  const cabeza = await publicClient.getBlockNumber().catch(() => undefined);
  const delIndice = await fetchTaskIdsOf(direccion, cabeza);

  const aLeer = new Set<string>();
  if (delIndice !== null) {
    for (const id of delIndice) aLeer.add(id.toString());
    for (let i = Math.max(0, total - VENTANA_RECIENTE); i < total; i++) aLeer.add(String(i));
  } else {
    for (let i = Math.max(0, total - TOPE_ESCANEO); i < total; i++) aLeer.add(String(i));
  }

  const ids = [...aLeer]
    .map((x) => BigInt(x))
    .filter((id) => id < BigInt(total))
    .sort((a, b) => (a > b ? 1 : a < b ? -1 : 0));

  const suyas: TareaDeAgente[] = [];
  const dirLc = direccion.toLowerCase();

  for (let i = 0; i < ids.length; i += LOTE) {
    const lote = ids.slice(i, i + LOTE);
    const filas = await Promise.all(
      lote.map(
        (id) =>
          publicClient.readContract({
            address: PANAL_ESCROW_V2_ADDRESS,
            abi: panalEscrowV2Abi,
            functionName: 'tasks',
            args: [id],
          }) as Promise<Omit<TareaDeAgente, 'id'> & { amount: bigint }>,
      ),
    );
    filas.forEach((f, j) => {
      if (f.worker.toLowerCase() !== dirLc) return;
      suyas.push({
        id: lote[j]!,
        client: f.client,
        worker: f.worker,
        amountWei: f.amount,
        taskHash: f.taskHash,
        resultHash: f.resultHash,
        deadline: f.deadline,
        createdAt: f.createdAt,
        status: Number(f.status),
        currency: f.currency ?? NATIVE_CURRENCY,
      });
    });
    if (i + LOTE < ids.length) await dormir(RESPIRO_MS);
  }

  // `deliveredAt` solo de las entregadas: es lo que da la cuenta atrás de los
  // tres días, y pedirlo de todas serían lecturas tiradas.
  const entregadas = suyas.filter((t) => t.status === 1);
  for (let i = 0; i < entregadas.length; i += LOTE) {
    const lote = entregadas.slice(i, i + LOTE);
    const cuandos = await Promise.all(
      lote.map(
        (t) =>
          publicClient
            .readContract({
              address: PANAL_ESCROW_V2_ADDRESS,
              abi: panalEscrowV2Abi,
              functionName: 'deliveredAt',
              args: [t.id],
            })
            .catch(() => 0n) as Promise<bigint>,
      ),
    );
    lote.forEach((t, j) => {
      t.deliveredAt = cuandos[j];
    });
    if (i + LOTE < entregadas.length) await dormir(RESPIRO_MS);
  }

  return suyas.sort((a, b) => (a.id > b.id ? -1 : 1));
}

/* ── la cartera: varios agentes de una vez ───────────────────────────────── */

/**
 * Todos los agentes que sigues, en UNA consulta.
 *
 * Se lee todo junto y no con un hook por fila porque el total tiene que salir
 * de la misma foto que las filas: con una consulta por agente, la suma de
 * arriba iría cambiando mientras van llegando y por un momento diría una cifra
 * que no es la de ninguna lista.
 *
 * Son tres lecturas por agente —ficha y las dos monedas— más el escaneo de sus
 * encargos abiertos. Con nueve agentes son 27 lecturas y un escaneo del escrow
 * compartido por todos, que es lo que cuesta ver una cartera entera.
 */
export function useCartera(direcciones: string[]) {
  const claves = direcciones.map((d) => d.toLowerCase()).sort();

  return useQuery<FilaCartera[]>({
    queryKey: ['cartera', activeChain.id, claves.join(',')],
    enabled: claves.length > 0,
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const ahora = Math.floor(Date.now() / 1000);
      // Las tareas abiertas se sacan del escrow UNA vez y se reparten: pedir
      // las de cada agente por separado repetiría el mismo recorrido nueve
      // veces contra un RPC público.
      const abiertasPorAgente = await abiertasDe(claves);

      const filas = await Promise.all(
        claves.map(async (dir): Promise<FilaCartera> => {
          const [ficha, panal, mon] = await Promise.all([
            publicClient.readContract({
              address: PANAL_REGISTRY_V2_ADDRESS,
              abi: panalRegistryV2Abi,
              functionName: 'getAgent',
              args: [dir as Address],
            }) as Promise<{
              metadataURI: string;
              pricePerTask: bigint;
              active: boolean;
              registeredAt: bigint;
              currency: Address;
            }>,
            publicClient.readContract({
              address: PANAL_ESCROW_V2_ADDRESS,
              abi: panalEscrowV2Abi,
              functionName: 'pendingWithdrawals',
              args: [PANAL_TOKEN_ADDRESS, dir as Address],
            }) as Promise<bigint>,
            publicClient.readContract({
              address: PANAL_ESCROW_V2_ADDRESS,
              abi: panalEscrowV2Abi,
              functionName: 'pendingWithdrawals',
              args: [NATIVE_CURRENCY, dir as Address],
            }) as Promise<bigint>,
          ]);

          const suyas = abiertasPorAgente.get(dir) ?? [];
          return {
            direccion: dir,
            nombre: partirFicha(ficha.metadataURI ?? '').nombre || `${dir.slice(0, 6)}…${dir.slice(-4)}`,
            registrado: ficha.registeredAt > 0n,
            activo: ficha.active,
            precio: ficha.pricePerTask,
            moneda:
              ficha.currency?.toLowerCase() === PANAL_TOKEN_ADDRESS.toLowerCase() ? '$PANAL' : 'MON',
            conEndpoint: extractBotUrl(ficha.metadataURI) !== null,
            panal,
            mon,
            vencidos: suyas.filter((t) => t < ahora).length,
            abiertos: suyas.filter((t) => t >= ahora).length,
          };
        }),
      );
      return filas;
    },
  });
}

/**
 * Los plazos de los encargos ABIERTOS de cada agente, en un solo recorrido.
 *
 * Solo mira la cola del escrow: un encargo abierto es reciente por definición
 * —o venció, y entonces sigue estando en esa cola salvo que sea muy viejo—.
 * Recorrer las 61 tareas enteras por cada carga de pantalla sería castigar un
 * RPC público para enseñar un contador.
 */
async function abiertasDe(direcciones: string[]): Promise<Map<string, number[]>> {
  const salida = new Map<string, number[]>();
  const total = Number(
    (await publicClient.readContract({
      address: PANAL_ESCROW_V2_ADDRESS,
      abi: panalEscrowV2Abi,
      functionName: 'getTaskCount',
    })) as bigint,
  );
  if (total === 0) return salida;

  const buscadas = new Set(direcciones);
  const desde = Math.max(0, total - VENTANA_CARTERA);

  for (let i = desde; i < total; i += LOTE) {
    const lote = Array.from({ length: Math.min(LOTE, total - i) }, (_, j) => BigInt(i + j));
    const filas = await Promise.all(
      lote.map(
        (id) =>
          publicClient.readContract({
            address: PANAL_ESCROW_V2_ADDRESS,
            abi: panalEscrowV2Abi,
            functionName: 'tasks',
            args: [id],
          }) as Promise<{ worker: Address; deadline: bigint; status: number }>,
      ),
    );
    for (const f of filas) {
      if (Number(f.status) !== 0) continue;
      const w = f.worker.toLowerCase();
      if (!buscadas.has(w)) continue;
      salida.set(w, [...(salida.get(w) ?? []), Number(f.deadline)]);
    }
    if (i + LOTE < total) await dormir(RESPIRO_MS);
  }
  return salida;
}

export function useTareasDe(direccion: string | undefined) {
  return useQuery<TareaDeAgente[]>({
    queryKey: ['tareas-de', activeChain.id, direccion?.toLowerCase()],
    enabled: !!direccion && esDireccion(direccion),
    queryFn: () => tareasDe(direccion as Address),
    staleTime: 10_000,
    refetchInterval: 20_000,
    refetchIntervalInBackground: false,
    retry: 1,
  });
}
