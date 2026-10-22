/**
 * cik desde la web: todo lo que se puede preguntar a sus contratos sin firmar
 * nada, más lo que hace falta para atestiguar, retar y retirar.
 *
 * Todo sale de la cadena por `eth_call`, gratis. Aquí no se calcula ningún
 * veredicto: se le pregunta a `Ci`, a `CiView` y a `CiGuardV2`, y lo único que
 * se hace en TypeScript es repartir el número de riesgo en sus sumandos, con
 * las mismas reglas que `CiRisk._score`, para poder decir de dónde sale.
 *
 * Las funciones reciben el cliente en vez de importarlo: así se prueban contra
 * la cadena con un cliente de viem cualquiera, sin wagmi.
 */

import {
  BaseError,
  decodeErrorResult,
  encodeDeployData,
  encodeFunctionData,
  getAddress,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { CIK, CI_GUARD_BYTECODE, ciAbi, ciGuardAbi, ciRiskAbi, ciViewAbi } from '@/contracts/cik';

/** El token base de los mercados que mira la sonda (WMON): no tiene par consigo mismo. */
export const WMON: Address = '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A';

const CERO: Address = '0x0000000000000000000000000000000000000000';

const ABI_ERC20 = parseAbi(['function name() view returns (string)', 'function symbol() view returns (string)']);

/** 0 ok, 1 drainer, 2 honeypot, 3 sospechoso: el orden de `Ci`. */
export const CLASES = ['ok', 'drainer', 'honeypot', 'sospechoso'] as const;
export type NombreClase = (typeof CLASES)[number];

/** 0 bajo, 1 medio, 2 alto, 3 crítico: el orden de `CiRisk`. */
export const NIVELES = ['bajo', 'medio', 'alto', 'critico'] as const;

/** Lo que devuelve `CiView.inspect`. */
export interface Informe {
  modelClass: number;
  cloneHit: boolean;
  cloneClass: number;
  hasSymbol: boolean;
  scamWord: boolean;
  nonAscii: boolean;
  othersWithSymbol: number;
  symbolLenScaled: number;
  nameLenScaled: number;
  symbolScam: boolean;
  liquidity: bigint;
  top1Bps: bigint;
  top10Bps: bigint;
  lpBurnedBps: bigint;
  riskScore: number;
  riskLevel: number;
  riskFlags: number;
  modelHash: Hex;
}

/** La prueba de compra y venta de `CiProbe`, tal como la devuelve `evidenceOf`. */
export interface Sonda {
  hasPair: boolean;
  bought: boolean;
  sold: boolean;
  movable: boolean;
  buyKeptBps: number;
  sellKeptBps: number;
  /** 0 sin mercado, 1 V2, 2 V3, 3 V4. */
  venue: number;
}

/** Un veredicto atestiguado con stake. */
export interface Atestacion {
  attestor: Address;
  postedAt: number;
  stake: bigint;
  classId: number;
  challenged: boolean;
  /** Pasó la ventana de reto o ya fue retado: el attestor puede retirar. */
  final: boolean;
}

/** De dónde sale la clase de `Ci.check`. */
export type Fuente = 'sonda' | 'registro' | 'modelo';

export interface Analisis {
  direccion: Address;
  /** Sin código no hay nada que analizar: una wallet, o un contrato destruido. */
  esContrato: boolean;
  /** `Ci.check`: sonda + registro de clones + modelo. `null` si no respondió. */
  clase: number | null;
  fuente: Fuente | null;
  informe: Informe | null;
  sonda: Sonda | null;
  nombre: string;
  simbolo: string;
  /** El hash que pide `attest(target, clase, evidenceHash)`: protege de un cambio a última hora. */
  evidencia: Hex | null;
  /** Si es un proxy mínimo EIP-1167, su implementación: `Ci` juzga ese código. */
  implementacion: Address | null;
  atestacion: Atestacion | null;
  /** `keyFor`: con ella se retira el stake. */
  clave: Hex | null;
}

/** Los parámetros fijos de este `Ci`: no cambian nunca, se leen una vez. */
export interface Parametros {
  modelHash: Hex;
  minStake: bigint;
  challengeBond: bigint;
  challengeWindow: number;
  clones: number;
  simbolos: number;
  minLiquidez: bigint;
}

/** La implementación de un proxy mínimo EIP-1167, o `null`. Misma regla que `Ci.codeOf`. */
export function implementacion1167(codigo: Hex | undefined): Address | null {
  if (!codigo) return null;
  const c = codigo.toLowerCase();
  if (c.length !== 92 || !c.startsWith('0x363d3d373d3d3d363d73') || !c.endsWith('5af43d82803e903d91602b57fd5bf3')) {
    return null;
  }
  return getAddress(`0x${c.slice(22, 62)}`);
}

/** Lo que escribe un contrato ajeno y acaba en pantalla: sin control ni marcas de dirección. */
function limpio(texto: string): string {
  // eslint-disable-next-line no-control-regex
  return texto.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim();
}

/** `bytes32` + longitud, como guarda `Ci` el nombre y el símbolo. */
function deBytes32(b: Hex, largo: number): string {
  const bytes = new Uint8Array((b.length - 2) / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(b.slice(2 + i * 2, 4 + i * 2), 16);
  return limpio(new TextDecoder().decode(bytes.subarray(0, Math.min(largo, 32))));
}

/** Undefined si la llamada falla: un informe a medias es mejor que ninguno. */
async function intentar<T>(f: () => Promise<T>): Promise<T | undefined> {
  try {
    return await f();
  } catch {
    return undefined;
  }
}

export async function leerParametros(cliente: PublicClient): Promise<Parametros> {
  const ci = { address: CIK.ci, abi: ciAbi } as const;
  const [modelHash, minStake, challengeBond, challengeWindow, clones, simbolos, minLiquidez] = await Promise.all([
    cliente.readContract({ ...ci, functionName: 'MODEL_HASH' }),
    cliente.readContract({ ...ci, functionName: 'minStake' }),
    cliente.readContract({ ...ci, functionName: 'challengeBond' }),
    cliente.readContract({ ...ci, functionName: 'challengeWindow' }),
    cliente.readContract({ ...ci, functionName: 'cloneCount' }),
    cliente.readContract({ ...ci, functionName: 'symbolCount' }),
    cliente.readContract({ address: CIK.risk, abi: ciRiskAbi, functionName: 'minLiquidity' }),
  ]);
  return {
    modelHash,
    minStake,
    challengeBond,
    challengeWindow: Number(challengeWindow),
    clones: Number(clones),
    simbolos: Number(simbolos),
    minLiquidez,
  };
}

/**
 * Todo lo que cik sabe de una dirección, en una tanda de lecturas en paralelo.
 * `check` y `evidenceOf` no son view (la sonda hace un préstamo que siempre
 * revierte), pero no cambian nada: se leen por `eth_call` como las demás.
 */
export async function analizar(cliente: PublicClient, direccion: Address): Promise<Analisis> {
  const vacio: Analisis = {
    direccion,
    esContrato: false,
    clase: null,
    fuente: null,
    informe: null,
    sonda: null,
    nombre: '',
    simbolo: '',
    evidencia: null,
    implementacion: null,
    atestacion: null,
    clave: null,
  };
  const codigo = await cliente.getCode({ address: direccion });
  if (!codigo || codigo === '0x') return vacio;

  const ci = { address: CIK.ci, abi: ciAbi } as const;
  const [clase, evidencia, informe, voto, final, clave] = await Promise.all([
    intentar(() => cliente.readContract({ ...ci, functionName: 'check', args: [direccion] })),
    intentar(() => cliente.readContract({ ...ci, functionName: 'evidenceOf', args: [direccion] })),
    intentar(() =>
      cliente.readContract({ address: CIK.view, abi: ciViewAbi, functionName: 'inspect', args: [direccion, CERO] }),
    ),
    intentar(() => cliente.readContract({ ...ci, functionName: 'getVerdict', args: [direccion] })),
    intentar(() => cliente.readContract({ ...ci, functionName: 'isFinal', args: [direccion] })),
    intentar(() => cliente.readContract({ ...ci, functionName: 'keyFor', args: [direccion] })),
  ]);

  const inf = informe as Informe | undefined;
  // La verdad de `Ci`: honeypot si la sonda lo vio; si no, registro + modelo,
  // que es justo la clase del informe. Si no coinciden, decidió la sonda.
  const fuente: Fuente | null =
    clase === undefined || !inf ? null : clase !== inf.modelClass ? 'sonda' : inf.cloneHit ? 'registro' : 'modelo';

  let nombre = evidencia ? deBytes32(evidencia[0].name, evidencia[0].nameLen) : '';
  let simbolo = evidencia ? deBytes32(evidencia[0].symbol, evidencia[0].symLen) : '';
  // `Ci` lee el nombre con un tope de gas (META_GAS) y un proxy actualizable
  // como el de USDC no llega: para el modelo no tiene nombre. Para enseñarlo se
  // le pregunta al token sin tope; el veredicto no cambia.
  const erc20 = { address: direccion, abi: ABI_ERC20 } as const;
  if (!nombre) nombre = limpio((await intentar(() => cliente.readContract({ ...erc20, functionName: 'name' }))) ?? '');
  if (!simbolo) simbolo = limpio((await intentar(() => cliente.readContract({ ...erc20, functionName: 'symbol' }))) ?? '');
  nombre = nombre.slice(0, 40);
  simbolo = simbolo.slice(0, 20);

  return {
    direccion,
    esContrato: true,
    clase: clase ?? null,
    fuente,
    informe: inf ?? null,
    sonda: evidencia ? (evidencia[1] as Sonda) : null,
    nombre,
    simbolo,
    evidencia: evidencia ? evidencia[2] : null,
    implementacion: implementacion1167(codigo),
    atestacion:
      voto && voto[5]
        ? {
            attestor: voto[0],
            postedAt: Number(voto[1]),
            stake: voto[2],
            classId: voto[3],
            challenged: voto[4],
            final: final === true,
          }
        : null,
    clave: clave ?? null,
  };
}

/** Lo que dice cik de un bytecode suelto, sin desplegarlo. */
export interface AnalisisCodigo {
  /** `verifyCode`: registro + modelo (si es un proxy EIP-1167, sobre su implementación). */
  clase: number;
  /** `infer` sobre las mismas features: solo el modelo, sin el registro. */
  soloModelo: number;
  /** Las 256 features (0..127) de `extractFeatures`, sobre los bytes tal cual. */
  features: number[];
  /** El vector ya estaba etiquetado en el registro de clones. */
  enRegistro: boolean;
}

export async function analizarCodigo(cliente: PublicClient, codigo: Hex): Promise<AnalisisCodigo> {
  const ci = { address: CIK.ci, abi: ciAbi } as const;
  const [clase, f] = await Promise.all([
    cliente.readContract({ ...ci, functionName: 'verifyCode', args: [codigo] }),
    cliente.readContract({ ...ci, functionName: 'extractFeatures', args: [codigo] }),
  ]);
  const [soloModelo, [enRegistro]] = await Promise.all([
    cliente.readContract({ ...ci, functionName: 'infer', args: [f] }),
    cliente.readContract({ ...ci, functionName: 'lookup', args: [f] }),
  ]);
  const features: number[] = [];
  for (let i = 2; i < f.length; i += 2) features.push(parseInt(f.slice(i, i + 2), 16));
  return { clase, soloModelo, features, enRegistro };
}

/** Los umbrales de un `CiGuardV2`. Se fijan al desplegarlo y no cambian. */
export interface Politica {
  /** 0 bajo … 3 crítico: por encima, rechazo 5. */
  maxRiskLevel: number;
  /** En wei de MON: por debajo, rechazo 6. */
  minLiquidity: bigint;
  /** Puntos básicos del supply: por encima, rechazos 7 y 8. */
  maxTop1Bps: number;
  maxTop10Bps: number;
  /** Rechazar lo que el modelo llama sospechoso (3) y los clones sospechosos (4). */
  blockSuspicious: boolean;
  /** Rechazar una palabra de estafa en el nombre o el símbolo (9). */
  blockSymbolScam: boolean;
}

/** Más o menos lo que pondría un DEX prudente: la política con la que abre la página. */
export const POLITICA_INICIAL: Politica = {
  maxRiskLevel: 2,
  minLiquidity: 0n,
  maxTop1Bps: 10_000,
  maxTop10Bps: 10_000,
  blockSuspicious: true,
  blockSymbolScam: true,
};

export interface ResultadoGuard {
  pasa: boolean;
  /** 0 si pasa; si no, el código de `Unsafe(reason)`: 1..10. */
  motivo: number;
}

/**
 * Ejecuta `CiGuardV2` de verdad, sin desplegarlo: el bytecode de creación con
 * la política como argumentos del constructor, en un `eth_call`. Con `sonda`,
 * `requireSafeWithProbe`, que además hace la prueba de compra y venta.
 */
export async function probarPolitica(
  cliente: PublicClient,
  politica: Politica,
  token: Address,
  holders: Address[],
  sonda: boolean,
): Promise<ResultadoGuard> {
  const code = encodeDeployData({
    abi: ciGuardAbi,
    bytecode: CI_GUARD_BYTECODE,
    args: [
      CIK.view,
      politica.maxRiskLevel,
      politica.minLiquidity,
      BigInt(politica.maxTop1Bps),
      BigInt(politica.maxTop10Bps),
      politica.blockSuspicious,
      politica.blockSymbolScam,
    ],
  });
  if (!sonda) {
    const [pasa, motivo] = await cliente.readContract({
      abi: ciGuardAbi,
      code,
      functionName: 'check',
      args: [token, CERO, holders],
    });
    return { pasa, motivo };
  }
  try {
    await cliente.call({
      code,
      data: encodeFunctionData({ abi: ciGuardAbi, functionName: 'requireSafeWithProbe', args: [token, CERO, holders] }),
    });
    return { pasa: true, motivo: 0 };
  } catch (err) {
    const motivo = motivoUnsafe(err);
    if (motivo === null) throw err;
    return { pasa: false, motivo };
  }
}

/** El código de `Unsafe(reason)` dentro de un revert, o `null` si el revert es otra cosa. */
function motivoUnsafe(err: unknown): number | null {
  if (!(err instanceof BaseError)) return null;
  const conDatos = err.walk((e) => typeof (e as { data?: unknown }).data === 'string') as { data?: Hex } | null;
  if (!conDatos?.data) return null;
  try {
    const d = decodeErrorResult({ abi: ciGuardAbi, data: conDatos.data });
    return d.errorName === 'Unsafe' ? Number(d.args[0]) : null;
  } catch {
    return null;
  }
}

/** Un sumando del número de riesgo: qué es y cuántos puntos pone. */
export interface Motivo {
  clave: string;
  puntos: number;
}

/** Los privilegios que `CiRisk` busca en el código, por su bit, y lo que suman. */
export const PERMISOS = [
  { bit: 1, clave: 'mint', puntos: 5 },
  { bit: 2, clave: 'pause', puntos: 5 },
  { bit: 4, clave: 'blacklist', puntos: 10 },
  { bit: 8, clave: 'owner', puntos: 5 },
  { bit: 16, clave: 'transferOwnership', puntos: 5 },
  { bit: 32, clave: 'upgradeTo', puntos: 10 },
  { bit: 64, clave: 'delegatecall', puntos: 10 },
  { bit: 128, clave: 'selfdestruct', puntos: 20 },
] as const;

/**
 * De dónde sale el número de riesgo: las mismas sumas que `CiRisk._score`. Si
 * el informe no cuadra con la suma, la suma está mal aquí, no en la cadena.
 */
export function motivosDeRiesgo(inf: Informe, minLiquidez: bigint, direccion: Address): Motivo[] {
  const m: Motivo[] = [];
  const clase = [0, 50, 70, 25][inf.modelClass] ?? 0;
  if (clase) m.push({ clave: `clase.${CLASES[inf.modelClass]}`, puntos: clase });
  const base = getAddress(direccion) === WMON;
  if (inf.liquidity === 0n) m.push({ clave: base ? 'base' : 'sinLiquidez', puntos: 40 });
  else if (inf.liquidity < minLiquidez) m.push({ clave: 'pocaLiquidez', puntos: 25 });
  else if (inf.liquidity < minLiquidez * 5n) m.push({ clave: 'liquidezJusta', puntos: 10 });
  if (inf.top1Bps > 3000n) m.push({ clave: 'top1', puntos: 15 });
  if (inf.top10Bps > 6000n) m.push({ clave: 'top10', puntos: 15 });
  if (inf.lpBurnedBps < 5000n) m.push({ clave: 'lp', puntos: 10 });
  for (const p of PERMISOS) if (inf.riskFlags & p.bit) m.push({ clave: `permiso.${p.clave}`, puntos: p.puntos });
  return m;
}

/** «0x12ab…cdef», o la dirección entera si es corta. */
export function corta(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}
