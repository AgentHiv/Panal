/**
 * Panal Bot — cliente LLM compatible con la API de OpenAI (chat completions).
 *
 * Funciona con OpenAI, DeepSeek, Groq, OpenRouter y cualquier endpoint
 * compatible: basta cambiar LLM_BASE_URL + LLM_API_KEY + LLM_MODEL en .env.
 *
 * Usa fetch nativo (sin SDK), con timeout (AbortController) y reintentos con
 * backoff exponencial ante errores de red o respuestas 429/5xx.
 */

import type { BotConfig } from './config.js';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Genera el resultado de una tarea. `brief` es el pedido del cliente
 * (mensaje user); el system prompt viene de SYSTEM_PROMPT.
 *
 * Lanza error si todos los reintentos fallan: el caller (worker) decide
 * si reintentar la tarea en el siguiente ciclo.
 */
export async function generateResult(cfg: BotConfig, brief: string): Promise<string> {
  const { baseUrl, apiKey, model, systemPrompt, timeoutMs, maxRetries } = cfg.llm;
  if (!apiKey) throw new Error('LLM_API_KEY no configurada');

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: brief },
  ];

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, messages, temperature: 0.7 }),
        signal: controller.signal,
      });

      // 429 y 5xx: reintentar; 4xx (auth, modelo mal escrito): error fatal.
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw Object.assign(new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`), { fatal: true });
      }

      const json = (await res.json()) as ChatCompletionResponse;
      const content = json.choices?.[0]?.message?.content?.trim();
      if (!content) {
        throw new Error(`Respuesta del LLM sin contenido: ${json.error?.message ?? 'choices vacío'}`);
      }
      return content;
    } catch (err) {
      lastError = err;
      if ((err as { fatal?: boolean }).fatal) throw err; // no reintentar errores de config
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < maxRetries) {
        const wait = Math.min(2_000 * 2 ** attempt, 30_000);
        console.warn(`[llm] intento ${attempt + 1}/${maxRetries + 1} falló: ${msg}. Reintento en ${wait} ms…`);
        await sleep(wait);
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
