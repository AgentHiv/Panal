/**
 * El modelo es libre: los tres dialectos, y que la foto llegue en el formato
 * que cada uno entiende.
 *
 * Hermético: se sustituye `fetch` y no sale una sola petición. Lo que se
 * comprueba es lo que se manda por el cable, porque un campo mal puesto aquí
 * se descubre en producción con el cliente esperando y el pago bloqueado.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LlmError,
  MAX_IMAGEN_BYTES,
  dialectoDe,
  esImagenSoportada,
  llmChat,
  resolverLlm,
  type LlmConfig,
} from '../src/llm.js';

const FOTO = { mime: 'image/png', bytes: new Uint8Array([137, 80, 78, 71]) };
const CFG: LlmConfig = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'k',
  model: 'm',
  dialecto: 'openai',
  maxRetries: 0,
};

/** Sustituye fetch, devuelve lo que se pidió y con qué. */
async function espiar(
  cfg: LlmConfig,
  respuesta: unknown,
  pet: Parameters<typeof llmChat>[1] = { user: 'hola' },
  // El cuerpo se navega sin ceremonia: es el JSON que construye este mismo
  // archivo tres líneas más arriba, y comprobarlo campo a campo es el test.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ url: string; headers: Record<string, string>; body: any; texto: string }> {
  const original = globalThis.fetch;
  let visto: { url: string; init: RequestInit } | null = null;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    visto = { url, init };
    return { ok: true, status: 200, statusText: 'OK', json: async () => respuesta } as unknown as Response;
  }) as unknown as typeof fetch;
  try {
    const texto = await llmChat(cfg, pet);
    const v = visto as unknown as { url: string; init: RequestInit };
    return {
      url: v.url,
      headers: v.init.headers as Record<string, string>,
      body: JSON.parse(v.init.body as string),
      texto,
    };
  } finally {
    globalThis.fetch = original;
  }
}

const OPENAI_OK = { choices: [{ message: { content: 'respondido' } }] };
const ANTHROPIC_OK = { content: [{ type: 'text', text: 'respondido' }] };
const GEMINI_OK = { candidates: [{ content: { parts: [{ text: 'respondido' }] } }] };

test('el dialecto se adivina por el host', () => {
  assert.equal(dialectoDe('https://api.anthropic.com'), 'anthropic');
  assert.equal(dialectoDe('https://generativelanguage.googleapis.com/v1beta'), 'gemini');
  assert.equal(dialectoDe('https://api.moonshot.ai/v1'), 'openai');
  assert.equal(dialectoDe('https://api.x.ai/v1'), 'openai');
  // Lo desconocido se trata como OpenAI, que es lo que implementa casi todo.
  assert.equal(dialectoDe('https://algo-nuevo.example/v1'), 'openai');
});

test('un proveedor por nombre trae URL, dialecto y modelo', () => {
  const cfg = resolverLlm({ LLM_PROVIDER: 'claude', LLM_API_KEY: 'k' });
  assert.equal(cfg.dialecto, 'anthropic');
  assert.match(cfg.baseUrl, /anthropic\.com/);
  assert.ok(cfg.model);
});

test('LLM_MODEL manda sobre el sugerido', () => {
  const cfg = resolverLlm({ LLM_PROVIDER: 'kimi', LLM_API_KEY: 'k', LLM_MODEL: 'kimi-nuevo' });
  assert.equal(cfg.model, 'kimi-nuevo');
});

test('un proveedor que no está en la lista se dice, no se adivina', () => {
  assert.throws(
    () => resolverLlm({ LLM_PROVIDER: 'inventado', LLM_API_KEY: 'k' }),
    (err: unknown) => {
      assert.ok(err instanceof LlmError);
      // Fatal: reintentarlo no lo arregla, hay que tocar el .env.
      assert.ok(err.fatal);
      assert.match(err.message, /LLM_BASE_URL/);
      return true;
    },
  );
});

test('sin proveedor ni URL no se arranca a ciegas', () => {
  assert.throws(() => resolverLlm({ LLM_API_KEY: 'k' }), /LLM_PROVIDER o LLM_BASE_URL/);
});

test('una URL a pelo vale para cualquiera que no esté en la lista', () => {
  const cfg = resolverLlm({ LLM_BASE_URL: 'https://lo-que-sea.example/v1', LLM_MODEL: 'x', LLM_API_KEY: 'k' });
  assert.equal(cfg.dialecto, 'openai');
  assert.equal(cfg.baseUrl, 'https://lo-que-sea.example/v1');
});

test('openai: la foto va como data URI y la clave en Authorization', async () => {
  const { url, headers, body, texto } = await espiar(CFG, OPENAI_OK, { user: 'mira', imagenes: [FOTO] });
  assert.equal(url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(headers.authorization, 'Bearer k');
  assert.equal(body.messages[0].content[0].type, 'text');
  assert.equal(body.messages[0].content[1].image_url.url, 'data:image/png;base64,iVBORw==');
  assert.equal(texto, 'respondido');
});

test('openai: sin fotos el contenido es un string, no un array', async () => {
  // La forma de array es válida, pero varios clones compatibles la rechazan.
  const { body } = await espiar(CFG, OPENAI_OK);
  assert.equal(typeof body.messages[0].content, 'string');
});

test('anthropic: bloque image con source base64 y x-api-key', async () => {
  const cfg: LlmConfig = { ...CFG, baseUrl: 'https://api.anthropic.com', dialecto: 'anthropic' };
  const { url, headers, body } = await espiar(cfg, ANTHROPIC_OK, { user: 'mira', imagenes: [FOTO], system: 's' });
  assert.equal(url, 'https://api.anthropic.com/v1/messages');
  assert.equal(headers['x-api-key'], 'k');
  assert.equal(headers['anthropic-version'], '2023-06-01');
  // El system va fuera de messages, que es lo que cambia respecto a OpenAI.
  assert.equal(body.system, 's');
  assert.deepEqual(body.messages[0].content[0].source, {
    type: 'base64',
    media_type: 'image/png',
    data: 'iVBORw==',
  });
  assert.ok(body.max_tokens > 0, 'anthropic exige max_tokens');
});

test('anthropic: la base con /v1 no lo duplica', async () => {
  const cfg: LlmConfig = { ...CFG, baseUrl: 'https://api.anthropic.com/v1', dialecto: 'anthropic' };
  const { url } = await espiar(cfg, ANTHROPIC_OK);
  assert.equal(url, 'https://api.anthropic.com/v1/messages');
});

test('gemini: inline_data, y la clave en cabecera y no en la query', async () => {
  const cfg: LlmConfig = {
    ...CFG,
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-2.0-flash',
    dialecto: 'gemini',
  };
  const { url, headers, body } = await espiar(cfg, GEMINI_OK, { user: 'mira', imagenes: [FOTO], system: 's' });
  assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent');
  assert.equal(headers['x-goog-api-key'], 'k');
  // Una clave en la URL acaba en logs, historial y Referer.
  assert.ok(!url.includes('k'), 'la clave no puede ir en la URL');
  assert.equal(body.systemInstruction.parts[0].text, 's');
  assert.deepEqual(body.contents[0].parts[0].inline_data, { mime_type: 'image/png', data: 'iVBORw==' });
});

test('cada dialecto sabe leer su respuesta', async () => {
  assert.equal((await espiar(CFG, OPENAI_OK)).texto, 'respondido');
  assert.equal((await espiar({ ...CFG, dialecto: 'anthropic' }, ANTHROPIC_OK)).texto, 'respondido');
  assert.equal((await espiar({ ...CFG, dialecto: 'gemini' }, GEMINI_OK)).texto, 'respondido');
});

test('un formato que ningún modelo mira se rechaza antes de gastar la llamada', async () => {
  await assert.rejects(
    llmChat(CFG, { user: 'x', imagenes: [{ mime: 'image/tiff', bytes: new Uint8Array([1]) }] }),
    /image\/tiff/,
  );
  assert.ok(!esImagenSoportada('application/pdf'));
  assert.ok(esImagenSoportada('image/JPEG'));
});

test('una imagen demasiado grande se rechaza aquí y no en el proveedor', async () => {
  const enorme = { mime: 'image/png', bytes: new Uint8Array(MAX_IMAGEN_BYTES + 1) };
  await assert.rejects(llmChat(CFG, { user: 'x', imagenes: [enorme] }), /tope/);
});

test('un 400 no se reintenta y un 429 sí', async () => {
  const original = globalThis.fetch;
  let llamadas = 0;
  try {
    globalThis.fetch = (async () => {
      llamadas++;
      return { ok: false, status: 400, statusText: 'Bad', text: async () => 'modelo inexistente' } as Response;
    }) as unknown as typeof fetch;
    await assert.rejects(llmChat({ ...CFG, maxRetries: 3 }, { user: 'x' }), /400/);
    assert.equal(llamadas, 1, 'un 4xx es de configuración: reintentarlo sólo gasta el plazo');

    llamadas = 0;
    globalThis.fetch = (async () => {
      llamadas++;
      return { ok: false, status: 429, statusText: 'Too Many' } as Response;
    }) as unknown as typeof fetch;
    await assert.rejects(llmChat({ ...CFG, maxRetries: 1 }, { user: 'x' }), /429/);
    assert.equal(llamadas, 2);
  } finally {
    globalThis.fetch = original;
  }
});

test('sin clave no se sale a la red, salvo en local', async () => {
  await assert.rejects(llmChat({ ...CFG, apiKey: '' }, { user: 'x' }), /LLM_API_KEY/);
  // Ollama en local no pide clave: obligarla impediría probar sin gastar.
  const local: LlmConfig = { ...CFG, apiKey: '', baseUrl: 'http://localhost:11434/v1' };
  assert.equal((await espiar(local, OPENAI_OK)).texto, 'respondido');
});
