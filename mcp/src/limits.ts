/**
 * panal-mcp — topes de gasto y presupuestos.
 *
 * Un MCP con clave privada es un modelo de lenguaje gastando dinero real a
 * petición de quien esté conversando. Los límites se aplican AQUÍ, en el
 * servidor, y nunca en el prompt: un prompt se puede negociar, un `if` no.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Address } from 'viem';
import type { AttachedFile } from '@panal/sdk';

/** Vida de un presupuesto. Corto a propósito: el precio del agente puede cambiar. */
const QUOTE_TTL_MS = 5 * 60 * 1000;

/**
 * Las dos maneras de pagar a un agente, y no son intercambiables.
 *
 * `hire` bloquea el pago en el escrow y abre una tarea con plazo, entrega y
 * disputa. `ask` paga una consulta suelta por x402 y se resuelve en la misma
 * llamada HTTP. Los precios son distintos —Spec cobra 100 $PANAL por tarea y
 * 0,5 por consulta—, así que canjear un presupuesto por el camino que no es
 * cobraría doscientas veces de más.
 */
export type QuoteKind = 'hire' | 'ask';

/**
 * Un adjunto ya anunciado en el brief, esperando a que se contrate.
 *
 * Se guarda la RUTA y no los bytes. Un presupuesto vive cinco minutos y puede
 * haber varios a la vez; con un tope de 25 MB por archivo y diez por encargo,
 * quedarse los bytes es sostener un cuarto de giga en memoria por si alguien
 * dice que sí. Se vuelven a leer al contratar y se comprueba que siguen dando
 * el hash anunciado — que además es la única forma de enterarse de que el
 * archivo cambió entre el precio y el sí, y de abortar ANTES de pagar.
 */
export interface AdjuntoPresupuestado {
  file: AttachedFile;
  ruta: string;
}

export interface Quote {
  id: string;
  kind: QuoteKind;
  worker: Address;
  agentName: string;
  /** El encargo TAL Y COMO SE HASHEA: con el manifiesto de adjuntos ya dentro. */
  brief: string;
  amount: bigint;
  /**
   * El nivel comprado, si el agente vende niveles.
   *
   * Es solo para poder decirlo: quien decide qué nivel es no es este nombre
   * sino `amount`, que es lo que se bloquea y lo único que el agente mira. Va
   * en el presupuesto para que al contratar se repita lo mismo que se aprobó.
   */
  tier: string | null;
  currency: Address;
  symbol: string;
  botUrl: string | null;
  adjuntos: AdjuntoPresupuestado[];
  expiresAt: number;
}

/**
 * Presupuestos vivos, en memoria.
 *
 * No se persisten a propósito: un presupuesto que sobrevive a un reinicio es un
 * precio viejo esperando a aplicarse. Si el servidor se cae, se vuelve a pedir.
 */
export class QuoteBook {
  private readonly quotes = new Map<string, Quote>();

  issue(data: Omit<Quote, 'id' | 'expiresAt'>): Quote {
    this.prune();
    const quote: Quote = { ...data, id: randomUUID(), expiresAt: Date.now() + QUOTE_TTL_MS };
    this.quotes.set(quote.id, quote);
    return quote;
  }

  /**
   * Devuelve el presupuesto, o el motivo por el que no vale.
   *
   * `kind` no es decorativo: obliga a canjear cada presupuesto por el camino
   * para el que se pidió. Sin esto, el id de una consulta de 0,5 $PANAL se
   * podría canjear como contratación y bloquear los 100 $PANAL de la tarea.
   */
  redeem(id: string, kind: QuoteKind): { quote: Quote } | { error: string } {
    this.prune();
    const quote = this.quotes.get(id);
    if (!quote) {
      return {
        error:
          'That quote does not exist or has expired (they last 5 minutes). ' +
          'Ask for a new one and show it to the person before spending.',
      };
    }
    if (quote.kind !== kind) {
      return {
        error:
          `That quote_id is for ${quote.kind === 'ask' ? 'a per-call question (panal_ask)' : 'hiring a job (panal_hire)'}, ` +
          `not for this. The two have different prices; ask for the right quote instead of reusing this id.`,
      };
    }
    // De un solo uso: sin esto, un reintento del modelo contrataría dos veces.
    this.quotes.delete(id);
    return { quote };
  }

  private prune(): void {
    const now = Date.now();
    for (const [id, q] of this.quotes) if (q.expiresAt <= now) this.quotes.delete(id);
  }
}

/** Clave de un contador: la dirección de la moneda, en minúsculas. */
function clave(currency: Address): string {
  return currency.toLowerCase();
}

/**
 * Registro de gasto diario, persistido en disco y SEPARADO POR MONEDA.
 *
 * Un tope que se borra al reiniciar no es un tope: bastaría con reiniciar el
 * servidor para volver a gastar el presupuesto entero. Se guarda el día UTC
 * junto a los importes, así que el contador se reinicia solo al cambiar de día.
 *
 * POR QUÉ POR MONEDA
 *
 * Antes había un solo número. Panal cobra en dos monedas —MON nativo y $PANAL—
 * y no hay tipo de cambio entre ellas, así que sumarlas era inventárselo: tres
 * consultas de $PANAL agotaban un presupuesto puesto pensando en MON, y al
 * revés, un tope generoso en $PANAL abría la mano con el MON sin que nadie lo
 * hubiera decidido. La cuenta protegía de más, que es el lado bueno del fallo,
 * pero un tope que no significa lo que dice no se puede ajustar.
 */
export class SpendLedger {
  constructor(
    private readonly file: string,
    private readonly onWarn: (msg: string) => void,
  ) {}

  static defaultFile(): string {
    return process.env.MCP_SPEND_FILE?.trim() || resolve(process.cwd(), '.panal-mcp', 'spend.json');
  }

  private static utcDay(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /** Todo lo gastado hoy, por moneda. Vacío si el archivo es de otro día. */
  private leer(): Map<string, bigint> {
    const out = new Map<string, bigint>();
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as {
        day?: string;
        spentWei?: string;
        spent?: Record<string, string>;
      };
      if (raw.day !== SpendLedger.utcDay()) return out;

      // Formato antiguo: un solo número, sin moneda. Era el gasto de todo, pero
      // en la práctica el que llevaba la cuenta era el nativo, así que se
      // adopta ahí. Perderlo dejaría el tope del día a cero tras actualizar.
      if (typeof raw.spentWei === 'string' && !raw.spent) {
        try {
          out.set(clave(NATIVO), BigInt(raw.spentWei));
        } catch {
          /* ilegible: se ignora */
        }
        return out;
      }

      for (const [k, v] of Object.entries(raw.spent ?? {})) {
        try {
          out.set(k.toLowerCase(), BigInt(v));
        } catch {
          /* una entrada corrupta no invalida las demás */
        }
      }
    } catch {
      // Sin archivo, ilegible o corrupto: se empieza de cero. Nunca lanza,
      // porque un ledger roto no debe dejar el servidor inservible.
    }
    return out;
  }

  spentToday(currency: Address): bigint {
    return this.leer().get(clave(currency)) ?? 0n;
  }

  record(currency: Address, wei: bigint): void {
    const todo = this.leer();
    todo.set(clave(currency), (todo.get(clave(currency)) ?? 0n) + wei);
    const spent: Record<string, string> = {};
    for (const [k, v] of todo) spent[k] = v.toString();
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      // Escritura atómica: un corte a media escritura dejaría un JSON truncado
      // que se leería como 0 y borraría el tope del día.
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify({ day: SpendLedger.utcDay(), spent }, null, 2));
      renameSync(tmp, this.file);
    } catch (err) {
      this.onWarn(
        `no se pudo registrar el gasto en ${this.file}: ${err instanceof Error ? err.message : err}. ` +
          'El tope diario deja de ser fiable entre reinicios.',
      );
    }
  }
}

/** El tope de una moneda concreta. */
export interface CurrencyLimit {
  maxPerTaskWei: bigint;
  dailyBudgetWei: bigint;
  /** El nombre de la variable de entorno, para poder decirle a alguien cuál subir. */
  envMaxPerTask: string;
  envDailyBudget: string;
}

export interface Limits {
  deadlineHours: number;
  /** Topes por moneda, indexados por dirección en minúsculas. */
  porMoneda: Map<string, CurrencyLimit>;
}

/** La moneda nativa en el escrow de Panal: la dirección cero. */
const NATIVO = '0x0000000000000000000000000000000000000000' as Address;
/** $PANAL en Monad mainnet. */
const PANAL = '0x2e2e44e7fa6178822d4397299f719e89d1a67777' as Address;

/**
 * El tope de una moneda, o `null` si no hay ninguno puesto para ella.
 *
 * `null` significa NO HAY PRESUPUESTO, y quien llame debe negarse. Es
 * deliberado: la alternativa sería reutilizar el tope de otra moneda, y eso
 * exige un tipo de cambio que nadie tiene. Un agente que cobre en un token
 * desconocido no se contrata hasta que alguien decida cuánto vale.
 */
export function limitFor(limits: Limits, currency: Address): CurrencyLimit | null {
  return limits.porMoneda.get(clave(currency)) ?? null;
}

export function limitsFromEnv(): Limits {
  const parse = (name: string, fallback: bigint): bigint => {
    const raw = process.env[name]?.trim();
    if (!raw) return fallback;
    try {
      const value = BigInt(raw);
      return value >= 0n ? value : fallback;
    } catch {
      return fallback;
    }
  };
  const hours = Number(process.env.MCP_TASK_DEADLINE_HOURS?.trim() || '24');

  const porMoneda = new Map<string, CurrencyLimit>();
  // MON conserva los nombres de siempre: quien ya tenía un .env sigue
  // significando exactamente lo que creía.
  porMoneda.set(clave(NATIVO), {
    maxPerTaskWei: parse('MCP_MAX_PER_TASK_WEI', 10n ** 18n),
    dailyBudgetWei: parse('MCP_DAILY_BUDGET_WEI', 5n * 10n ** 18n),
    envMaxPerTask: 'MCP_MAX_PER_TASK_WEI',
    envDailyBudget: 'MCP_DAILY_BUDGET_WEI',
  });
  // $PANAL estrena las suyas, con los mismos números de antes. No se copian de
  // MON porque no valen lo mismo: son dos presupuestos que se ajustan aparte.
  porMoneda.set(clave(PANAL), {
    maxPerTaskWei: parse('MCP_MAX_PER_TASK_PANAL_WEI', 10n ** 18n),
    dailyBudgetWei: parse('MCP_DAILY_BUDGET_PANAL_WEI', 5n * 10n ** 18n),
    envMaxPerTask: 'MCP_MAX_PER_TASK_PANAL_WEI',
    envDailyBudget: 'MCP_DAILY_BUDGET_PANAL_WEI',
  });

  return { deadlineHours: Number.isFinite(hours) && hours > 0 ? hours : 24, porMoneda };
}
