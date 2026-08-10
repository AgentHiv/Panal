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

/** Vida de un presupuesto. Corto a propósito: el precio del agente puede cambiar. */
const QUOTE_TTL_MS = 5 * 60 * 1000;

export interface Quote {
  id: string;
  worker: Address;
  agentName: string;
  brief: string;
  amount: bigint;
  currency: Address;
  symbol: string;
  botUrl: string | null;
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

  /** Devuelve el presupuesto, o el motivo por el que no vale. */
  redeem(id: string): { quote: Quote } | { error: string } {
    this.prune();
    const quote = this.quotes.get(id);
    if (!quote) {
      return {
        error:
          'Ese presupuesto no existe o ya caducó (duran 5 minutos). ' +
          'Pide uno nuevo con panal_quote_hire y enséñaselo a la persona antes de contratar.',
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

/**
 * Registro de gasto diario, persistido en disco.
 *
 * Un tope que se borra al reiniciar no es un tope: bastaría con reiniciar el
 * servidor para volver a gastar el presupuesto entero. Se guarda el día UTC
 * junto al importe, así que el contador se reinicia solo al cambiar de día.
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

  spentToday(): bigint {
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as { day?: string; spentWei?: string };
      if (raw.day !== SpendLedger.utcDay()) return 0n;
      return BigInt(raw.spentWei ?? '0');
    } catch {
      // Sin archivo, ilegible o corrupto: se empieza de cero. Nunca lanza,
      // porque un ledger roto no debe dejar el servidor inservible.
      return 0n;
    }
  }

  record(wei: bigint): void {
    const total = this.spentToday() + wei;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      // Escritura atómica: un corte a media escritura dejaría un JSON truncado
      // que se leería como 0 y borraría el tope del día.
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify({ day: SpendLedger.utcDay(), spentWei: total.toString() }, null, 2));
      renameSync(tmp, this.file);
    } catch (err) {
      this.onWarn(
        `no se pudo registrar el gasto en ${this.file}: ${err instanceof Error ? err.message : err}. ` +
          'El tope diario deja de ser fiable entre reinicios.',
      );
    }
  }
}

export interface Limits {
  maxPerTaskWei: bigint;
  dailyBudgetWei: bigint;
  deadlineHours: number;
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
  return {
    maxPerTaskWei: parse('MCP_MAX_PER_TASK_WEI', 10n ** 18n), // 1 MON / $PANAL
    dailyBudgetWei: parse('MCP_DAILY_BUDGET_WEI', 5n * 10n ** 18n),
    deadlineHours: Number.isFinite(hours) && hours > 0 ? hours : 24,
  };
}
