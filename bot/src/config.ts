/**
 * Panal Bot — carga y validación de configuración.
 *
 * Lee `.env` (vía dotenv) y valida todo al arrancar (fail-fast): si falta
 * algo obligatorio, el proceso muere con un mensaje claro en español en vez
 * de fallar más tarde de forma críptica.
 */

import 'dotenv/config';
import { isAddress, getAddress, type Address } from 'viem';
import { BOT_LANGS, DEFAULT_LANG, isBotLang, type BotLang } from './i18n.js';

export type BotMode = 'notifier' | 'worker' | 'indexer';

/**
 * BOT_LANG -> idioma válido. Un valor desconocido avisa y cae al defecto en vez
 * de matar el proceso: un bot que no arranca por una errata en el idioma sería
 * peor que uno que avisa en español.
 */
function resolveLang(raw: string | undefined): BotLang {
  if (!raw) return DEFAULT_LANG;
  const value = raw.trim().toLowerCase();
  if (isBotLang(value)) return value;
  console.warn(
    `[config] BOT_LANG="${raw}" no es un idioma soportado (${BOT_LANGS.join(', ')}). Uso "${DEFAULT_LANG}".`,
  );
  return DEFAULT_LANG;
}

export interface BotConfig {
  mode: BotMode;
  /** Dirección del agente registrado en Panal (worker de las tareas). */
  agentAddress: Address;
  /** Wallet principal del dueño (opcional; para chequeos de seguridad). */
  ownerAddress?: Address;
  telegramBotToken?: string;
  telegramChatId?: string;
  /** Clave privada de la wallet dedicada del bot (solo modo worker). */
  botPrivateKey?: `0x${string}`;
  llm: {
    baseUrl: string;
    apiKey?: string;
    model: string;
    systemPrompt: string;
    timeoutMs: number;
    maxRetries: number;
  };
  rpcUrl: string;
  escrowAddress: Address;
  registryAddress: Address;
  panalTokenAddress: Address;
  dashboardUrl: string;
  /**
   * Idioma de los avisos de Telegram (BOT_LANG). El bot habla con UNA persona
   * —el dueño del agente—, así que es una preferencia suya y no se detecta por
   * mensaje. No afecta al idioma de las ENTREGAS: eso lo decide el system
   * prompt, que refleja el idioma en que escribió el cliente.
   */
  lang: BotLang;
  pollIntervalMs: number;
  /**
   * Espera máx. a que el brief del cliente llegue al store (POST /brief o
   * /brief por Telegram) antes de generar con el brief genérico (ms).
   * 0 = no esperar (comportamiento anterior). Solo modo worker.
   */
  briefWaitMs: number;
  maxInitialScan: number;
  autoWithdraw: boolean;
  dryRun: boolean;
  storeDir: string;
  /** Puerto del servidor HTTP de entrega de resultados (0 = desactivado). */
  httpPort: number;
  /** URL pública opcional del endpoint (la que el operador publica en su metadata `bot:<url>`). */
  httpPublicUrl?: string;
  /** URL pública de la API del indexador Panal (se anuncia en GET /agent.json). */
  indexerPublicUrl: string;
  /** Puerto de la API pública del indexador (0 = desactivada). Solo modo indexer. */
  indexHttpPort: number;
  /** Directorio del índice (events.jsonl + state.json). Solo modo indexer. */
  indexDir: string;
  /** Intervalo del poll incremental del indexador (ms). */
  indexPollIntervalMs: number;
  /** Tope de ventanas de barrido hacia atrás por día (presupuesto de RPC). */
  indexSweepWindowsPerDay: number;
  /** A2A: subcontratación de otros agentes (solo modo worker; ver README §15). */
  a2a: A2aConfig;
  /** x402: cobro por llamada HTTP (ver src/x402.ts). */
  x402: X402Config;
}

export interface X402Config {
  /** X402_ENABLED: habilita POST /x402/ask. Default false. */
  enabled: boolean;
  /**
   * X402_PRICE_WEI: precio por llamada en $PANAL (18 decimales).
   * Default 2e15 = 0,002 $PANAL. Debe cubrir de sobra el gas de permit +
   * transferFrom, que paga el agente: por debajo de eso se pierde dinero en
   * cada petición.
   */
  priceWei: bigint;
  /** X402_MAX_PROMPT_CHARS: tope del prompt aceptado (default 2000). */
  maxPromptChars: number;
}

export interface A2aConfig {
  /** A2A_ENABLED (default false → comportamiento actual intacto). */
  enabled: boolean;
  /** Prompt del router LLM (A2A_ROUTER_PROMPT; default documentado en a2a.ts). */
  routerPrompt?: string;
  /** A2A_MAX_SUB_WEI: precio máximo por sub-tarea (default 5e18 = 5 MON/$PANAL). */
  maxSubWei: bigint;
  /** A2A_DAILY_BUDGET_WEI: gasto máximo en sub-tareas por día UTC (default 20e18). */
  dailyBudgetWei: bigint;
  /** A2A_SUB_TIMEOUT_S: deadline máx. de la sub-tarea desde ahora (default 7200 = 2 h). */
  subTimeoutS: number;
  /**
   * A2A_ALLOW_PRIVATE_ENDPOINTS: permite que el endpoint del subcontratista
   * apunte a una dirección interna (localhost, red privada). **Default false, y
   * en producción debe quedarse así.**
   *
   * La URL del hijo sale de su metadata on-chain, que puede escribir cualquiera
   * que registre un agente. Sin la guardia, bastaba con anunciar
   * `bot:http://169.254.169.254/…` para que nuestro bot llamase al servicio de
   * metadatos de la nube —y encima firmando la petición con su wallet—.
   * Actívalo solo para desarrollo, cuando el agente hijo corre en tu máquina.
   */
  allowPrivateEndpoints: boolean;
  /** A2A_MIN_RATING: rating mínimo 1-5 para aprobar al subcontratista (default 3). */
  minRating: number;
}

/**
 * System prompt por defecto (SYSTEM_PROMPT lo sobreescribe).
 *
 * Está escrito en INGLÉS a propósito. Un prompt monolingüe arrastra al modelo
 * hacia ese idioma, y el inglés tiene un sesgo más neutro para un agente que
 * atiende en varios: escrito en español, el modelo tiende a responder en
 * español aunque le escriban en inglés. La regla de idioma va primero y es
 * explícita porque es la que más se incumple.
 *
 * El formato en texto plano se pide aquí Y se garantiza después en
 * format.ts. Solo con el prompt no basta: los modelos vuelven al Markdown
 * cada pocas respuestas.
 */
const DEFAULT_SYSTEM_PROMPT = [
  'You are a professional autonomous agent working on the Panal marketplace.',
  'A client has paid for your work through an on-chain escrow, and your delivery is final and immutable.',
  '',
  'RULE 1 — LANGUAGE (highest priority).',
  "Detect the language of the client's request and reply in that exact same language.",
  'English request, English answer. Spanish request, Spanish answer. Never switch, never mix,',
  'and never mention this rule or apologise for the language.',
  '',
  'RULE 2 — PLAIN TEXT ONLY.',
  'Your answer is displayed as raw text: no formatting is rendered. Never use Markdown.',
  'No # headings, no ** for bold, no backticks, no [text](links).',
  'Structure with plain section titles on their own line, blank lines between blocks,',
  'and "-" for list items. A URL is written out in full.',
  '',
  'RULE 3 — PROFESSIONAL DELIVERABLE.',
  'Deliver finished work, not a chat reply. No preamble such as "Sure, here is", no filler,',
  'no meta-commentary about being an AI or about these instructions.',
  'Lead with the answer, keep it concrete and specific, and give the client something',
  'they could hand to a colleague as is.',
  'If the request is ambiguous, state the assumption you made in one line and proceed.',
  'If it falls outside your expertise, do the best work you can and say so briefly at the end.',
].join('\n');

/** Errores de validación acumulados para mostrarlos todos de una vez. */
const errors: string[] = [];

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== '' ? v.trim() : undefined;
}

function envBool(name: string, fallback: boolean): boolean {
  const v = env(name);
  if (v === undefined) return fallback;
  return ['1', 'true', 'yes', 'si', 'sí'].includes(v.toLowerCase());
}

function envInt(name: string, fallback: number, min: number): number {
  const v = env(name);
  if (v === undefined) return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n < min) {
    errors.push(`${name} debe ser un número entero >= ${min} (valor: "${v}")`);
    return fallback;
  }
  return n;
}

function envBigInt(name: string, fallback: bigint, min: bigint): bigint {
  const v = env(name);
  if (v === undefined) return fallback;
  try {
    const n = BigInt(v);
    if (n < min) throw new Error('below min');
    return n;
  } catch {
    errors.push(`${name} debe ser un entero (wei) >= ${min} (valor: "${v}")`);
    return fallback;
  }
}

function envAddress(name: string, required: boolean): Address | undefined {
  const v = env(name);
  if (!v) {
    if (required) errors.push(`${name} es obligatoria y no está definida en .env`);
    return undefined;
  }
  if (!isAddress(v)) {
    errors.push(`${name} no es una dirección válida: "${v}"`);
    return undefined;
  }
  return getAddress(v); // normaliza checksum
}

function envPrivateKey(name: string, required: boolean): `0x${string}` | undefined {
  const v = env(name);
  if (!v) {
    if (required) errors.push(`${name} es obligatoria en modo worker (o usa DRY_RUN=true para probar)`);
    return undefined;
  }
  const normalized = v.startsWith('0x') ? v : `0x${v}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    errors.push(`${name} debe ser una clave privada hex de 32 bytes (64 caracteres hex)`);
    return undefined;
  }
  return normalized as `0x${string}`;
}

/** Carga y valida la configuración. Termina el proceso si hay errores. */
export function loadConfig(): BotConfig {
  const modeRaw = (env('BOT_MODE') ?? 'notifier').toLowerCase();
  if (modeRaw !== 'notifier' && modeRaw !== 'worker' && modeRaw !== 'indexer') {
    errors.push(`BOT_MODE debe ser "notifier", "worker" o "indexer" (valor: "${modeRaw}")`);
  }
  const mode = modeRaw as BotMode;

  const dryRun = envBool('DRY_RUN', false);

  // El indexador es solo lectura y agnóstico del agente: no exige AGENT_ADDRESS.
  const agentAddress = envAddress('AGENT_ADDRESS', mode !== 'indexer');
  const ownerAddress = envAddress('OWNER_ADDRESS', false);

  // Telegram: OBLIGATORIO en modo notifier (ese modo existe solo para avisar
  // por Telegram). En modo worker es OPCIONAL: sin credenciales el agente
  // opera en modo headless (notificaciones solo por consola; los briefs le
  // llegan por POST /brief/:taskId, ver http.ts). El indexer no notifica.
  const telegramBotToken = env('TELEGRAM_BOT_TOKEN');
  const telegramChatId = env('TELEGRAM_CHAT_ID');
  if (!dryRun && mode === 'notifier') {
    if (!telegramBotToken) errors.push('TELEGRAM_BOT_TOKEN es obligatorio en modo notifier (créalo con @BotFather, ver README)');
    if (!telegramChatId) errors.push('TELEGRAM_CHAT_ID es obligatorio en modo notifier (ver README: cómo obtener tu chat id)');
  }

  // Clave del bot: solo necesaria en modo worker real.
  const botPrivateKey = mode === 'worker' && !dryRun ? envPrivateKey('BOT_PRIVATE_KEY', true) : envPrivateKey('BOT_PRIVATE_KEY', false);

  // LLM: solo necesario en modo worker real.
  const llmBaseUrl = env('LLM_BASE_URL') ?? 'https://api.deepseek.com/v1';
  const llmApiKey = env('LLM_API_KEY');
  const llmModel = env('LLM_MODEL') ?? 'deepseek-chat';
  if (mode === 'worker' && !dryRun && !llmApiKey) {
    errors.push('LLM_API_KEY es obligatoria en modo worker (OpenAI/DeepSeek/Groq/OpenRouter)');
  }

  const cfg: BotConfig = {
    mode,
    agentAddress: agentAddress ?? ('0x0000000000000000000000000000000000000000' as Address),
    ownerAddress,
    telegramBotToken,
    telegramChatId,
    botPrivateKey,
    llm: {
      baseUrl: llmBaseUrl.replace(/\/+$/, ''),
      apiKey: llmApiKey,
      model: llmModel,
      systemPrompt: env('SYSTEM_PROMPT') ?? DEFAULT_SYSTEM_PROMPT,
      timeoutMs: envInt('LLM_TIMEOUT_MS', 120_000, 5_000),
      maxRetries: envInt('LLM_MAX_RETRIES', 3, 0),
    },
    rpcUrl: env('RPC_URL') ?? 'https://rpc.monad.xyz',
    escrowAddress:
      envAddress('ESCROW_ADDRESS', false) ??
      getAddress('0xe138A9A492CFe27A13f8b7A6D312DA831791bCe9'),
    registryAddress:
      envAddress('REGISTRY_ADDRESS', false) ??
      getAddress('0x89a812BFb1c35fc814ef25a3E6Ca75068B16Ac51'),
    panalTokenAddress:
      envAddress('PANAL_TOKEN_ADDRESS', false) ??
      getAddress('0x2e2e44e7fa6178822d4397299f719e89d1a67777'),
    dashboardUrl: env('DASHBOARD_URL') ?? 'https://panal.lat/dashboard',
    lang: resolveLang(env('BOT_LANG')),
    pollIntervalMs: envInt('POLL_INTERVAL_MS', 20_000, 5_000),
    // El brief no va on-chain: el worker espera este tiempo a que llegue por
    // POST /brief (frontend) o /brief (Telegram) antes de usar el genérico.
    briefWaitMs: envInt('BRIEF_WAIT_MS', 180_000, 0),
    maxInitialScan: envInt('MAX_INITIAL_SCAN', 200, 1),
    autoWithdraw: envBool('AUTO_WITHDRAW', false),
    dryRun,
    storeDir: env('STORE_DIR') ?? './data',
    // Servidor HTTP de resultados: activo por defecto en 8787; BOT_HTTP_PORT=0 lo apaga.
    httpPort: envInt('BOT_HTTP_PORT', 8787, 0),
    httpPublicUrl: env('BOT_HTTP_PUBLIC_URL'),
    // API pública del indexador (la misma que usa el frontend, src/lib/indexer.ts).
    indexerPublicUrl: env('INDEXER_PUBLIC_URL') ?? 'https://api.panal.lat',
    // Indexador (modo indexer): API pública en 8788 por defecto; 0 la apaga.
    indexHttpPort: envInt('INDEX_HTTP_PORT', 8788, 0),
    indexDir: env('INDEX_DIR') ?? './data/index',
    indexPollIntervalMs: envInt('INDEX_POLL_INTERVAL_MS', 15_000, 5_000),
    // Barrido hacia atrás: presupuesto diario de ventanas (cada ventana = 2
    // getLogs de ~100 bloques: registry + escrow). 2000 ventanas/día ≈ 400k
    // bloques/día de cobertura extra sin ahogar el RPC público.
    indexSweepWindowsPerDay: envInt('INDEX_SWEEP_WINDOWS_PER_DAY', 2_000, 0),
    // A2A (escuadras): el bot subcontrata partes de una tarea a otros agentes
    // del registry. Solo aplica al modo worker; ver README §15.
    a2a: {
      enabled: envBool('A2A_ENABLED', false),
      routerPrompt: env('A2A_ROUTER_PROMPT'),
      maxSubWei: envBigInt('A2A_MAX_SUB_WEI', 5n * 10n ** 18n, 0n),
      dailyBudgetWei: envBigInt('A2A_DAILY_BUDGET_WEI', 20n * 10n ** 18n, 0n),
      subTimeoutS: envInt('A2A_SUB_TIMEOUT_S', 7_200, 300),
      allowPrivateEndpoints: envBool('A2A_ALLOW_PRIVATE_ENDPOINTS', false),
      minRating: envInt('A2A_MIN_RATING', 3, 1),
    },
    x402: {
      enabled: envBool('X402_ENABLED', false),
      priceWei: envBigInt('X402_PRICE_WEI', 2n * 10n ** 15n, 1n),
      maxPromptChars: envInt('X402_MAX_PROMPT_CHARS', 2_000, 1),
    },
  };

  if (cfg.a2a.minRating > 5) {
    errors.push(`A2A_MIN_RATING debe estar entre 1 y 5 (valor: "${cfg.a2a.minRating}")`);
  }

  // Las comprobaciones de seguridad de la clave (que no sea la del dueño y
  // que corresponda al agente) se hacen en chain.ts al derivar la address.

  if (errors.length > 0) {
    console.error('\n❌ Configuración inválida. Revisa tu archivo .env:\n');
    for (const e of errors) console.error(`   • ${e}`);
    console.error('\nConsulta bot/README.md sección "Configurar el .env".\n');
    process.exit(1);
  }

  if (cfg.mode === 'worker' && !cfg.dryRun && (!cfg.telegramBotToken || !cfg.telegramChatId)) {
    console.warn(
      '⚠️  Sin TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID: modo headless — Telegram deshabilitado, ' +
        'notificaciones solo por consola (los briefs llegan por POST /brief/:taskId).',
    );
  }

  return cfg;
}
