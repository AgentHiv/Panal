/**
 * Panal SDK — hablarle a un modelo sin casarse con quien lo sirve.
 *
 * Un agente de Panal cobra on-chain y entrega on-chain; qué modelo piensa por
 * dentro es asunto suyo, y no debería costarle un cambio de código. Aquí no
 * hay SDK de ningún proveedor: son tres formatos de red, y con esos tres se
 * habla con todos.
 *
 *   - `openai`     · OpenAI, Kimi (Moonshot), Grok (xAI), GLM (Zhipu),
 *                    DeepSeek, Groq, OpenRouter, Mistral, Together, Ollama…
 *                    Es el formato que ha copiado casi todo el mundo.
 *   - `anthropic`  · Claude. Cambia la ruta, la cabecera de la clave y dónde
 *                    va el system; el resto es lo mismo.
 *   - `gemini`     · Google. Cambia hasta cómo se llaman los campos.
 *
 * El dialecto se ADIVINA a partir de la URL, así que en el caso normal basta
 * con poner el proveedor y la clave. Se puede forzar si haces de puente con
 * algo raro.
 *
 * Las imágenes viajan en base64 dentro de la petición, en el formato que cada
 * dialecto entiende. Eso es lo que permite que un cliente mande una foto y el
 * agente la MIRE — pero ojo, quien la mira es el modelo: si el que has
 * configurado no es multimodal, la llamada falla con lo que diga el
 * proveedor, y eso es justo lo que su autor necesita leer.
 *
 * Sin dependencias a propósito, base64 incluido: este archivo lo carga todo
 * agente que arranca, y no sale a cuenta arrastrar un paquete por 12 líneas.
 */

/** Los tres formatos de red que sabemos hablar. */
export type LlmDialecto = 'openai' | 'anthropic' | 'gemini';

export interface LlmProveedor {
  /** Base de la API, sin la ruta del método. */
  baseUrl: string;
  dialecto: LlmDialecto;
  /**
   * Un modelo que existía cuando se escribió esto.
   *
   * Es una comodidad, no una promesa: los nombres cambian cada pocos meses y
   * ninguna lista dentro de un paquete sobrevive a eso. `LLM_MODEL` manda
   * siempre, y es lo que se debe poner en producción.
   */
  modeloSugerido?: string;
}

/**
 * Los proveedores conocidos, por nombre corto.
 *
 * Lo que fija cada entrada es la URL y el dialecto —lo estructural, lo que no
 * cambia—. Añadir uno nuevo es una línea, y usar uno que no esté en la lista
 * no requiere tocar este archivo: se pone `LLM_BASE_URL` a pelo.
 */
export const PROVEEDORES: Record<string, LlmProveedor> = {
  openai: { baseUrl: 'https://api.openai.com/v1', dialecto: 'openai', modeloSugerido: 'gpt-4o-mini' },
  claude: { baseUrl: 'https://api.anthropic.com', dialecto: 'anthropic', modeloSugerido: 'claude-opus-5' },
  anthropic: { baseUrl: 'https://api.anthropic.com', dialecto: 'anthropic', modeloSugerido: 'claude-opus-5' },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    dialecto: 'gemini',
    modeloSugerido: 'gemini-2.0-flash',
  },
  kimi: { baseUrl: 'https://api.moonshot.ai/v1', dialecto: 'openai', modeloSugerido: 'moonshot-v1-8k' },
  moonshot: { baseUrl: 'https://api.moonshot.ai/v1', dialecto: 'openai', modeloSugerido: 'moonshot-v1-8k' },
  grok: { baseUrl: 'https://api.x.ai/v1', dialecto: 'openai', modeloSugerido: 'grok-2-vision-1212' },
  xai: { baseUrl: 'https://api.x.ai/v1', dialecto: 'openai', modeloSugerido: 'grok-2-vision-1212' },
  glm: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', dialecto: 'openai', modeloSugerido: 'glm-4v' },
  zhipu: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', dialecto: 'openai', modeloSugerido: 'glm-4v' },
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', dialecto: 'openai', modeloSugerido: 'deepseek-chat' },
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    dialecto: 'openai',
    modeloSugerido: 'llama-3.3-70b-versatile',
  },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', dialecto: 'openai' },
  mistral: { baseUrl: 'https://api.mistral.ai/v1', dialecto: 'openai', modeloSugerido: 'mistral-small-latest' },
  together: { baseUrl: 'https://api.together.xyz/v1', dialecto: 'openai' },
  // Local, sin clave y sin factura. Útil para probar un agente sin gastar.
  ollama: { baseUrl: 'http://localhost:11434/v1', dialecto: 'openai', modeloSugerido: 'llama3.2' },
};

/**
 * Qué dialecto habla una URL.
 *
 * Se mira el host y no la ruta: un proxy corporativo cambia el camino, pero
 * quien contesta al otro lado sigue siendo el mismo. Lo que no se reconoce se
 * trata como OpenAI, que es lo que implementa casi todo el mundo — y si se
 * falla, se falla del lado que tiene arreglo con `LLM_DIALECT`.
 */
export function dialectoDe(baseUrl: string): LlmDialecto {
  let host: string;
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return 'openai';
  }
  if (host.endsWith('anthropic.com')) return 'anthropic';
  if (host.endsWith('googleapis.com')) return 'gemini';
  return 'openai';
}

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  dialecto: LlmDialecto;
  /** Corta la llamada. Un modelo colgado deja la tarea colgada. */
  timeoutMs?: number;
  /** Reintentos ante 429 y 5xx. Los 4xx no se reintentan: son de configuración. */
  maxRetries?: number;
  maxTokens?: number;
  temperature?: number;
}

/** Una imagen que se le enseña al modelo. */
export interface LlmImagen {
  mime: string;
  bytes: Uint8Array;
}

export interface LlmPeticion {
  system?: string;
  user: string;
  /** Lo que el cliente adjuntó, ya filtrado a formatos que un modelo entiende. */
  imagenes?: LlmImagen[];
}

export class LlmError extends Error {
  constructor(
    message: string,
    /** De configuración: reintentarlo sólo gasta tiempo y dinero. */
    readonly fatal = false,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

/**
 * Lee la configuración del entorno.
 *
 * `LLM_PROVIDER` es el camino corto (`claude`, `kimi`, `gemini`…) y
 * `LLM_BASE_URL` el largo, para cualquiera que no esté en la lista. Si están
 * los dos, manda la URL: quien la escribe a mano sabe lo que quiere.
 */
export function resolverLlm(env: Record<string, string | undefined>): LlmConfig {
  const nombre = env.LLM_PROVIDER?.trim().toLowerCase();
  const preset = nombre ? PROVEEDORES[nombre] : undefined;
  if (nombre && !preset && !env.LLM_BASE_URL?.trim()) {
    throw new LlmError(
      `LLM_PROVIDER="${nombre}" no está en la lista (${Object.keys(PROVEEDORES).join(', ')}). ` +
        `Si tu proveedor no está, pon LLM_BASE_URL con su endpoint y ya.`,
      true,
    );
  }

  const baseUrl = (env.LLM_BASE_URL?.trim() || preset?.baseUrl || '').replace(/\/$/, '');
  if (!baseUrl) {
    throw new LlmError('Falta LLM_PROVIDER o LLM_BASE_URL: el agente no sabe a quién preguntarle.', true);
  }

  const model = env.LLM_MODEL?.trim() || preset?.modeloSugerido;
  if (!model) {
    throw new LlmError(`Falta LLM_MODEL: ${baseUrl} no tiene un modelo por defecto que se pueda suponer.`, true);
  }

  const forzado = env.LLM_DIALECT?.trim().toLowerCase();
  if (forzado && forzado !== 'openai' && forzado !== 'anthropic' && forzado !== 'gemini') {
    throw new LlmError(`LLM_DIALECT="${forzado}" no existe. Es openai, anthropic o gemini.`, true);
  }

  return {
    baseUrl,
    apiKey: env.LLM_API_KEY?.trim() ?? '',
    model,
    dialecto: (forzado as LlmDialecto | undefined) ?? preset?.dialecto ?? dialectoDe(baseUrl),
    ...(env.LLM_TIMEOUT_MS ? { timeoutMs: Number(env.LLM_TIMEOUT_MS) } : {}),
    ...(env.LLM_MAX_TOKENS ? { maxTokens: Number(env.LLM_MAX_TOKENS) } : {}),
  };
}

// ---------------------------------------------------------------------------
// Imágenes
// ---------------------------------------------------------------------------

/**
 * Los formatos que aceptan los tres dialectos a la vez.
 *
 * Es la intersección y no la unión: un agente que acepta un TIFF porque su
 * proveedor de hoy lo admite se rompe el día que cambie de proveedor, y se
 * rompe con el cliente esperando y el pago bloqueado.
 */
export const MIMES_IMAGEN = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;

/** Tope por imagen. Por encima, los proveedores empiezan a rechazar peticiones. */
export const MAX_IMAGEN_BYTES = 5 * 1024 * 1024;

export function esImagenSoportada(mime: string | undefined): boolean {
  return !!mime && (MIMES_IMAGEN as readonly string[]).includes(mime.toLowerCase());
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** base64 a mano: ni Buffer (Node) ni btoa (navegador), así vale en los dos. */
function aBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const trio = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += B64[(trio >> 18) & 63]! + B64[(trio >> 12) & 63]!;
    out += b === undefined ? '=' : B64[(trio >> 6) & 63]!;
    out += c === undefined ? '=' : B64[trio & 63]!;
  }
  return out;
}

function prepararImagenes(imagenes: LlmImagen[]): { mime: string; b64: string }[] {
  return imagenes.map((img) => {
    const mime = img.mime.toLowerCase();
    if (!esImagenSoportada(mime)) {
      throw new LlmError(`No se puede enseñar un ${img.mime} a un modelo. Sólo ${MIMES_IMAGEN.join(', ')}.`, true);
    }
    if (img.bytes.byteLength > MAX_IMAGEN_BYTES) {
      throw new LlmError(
        `Una imagen de ${img.bytes.byteLength} bytes pasa del tope de ${MAX_IMAGEN_BYTES}. Redúcela antes de mandarla.`,
        true,
      );
    }
    return { mime, b64: aBase64(img.bytes) };
  });
}

// ---------------------------------------------------------------------------
// Los tres dialectos
// ---------------------------------------------------------------------------

interface Peticion {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

function construir(cfg: LlmConfig, pet: LlmPeticion): Peticion {
  const imgs = prepararImagenes(pet.imagenes ?? []);
  const maxTokens = cfg.maxTokens ?? 4096;
  const base = cfg.baseUrl.replace(/\/$/, '');

  if (cfg.dialecto === 'anthropic') {
    // La base puede venir con o sin /v1 según de dónde la haya copiado quien
    // configura; las dos formas circulan en la documentación de todo el mundo.
    const url = /\/v1$/.test(base) ? `${base}/messages` : `${base}/v1/messages`;
    return {
      url,
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: {
        model: cfg.model,
        max_tokens: maxTokens,
        ...(pet.system ? { system: pet.system } : {}),
        messages: [
          {
            role: 'user',
            content: [
              ...imgs.map((i) => ({
                type: 'image',
                source: { type: 'base64', media_type: i.mime, data: i.b64 },
              })),
              { type: 'text', text: pet.user },
            ],
          },
        ],
      },
    };
  }

  if (cfg.dialecto === 'gemini') {
    return {
      url: `${base}/models/${encodeURIComponent(cfg.model)}:generateContent`,
      // La clave va en cabecera y no en la query: una URL acaba en los logs
      // del proxy, en el historial y en el `Referer`, y una clave ahí es una
      // clave regalada.
      headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.apiKey },
      body: {
        ...(pet.system ? { systemInstruction: { parts: [{ text: pet.system }] } } : {}),
        contents: [
          {
            role: 'user',
            parts: [
              ...imgs.map((i) => ({ inline_data: { mime_type: i.mime, data: i.b64 } })),
              { text: pet.user },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: maxTokens,
          ...(cfg.temperature === undefined ? {} : { temperature: cfg.temperature }),
        },
      },
    };
  }

  // openai. El contenido va como STRING cuando no hay imágenes: la forma de
  // array es válida en la especificación, pero unos cuantos clones compatibles
  // la rechazan, y no hay motivo para arriesgarse en el caso normal.
  return {
    url: `${base}/chat/completions`,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
    body: {
      model: cfg.model,
      max_tokens: maxTokens,
      ...(cfg.temperature === undefined ? {} : { temperature: cfg.temperature }),
      messages: [
        ...(pet.system ? [{ role: 'system', content: pet.system }] : []),
        {
          role: 'user',
          content: imgs.length
            ? [
                { type: 'text', text: pet.user },
                ...imgs.map((i) => ({
                  type: 'image_url',
                  image_url: { url: `data:${i.mime};base64,${i.b64}` },
                })),
              ]
            : pet.user,
        },
      ],
    },
  };
}

/**
 * Baja por una ruta de un JSON ajeno sin fiarse de ningún tramo.
 *
 * Lo que contesta el proveedor no lo controlamos, y un `choices[0].message`
 * que hoy existe puede llegar mañana como `null` en mitad de una incidencia
 * suya. Devolver `undefined` en vez de reventar deja que el error que se
 * enseñe sea el de arriba, que sí explica lo que pasó.
 */
function campo(raiz: unknown, ...ruta: (string | number)[]): unknown {
  let actual: unknown = raiz;
  for (const paso of ruta) {
    if (actual === null || typeof actual !== 'object') return undefined;
    actual = (actual as Record<string | number, unknown>)[paso];
  }
  return actual;
}

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor : '';
}

/** Junta el texto de una lista de bloques, saltándose lo que no lo sea. */
function juntarBloques(bloques: unknown, clave: string, tipo?: string): string {
  if (!Array.isArray(bloques)) return '';
  return bloques
    .map((b) => (tipo && campo(b, 'type') !== tipo ? '' : texto(campo(b, clave))))
    .join('')
    .trim();
}

function leer(dialecto: LlmDialecto, json: unknown): string {
  const error = texto(campo(json, 'error', 'message'));

  if (dialecto === 'anthropic') {
    const salida = juntarBloques(campo(json, 'content'), 'text', 'text');
    if (salida) return salida;
    if (campo(json, 'stop_reason') === 'refusal') {
      throw new LlmError('El modelo se negó a responder a este encargo.', true);
    }
    throw new LlmError(`Respuesta sin texto: ${error || texto(campo(json, 'stop_reason')) || 'vacía'}`);
  }

  if (dialecto === 'gemini') {
    const salida = juntarBloques(campo(json, 'candidates', 0, 'content', 'parts'), 'text');
    if (salida) return salida;
    const motivo =
      texto(campo(json, 'candidates', 0, 'finishReason')) || texto(campo(json, 'promptFeedback', 'blockReason'));
    throw new LlmError(`Respuesta sin texto: ${error || motivo || 'sin candidatos'}`);
  }

  const salida = texto(campo(json, 'choices', 0, 'message', 'content')).trim();
  if (!salida) throw new LlmError(`Respuesta sin texto: ${error || 'choices vacío'}`);
  return salida;
}

function dormir(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Una pregunta, una respuesta, con reintentos.
 *
 * Se reintentan 429 y 5xx —el proveedor está saturado, es cuestión de
 * esperar— y NO se reintenta un 4xx: una clave mal escrita o un modelo que no
 * existe dan lo mismo al segundo intento, y mientras tanto el plazo de la
 * tarea corre.
 */
export async function llmChat(cfg: LlmConfig, pet: LlmPeticion): Promise<string> {
  if (!cfg.apiKey && !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(cfg.baseUrl)) {
    throw new LlmError('Falta LLM_API_KEY.', true);
  }

  const { url, headers, body } = construir(cfg, pet);
  const maxRetries = cfg.maxRetries ?? 2;
  const timeoutMs = cfg.timeoutMs ?? 120_000;
  let ultimo: unknown;

  for (let intento = 0; intento <= maxRetries; intento++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (res.status === 429 || res.status >= 500) {
        throw new LlmError(`HTTP ${res.status} ${res.statusText}`);
      }
      if (!res.ok) {
        const cuerpo = await res.text().catch(() => '');
        throw new LlmError(`HTTP ${res.status}: ${cuerpo.slice(0, 300)}`, true);
      }
      return leer(cfg.dialecto, await res.json());
    } catch (err) {
      ultimo = err;
      if (err instanceof LlmError && err.fatal) throw err;
      if (intento < maxRetries) await dormir(Math.min(2_000 * 2 ** intento, 30_000));
    }
  }
  throw ultimo instanceof Error ? ultimo : new LlmError(String(ultimo));
}
