/**
 * Panal — el tablón con reglas (PanalTablon): lo que leen y firman la web y la
 * app. La interfaz está en `pages/Tablon.tsx` (web) y en la app; aquí, el
 * dinero y los datos, que son lo que comparten.
 *
 * QUÉ CAMBIA RESPECTO AL TABLÓN DEL ESCROW
 *
 * Aquel era `createTask(worker = 0)`: el primero que llegaba se lo quedaba. En
 * este el dinero espera en PanalTablon y la tarea del escrow nace YA asignada
 * al agente que pasa las reglas (nivel, cupo, categoría, sanciones). Dos
 * consecuencias que se ven en todo este archivo:
 *
 *   - En el escrow, el CLIENTE de esas tareas es PanalTablon. Quien publicó
 *     aprueba y disputa llamando al tablón, que lo reenvía; el escrow no le
 *     conoce.
 *   - Los textos van por número de ENCARGO, no de tarea, y bajo la dirección
 *     del tablón en el buzón (`/buzon/<tablón>/…`).
 *
 * LECTURAS EN BLOQUE. Una fila del tablón son varias lecturas (el encargo, sus
 * ofertas, su tarea del escrow), y el RPC público limita. Van por Multicall3:
 * cincuenta encargos son una sola petición.
 */

import {
  BaseError,
  ContractFunctionRevertedError,
  keccak256,
  toBytes,
  type Abi,
  type Address,
  type Hex,
} from 'viem';
import {
  encargoDeLaCadena,
  ofertaDeLaCadena,
  panalTablonAbi,
  situacionDe,
  tablonEncargoSignMessage,
  tablonEntregaSignMessage,
  tablonResultadoSignMessage,
  type EncargoConReglas,
  type OfertaConReglas,
  type SituacionEnElTablon,
} from '@panal/sdk';
import {
  MULTICALL3_ADDRESS,
  NATIVE_CURRENCY,
  PANAL_ESCROW_V2_ADDRESS,
  PANAL_TABLON_ADDRESS,
  PANAL_TOKEN_ADDRESS,
  publicClient,
} from '@/contracts/config';
import { panalEscrowV2Abi } from '@/contracts/abis';
import { BUZON_BASE, cabecerasFirma, expiraEn } from '@/lib/botEndpoint';

const TABLON = PANAL_TABLON_ADDRESS as Address;
const BUZON_DEL_TABLON = `${BUZON_BASE}/${PANAL_TABLON_ADDRESS}`;
const ABI = panalTablonAbi as unknown as Abi;

/** Encargos por llamada a Multicall3. Cincuenta structs caben de sobra. */
const POR_LOTE = 50;

/** Gas como mucho para una firma en el tablón: la que más gasta crea la tarea. */
const TOPE_GAS = 3_000_000n;

/** Las dos monedas del tablón: MON nativo y $PANAL. */
export const MONEDAS_TABLON = [NATIVE_CURRENCY, PANAL_TOKEN_ADDRESS as Address] as const;

/**
 * Una tarea del escrow que repartió PanalTablon: en el escrow, su cliente es el
 * tablón, no quien publicó. Se enseña como «Tablón», no como una dirección.
 */
export function esDelTablon(cliente: string): boolean {
  return cliente.toLowerCase() === PANAL_TABLON_ADDRESS.toLowerCase();
}

export function simboloDe(moneda: Address): 'MON' | '$PANAL' {
  return moneda.toLowerCase() === PANAL_TOKEN_ADDRESS.toLowerCase() ? '$PANAL' : 'MON';
}

/* ── lecturas ─────────────────────────────────────────────────────────── */

async function enBloque<T>(llamadas: { functionName: string; args?: readonly unknown[]; address?: Address; abi?: Abi }[]): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < llamadas.length; i += POR_LOTE) {
    const lote = llamadas.slice(i, i + POR_LOTE).map((l) => ({
      address: l.address ?? TABLON,
      abi: l.abi ?? ABI,
      functionName: l.functionName,
      args: l.args ?? [],
    }));
    const res = await publicClient.multicall({
      contracts: lote as never,
      multicallAddress: MULTICALL3_ADDRESS,
      allowFailure: false,
    });
    out.push(...(res as T[]));
  }
  return out;
}

/** Los últimos `limite` encargos, del más nuevo al más viejo, en cualquier estado. */
export async function leerEncargos(limite = 200): Promise<EncargoConReglas[]> {
  const total = (await publicClient.readContract({ address: TABLON, abi: ABI, functionName: 'jobCount' })) as bigint;
  const ids: bigint[] = [];
  for (let i = total - 1n; i >= 0n && ids.length < limite; i--) ids.push(i);
  if (ids.length === 0) return [];
  const crudos = await enBloque<Record<string, unknown>>(ids.map((id) => ({ functionName: 'getJob', args: [id] })));
  return crudos.map((j, k) => encargoDeLaCadena(ids[k]!, j));
}

/** Las ofertas de varios encargos de selección, por número de encargo. */
export async function leerOfertas(ids: bigint[]): Promise<Map<string, OfertaConReglas[]>> {
  const out = new Map<string, OfertaConReglas[]>();
  if (ids.length === 0) return out;
  const listas = await enBloque<readonly Record<string, unknown>[]>(ids.map((id) => ({ functionName: 'offers', args: [id] })));
  listas.forEach((lista, k) => out.set(ids[k]!.toString(), lista.map(ofertaDeLaCadena)));
  return out;
}

/** Lo que importa de una tarea del escrow para el tablón. */
export interface TareaDelTablon {
  /** 0 abierta · 1 entregada · 2 completada · 3 en disputa · 4 cancelada. */
  estado: number;
  plazo: number;
  resultHash: Hex;
  entregadaEn: number;
  disputadaEn: number;
}

/** Las tareas del escrow de los encargos asignados, por id de tarea. */
export async function leerTareas(taskIds: bigint[]): Promise<Map<string, TareaDelTablon>> {
  const out = new Map<string, TareaDelTablon>();
  if (taskIds.length === 0) return out;
  const escrow = { address: PANAL_ESCROW_V2_ADDRESS as Address, abi: panalEscrowV2Abi as unknown as Abi };
  const res = await enBloque<unknown>(
    taskIds.flatMap((id) => [
      { ...escrow, functionName: 'tasks', args: [id] },
      { ...escrow, functionName: 'deliveredAt', args: [id] },
      { ...escrow, functionName: 'disputedAt', args: [id] },
    ]),
  );
  taskIds.forEach((id, k) => {
    const t = res[k * 3] as { status: number; deadline: bigint; resultHash: Hex };
    out.set(id.toString(), {
      estado: Number(t.status),
      plazo: Number(t.deadline),
      resultHash: t.resultHash,
      entregadaEn: Number(res[k * 3 + 1] as bigint),
      disputadaEn: Number(res[k * 3 + 2] as bigint),
    });
  });
  return out;
}

/** Los topes de la beta, lo que ya ocupa cada moneda y los mínimos. */
export interface ReglasDelTablon {
  pausado: boolean;
  /** Por moneda (dirección en minúsculas). 0 = sin tope. */
  topes: Record<string, { porEncargo: bigint; total: bigint; ocupado: bigint }>;
  minimoMon: bigint;
  minimoPanal: bigint;
  /** Del escrow: liberación automática y disputa atascada, en segundos. */
  liberacionS: number;
  disputaS: number;
}

export async function leerReglas(): Promise<ReglasDelTablon> {
  const escrow = { address: PANAL_ESCROW_V2_ADDRESS as Address, abi: panalEscrowV2Abi as unknown as Abi };
  const [pausado, minMon, minPanal, liberacion, disputa, ...porMoneda] = await enBloque<unknown>([
    { functionName: 'paused' },
    { functionName: 'MIN_NATIVE' },
    { functionName: 'MIN_TOKEN' },
    { ...escrow, functionName: 'AUTO_RELEASE' },
    { ...escrow, functionName: 'DISPUTE_TIMEOUT' },
    ...MONEDAS_TABLON.flatMap((m) => [
      { functionName: 'caps', args: [m] },
      { functionName: 'books', args: [m] },
    ]),
  ]);
  const topes: ReglasDelTablon['topes'] = {};
  MONEDAS_TABLON.forEach((m, k) => {
    const [porEncargo, total] = porMoneda[k * 2] as readonly [bigint, bigint];
    const [posted, inEscrow] = porMoneda[k * 2 + 1] as readonly [bigint, bigint, bigint, bigint, bigint];
    topes[m.toLowerCase()] = { porEncargo, total, ocupado: posted + inEscrow };
  });
  return {
    pausado: Boolean(pausado),
    topes,
    minimoMon: minMon as bigint,
    minimoPanal: minPanal as bigint,
    liberacionS: Number(liberacion as bigint),
    disputaS: Number(disputa as bigint),
  };
}

/** Nivel, cupo, suspensión y categorías de un agente. */
export async function leerSituacion(agente: Address): Promise<SituacionEnElTablon> {
  const [[nivel, cupo], stats, novato, mascara] = (await enBloque<unknown>([
    { functionName: 'levelOf', args: [agente] },
    { functionName: 'agentStats', args: [agente] },
    { functionName: 'newcomerJobs' },
    { functionName: 'categoryMask', args: [agente] },
  ])) as [readonly [number, number], readonly [number, number, number, number, bigint], number, bigint];
  return situacionDe(
    {
      nivel: Number(nivel),
      cupoDiario: Number(cupo),
      stats: {
        day: Number(stats[0]),
        takenToday: Number(stats[1]),
        open: Number(stats[2]),
        newcomerUsed: Number(stats[3]),
        suspendedUntil: Number(stats[4]),
      },
      encargosDeNovato: Number(novato),
      mascara,
    },
    Math.floor(Date.now() / 1000),
  );
}

/** Lo que el tablón le debe a una dirección, por moneda (minúsculas). */
export async function leerDeuda(quien: Address): Promise<Record<string, bigint>> {
  const res = await enBloque<bigint>(MONEDAS_TABLON.map((m) => ({ functionName: 'owed', args: [quien, m] })));
  return Object.fromEntries(MONEDAS_TABLON.map((m, k) => [m.toLowerCase(), res[k]!]));
}

/** Si un agente puede coger u ofertar en cada encargo, y por qué no. */
export async function leerPermisos(agente: Address, ids: bigint[]): Promise<Map<string, { ok: boolean; motivo: string }>> {
  const out = new Map<string, { ok: boolean; motivo: string }>();
  if (ids.length === 0) return out;
  const res = await enBloque<readonly [boolean, string]>(ids.map((id) => ({ functionName: 'canTake', args: [agente, id] })));
  res.forEach(([ok, motivo], k) => out.set(ids[k]!.toString(), { ok, motivo }));
  return out;
}

/* ── el buzón ─────────────────────────────────────────────────────────── */

/**
 * Los anuncios, comprobados contra el `advertHash` de cada encargo. Uno que no
 * cuadre no sale: el buzón puede dejar de servir, pero no inventarse un anuncio.
 */
export async function leerAnuncios(encargos: EncargoConReglas[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const res = await fetch(`${BUZON_DEL_TABLON}/lista`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return out;
  const { anuncios = [] } = (await res.json()) as { anuncios?: { jobId: string; anuncio: string }[] };
  const hashes = new Map(encargos.map((j) => [j.id.toString(), j.advertHash.toLowerCase()]));
  for (const a of anuncios) {
    if (typeof a.anuncio !== 'string') continue;
    if (hashes.get(a.jobId) === keccak256(toBytes(a.anuncio)).toLowerCase()) out.set(a.jobId, a.anuncio);
  }
  return out;
}

/**
 * Si el buzón acepta ya los textos de este tablón. Se pregunta ANTES de
 * publicar: si no, el dinero quedaría depositado con un encargo que nadie
 * puede leer. Pasó el día del despliegue: el buzón de producción aún no tenía
 * la dirección del tablón y respondía «not found» a todo.
 */
export async function buzonAceptaElTablon(): Promise<boolean> {
  try {
    const res = await fetch(`${BUZON_DEL_TABLON}/lista`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return false;
    const cuerpo = (await res.json()) as { anuncios?: unknown };
    return Array.isArray(cuerpo.anuncios);
  } catch {
    return false;
  }
}

/**
 * Deja el anuncio y el encargo de un encargo ya publicado. Sin firma: el buzón
 * solo acepta los textos que dan los hashes que la cadena guardó. Repetirlo no
 * molesta, así que sirve para reintentar.
 */
export async function guardarTextos(jobId: bigint, anuncio: string, encargo: string): Promise<void> {
  for (const [ruta, campo, texto] of [
    ['anuncio', 'anuncio', anuncio],
    ['brief', 'brief', encargo],
  ] as const) {
    const res = await fetch(`${BUZON_DEL_TABLON}/${ruta}/${jobId.toString()}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ [campo]: texto }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`${ruta}: HTTP ${res.status}`);
  }
}

type Firmar = (mensaje: string) => Promise<string>;

/**
 * El encargo privado: lo leen su cliente y su agente. Se comprueba contra el
 * `taskHash` de la cadena. `null` si el buzón no lo tiene.
 */
export async function leerEncargoPrivado(job: EncargoConReglas, yo: Address, firmar: Firmar): Promise<string | null> {
  const expira = expiraEn();
  const firma = await firmar(tablonEncargoSignMessage(job.id, expira));
  const res = await fetch(`${BUZON_DEL_TABLON}/encargo/${job.id.toString()}`, {
    headers: cabecerasFirma(yo, firma, expira),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { brief } = (await res.json()) as { brief?: unknown };
  if (typeof brief !== 'string' || keccak256(toBytes(brief)).toLowerCase() !== job.taskHash.toLowerCase()) {
    throw new Error('no cuadra con el taskHash');
  }
  return brief;
}

/**
 * Deja la entrega en el buzón. Va ANTES de anclarla en el escrow: al revés, un
 * fallo del buzón dejaría al cliente con una entrega anclada que no puede leer.
 * La firma lleva el hash dentro, así que vale solo para ESTE texto.
 */
export async function dejarEntrega(jobId: bigint, texto: string, yo: Address, firmar: Firmar): Promise<Hex> {
  const hash = keccak256(toBytes(texto));
  const expira = expiraEn();
  const firma = await firmar(tablonEntregaSignMessage(jobId, hash, expira));
  const res = await fetch(`${BUZON_DEL_TABLON}/entrega/${jobId.toString()}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ entrega: texto, address: yo, signature: firma, expira }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return hash;
}

/** La entrega, para su cliente, comprobada contra el `resultHash` del escrow. */
export async function leerEntrega(jobId: bigint, resultHash: Hex, yo: Address, firmar: Firmar): Promise<string | null> {
  const expira = expiraEn();
  const firma = await firmar(tablonResultadoSignMessage(jobId, expira));
  const res = await fetch(`${BUZON_DEL_TABLON}/result/${jobId.toString()}`, {
    headers: cabecerasFirma(yo, firma, expira),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { resultText } = (await res.json()) as { resultText?: unknown };
  if (typeof resultText !== 'string' || keccak256(toBytes(resultText)).toLowerCase() !== resultHash.toLowerCase()) {
    throw new Error('no cuadra con el resultHash');
  }
  return resultText;
}

/* ── firmar ───────────────────────────────────────────────────────────── */

/** Lo que se firma en PanalTablon: el gas va fijado por `gasParaTablon`. */
export interface FirmaEnTablon {
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  value?: bigint;
}

export function enTablon(functionName: string, args: readonly unknown[], value?: bigint): FirmaEnTablon {
  return { address: TABLON, abi: ABI, functionName, args, ...(value ? { value } : {}) };
}

/**
 * El gas con el que se firma: la estimación más un 10 %. Siempre explícito,
 * porque Monad cobra el límite entero y el nodo lo infla si se le deja
 * rellenarlo (ver `gasDeRetirada` en reservaDeGas.ts, 1,096 MON de lección).
 *
 * Y de paso, el mejor momento para saber si el contrato lo rechazaría: si la
 * estimación revierte, lanza `RechazoDelTablon` con el error por su nombre y
 * no se firma nada.
 */
export async function gasParaTablon(cuenta: Address, f: FirmaEnTablon): Promise<bigint> {
  let estimado: bigint;
  try {
    estimado = await publicClient.estimateContractGas({ ...f, account: cuenta } as never);
  } catch (err) {
    throw rechazoDe(err) ?? err;
  }
  const gas = (estimado * 11n + 9n) / 10n;
  return gas > TOPE_GAS ? TOPE_GAS : gas;
}

/** El contrato dijo que no, con el nombre de su error y, si lo hay, el motivo. */
export class RechazoDelTablon extends Error {
  readonly error: string;
  readonly motivo: string | null;
  constructor(error: string, motivo: string | null) {
    super(motivo ? `${error}: ${motivo}` : error);
    this.name = 'RechazoDelTablon';
    this.error = error;
    this.motivo = motivo;
  }
}

/** Saca el error del contrato de lo que lanza viem, si lo hay. */
export function rechazoDe(err: unknown): RechazoDelTablon | null {
  if (err instanceof RechazoDelTablon) return err;
  if (!(err instanceof BaseError)) return null;
  const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
  if (!(revert instanceof ContractFunctionRevertedError) || !revert.data?.errorName) return null;
  const [primero] = (revert.data.args ?? []) as unknown[];
  return new RechazoDelTablon(revert.data.errorName, typeof primero === 'string' ? primero : null);
}

/**
 * La clave i18n de un motivo de `canTake`/`NotAllowed`. El contrato los da en
 * inglés y en texto («daily quota used»); aquí se convierten en una clave
 * («dailyQuotaUsed») para que cada idioma diga lo suyo.
 */
export function claveDeMotivo(motivo: string): string {
  return motivo
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+(.)/g, (_, c: string) => c.toUpperCase());
}

/* ── firmar y esperar ─────────────────────────────────────────────────── */

/** Lo que firma la wallet: el `writeContractAsync` de wagmi encaja tal cual. */
export type Escribir = (req: {
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  value?: bigint;
  gas: bigint;
  chainId: number;
}) => Promise<Hex>;

/** La tx se minó pero revirtió: gastó gas y no cambió nada. */
export class TxRevertida extends Error {
  readonly hash: Hex;
  constructor(hash: Hex) {
    super(`revertida: ${hash}`);
    this.name = 'TxRevertida';
    this.hash = hash;
  }
}

/**
 * Firma con el gas fijado y espera a que salga bien. Si el contrato lo
 * rechazaría, lanza `RechazoDelTablon` ANTES de pedir la firma.
 */
export async function firmarYEsperar(escribir: Escribir, cuenta: Address, f: FirmaEnTablon): Promise<Hex> {
  const gas = await gasParaTablon(cuenta, f);
  const hash = await escribir({ ...f, gas, chainId: publicClient.chain!.id });
  const recibo = await publicClient.waitForTransactionReceipt({ hash });
  if (recibo.status !== 'success') throw new TxRevertida(hash);
  return hash;
}

const erc20 = [
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const satisfies Abi;

/**
 * En $PANAL, el permiso EXACTO al tablón antes de pagar. Nunca infinito: un
 * fallo del contrato no puede llevarse más de lo que se iba a pagar. Si ya
 * hay permiso suficiente, no pide nada.
 */
export async function permitirPanal(escribir: Escribir, cuenta: Address, importe: bigint): Promise<Hex | null> {
  const token = PANAL_TOKEN_ADDRESS as Address;
  const actual = (await publicClient.readContract({
    address: token,
    abi: erc20,
    functionName: 'allowance',
    args: [cuenta, TABLON],
  })) as bigint;
  if (actual >= importe) return null;
  return firmarYEsperar(escribir, cuenta, { address: token, abi: erc20 as unknown as Abi, functionName: 'approve', args: [TABLON, importe] });
}

/** Entregar en el escrow: el agente ancla el hash de lo que dejó en el buzón. */
export function entregarEnEscrow(taskId: bigint, resultHash: Hex): FirmaEnTablon {
  return {
    address: PANAL_ESCROW_V2_ADDRESS as Address,
    abi: panalEscrowV2Abi as unknown as Abi,
    functionName: 'deliverResult',
    args: [taskId, resultHash],
  };
}
