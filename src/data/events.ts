/**
 * Panal — Eventos del feed en vivo (en-vivo.md, home.md S1/S5)
 * Tipos + semillas + generador cliente de eventos simulados.
 */

export type LiveEventType = 'contratacion' | 'pago' | 'registro' | 'entrega' | 'disputa';
export type PartyKind = 'agente' | 'humano';

export interface LiveEvent {
  id: string;
  type: LiveEventType;
  from: string;
  fromKind: PartyKind;
  to?: string;
  toKind?: PartyKind;
  task?: string;
  amount?: number; // MON
  txHash: string;
  /** segundos desde que ocurrió (los timers lo incrementan en vivo) */
  secondsAgo: number;
  /** badge de relación, p. ej. "agente↔agente" */
  relation?: string;
}

export interface TickerItem {
  hash: string;
  actor: string;
  target: string;
  task: string;
  amount: string; // "0.010 MON"
  time: string; // "812ms"
}

/* ---------- Hashes ---------- */

const HEX = '0123456789abcdefABCDEF';

export function randomTxHash(rng: () => number = Math.random): string {
  let h = '0x';
  for (let i = 0; i < 40; i++) h += HEX[Math.floor(rng() * HEX.length)];
  return h;
}

/** "0x3f9a…c21e" */
export function truncateHash(hash: string): string {
  if (hash.length <= 12) return hash;
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}

/* ---------- Ticker del hero (home.md S1) ---------- */

export const TICKER_ITEMS: TickerItem[] = [
  { hash: '0x3f9a…c21e', actor: '0x3f9a…c21e', target: 'TranslatorBot', task: 'Traducción ES→EN', amount: '0.010 MON', time: '812ms' },
  { hash: '0x8b2f…9d04', actor: 'DataScout', target: 'PriceOracle Bot', task: 'Verificación de precio', amount: '0.001 MON', time: '640ms' },
  { hash: '0x51cd…77ab', actor: '0x7A4f…f9B2', target: 'CodeAuditor', task: 'Auditoría completa', amount: '0.150 MON', time: '795ms' },
  { hash: '0xa9e3…3f18', actor: 'DeFiFactory', target: 'LegalReviewer', task: 'Revisión de términos', amount: '0.080 MON', time: '880ms' },
  { hash: '0x22b7…e4c9', actor: 'ResearchAgent', target: 'SummarizerAI', task: 'Resumen de informe', amount: '0.005 MON', time: '720ms' },
  { hash: '0x6d41…b8f2', actor: 'HelenaRojas.eth', target: 'StudioNadir', task: 'Sprint de identidad', amount: '0.800 MON', time: '910ms' },
  { hash: '0xc308…55d1', actor: 'YieldKeeper', target: 'DataScout', task: 'Análisis de flujos', amount: '0.050 MON', time: '845ms' },
  { hash: '0x94ee…02c6', actor: '0xB22…9eF0', target: 'ImageAnalyst', task: 'OCR de facturas', amount: '0.020 MON', time: '770ms' },
  { hash: '0x1a5b…d987', actor: 'SentryGuard', target: 'PriceOracle Bot', task: 'Feed MON/USD', amount: '0.001 MON', time: '615ms' },
  { hash: '0x73f0…4b2a', actor: '0x8F1c…2Aa4', target: 'SummarizerAI', task: 'Resumen ejecutivo', amount: '0.005 MON', time: '830ms' },
];

/* ---------- Mini-feed del home (home.md S5) ---------- */

export const MINI_FEED_SEED: LiveEvent[] = [
  { id: 'mf-1', type: 'contratacion', from: 'DataScout', fromKind: 'agente', to: 'PriceOracle Bot', toKind: 'agente', task: 'Verificación de precio', amount: 0.001, txHash: '0x8b2f41d6c3a5b7e9f1d3c5a7b9e1d3f5a7b99d04', secondsAgo: 4, relation: 'agente↔agente' },
  { id: 'mf-2', type: 'pago', from: 'PanalEscrow', fromKind: 'agente', to: 'TranslatorBot', toKind: 'agente', task: 'Escrow liberado tras verificación · 812 ms', amount: 0.00975, txHash: '0x51cd82e4b6a8c0d2e4f6a8b0c2d4e6a8c0e277ab', secondsAgo: 9 },
  { id: 'mf-3', type: 'contratacion', from: '0x7A4f…f9B2', fromKind: 'humano', to: 'CodeAuditor', toKind: 'agente', task: 'Auditoría completa + parche', amount: 0.3, txHash: '0xa9e3c5b7d9f1a3c5e7b9d1f3a5c7e9b1d3f53f18', secondsAgo: 14, relation: 'humano→agente' },
  { id: 'mf-4', type: 'entrega', from: 'SummarizerAI', fromKind: 'agente', task: 'hash anclado on-chain · 0x77ab…', txHash: '0x22b7d4f6a8c0e2a4c6e8b0d2f4a6c8e0b2d4e4c9', secondsAgo: 21 },
  { id: 'mf-5', type: 'registro', from: 'SentimentHive', fromKind: 'agente', task: 'Categoría: Datos · 0.008 MON/tarea', txHash: '0x6d41e8a0c2e4b6d8f0a2c4e6b8d0f2a4c6e8b8f2', secondsAgo: 33 },
];

/* ---------- Generador de eventos (en-vivo.md §Rendimiento) ---------- */

const TASK_POOL = [
  'Verificación de precio ETH/USD',
  'Traducción de documentación',
  'Resumen ejecutivo de informe',
  'Auditoría express de contrato',
  'Análisis de flujos de wallet',
  'OCR de lote de facturas',
  'Revisión de términos v2',
  'Feed MON/USD firmado',
  'Síntesis de research con citas',
  'Monitoreo de TVL 24h',
  'Moderación de imágenes',
  'Rebalanceo de liquidez',
];

const HUMAN_WALLETS = ['0x7A4f…f9B2', '0xB22…9eF0', '0x8F1c…2Aa4', '0x3E7d…91Bc', '0xC44…7e21'];

const NEW_AGENT_NAMES = ['SentimentHive', 'PixelForge', 'LexisBot', 'QuantSage', 'EchoScribe', 'VaultWarden'];

export interface GenerateOptions {
  rng?: () => number;
  agentNames?: string[];
}

let counter = 0;

/**
 * Un evento simulado por llamada (en-vivo.md: 60% agente↔agente, 25% humano→agente,
 * 10% registros/entregas, 5% varios — disputas ~2%).
 */
export function generateLiveEvent(opts: GenerateOptions = {}): LiveEvent {
  const rng = opts.rng ?? Math.random;
  const names = opts.agentNames ?? [
    'CodeAuditor', 'LegalReviewer', 'TranslatorBot', 'ResearchAgent', 'SummarizerAI',
    'DataScout', 'ImageAnalyst', 'PriceOracle Bot', 'SentryGuard', 'YieldKeeper',
  ];
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];
  const pick2 = (): [string, string] => {
    const a = pick(names);
    let b = pick(names);
    while (b === a) b = pick(names);
    return [a, b];
  };

  const roll = rng();
  counter += 1;
  const id = `ev-${Date.now()}-${counter}`;
  const txHash = randomTxHash(rng);

  if (roll < 0.02) {
    // Disputa (raro)
    const [a] = pick2();
    return {
      id, type: 'disputa', from: a, fromKind: 'agente', to: pick(HUMAN_WALLETS), toKind: 'humano',
      task: `Disputa abierta #D-${100 + Math.floor(rng() * 50)} · jurado convocado`,
      txHash, secondsAgo: 0,
    };
  }
  if (roll < 0.07) {
    // Registro
    return {
      id, type: 'registro', from: pick(NEW_AGENT_NAMES), fromKind: 'agente',
      task: `Nuevo agente en el panal · ${(rng() * 0.05 + 0.001).toFixed(3)} MON/tarea`,
      txHash, secondsAgo: 0,
    };
  }
  if (roll < 0.12) {
    // Entrega
    return {
      id, type: 'entrega', from: pick(names), fromKind: 'agente',
      task: `entregó resultado · hash anclado on-chain`,
      txHash, secondsAgo: 0,
    };
  }
  if (roll < 0.37) {
    // Pago liberado
    const amount = Math.round(rng() * 2000) / 100000 + 0.001;
    return {
      id, type: 'pago', from: 'PanalEscrow', fromKind: 'agente', to: pick(names), toKind: 'agente',
      task: `Escrow liberado tras verificación · ${Math.floor(600 + rng() * 350)} ms`,
      amount, txHash, secondsAgo: 0,
    };
  }
  // Contratación (60% agente↔agente, 25% humano→agente)
  const humano = roll > 0.75;
  const [a, b] = pick2();
  const amount = Math.round(rng() * 3000) / 100000 + 0.001;
  return {
    id,
    type: 'contratacion',
    from: humano ? pick(HUMAN_WALLETS) : a,
    fromKind: humano ? 'humano' : 'agente',
    to: b,
    toKind: 'agente',
    task: pick(TASK_POOL),
    amount,
    txHash,
    secondsAgo: 0,
    relation: humano ? 'humano→agente' : 'agente↔agente',
  };
}

/** "hace 4s" / "hace 2 min" / "hace 1 h" */
export function timeAgoEs(seconds: number): string {
  if (seconds < 5) return 'ahora mismo';
  if (seconds < 60) return `hace ${Math.floor(seconds)}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  return `hace ${h} h`;
}
