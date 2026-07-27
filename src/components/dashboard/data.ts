/**
 * Panal — Mocks tipados del panel de usuario (dashboard.md).
 * El dashboard no tiene backend: todos los datos viven aquí y el
 * "tiempo real" se simula en cliente (progreso de tareas, entregas).
 * Datos base del catálogo se consumen desde @/data/agents (sin modificar).
 */

import type { AgentCategory } from '@/data/agents';
import { AGENTS } from '@/data/agents';
import type { Agent } from '@/data/agents';

export type Perspective = 'proveedor' | 'cliente';

/* ---------- Formatters ---------- */

const nfES2 = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 1284.5 → "1.284,50" (texto corrido es-ES, dashboard.md S2/S7) */
export function formatMonEs(n: number): string {
  return nfES2.format(n);
}

/** 4.9 → "4,9" */
export function formatRatingEs(r: number): string {
  return r.toFixed(1).replace('.', ',');
}

/* ---------- KPIs (S2) ---------- */

export interface Kpi {
  id: string;
  label: string;
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  /** delta destacado (olive), p. ej. "+18,4%" */
  delta?: string;
  deltaIcon?: 'up' | 'none';
  /** línea secundaria, p. ej. "512 reseñas" */
  sub?: string;
}

export const KPIS: Record<Perspective, Kpi[]> = {
  proveedor: [
    { id: 'ingresos', label: 'dash.kpi.income', value: 96.32, decimals: 2, suffix: 'MON', delta: '+18,4%', deltaIcon: 'up' },
    { id: 'activas', label: 'dash.kpi.activeTasks', value: 23, sub: 'dash.kpi.inQueue' },
    { id: 'rating', label: 'dash.kpi.avgRating', value: 4.9, decimals: 1, suffix: '★', sub: 'dash.kpi.reviews' },
    { id: 'ranking', label: 'dash.kpi.rankingTexto', value: 12, prefix: '#', delta: 'dash.kpi.up3', deltaIcon: 'none' },
  ],
  cliente: [
    { id: 'gastado', label: 'dash.kpi.spent', value: 12.4, decimals: 2, suffix: 'MON', sub: 'dash.kpi.hires' },
    { id: 'pedidas', label: 'dash.kpi.requested', value: 8, sub: 'dash.kpi.inProgress' },
    { id: 'puntual', label: 'dash.kpi.onTime', value: 100, suffix: '%', sub: 'dash.kpi.claims' },
    { id: 'favoritos', label: 'dash.kpi.favorites', value: 2, sub: 'TranslatorBot · CodeAuditor' },
  ],
};

/* ---------- Gráfica de ganancias / gasto (S3) ---------- */

export interface EarningsPoint {
  label: string;
  mon: number;
  tareas: number;
}

/** Serie determinista (pseudo-aleatoria con semilla) para 7/30/90 días. */
function seededSeries(n: number, seed: number, base: number, amp: number, tBase: number): EarningsPoint[] {
  let s = seed;
  const rnd = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  const out: EarningsPoint[] = [];
  for (let i = 0; i < n; i++) {
    const wave = Math.sin((i / n) * Math.PI * 2.2) * 0.35;
    const mon = Math.max(0.4, base + amp * (rnd() * 0.7 + wave + i / (n * 3)));
    out.push({
      label: `${i + 1}`,
      mon: Math.round(mon * 100) / 100,
      tareas: Math.round(tBase + rnd() * tBase * 0.9),
    });
  }
  return out;
}

const DAYS_7 = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

export interface EarningsRanges {
  '7': EarningsPoint[];
  '30': EarningsPoint[];
  '90': EarningsPoint[];
}

export const EARNINGS: Record<Perspective, EarningsRanges> = {
  proveedor: {
    '7': seededSeries(7, 42, 2.6, 1.6, 30).map((p, i) => ({ ...p, label: DAYS_7[i] })),
    '30': seededSeries(30, 7, 2.2, 1.8, 34),
    '90': seededSeries(13, 99, 14, 7, 210).map((p, i) => ({ ...p, label: `S${i + 1}` })),
  },
  cliente: {
    '7': seededSeries(7, 13, 0.5, 0.4, 3).map((p, i) => ({ ...p, label: DAYS_7[i] })),
    '30': seededSeries(30, 21, 0.35, 0.3, 2),
    '90': seededSeries(13, 5, 2.4, 1.4, 14).map((p, i) => ({ ...p, label: `S${i + 1}` })),
  },
};

/* ---------- Donut por categoría (S3) ---------- */

export interface CategorySlice {
  name: string;
  pct: number;
  color: string;
}

export const CATEGORY_SPLIT: Record<Perspective, { title: string; center: string; centerLabel: string; slices: CategorySlice[] }> = {
  proveedor: {
    title: 'dash.donut.tasksByCategory',
    center: '1.284',
    centerLabel: 'dash.donut.tasks',
    slices: [
      { name: 'categories.texto', pct: 62, color: '#E29A2E' },
      { name: 'categories.datos', pct: 24, color: '#6E7B4E' },
      { name: 'categories.codigo', pct: 14, color: '#C9B68C' },
    ],
  },
  cliente: {
    title: 'dash.donut.spendByCategory',
    center: '12,40',
    centerLabel: 'dash.donut.mon30',
    slices: [
      { name: 'categories.texto', pct: 48, color: '#E29A2E' },
      { name: 'categories.codigo', pct: 37, color: '#6E7B4E' },
      { name: 'categories.datos', pct: 15, color: '#C9B68C' },
    ],
  },
};

/* ---------- Reputación en el tiempo (S3) ---------- */

export interface ReputationPoint {
  label: string;
  rating: number;
  milestone?: string;
}

export const REPUTATION_TIMELINE: ReputationPoint[] = [
  { label: 'may', rating: 4.6 },
  { label: 'jun', rating: 4.65 },
  { label: 'jul', rating: 4.7 },
  { label: 'ago', rating: 4.75, milestone: '1.000 tareas' },
  { label: 'sep', rating: 4.8 },
  { label: 'oct', rating: 4.85 },
  { label: 'nov', rating: 4.88, milestone: 'Top 25' },
  { label: 'dic', rating: 4.9 },
];

/* ---------- Mis agentes (S4) ---------- */

export interface OwnAgent {
  id: string;
  name: string;
  wallet: string;
  category: AgentCategory;
  pricePerTask: number;
  todayMon: number;
  tasks30d: number;
  rating: number;
  trend14d: number[];
}

export const OWN_AGENTS: OwnAgent[] = [
  {
    id: 'resumidorexpress',
    name: 'ResumidorExpress',
    wallet: '0x9E51f3A7b2C4d6E8a0B1c3D5e7F9a1B3c5D7e9F0',
    category: 'texto',
    pricePerTask: 0.004,
    todayMon: 2.41,
    tasks30d: 8213,
    rating: 4.8,
    trend14d: [1.6, 1.9, 1.7, 2.1, 2.0, 2.3, 2.2, 2.5, 2.3, 2.6, 2.4, 2.8, 2.5, 2.9],
  },
  {
    id: 'datamole',
    name: 'DataMole',
    wallet: '0xDa7A0b1e2F3a4B5c6D7e8F9a0B1c2D3e4F5a6B7',
    category: 'datos',
    pricePerTask: 0.018,
    todayMon: 1.12,
    tasks30d: 1402,
    rating: 4.7,
    trend14d: [0.7, 0.8, 0.9, 0.8, 1.0, 0.9, 1.1, 1.0, 1.2, 1.1, 1.0, 1.3, 1.2, 1.12],
  },
];

/** Favoritos de la vista cliente: 2 agentes reales del catálogo. */
export const FAVORITE_AGENTS: Agent[] = [
  AGENTS.find((a) => a.id === 'translatorbot')!,
  AGENTS.find((a) => a.id === 'codeauditor')!,
];

/* ---------- Tareas (S5) ---------- */

export type TaskStatus = 'escrow' | 'progreso' | 'entregada' | 'disputa';

export interface DashTask {
  id: string; // "#T-8291"
  counterparty: string;
  counterpartyWallet: string;
  task: string;
  amount: number; // MON
  status: TaskStatus;
  progress: number; // 0–100
  duration?: string;
  ratingGiven?: number;
}

export const ACTIVE_TASKS: Record<Perspective, DashTask[]> = {
  proveedor: [
    { id: '#T-8291', counterparty: '0xB22…9eF0', counterpartyWallet: '0xB229eF0a1B2c3D4e5F6a7B8c9D0e1F2a3B4c9eF0', task: 'Resumen ejecutivo de informe trimestral', amount: 0.004, status: 'progreso', progress: 86 },
    { id: '#T-8290', counterparty: '0x8F1c…2Aa4', counterpartyWallet: '0x8F1c2Aa4b5C6d7E8f9A0b1C2d3E4f5A6b7C82Aa4', task: 'Traducción de documentación técnica (ES→EN)', amount: 0.01, status: 'progreso', progress: 64 },
    { id: '#T-8288', counterparty: 'DeFiFactory', counterpartyWallet: '0xDeF1Fac7b8C9d0E1f2A3b4C5d6E7f8A9b0C1Fac7', task: 'Extracción de datos de holders del token', amount: 0.018, status: 'progreso', progress: 41 },
    { id: '#T-8286', counterparty: '0x3E7d…91Bc', counterpartyWallet: '0x3E7d91BcA0b1C2d3E4f5A6b7C8d9E0f1A2b391Bc', task: 'Resumen de actas de reuniones del comité', amount: 0.004, status: 'escrow', progress: 0 },
    { id: '#T-8285', counterparty: '0xC44…7e21', counterpartyWallet: '0xC447e21Fb3C4d5E6f7A8b9C0d1E2f3A4b5C67e21', task: 'Informe de sentimiento en X sobre Monad', amount: 0.012, status: 'progreso', progress: 78 },
    { id: '#T-8284', counterparty: 'NexoLabs', counterpartyWallet: '0xNeX0LaB5c6D7e8F9a0B1c2D3e4F5a6B7c8D9LaB5', task: 'Resumen del whitepaper v2 (42 páginas)', amount: 0.005, status: 'progreso', progress: 12 },
    { id: '#T-8282', counterparty: '0x9Ab…33E1', counterpartyWallet: '0x9Ab33E1c2D3e4F5a6B7c8D9e0F1a2B3c4D533E1', task: 'Dataset de precios históricos MON/USD', amount: 0.02, status: 'escrow', progress: 0 },
    { id: '#T-8281', counterparty: '0xF21…7bC9', counterpartyWallet: '0xF217bC9d0E1f2A3b4C5d6E7f8A9b0C1d2E37bC9', task: 'Informe semanal de DataMole (disputado)', amount: 0.018, status: 'disputa', progress: 100 },
  ],
  cliente: [
    { id: '#T-8104', counterparty: 'TranslatorBot', counterpartyWallet: '0x7aA1c3E5b7D9f1A3c5E7b9D1f3A5c7E9b1D3F5c2', task: 'Traducción de la landing al inglés', amount: 0.01, status: 'progreso', progress: 72 },
    { id: '#T-8102', counterparty: 'CodeAuditor', counterpartyWallet: '0xC0de41d17bB2f8A3c6E9d4F1a5B7e8C2d0F3A170', task: 'Auditoría express del contrato de staking', amount: 0.05, status: 'progreso', progress: 35 },
    { id: '#T-8101', counterparty: 'ResearchAgent', counterpartyWallet: '0xRe5e4B3c2D1f0A9c8E7b6D5f4A3c2E1b0D9F8a71', task: 'Research de competidores con citas', amount: 0.03, status: 'escrow', progress: 0 },
    { id: '#T-8098', counterparty: 'DataScout', counterpartyWallet: '0xDa7A5c0a7B3d5F1a9C2e4B6d8F0a2C4e6B8d0F13', task: 'Análisis de flujos de la treasury', amount: 0.05, status: 'progreso', progress: 58 },
    { id: '#T-8097', counterparty: 'SummarizerAI', counterpartyWallet: '0x5B44d1a3A1c5E7b9D2f4A6c8E0b2D4f6A8c0E107', task: 'Resumen de actas del comité', amount: 0.005, status: 'entregada', progress: 100 },
  ],
};

export const COMPLETED_TASKS: Record<Perspective, DashTask[]> = {
  proveedor: [
    { id: '#T-8279', counterparty: '0xB22…9eF0', counterpartyWallet: '0xB229eF0a1B2c3D4e5F6a7B8c9D0e1F2a3B4c9eF0', task: 'Resumen de informe de protocolo', amount: 0.004, status: 'entregada', progress: 100, duration: '1,8 s', ratingGiven: 5 },
    { id: '#T-8276', counterparty: '0x8F1c…2Aa4', counterpartyWallet: '0x8F1c2Aa4b5C6d7E8f9A0b1C2d3E4f5A6b7C82Aa4', task: 'Dataset limpio de votaciones DAO', amount: 0.016, status: 'entregada', progress: 100, duration: '4,2 s', ratingGiven: 5 },
    { id: '#T-8274', counterparty: 'KarmaDAO', counterpartyWallet: '0xKaRmAa0b1C2d3E4f5A6b7C8d9E0f1A2b3C4dA0b1', task: 'Resumen ejecutivo de propuesta de gobernanza', amount: 0.005, status: 'entregada', progress: 100, duration: '2,1 s', ratingGiven: 4 },
    { id: '#T-8271', counterparty: '0xC44…7e21', counterpartyWallet: '0xC447e21Fb3C4d5E6f7A8b9C0d1E2f3A4b5C67e21', task: 'Extracción de KPIs de 120 PDFs', amount: 0.022, status: 'entregada', progress: 100, duration: '6,7 s', ratingGiven: 5 },
    { id: '#T-8269', counterparty: '0x3E7d…91Bc', counterpartyWallet: '0x3E7d91BcA0b1C2d3E4f5A6b7C8d9E0f1A2b391Bc', task: 'Resumen de hilo de gobernanza (380 mensajes)', amount: 0.004, status: 'entregada', progress: 100, duration: '1,5 s', ratingGiven: 5 },
    { id: '#T-8266', counterparty: 'OrbitPay', counterpartyWallet: '0x0rB17PaYc1D2e3F4a5B6c7D8e9F0a1B2c3D4PaYc', task: 'Informe de riesgo de contraparte', amount: 0.018, status: 'entregada', progress: 100, duration: '3,9 s', ratingGiven: 4 },
    { id: '#T-8263', counterparty: '0x9Ab…33E1', counterpartyWallet: '0x9Ab33E1c2D3e4F5a6B7c8D9e0F1a2B3c4D533E1', task: 'Resumen de documentación de API', amount: 0.004, status: 'entregada', progress: 100, duration: '1,2 s', ratingGiven: 5 },
    { id: '#T-8260', counterparty: 'DeFiFactory', counterpartyWallet: '0xDeF1Fac7b8C9d0E1f2A3b4C5d6E7f8A9b0C1Fac7', task: 'Dataset de rendimiento de pools', amount: 0.02, status: 'entregada', progress: 100, duration: '5,4 s', ratingGiven: 5 },
    { id: '#T-8258', counterparty: '0xF21…7bC9', counterpartyWallet: '0xF217bC9d0E1f2A3b4C5d6E7f8A9b0C1d2E37bC9', task: 'Resumen de tesis de inversión (86 páginas)', amount: 0.006, status: 'entregada', progress: 100, duration: '2,8 s', ratingGiven: 5 },
    { id: '#T-8255', counterparty: 'NexoLabs', counterpartyWallet: '0xNeX0LaB5c6D7e8F9a0B1c2D3e4F5a6B7c8D9LaB5', task: 'Informe de actividad de whales', amount: 0.019, status: 'entregada', progress: 100, duration: '4,6 s', ratingGiven: 4 },
    { id: '#T-8252', counterparty: '0xB22…9eF0', counterpartyWallet: '0xB229eF0a1B2c3D4e5F6a7B8c9D0e1F2a3B4c9eF0', task: 'Resumen de acta de partners', amount: 0.004, status: 'entregada', progress: 100, duration: '1,9 s', ratingGiven: 5 },
    { id: '#T-8249', counterparty: '0x8F1c…2Aa4', counterpartyWallet: '0x8F1c2Aa4b5C6d7E8f9A0b1C2d3E4f5A6b7C82Aa4', task: 'Dataset de menciones en Discord', amount: 0.014, status: 'entregada', progress: 100, duration: '3,3 s', ratingGiven: 5 },
  ],
  cliente: [
    { id: '#T-8095', counterparty: 'TranslatorBot', counterpartyWallet: '0x7aA1c3E5b7D9f1A3c5E7b9D1f3A5c7E9b1D3F5c2', task: 'Traducción de documentación (EN→ES)', amount: 0.01, status: 'entregada', progress: 100, duration: '3 s', ratingGiven: 5 },
    { id: '#T-8091', counterparty: 'SummarizerAI', counterpartyWallet: '0x5B44d1a3A1c5E7b9D2f4A6c8E0b2D4f6A8c0E107', task: 'Resumen ejecutivo de informe de 60 páginas', amount: 0.005, status: 'entregada', progress: 100, duration: '2 s', ratingGiven: 5 },
    { id: '#T-8088', counterparty: 'CodeAuditor', counterpartyWallet: '0xC0de41d17bB2f8A3c6E9d4F1a5B7e8C2d0F3A170', task: 'Auditoría completa + parche', amount: 0.3, status: 'entregada', progress: 100, duration: '45 s', ratingGiven: 5 },
    { id: '#T-8084', counterparty: 'ResearchAgent', counterpartyWallet: '0xRe5e4B3c2D1f0A9c8E7b6D5f4A3c2E1b0D9F8a71', task: 'Due diligence de protocolo de lending', amount: 0.03, status: 'entregada', progress: 100, duration: '18 s', ratingGiven: 4 },
    { id: '#T-8080', counterparty: 'ImageAnalyst', counterpartyWallet: '0x1B49e2d4a6F8a0c2e4B6d8F0a2C4e6B8d0F2a4C1', task: 'OCR de lote de facturas (240)', amount: 0.02, status: 'entregada', progress: 100, duration: '6 s', ratingGiven: 5 },
    { id: '#T-8076', counterparty: 'DataScout', counterpartyWallet: '0xDa7A5c0a7B3d5F1a9C2e4B6d8F0a2C4e6B8d0F13', task: 'Análisis de wallets vinculadas', amount: 0.05, status: 'entregada', progress: 100, duration: '9 s', ratingGiven: 5 },
  ],
};

export const TASK_COUNTS: Record<Perspective, { activas: number; disputa: number }> = {
  proveedor: { activas: 23, disputa: 1 },
  cliente: { activas: 8, disputa: 0 },
};

/* ---------- Disputa (S6) ---------- */

export interface DisputeStep {
  title: string;
  detail?: string;
  done: boolean;
  current?: boolean;
}

export const DISPUTE = {
  id: '#D-104',
  title: 'dash.dispute.title',
  taskId: '#T-8281',
  amount: 0.018,
  counterparty: '0xF21…7bC9',
  /** plazo inicial en minutos (hace tick a la baja) */
  deadlineMin: 31 * 60 + 12,
  votes: 3,
  votesTotal: 5,
  steps: [
    { title: 'dash.dispute.step1', detail: 'dash.dispute.step1detail', done: true },
    { title: 'dash.dispute.step2', detail: 'dash.dispute.step2detail', done: true },
    { title: 'dash.dispute.step3', detail: 'dash.dispute.step3detail', done: false, current: true },
    { title: 'dash.dispute.step4', detail: 'dash.dispute.step4detail', done: false },
  ] as DisputeStep[],
  note: 'dash.dispute.note',
};

/* ---------- Historial de pagos (S7) ---------- */

export interface Payment {
  id: string;
  direction: 'recibido' | 'enviado';
  description: string;
  counterparty: string;
  date: string;
  amount: number; // MON, positivo
  txHash: string;
}

export const PAYMENTS: Payment[] = [
  { id: 'p1', direction: 'recibido', description: 'Tarea #T-8.291 — Resumen ejecutivo', counterparty: '0xB22…9eF0', date: 'hoy · 14:02', amount: 0.004, txHash: '0x91e4a2c8d3f5b7a9c1e2d4f6a8b0c2d4e6a8c0e4' },
  { id: 'p2', direction: 'recibido', description: 'Tarea #T-8.288 — Dataset de holders', counterparty: 'DeFiFactory', date: 'ayer · 18:44', amount: 0.018, txHash: '0x3f9ac21e8b2f9d0451cd77aba9e33f1822b7e4c9' },
  { id: 'p3', direction: 'enviado', description: 'Tarea #T-8.102 — Auditoría express', counterparty: 'CodeAuditor', date: 'ayer · 09:17', amount: 0.05, txHash: '0x6d41b8f2c30855d194ee02c61a5bd98773f04b2a' },
  { id: 'p4', direction: 'recibido', description: 'Tarea #T-8.279 — Informe de sentimiento', counterparty: '0xC44…7e21', date: '12 dic · 16:30', amount: 0.012, txHash: '0x22b7e4c96d41b8f2c30855d194ee02c61a5bd987' },
  { id: 'p5', direction: 'enviado', description: 'Tarea #T-8.096 — Traducción ES→EN', counterparty: 'TranslatorBot', date: '11 dic · 12:05', amount: 0.01, txHash: '0xa9e33f1822b7e4c96d41b8f2c30855d194ee02c6' },
  { id: 'p6', direction: 'recibido', description: 'Tarea #T-8.270 — Resumen de actas', counterparty: '0x3E7d…91Bc', date: '10 dic · 20:52', amount: 0.004, txHash: '0x51cd77ab6d41b8f2c30855d194ee02c6a9e33f18' },
];

/* ---------- Reputación e insignias (S8) ---------- */

export interface ReputationBreakdown {
  rating: number;
  total: number;
  histogram: { stars: number; pct: number }[];
  bullets: string[];
}

export const REPUTATION: ReputationBreakdown = {
  rating: 4.9,
  total: 512,
  histogram: [
    { stars: 5, pct: 92 },
    { stars: 4, pct: 6 },
    { stars: 3, pct: 2 },
    { stars: 2, pct: 0 },
    { stars: 1, pct: 0 },
  ],
  bullets: ['dash.reputation.bullet1', 'dash.reputation.bullet2', 'dash.reputation.bullet3'],
};

export type BadgeTone = 'honey' | 'olive' | 'ink' | 'terra';

export interface HiveBadge {
  id: string;
  name: string;
  detail: string;
  tone: BadgeTone;
  icon: 'trophy' | 'hexagon' | 'rocket' | 'shield' | 'scale';
  locked?: boolean;
  lockedHint?: string;
}

export const BADGES: HiveBadge[] = [
  { id: 'top1', name: 'dash.badges.top1.name', detail: 'dash.badges.top1.detail', tone: 'honey', icon: 'trophy' },
  { id: 'mil', name: 'dash.badges.mil.name', detail: 'dash.badges.mil.detail', tone: 'olive', icon: 'hexagon' },
  { id: 'pionero', name: 'dash.badges.pionero.name', detail: 'dash.badges.pionero.detail', tone: 'ink', icon: 'rocket' },
  { id: 'cero', name: 'dash.badges.cero.name', detail: 'dash.badges.cero.detail', tone: 'olive', icon: 'shield' },
  { id: 'jurado', name: 'dash.badges.jurado.name', detail: 'dash.badges.jurado.detail', tone: 'terra', icon: 'scale', locked: true, lockedHint: 'dash.badges.jurado.hint' },
];
