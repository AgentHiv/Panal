/**
 * Panal Bot — cliente de la Bot API de Telegram usando fetch nativo de Node
 * (sin dependencias extra). Soporta:
 *   - sendMessage con Markdown (para las alertas bonitas)
 *   - getUpdates con long polling (para los comandos /start, /status, /brief)
 *
 * En DRY_RUN no se llama a Telegram: los mensajes se imprimen por consola.
 */

import type { BotConfig } from './config.js';
import type { Store } from './store.js';
import { toPlainText } from './format.js';

const API_BASE = (token: string) => `https://api.telegram.org/bot${token}`;

interface TelegramUpdate {
  update_id: number;
  message?: {
    text?: string;
    chat?: { id?: number };
  };
}

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

/** Escapa caracteres especiales del modo Markdown "legacy" de Telegram. */
export function escapeMarkdown(text: string): string {
  return text.replace(/([_*`\[])/g, '\\$1');
}

export class Telegram {
  private readonly cfg: BotConfig;
  private readonly enabled: boolean;

  constructor(cfg: BotConfig) {
    this.cfg = cfg;
    this.enabled = !cfg.dryRun && Boolean(cfg.telegramBotToken && cfg.telegramChatId);
    if (cfg.dryRun) {
      console.log('[telegram] DRY_RUN activo: los mensajes se imprimen en consola, no se envían.');
    }
  }

  /** Llamada genérica a la Bot API con timeout. */
  private async api<T>(method: string, body: Record<string, unknown>, timeoutMs = 15_000): Promise<T | null> {
    const token = this.cfg.telegramBotToken;
    if (!token) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${API_BASE(token)}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const json = (await res.json()) as TelegramResponse<T>;
      if (!json.ok) {
        console.warn(`[telegram] ${method} respondió error: ${json.description ?? res.status}`);
        return null;
      }
      return json.result ?? null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[telegram] ${method} falló: ${msg}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Envía un mensaje al chat del dueño, siempre como TEXTO PLANO.
   *
   * Antes se mandaba con `parse_mode: 'Markdown'` y, si Telegram lo rechazaba,
   * se reintentaba borrando a lo bruto los caracteres de formato. Eso fallaba
   * de las dos maneras posibles:
   *
   *   - El parser antiguo de Telegram no admite encabezados `#` y revienta con
   *     asteriscos desparejados. Cualquier resultado del LLM con Markdown caía
   *     en el reintento.
   *   - El reintento borraba `_`, `*` y backticks de TODO el mensaje, así que
   *     destrozaba nombres como `BRIEF_WAIT_MS` y dejaba el texto a medias.
   *
   * Ahora el mensaje se convierte a texto plano legible antes de salir y se
   * manda sin `parse_mode`. No hay nada que interpretar, así que no hay error
   * posible ni reintento que degrade nada: lo que se lee es lo que se escribió,
   * sin asteriscos ni almohadillas a la vista.
   */
  async send(text: string): Promise<void> {
    const plain = toPlainText(text);
    if (!this.enabled) {
      console.log(`\n[telegram:dry-run] ────────────────────────────\n${plain}\n`);
      return;
    }
    await this.api<unknown>('sendMessage', {
      chat_id: this.cfg.telegramChatId,
      text: plain,
      disable_web_page_preview: true,
    });
  }

  /** Long polling de getUpdates (espera hasta `timeoutSec` segundos en Telegram). */
  private async getUpdates(offset: number, timeoutSec: number): Promise<TelegramUpdate[]> {
    const result = await this.api<TelegramUpdate[]>(
      'getUpdates',
      { offset, timeout: timeoutSec, allowed_updates: ['message'] },
      (timeoutSec + 10) * 1000,
    );
    return result ?? [];
  }

  /**
   * Bucle de comandos. Corre en paralelo al loop on-chain hasta que `stop()`
   * sea llamado. Solo responde al chat configurado (ignora a desconocidos).
   */
  async pollCommands(handlers: CommandHandlers, store: Store, stop: { stopped: boolean }): Promise<void> {
    if (!this.enabled) return; // en dry-run no hay telegram que escuchar
    // Descartar mensajes viejos acumulados mientras el bot estaba apagado.
    const backlog = await this.getUpdates(store.telegramOffset || -1, 0);
    let offset = store.telegramOffset;
    if (backlog.length > 0) {
      offset = backlog[backlog.length - 1]!.update_id + 1;
      store.setTelegramOffset(offset);
      store.save();
    }
    console.log('[telegram] Escuchando comandos (/start, /status, /brief)…');
    while (!stop.stopped) {
      const updates = await this.getUpdates(offset, 25);
      for (const u of updates) {
        offset = u.update_id + 1;
        store.setTelegramOffset(offset);
        await this.handleUpdate(u, handlers, store);
      }
      if (updates.length > 0) store.save();
    }
  }

  private async handleUpdate(u: TelegramUpdate, handlers: CommandHandlers, store: Store): Promise<void> {
    const text = u.message?.text?.trim();
    const chatId = u.message?.chat?.id;
    if (!text || chatId === undefined) return;
    // Seguridad: solo el dueño (TELEGRAM_CHAT_ID) puede dar órdenes.
    if (String(chatId) !== String(this.cfg.telegramChatId)) {
      console.warn(`[telegram] Mensaje ignorado de chat desconocido: ${chatId}`);
      return;
    }

    const [rawCmd = '', ...rest] = text.split(/\s+/);
    const cmd = rawCmd.toLowerCase().split('@')[0] ?? ''; // quita @NombreDelBot

    if (cmd === '/start' || cmd === '/help') {
      await this.send(HELP_TEXT);
      return;
    }

    if (cmd === '/status') {
      await this.send(await handlers.getStatus());
      return;
    }

    if (cmd === '/result') {
      // Formato: /result #12  → devuelve el resultado entregado (si existe)
      const m = rest.join(' ').match(/^#?(\d+)\s*$/);
      if (!m) {
        await this.send('⚠️ Formato: `/result #N` — ejemplo: `/result #3`');
        return;
      }
      const taskId = BigInt(m[1]!);
      const result = store.getResult(taskId);
      if (!result) {
        await this.send(
          `ℹ️ No tengo guardado ningún resultado para la tarea *#${taskId}*.\n` +
            'Si el agente ya la entregó on-chain, pídele al operador su resultado.',
        );
        return;
      }
      await this.send(`📄 *Resultado de #${taskId}*:\n\n${result.slice(0, 3800)}`);
      return;
    }

    if (cmd === '/brief') {
      // Formato: /brief #12 texto del pedido…   (también acepta "/brief 12 …")
      const joined = rest.join(' ');
      const m = joined.match(/^#?(\d+)\s+([\s\S]+)$/);
      if (!m) {
        await this.send(
          '⚠️ Formato: `/brief #N texto del pedido`\n' +
            'Ejemplo: `/brief #3 Redacta un hilo de 5 tuits sobre Monad`',
        );
        return;
      }
      const taskId = BigInt(m[1]!);
      const briefText = m[2]!.trim();
      store.setBrief(taskId, briefText);
      await this.send(`📝 Brief guardado para la tarea *#${taskId}* (${briefText.length} caracteres).`);
      return;
    }

    if (cmd.startsWith('/')) {
      await this.send('🤔 Comando no reconocido. Escribe /start para ver la ayuda.');
    }
  }
}

/** Handlers que cada modo (notifier/worker) implementa para los comandos. */
export interface CommandHandlers {
  /** Texto Markdown para el comando /status. */
  getStatus: () => Promise<string>;
}

const HELP_TEXT =
  '🐝 *Panal Bot*\n\n' +
  'Comandos disponibles:\n' +
  '• `/brief #N texto` — guarda el pedido del cliente para la tarea N ' +
  '(el brief no va on-chain, solo su hash; reenvíalo aquí cuando el cliente te lo pase).\n' +
  '• `/status` — resumen de tus tareas y pagos pendientes.\n' +
  '• `/start` — esta ayuda.\n\n' +
  'Panel web: https://panal.lat/dashboard';
