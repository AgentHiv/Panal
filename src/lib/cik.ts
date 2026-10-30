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
  decodeFunctionResult,
  encodeDeployData,
  encodeFunctionData,
  getAddress,
  keccak256,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { CIK, CI_GUARD_BYTECODE, ciAbi, ciDelegateAbi, ciGuardAbi, ciProbeAbi, ciRiskAbi, ciViewAbi } from '@/contracts/cik';

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
  /** Quién dio `modelClass`: 0 la red, 1 el registro de clones. */
  source: number;
  /** Con la red, la segunda clase; con el registro, la misma. */
  runnerUp: number;
  /** Con la red, logit de la clase menos el de la segunda (ver `vecesMasProbable`); con el registro, 0. */
  margin: bigint;
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
  /** La regla de la sonda sobre su resultado (`CiProbe.honeypot`): `null` si no se pudo leer. */
  sondaHoneypot: boolean | null;
  nombre: string;
  simbolo: string;
  /** El hash que pide `attest(target, clase, evidenceHash)`: protege de un cambio a última hora. */
  evidencia: Hex | null;
  /** Si es un proxy mínimo EIP-1167, su implementación: `Ci` juzga ese código. */
  implementacion: Address | null;
  atestacion: Atestacion | null;
  /** `keyFor`: con ella se retira el stake. */
  clave: Hex | null;
  /**
   * Si la dirección es una cuenta delegada con EIP-7702, lo que dice `CiDelegate`.
   * Entonces no es un token y no pasa por la red de `Ci`: esa red se entrenó con
   * tokens y llamaba «honeypot» a una cuenta delegada a un barredor.
   */
  delegacion: Delegacion | null;
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
  /** El tamaño de cada capa de la red, de la entrada a la salida (256, 384, 192, 4). */
  capas: number[];
  /** Los pesos de la red: entrada × salida de cada capa. */
  pesos: number;
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
  const [modelHash, minStake, challengeBond, challengeWindow, clones, simbolos, minLiquidez, ...forma] = await Promise.all([
    cliente.readContract({ ...ci, functionName: 'MODEL_HASH' }),
    cliente.readContract({ ...ci, functionName: 'minStake' }),
    cliente.readContract({ ...ci, functionName: 'challengeBond' }),
    cliente.readContract({ ...ci, functionName: 'challengeWindow' }),
    cliente.readContract({ ...ci, functionName: 'cloneCount' }),
    cliente.readContract({ ...ci, functionName: 'symbolCount' }),
    cliente.readContract({ address: CIK.risk, abi: ciRiskAbi, functionName: 'minLiquidity' }),
    // La forma de la red la dice el propio `Ci`: entrada y salida de cada capa.
    cliente.readContract({ ...ci, functionName: 'IN0' }),
    cliente.readContract({ ...ci, functionName: 'OUT0' }),
    cliente.readContract({ ...ci, functionName: 'IN1' }),
    cliente.readContract({ ...ci, functionName: 'OUT1' }),
    cliente.readContract({ ...ci, functionName: 'IN2' }),
    cliente.readContract({ ...ci, functionName: 'OUT2' }),
  ]);
  const [in0, out0, in1, out1, in2, out2] = forma.map(Number);
  return {
    modelHash,
    minStake,
    challengeBond,
    challengeWindow: Number(challengeWindow),
    clones: Number(clones),
    simbolos: Number(simbolos),
    minLiquidez,
    capas: [in0, out0, out1, out2],
    pesos: in0 * out0 + in1 * out1 + in2 * out2,
  };
}

/**
 * Cuántas veces más probable ve la red su clase que la segunda. `Ci` escala los
 * logits por 2^S2 = 64 (la temperatura del entrenamiento), así que el margen
 * entre 64 es el logaritmo natural de esa razón: 141 son unas 9 veces.
 */
export function vecesMasProbable(margen: bigint): number {
  return Math.exp(Number(margen) / 64);
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
    sondaHoneypot: null,
    nombre: '',
    simbolo: '',
    evidencia: null,
    implementacion: null,
    atestacion: null,
    clave: null,
    delegacion: null,
  };
  const codigo = await cliente.getCode({ address: direccion });
  if (!codigo || codigo === '0x') return vacio;
  if (esCuentaDelegada(codigo)) {
    return { ...vacio, delegacion: (await intentar(() => delegacionDe(cliente, direccion, codigo))) ?? null };
  }

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
  const sonda = evidencia ? (evidencia[1] as Sonda) : null;
  // La regla la aplica la propia sonda (es `pure`): así es la cadena, y no esta
  // web, la que dice si el resultado de la compra y la venta es un honeypot.
  const sondaHoneypot = sonda
    ? ((await intentar(() =>
        cliente.readContract({ address: CIK.probe, abi: ciProbeAbi, functionName: 'honeypot', args: [sonda] }),
      )) ?? null)
    : null;
  // El orden de `Ci._truth`: primero la sonda; si no ve un honeypot, el registro
  // de clones y, si el código no está en él, el modelo. La clase del informe es
  // esa misma de registro + modelo, así que dice cuál de los dos contestó. Que
  // el modelo diga también honeypot no cambia nada: la sonda va antes.
  const fuente: Fuente | null =
    clase === undefined || !inf
      ? null
      : sondaHoneypot || clase !== inf.modelClass
        ? 'sonda'
        : inf.cloneHit
          ? 'registro'
          : 'modelo';

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
    sonda,
    sondaHoneypot,
    nombre,
    simbolo,
    evidencia: evidencia ? evidencia[2] : null,
    implementacion: implementacion1167(codigo),
    delegacion: null,
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

/* ------------------------------------------------------------------ datos del token */

const DEAD: Address = '0x000000000000000000000000000000000000dEaD';

/** El PoolManager de Uniswap V4 en Monad: el mismo que mira la sonda (`CiProbe.poolManager`). */
export const POOL_MANAGER_V4: Address = '0x188d586Ddcf52439676Ca21A244753fA19F9Ea8e';

const ABI_TOKEN = parseAbi([
  'function totalSupply() view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function owner() view returns (address)',
]);
const ABI_RIESGO = parseAbi([
  'function pairOf(address) view returns (address)',
  'function v3PoolsOf(address) view returns (address[4])',
]);
const riesgo = { address: CIK.risk, abi: ciRiskAbi } as const;
const ABI_PAR = parseAbi([
  'function getReserves() view returns (uint112, uint112, uint32)',
  'function token0() view returns (address)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
]);
const ABI_POOL_V3 = parseAbi(['function fee() view returns (uint24)']);

/** Un mercado donde el token tiene liquidez, con lo que guarda. */
export interface Mercado {
  tipo: 'v2' | 'v3' | 'v4' | 'nadfun';
  direccion: Address;
  /** Comisión de un pool V3, en centésimas de punto básico (3000 = 0,3 %). */
  comision?: number;
  /** WMON (o MON) que hay en el mercado: la profundidad. `null` si no se puede saber de ese mercado. */
  wmon: bigint | null;
  /** Del token, cuánto guarda el mercado. */
  tokens: bigint;
  /** Solo el par V2: del LP, la parte en 0x0 y 0xdead. */
  lpQuemadoBps?: number;
}

export interface DatosToken {
  supply: bigint | null;
  decimales: number | null;
  /** `owner()`: una cuenta, renunciado (0x0 o 0xdead), o el contrato no tiene esa función. */
  dueno: { tipo: 'cuenta'; direccion: Address } | { tipo: 'renunciado' } | { tipo: 'sin' };
  bytes: number;
  codehash: Hex;
  /** ¿Está su código fuente publicado y verificado en Sourcify? `null` si no se pudo preguntar. */
  verificado: boolean | null;
  mercados: Mercado[];
  /** Dónde está el supply, por quién lo tiene. `null` sin supply. */
  reparto: { mercados: bigint; dueno: bigint; quemado: bigint; contrato: bigint; resto: bigint } | null;
  /** Las 256 features que lee el modelo para este contrato (`Ci.featuresOf`). */
  features: number[];
}

/**
 * Todo lo exacto que se puede leer de un token, para enseñar los números de
 * los que sale el veredicto y el riesgo: supply, dueño, código, mercados con lo
 * que guarda cada uno y dónde está el supply. Todo de la cadena, salvo una cosa
 * que la cadena no puede decir y se pide fuera, con su nombre: si el código
 * está verificado (Sourcify).
 */
export async function datosDelToken(cliente: PublicClient, direccion: Address): Promise<DatosToken> {
  const tk = { address: direccion, abi: ABI_TOKEN } as const;
  const saldo = (a: Address) => intentar(() => cliente.readContract({ ...tk, functionName: 'balanceOf', args: [a] }));

  const [codigo, supply, decimales, dueno, par, poolsV3, featuresHex, verificado, curva, enCurva] = await Promise.all([
    cliente.getCode({ address: direccion }),
    intentar(() => cliente.readContract({ ...tk, functionName: 'totalSupply' })),
    intentar(() => cliente.readContract({ ...tk, functionName: 'decimals' })),
    intentar(() => cliente.readContract({ ...tk, functionName: 'owner' })),
    intentar(() => cliente.readContract({ address: CIK.risk, abi: ABI_RIESGO, functionName: 'pairOf', args: [direccion] })),
    intentar(() => cliente.readContract({ address: CIK.risk, abi: ABI_RIESGO, functionName: 'v3PoolsOf', args: [direccion] })),
    intentar(() => cliente.readContract({ address: CIK.ci, abi: ciAbi, functionName: 'featuresOf', args: [direccion] })),
    enSourcify(direccion),
    intentar(() => cliente.readContract({ ...riesgo, functionName: 'nadfunCurve' })),
    intentar(() => cliente.readContract({ ...riesgo, functionName: 'nadfunLiquidity', args: [direccion] })),
  ]);

  // Los mercados: el par V2, los pools V3 de cada comisión, el PoolManager de V4
  // y la curva de nad.fun. De cada uno, cuánto token y cuánto WMON guarda. El MON
  // de la curva es el real que da `CiRisk` (la reserva virtual menos la inicial,
  // la que suma a la liquidez del riesgo), no la reserva virtual que da la API.
  const mercados: Mercado[] = [];
  if (par && par !== CERO) {
    const p = { address: par, abi: ABI_PAR } as const;
    const [reservas, token0, lpTotal, lpMuerto, lpCero, tokens] = await Promise.all([
      cliente.readContract({ ...p, functionName: 'getReserves' }),
      cliente.readContract({ ...p, functionName: 'token0' }),
      cliente.readContract({ ...p, functionName: 'totalSupply' }),
      cliente.readContract({ ...p, functionName: 'balanceOf', args: [DEAD] }),
      cliente.readContract({ ...p, functionName: 'balanceOf', args: [CERO] }),
      saldo(par),
    ]);
    const esToken0 = getAddress(token0) === getAddress(direccion);
    mercados.push({
      tipo: 'v2',
      direccion: par,
      wmon: esToken0 ? reservas[1] : reservas[0],
      tokens: tokens ?? (esToken0 ? reservas[0] : reservas[1]),
      lpQuemadoBps: lpTotal > 0n ? Number(((lpMuerto + lpCero) * 10_000n) / lpTotal) : 0,
    });
  }
  for (const pool of poolsV3 ?? []) {
    if (pool === CERO) continue;
    const [comision, wmon, tokens] = await Promise.all([
      intentar(() => cliente.readContract({ address: pool, abi: ABI_POOL_V3, functionName: 'fee' })),
      intentar(() => cliente.readContract({ address: WMON, abi: ABI_TOKEN, functionName: 'balanceOf', args: [pool] })),
      saldo(pool),
    ]);
    mercados.push({ tipo: 'v3', direccion: pool, comision, wmon: wmon ?? null, tokens: tokens ?? 0n });
  }
  const enV4 = await saldo(POOL_MANAGER_V4);
  // El PoolManager guarda los saldos de todos sus pools juntos: se sabe cuánto
  // token tiene, no cuánto WMON hay emparejado con él.
  if (enV4 && enV4 > 0n) mercados.push({ tipo: 'v4', direccion: POOL_MANAGER_V4, wmon: null, tokens: enV4 });
  // Una sola curva guarda lo que queda por vender de todos sus tokens, y también
  // WMON y lo que le manden: que tenga saldo no hace de ella un mercado del token.
  // Lo es si `CiRisk` le ve MON real, que solo cuenta la curva de este token.
  if (curva && curva !== CERO && enCurva && enCurva > 0n) {
    const tokens = await saldo(curva);
    mercados.push({ tipo: 'nadfun', direccion: curva, wmon: enCurva, tokens: tokens ?? 0n });
  }

  // Dónde está el supply. El dueño solo cuenta si es una cuenta de verdad, y lo
  // que no es de nadie conocido queda en «resto»: la cadena no deja listar holders.
  const tipoDueno: DatosToken['dueno'] =
    dueno === undefined
      ? { tipo: 'sin' }
      : getAddress(dueno) === CERO || getAddress(dueno) === getAddress(DEAD)
        ? { tipo: 'renunciado' }
        : { tipo: 'cuenta', direccion: dueno };
  const [muerto, cero, propio, delDueno] = await Promise.all([
    saldo(DEAD),
    saldo(CERO),
    saldo(direccion),
    tipoDueno.tipo === 'cuenta' && getAddress(tipoDueno.direccion) !== getAddress(direccion)
      ? saldo(tipoDueno.direccion)
      : Promise.resolve(0n),
  ]);
  let reparto: DatosToken['reparto'] = null;
  if (supply && supply > 0n) {
    const enMercados = mercados.reduce((s, m) => s + m.tokens, 0n);
    const quemado = (muerto ?? 0n) + (cero ?? 0n);
    const conocido = enMercados + quemado + (propio ?? 0n) + (delDueno ?? 0n);
    reparto = {
      mercados: enMercados,
      dueno: delDueno ?? 0n,
      quemado,
      contrato: propio ?? 0n,
      resto: supply > conocido ? supply - conocido : 0n,
    };
  }

  const features: number[] = [];
  if (featuresHex) for (let i = 2; i < featuresHex.length; i += 2) features.push(parseInt(featuresHex.slice(i, i + 2), 16));

  return {
    supply: supply ?? null,
    decimales: decimales ?? null,
    dueno: tipoDueno,
    bytes: codigo ? (codigo.length - 2) / 2 : 0,
    codehash: keccak256(codigo ?? '0x'),
    verificado,
    mercados,
    reparto,
    features,
  };
}

/** ¿Tiene el contrato su código verificado en Sourcify? 200 sí, 404 no; otra cosa, no se sabe. */
async function enSourcify(direccion: Address): Promise<boolean | null> {
  try {
    const r = await fetch(`https://sourcify.dev/server/v2/contract/143/${direccion}`, { signal: AbortSignal.timeout(8_000) });
    return r.status === 200 ? true : r.status === 404 ? false : null;
  } catch {
    return null;
  }
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
  /** Rechazar un proxy actualizable (11): su código puede cambiar después de mirarlo. */
  blockUpgradeable: boolean;
  /** Margen mínimo cuando la red dice ok (12); 0 = no se exige. No se aplica al registro. */
  minOkMargin: bigint;
}

/** Más o menos lo que pondría un DEX prudente: la política con la que abre la página. */
export const POLITICA_INICIAL: Politica = {
  maxRiskLevel: 2,
  minLiquidity: 0n,
  maxTop1Bps: 10_000,
  maxTop10Bps: 10_000,
  blockSuspicious: true,
  blockSymbolScam: true,
  blockUpgradeable: false,
  minOkMargin: 0n,
};

export interface ResultadoGuard {
  pasa: boolean;
  /** 0 si pasa; si no, el código de `Unsafe(reason)`: 1..12. */
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
      politica.blockUpgradeable,
      politica.minOkMargin,
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
  { bit: 256, clave: 'proxy', puntos: 10 },
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

/**
 * Nodos públicos de Monad a los que se puede preguntar desde el navegador
 * (dejan llamadas de otras webs y no recortan el gas de un `eth_call`, que
 * `check` necesita: ~6 M). Distintos del que usa la web, y de operadores
 * distintos entre sí, para que comprobar no sea preguntarle otra vez a lo mismo.
 * Probados el 2026-10-22, con varias llamadas seguidas. No valen: drpc (corta
 * el gas), thirdweb (sin clave de cliente responde 429), Tatum (eth_call solo
 * de pago) y los de BlockPI y Alchemy (piden clave).
 */
export const NODOS = [
  { nombre: 'Monad Foundation', url: 'https://rpc-mainnet.monadinfra.com' },
  { nombre: 'Ankr', url: 'https://rpc.ankr.com/monad_mainnet' },
  { nombre: 'Sentio', url: 'https://rpc.sentio.xyz/monad-mainnet' },
] as const;

/** Lo que respondió un nodo a `Ci.check(direccion)`, con la petición tal cual se mandó. */
export interface RespuestaNodo {
  /** El cuerpo JSON-RPC exacto: se puede copiar y mandar a cualquier otro nodo. */
  peticion: string;
  /** El `result` en crudo, sin decodificar. */
  resultado: Hex;
  clase: number;
  ms: number;
}

/**
 * Pregunta `Ci.check(direccion)` a un nodo concreto, con un `fetch` directo y
 * sin cliente de por medio: el navegador habla con ese nodo, no con Panal. Se
 * enseña la petición y la respuesta en crudo para que quien desconfíe de esta
 * página pueda repetirla en otro sitio.
 */
export async function checkEnNodo(url: string, direccion: Address): Promise<RespuestaNodo> {
  const data = encodeFunctionData({ abi: ciAbi, functionName: 'check', args: [direccion] });
  const peticion = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_call',
    params: [{ to: CIK.ci, data }, 'latest'],
  });
  const t0 = performance.now();
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: peticion,
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await r.json()) as { result?: Hex; error?: { message?: string } };
  if (!j.result) throw new Error(j.error?.message ?? `HTTP ${r.status}`);
  const clase = decodeFunctionResult({ abi: ciAbi, functionName: 'check', data: j.result });
  return { peticion, resultado: j.result, clase, ms: Math.round(performance.now() - t0) };
}

/** «0x12ab…cdef», o la dirección entera si es corta. */
export function corta(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

/* ── delegaciones EIP-7702: CiDelegate ──────────────────────────────────── */

/**
 * Lo que dice `CiDelegate` de una dirección.
 *
 * Con EIP-7702 una cuenta normal ejecuta el código de otro contrato (el
 * delegado), que puede llevarse todo lo que tiene sin pedir un solo permiso.
 * `CiDelegate` juzga ese código con reglas fijas, no con la red de `Ci`.
 */
export interface Delegacion {
  /**
   * `cuenta`: una cuenta ya delegada, y se juzga su delegado. `delegado`: un
   * contrato, y se juzga qué pasaría si una cuenta se delegara en él.
   * `ninguna`: una cuenta sin delegación, que no ejecuta el código de nadie.
   */
  tipo: 'cuenta' | 'delegado' | 'ninguna';
  delegado: Address | null;
  /** Índice de `VEREDICTOS_DELEGACION`. */
  veredicto: number;
  banderas: number;
  tamano: number;
}

export const VEREDICTOS_DELEGACION = ['ninguna', 'conocido', 'desconocido', 'barredor'] as const;

/** Las banderas de `CiDelegate`, con su bit. La clave es la de los textos de la página. */
export const BANDERAS_DELEGACION = [
  { bit: 1, clave: 'firma' },
  { bit: 2, clave: 'userop' },
  { bit: 4, clave: 'call' },
  { bit: 8, clave: 'delegatecall' },
  { bit: 16, clave: 'selfdestruct' },
  { bit: 32, clave: 'create' },
  { bit: 64, clave: 'saldo' },
  { bit: 128, clave: 'tokens' },
  { bit: 256, clave: 'origin' },
  { bit: 512, clave: 'sinCodigo' },
  { bit: 1024, clave: 'cadena' },
  { bit: 2048, clave: 'grande' },
] as const;

/** Los delegados que `CiDelegate` da por conocidos: la lista fija de su despliegue. */
export const DELEGADOS_CONOCIDOS: Record<string, string> = {
  '0x63c0c19a282a1b52b07dd5a65b58948a07dae32b': 'MetaMask (EIP7702StatelessDeleGator)',
  '0x000000009b1d0af20d8c6d0a44e162d11f9b8f00': 'Uniswap Calibur',
  '0x5a7fc11397e9a8ad41bf10bf13f22b0a63f96f6d': 'Ambire',
  '0x7702cb554e6bfb442cb743a7df23154544a7176c': 'Coinbase (EIP7702Proxy)',
  '0x4cd241e8d1510e30b2076397afc7508ae59c66c9': 'Simple7702Account (ERC-4337 v0.8)',
  '0x69007702764179f14f51cdce752f4f775d74e139': 'Alchemy Modular Account v2',
};

/** `0xef0100` + una dirección (23 bytes): el código de una cuenta delegada con EIP-7702. */
export function esCuentaDelegada(codigo: Hex | undefined): boolean {
  return !!codigo && codigo.length === 48 && codigo.toLowerCase().startsWith('0xef0100');
}

/**
 * A quién está delegada una cuenta, o qué pasaría si una cuenta se delegara en
 * este contrato. Por `eth_call`: gratis, y ahí `CiDelegate` recorre el código
 * entero (el tope de 24 KB es solo para quien lo llama dentro de una transacción).
 */
export async function delegacionDe(cliente: PublicClient, direccion: Address, codigo?: Hex): Promise<Delegacion> {
  const c = codigo ?? (await cliente.getCode({ address: direccion }));
  if (!c || c === '0x') return { tipo: 'ninguna', delegado: null, veredicto: 0, banderas: 0, tamano: 0 };
  const cuenta = esCuentaDelegada(c);
  const r = await cliente.readContract({
    address: CIK.delegate,
    abi: ciDelegateAbi,
    functionName: cuenta ? 'inspectAccount' : 'inspectDelegate',
    args: [direccion],
  });
  return {
    tipo: cuenta ? 'cuenta' : 'delegado',
    delegado: r.delegate === CERO ? null : r.delegate,
    veredicto: r.verdict,
    banderas: r.flags,
    tamano: r.codeSize,
  };
}
