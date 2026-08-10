/**
 * Panal Bot — cliente de la Bot API de Telegram usando fetch nativo de Node
 * (sin dependencias extra). Soporta:
 *   - sendMessage en HTML (formato de verdad, sin marcado a la vista)
 *   - setMyCommands (los comandos salen en el menú "/" de Telegram)
 *   - getUpdates con long polling (comandos /start, /status, /brief, /result)
 *
 * En DRY_RUN no se llama a Telegram: los mensajes se imprimen por consola.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BotConfig } from './config.js';
import type { Store } from './store.js';
import { toPlainText } from './format.js';
import { escapeHtml, t, telegramLangCode, type BotLang } from './i18n.js';

const API_BASE = (token: string) => `https://api.telegram.org/bot${token}`;

/** ¿Sigue vivo ese pid? `kill(pid, 0)` no envía señal: solo comprueba. */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM = existe pero es de otro usuario; ESRCH = no existe.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Los cuatro comandos que se publican en el menú de Telegram. */
const COMMANDS = [
  { command: 'start', key: 'menu.start' },
  { command: 'status', key: 'menu.status' },
  { command: 'brief', key: 'menu.brief' },
  { command: 'result', key: 'menu.result' },
] as const;

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
   * Envía un mensaje ya compuesto en HTML de Telegram.
   *
   * Historia de por qué HTML y no Markdown: al principio se mandaba con
   * `parse_mode: 'Markdown'` y, si Telegram lo rechazaba, se reintentaba
   * borrando a lo bruto los caracteres de formato. Fallaba de las dos maneras
   * posibles —el parser antiguo revienta con asteriscos desparejados y no
   * admite `#`, y el reintento destrozaba nombres como `BRIEF_WAIT_MS`—, así
   * que se pasó a texto plano: correcto, pero sin ninguna jerarquía visual.
   *
   * HTML resuelve las dos cosas a la vez. El formato se ve renderizado y la
   * etiqueta nunca aparece en pantalla, que era la queja original: lo que
   * molestaba no era el formato, eran los asteriscos crudos.
   *
   * El contrato es que quien llama compone con `t()`, que escapa cada valor
   * interpolado. Para texto libre que no pasa por el catálogo —el resultado
   * del LLM, un mensaje de error— está `sendText()`.
   */
  async send(html: string): Promise<void> {
    if (!this.enabled) {
      console.log(`\n[telegram:dry-run] ────────────────────────────\n${toPlainText(html)}\n`);
      return;
    }
    await this.api<unknown>('sendMessage', {
      chat_id: this.cfg.telegramChatId,
      text: html,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  }

  /**
   * Envía texto que NO viene del catálogo (resultado del LLM, error de una
   * librería). Se normaliza el Markdown que traiga el modelo y se escapa: sin
   * esto, un resultado con `<` rompería el parser y Telegram devolvería 400.
   */
  async sendText(text: string): Promise<void> {
    await this.send(escapeHtml(toPlainText(text)));
  }

  /**
   * Publica los comandos en el menú "/" de Telegram, en los 10 idiomas.
   *
   * Sin esto los comandos existían pero eran invisibles: había que saberse
   * `/brief` de memoria. Telegram guarda una lista por `language_code` y sirve
   * la que coincide con el idioma del cliente de cada usuario, con la lista sin
   * idioma como respaldo —por eso se publica también el idioma configurado como
   * predeterminado, para quien tenga Telegram en un idioma que no cubrimos.
   */
  async publishCommands(): Promise<void> {
    if (!this.enabled) return;
    const build = (lang: BotLang) =>
      COMMANDS.map((c) => ({ command: c.command, description: t(lang, c.key) }));

    await this.api('setMyCommands', { commands: build(this.cfg.lang) });
    for (const lang of ['es', 'en', 'zh', 'hi', 'fr', 'ar', 'pt', 'ru', 'bn', 'ur'] as const) {
      await this.api('setMyCommands', {
        commands: build(lang),
        language_code: telegramLangCode(lang),
      });
    }
    console.log('[telegram] Comandos publicados en el menú (10 idiomas).');
  }

  /**
   * Reserva el derecho a escuchar comandos, uno por token.
   *
   * El modo worker es un superconjunto del notifier: manda los mismos avisos de
   * tarea nueva y de cambio de estado, y además trabaja. Pero
   * `ecosystem.config.cjs` arrancaba los dos a la vez, así que cada aviso salía
   * DUPLICADO y un `/status` respondía dos veces —los dos procesos hacían
   * getUpdates contra el mismo token y ambos contestaban—. Peor: al competir
   * por el mismo `offset`, cada uno se llevaba parte de los mensajes, así que
   * los comandos fallaban de forma intermitente.
   *
   * Arreglar solo el ecosystem no bastaba: nada impedía volver a levantar los
   * dos. Este candado lo hace imposible por construcción. Se comprueba que el
   * pid siga vivo, así que un proceso muerto de mala manera no deja el bot
   * mudo para siempre: el siguiente en arrancar se queda con el turno.
   */
  private claimCommandLock(): boolean {
    const lockPath = join(this.cfg.storeDir, 'telegram-commands.lock');
    const mine = JSON.stringify({ pid: process.pid, mode: this.cfg.mode, at: new Date().toISOString() });

    for (let intento = 0; intento < 2; intento++) {
      try {
        mkdirSync(this.cfg.storeDir, { recursive: true });
        writeFileSync(lockPath, mine, { flag: 'wx' }); // atómico: falla si existe
        return true;
      } catch {
        // Ya hay candado: solo cuenta si su proceso sigue vivo.
        let holder: { pid?: number; mode?: string } = {};
        try {
          holder = JSON.parse(readFileSync(lockPath, 'utf8')) as typeof holder;
        } catch {
          /* candado ilegible: se trata como caduco */
        }
        const alive = typeof holder.pid === 'number' && isProcessAlive(holder.pid);
        if (alive && holder.pid !== process.pid) {
          console.warn(
            `[telegram] El proceso ${holder.pid} (${holder.mode ?? '?'}) ya escucha los comandos de este bot. ` +
              `Este proceso (${this.cfg.mode}) NO los atenderá, para no responder por duplicado.`,
          );
          return false;
        }
        try {
          rmSync(lockPath, { force: true }); // caduco: se retoma
        } catch {
          return false;
        }
      }
    }
    return false;
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
    // Un solo proceso puede escuchar comandos por token. Ver claimCommandLock.
    if (!this.claimCommandLock()) return;
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

    const lang = this.cfg.lang;

    if (cmd === '/start' || cmd === '/help') {
      await this.send(t(lang, 'cmd.help', { dashboard: this.cfg.dashboardUrl }));
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
        await this.send(t(lang, 'cmd.result.usage'));
        return;
      }
      const taskId = BigInt(m[1]!);
      const result = store.getResult(taskId);
      if (!result) {
        await this.send(t(lang, 'cmd.result.missing', { id: taskId.toString() }));
        return;
      }
      // El resultado lo escribió un LLM: va por sendText para escaparlo.
      await this.send(t(lang, 'cmd.result.header', { id: taskId.toString() }));
      await this.sendText(result.slice(0, 3800));
      return;
    }

    if (cmd === '/brief') {
      // Formato: /brief #12 texto del pedido…   (también acepta "/brief 12 …")
      const joined = rest.join(' ');
      const m = joined.match(/^#?(\d+)\s+([\s\S]+)$/);
      if (!m) {
        await this.send(t(lang, 'cmd.brief.usage'));
        return;
      }
      const taskId = BigInt(m[1]!);
      const briefText = m[2]!.trim();
      store.setBrief(taskId, briefText);
      await this.send(
        t(lang, 'cmd.brief.saved', { id: taskId.toString(), chars: briefText.length }),
      );
      return;
    }

    if (cmd.startsWith('/')) {
      await this.send(t(lang, 'cmd.unknown'));
    }
  }
}

/** Handlers que cada modo (notifier/worker) implementa para los comandos. */
export interface CommandHandlers {
  /** HTML de Telegram ya compuesto para el comando /status. */
  getStatus: () => Promise<string>;
}
