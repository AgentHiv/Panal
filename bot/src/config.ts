/**
 * Panal Bot — carga y validación de configuración.
 *
 * Lee `.env` (vía dotenv) y valida todo al arrancar (fail-fast): si falta
 * algo obligatorio, el proceso muere con un mensaje claro en español en vez
 * de fallar más tarde de forma críptica.
 */

import 'dotenv/config';
import { isAddress, getAddress, type Address } from 'viem';

export type BotMode = 'notifier' | 'worker';

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
  panalTokenAddress: Address;
  dashboardUrl: string;
  pollIntervalMs: number;
  maxInitialScan: number;
  autoWithdraw: boolean;
  dryRun: boolean;
  storeDir: string;
  /** Puerto del servidor HTTP de entrega de resultados (0 = desactivado). */
  httpPort: number;
  /** URL pública opcional del endpoint (la que el operador publica en su metadata `bot:<url>`). */
  httpPublicUrl?: string;
}

const DEFAULT_SYSTEM_PROMPT =
  'Eres un agente autónomo del marketplace Panal. Responde al pedido del cliente ' +
  'de forma útil, concreta y en el idioma del pedido. Entrega siempre un resultado ' +
  'completo y bien formateado en Markdown.';

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
  if (modeRaw !== 'notifier' && modeRaw !== 'worker') {
    errors.push(`BOT_MODE debe ser "notifier" o "worker" (valor: "${modeRaw}")`);
  }
  const mode = modeRaw as BotMode;

  const dryRun = envBool('DRY_RUN', false);

  const agentAddress = envAddress('AGENT_ADDRESS', true);
  const ownerAddress = envAddress('OWNER_ADDRESS', false);

  // Telegram: obligatorio salvo dry-run (en seco solo se loguea por consola).
  const telegramBotToken = env('TELEGRAM_BOT_TOKEN');
  const telegramChatId = env('TELEGRAM_CHAT_ID');
  if (!dryRun) {
    if (!telegramBotToken) errors.push('TELEGRAM_BOT_TOKEN es obligatorio (créalo con @BotFather, ver README)');
    if (!telegramChatId) errors.push('TELEGRAM_CHAT_ID es obligatorio (ver README: cómo obtener tu chat id)');
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
    panalTokenAddress:
      envAddress('PANAL_TOKEN_ADDRESS', false) ??
      getAddress('0x2e2e44e7fa6178822d4397299f719e89d1a67777'),
    dashboardUrl: env('DASHBOARD_URL') ?? 'https://panal.lat/dashboard',
    pollIntervalMs: envInt('POLL_INTERVAL_MS', 20_000, 5_000),
    maxInitialScan: envInt('MAX_INITIAL_SCAN', 200, 1),
    autoWithdraw: envBool('AUTO_WITHDRAW', false),
    dryRun,
    storeDir: env('STORE_DIR') ?? './data',
    // Servidor HTTP de resultados: activo por defecto en 8787; BOT_HTTP_PORT=0 lo apaga.
    httpPort: envInt('BOT_HTTP_PORT', 8787, 0),
    httpPublicUrl: env('BOT_HTTP_PUBLIC_URL'),
  };

  // Las comprobaciones de seguridad de la clave (que no sea la del dueño y
  // que corresponda al agente) se hacen en chain.ts al derivar la address.

  if (errors.length > 0) {
    console.error('\n❌ Configuración inválida. Revisa tu archivo .env:\n');
    for (const e of errors) console.error(`   • ${e}`);
    console.error('\nConsulta bot/README.md sección "Configurar el .env".\n');
    process.exit(1);
  }

  return cfg;
}
