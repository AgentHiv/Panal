/**
 * Panal — cuánto vale en dólares lo que se paga en MON o en $PANAL.
 * ───────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTÁ AQUÍ
 * Nadie piensa en MON ni en $PANAL. Quien contrata quiere saber cuánto paga, y
 * un agente si el encargo le cubre lo que le cuesta: un vídeo que cuesta $1-2
 * de generar no se puede hacer por 100.000 $PANAL si eso son $0,60. Ver
 * contracts/BOARD.md §11.
 *
 * SOLO FUERA DE LA CADENA. Los contratos no leen ningún precio y las cantidades
 * on-chain siguen en MON o $PANAL: lo que se bloquea es lo que cobra el agente,
 * se mueva el precio o no. Los dólares son para enseñar y para decidir.
 *
 * DE DÓNDE SALE CADA PRECIO
 *
 *   MON → USD    Pyth en Monad, EN LA CADENA (`getPriceUnsafe`), con su
 *                `publishTime`. Si no responde o está viejo, CoinGecko.
 *   $PANAL → MON La curva de nad.fun, EN LA CADENA (`getAmountOut` del
 *                mercado de $PANAL). Si no responde, la API de nad.fun.
 *   $PANAL → USD Lo anterior multiplicado.
 *
 * En la cadena primero: es el mismo RPC que ya usan la web, la app y los
 * agentes, y no necesita claves. La API de nad.fun solo deja entrar a
 * panal.lat, así que para la app y los agentes es un respaldo que puede fallar
 * por CORS; desde Node no hay CORS.
 *
 * DOS PRECIOS DE $PANAL
 *   - El de MERCADO, el que se enseña: el punto medio entre comprar y vender
 *     una cantidad pequeña. Coincide con el que enseña nad.fun.
 *   - El de VENTA (`valorDeVenta`): lo que daría vender ESA cantidad, con la
 *     comisión de la curva y el impacto en el precio. Para un agente es el
 *     honrado, porque es lo que cobraría de verdad.
 *
 * NUNCA UN NÚMERO VIEJO SIN DECIRLO. Cada precio lleva cuándo se publicó, y
 * `enDolares` no devuelve nada si tiene más de cinco minutos.
 */

import { formatUnits, parseEther, type Address, type Hex, type PublicClient } from 'viem';

/** Pyth en Monad mainnet (contrato «pull»: alguien publica y queda guardado). */
export const PYTH_MONAD: Address = '0x2880aB155794e7179c9eE2e38200202908C17B43';
/** El feed `Crypto.MON/USD` de Pyth. */
export const PYTH_MON_USD: Hex = '0x31491744e2dbf6df7fcf4ac0820d18a609b49076d45066d3568424e62f686cd1';
/**
 * El mercado de $PANAL en la curva V2 de nad.fun. Si $PANAL se gradúa a un
 * pool, `getAmountOut` deja de responder aquí y se usa la API, que sigue al
 * token donde esté.
 */
export const MERCADO_PANAL: Address = '0x9f3832732923252A21044F21eE6bd87F09514ae4';
/** $PANAL en Monad mainnet. */
export const PANAL_TOKEN_MAINNET: Address = '0x2e2e44e7fa6178822d4397299f719e89d1a67777';

/** Pasado esto, un precio no se enseña (BOARD.md §14, decisión 11). */
export const PRECIO_MAX_EDAD_S = 5 * 60;

const COINGECKO_MON =
  'https://api.coingecko.com/api/v3/simple/price?ids=monad&vs_currencies=usd&include_last_updated_at=true';
const NADFUN_MERCADO = 'https://api.nad.fun/agent/market/';

const pythAbi = [
  {
    type: 'function',
    name: 'getPriceUnsafe',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'price', type: 'int64' },
          { name: 'conf', type: 'uint64' },
          { name: 'expo', type: 'int32' },
          { name: 'publishTime', type: 'uint256' },
        ],
      },
    ],
  },
] as const;

const curvaAbi = [
  {
    type: 'function',
    name: 'getAmountOut',
    stateMutability: 'view',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'isBuy', type: 'bool' },
    ],
    outputs: [{ type: 'uint256' }],
  },
] as const;

export type FuentePrecio = 'pyth' | 'coingecko' | 'nadfun-curva' | 'nadfun-api';

/** Un precio con su fecha: unix en segundos de cuando se publicó. */
export interface Precio {
  valor: number;
  actualizado: number;
  fuente: FuentePrecio;
}

export interface Precios {
  /** Dólares por MON. */
  mon: Precio | null;
  /** MON por $PANAL, a precio de mercado. */
  panalEnMon: Precio | null;
  /** Dólares por $PANAL: los dos anteriores multiplicados, con la fecha del más viejo. */
  panal: Precio | null;
}

export interface OpcionesPrecios {
  /** Para las pruebas y para entornos sin `fetch` global. */
  fetch?: typeof fetch;
  /** Ahora, en segundos. Para las pruebas. */
  ahora?: number;
  /** Si no se pasa, el de mainnet. */
  panalToken?: Address;
  /** Cuánto esperar a cada fuente HTTP. */
  timeoutMs?: number;
}

type Lector = Pick<PublicClient, 'readContract'>;

const ahoraS = (o?: OpcionesPrecios): number => o?.ahora ?? Math.floor(Date.now() / 1000);

async function getJson(url: string, o?: OpcionesPrecios): Promise<unknown> {
  const f = o?.fetch ?? fetch;
  const r = await f(url, { signal: AbortSignal.timeout(o?.timeoutMs ?? 6000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

const numero = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** MON → USD de Pyth en la cadena. */
async function monDePyth(lector: Lector): Promise<Precio | null> {
  try {
    const p = (await lector.readContract({
      address: PYTH_MONAD,
      abi: pythAbi,
      functionName: 'getPriceUnsafe',
      args: [PYTH_MON_USD],
    })) as { price: bigint; expo: number; publishTime: bigint };
    const valor = Number(p.price) * 10 ** p.expo;
    return valor > 0 ? { valor, actualizado: Number(p.publishTime), fuente: 'pyth' } : null;
  } catch {
    return null;
  }
}

/** MON → USD de CoinGecko. */
async function monDeCoingecko(o?: OpcionesPrecios): Promise<Precio | null> {
  try {
    const j = (await getJson(COINGECKO_MON, o)) as { monad?: { usd?: unknown; last_updated_at?: unknown } };
    const valor = numero(j.monad?.usd);
    const actualizado = numero(j.monad?.last_updated_at);
    return valor && actualizado ? { valor, actualizado, fuente: 'coingecko' } : null;
  } catch {
    return null;
  }
}

/**
 * $PANAL → MON en la curva: el punto medio entre comprar con 1 MON y vender
 * 1.000 $PANAL. Las dos cantidades son ínfimas frente a las reservas, así que
 * el impacto no cuenta y la media geométrica quita la comisión de la curva.
 */
async function panalDeCurva(lector: Lector, token: Address, ahora: number): Promise<Precio | null> {
  try {
    const [comprados, monVenta] = await Promise.all([
      lector.readContract({
        address: MERCADO_PANAL,
        abi: curvaAbi,
        functionName: 'getAmountOut',
        args: [token, parseEther('1'), true],
      }) as Promise<bigint>,
      lector.readContract({
        address: MERCADO_PANAL,
        abi: curvaAbi,
        functionName: 'getAmountOut',
        args: [token, parseEther('1000'), false],
      }) as Promise<bigint>,
    ]);
    const compra = 1 / Number(formatUnits(comprados, 18)); // MON por $PANAL al comprar
    const venta = Number(formatUnits(monVenta, 18)) / 1000; // MON por $PANAL al vender
    const valor = Math.sqrt(compra * venta);
    return Number.isFinite(valor) && valor > 0 ? { valor, actualizado: ahora, fuente: 'nadfun-curva' } : null;
  } catch {
    return null;
  }
}

/** $PANAL → MON de la API de nad.fun. */
async function panalDeApi(token: Address, ahora: number, o?: OpcionesPrecios): Promise<Precio | null> {
  try {
    const j = (await getJson(`${NADFUN_MERCADO}${token}`, o)) as {
      market_info?: { price_native?: unknown };
      price_native?: unknown;
    };
    const valor = numero(j.market_info?.price_native ?? j.price_native);
    return valor ? { valor, actualizado: ahora, fuente: 'nadfun-api' } : null;
  } catch {
    return null;
  }
}

/**
 * Lee los precios de MON y de $PANAL.
 *
 * Nunca lanza: si una fuente cae se usa la otra, y si caen las dos ese precio
 * queda en `null`. Un precio viejo SÍ se devuelve, con su fecha: quien enseña
 * decide con `esFresco`, y `enDolares` ya lo hace.
 */
export async function leerPrecios(lector: Lector, opciones?: OpcionesPrecios): Promise<Precios> {
  const ahora = ahoraS(opciones);
  const token = opciones?.panalToken ?? PANAL_TOKEN_MAINNET;

  const [pyth, curva] = await Promise.all([monDePyth(lector), panalDeCurva(lector, token, ahora)]);
  // CoinGecko solo si Pyth no responde o se ha quedado viejo.
  const mon = pyth && esFresco(pyth, ahora) ? pyth : masReciente(pyth, await monDeCoingecko(opciones));
  const panalEnMon = curva ?? (await panalDeApi(token, ahora, opciones));

  const panal =
    mon && panalEnMon
      ? {
          valor: mon.valor * panalEnMon.valor,
          actualizado: Math.min(mon.actualizado, panalEnMon.actualizado),
          fuente: panalEnMon.fuente,
        }
      : null;
  return { mon, panalEnMon, panal };
}

function masReciente(a: Precio | null, b: Precio | null): Precio | null {
  if (!a) return b;
  if (!b) return a;
  return b.actualizado > a.actualizado ? b : a;
}

/** Si un precio se puede enseñar: existe y tiene menos de cinco minutos. */
export function esFresco(p: Precio | null | undefined, ahora?: number, maxEdadS = PRECIO_MAX_EDAD_S): p is Precio {
  if (!p) return false;
  return (ahora ?? Math.floor(Date.now() / 1000)) - p.actualizado <= maxEdadS;
}

/** Las monedas que tienen precio aquí. Las estables (GHO, USDC, AUSD) ya son dólares. */
export type MonedaConPrecio = 'MON' | '$PANAL';

/**
 * Cuántos dólares son `cantidad` unidades mínimas de `moneda` (18 decimales),
 * con el precio de mercado. `null` si no hay precio o tiene más de 5 minutos.
 */
export function enDolares(
  cantidad: bigint,
  moneda: MonedaConPrecio,
  precios: Precios | null | undefined,
  ahora?: number,
): { usd: number; actualizado: number; fuente: FuentePrecio } | null {
  const p = moneda === 'MON' ? precios?.mon : precios?.panal;
  if (!esFresco(p, ahora)) return null;
  return { usd: Number(formatUnits(cantidad, 18)) * p.valor, actualizado: p.actualizado, fuente: p.fuente };
}

/**
 * Lo que daría vender `cantidad` $PANAL ahora en la curva, en MON (wei): con
 * la comisión y el impacto en el precio. Es lo que de verdad cobraría quien
 * los vendiera. `null` si la curva no responde.
 */
export async function valorDeVenta(
  lector: Lector,
  cantidad: bigint,
  panalToken: Address = PANAL_TOKEN_MAINNET,
): Promise<bigint | null> {
  if (cantidad <= 0n) return 0n;
  try {
    return (await lector.readContract({
      address: MERCADO_PANAL,
      abi: curvaAbi,
      functionName: 'getAmountOut',
      args: [panalToken, cantidad, false],
    })) as bigint;
  } catch {
    return null;
  }
}

/**
 * «$0.075», «$0.0006», «$1.50». Por debajo de un dólar, dos cifras
 * significativas: con decimales fijos, 100 $PANAL saldrían «$0.00».
 */
export function formatearDolares(usd: number, locale = 'en-US'): string {
  if (!Number.isFinite(usd) || usd < 0) return '';
  if (usd > 0 && usd < 0.000001) {
    return `< ${new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: 6 }).format(0.000001)}`;
  }
  const opciones: Intl.NumberFormatOptions =
    usd >= 1
      ? { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }
      : { style: 'currency', currency: 'USD', maximumSignificantDigits: 2 };
  return new Intl.NumberFormat(locale, opciones).format(usd);
}
