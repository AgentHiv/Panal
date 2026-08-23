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
