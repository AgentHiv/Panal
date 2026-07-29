/**
 * Panal — Mock tipado de agentes (design.md §Nota de datos, marketplace.md S5)
 * Fuente única de verdad para /mercado, /agente/:id, home ranking, en-vivo y dashboard.
 */

export type AgentCategory =
  | 'datos'
  | 'texto'
  | 'codigo'
  | 'vision'
  | 'legal'
  | 'defi'
  | 'creativo'
  | 'humanos';

export type AgentType = 'ia' | 'humano';
export type AgentStatus = 'en-linea' | 'ocupado' | 'desconectado';

export interface AgentService {
  name: string;
  price: number; // MON
  description: string;
}

export interface Agent {
  id: string; // slug usado en /agente/:id
  name: string;
  category: AgentCategory;
  type: AgentType;
  tagline: string;
  description: string;
  pricePerTask: number; // en la unidad de `currency` (MON por defecto)
  /** v2: moneda de cobro (address del token $PANAL). Ausente/undefined = MON. */
  currency?: string;
  rating: number; // 0–5
  reviews: number;
  tasksCompleted: number;
  avgResponse: string; // "12s" · "2h"
  avgResponseSec: number;
  successRate: number; // %
  status: AgentStatus;
  verified: boolean;
  acceptsSubcontracting: boolean;
  wallet: string;
  walletShort: string;
  skills: string[];
  totalEarned: number; // MON
  memberSince: string; // "nov 2025"
  volume24h: number; // MON — tamaño de nodo en el enjambre
  trend7d: number[]; // sparkline 7 días
  services?: AgentService[];
}

/** Claves i18n por categoría — traducir con t(CATEGORY_LABELS[cat]) */
export const CATEGORY_LABELS: Record<AgentCategory, string> = {
  datos: 'categories.datos',
  texto: 'categories.texto',
  codigo: 'categories.codigo',
  vision: 'categories.vision',
  legal: 'categories.legal',
  defi: 'categories.defi',
  creativo: 'categories.creativo',
  humanos: 'categories.humanos',
};

/** Claves i18n por estado — traducir con t(STATUS_LABELS[status]) */
export const STATUS_LABELS: Record<AgentStatus, string> = {
  'en-linea': 'status.enLinea',
  ocupado: 'status.ocupado',
  desconectado: 'status.desconectado',
};

export const AGENTS: Agent[] = [
  {
    id: 'codeauditor',
    name: 'CodeAuditor',
    category: 'codigo',
    type: 'ia',
    tagline: 'Auditoría de contratos Solidity con informe de severidades y PoC.',
    description:
      'Agente de auditoría especializado en contratos EVM. Analiza bytecode y fuente, clasifica hallazgos por severidad, genera pruebas de concepto y entrega un informe firmado con su clave. Entrenado con 4.100 exploits históricos y actualizado con cada bloque de Monad.',
    pricePerTask: 0.15,
    rating: 5.0,
    reviews: 12847,
    tasksCompleted: 12847,
    avgResponse: '12s',
    avgResponseSec: 12,
    successRate: 99.6,
    status: 'en-linea',
    verified: true,
    acceptsSubcontracting: true,
    wallet: '0xC0de41d17bB2f8A3c6E9d4F1a5B7e8C2d0F3A170',
    walletShort: '0xC0de…A170',
    skills: ['Solidity', 'Slither', 'Foundry', 'Reentrancy', 'Gas golf', 'Informes PDF'],
    totalEarned: 1923,
    memberSince: 'nov 2025',
    volume24h: 41.2,
    trend7d: [31, 34, 33, 38, 41, 39, 44],
    services: [
      {
        name: 'Auditoría express',
        price: 0.05,
        description: 'Revisión automática de un contrato (≤500 líneas). Informe de severidades en ~12s.',
      },
      {
        name: 'Auditoría completa',
        price: 0.15,
        description: 'Estático + fuzzing + PoC de hallazgos críticos. Informe firmado en ~45s.',
      },
      {
        name: 'Auditoría + parche',
        price: 0.3,
        description: 'Incluye diff con correcciones sugeridas y re-auditoría del fix.',
      },
    ],
  },
  {
    id: 'legalreviewer',
    name: 'LegalReviewer',
    category: 'legal',
    type: 'ia',
    tagline: 'Revisión de acuerdos y términos con banderas de riesgo.',
    description:
      'Analiza acuerdos, términos de servicio y contratos comerciales. Marca cláusulas de riesgo, propone redacciones alternativas y ancla un hash del informe on-chain como evidencia.',
    pricePerTask: 0.08,
    rating: 4.9,
    reviews: 8412,
    tasksCompleted: 8412,
    avgResponse: '41s',
    avgResponseSec: 41,
    successRate: 99.1,
    status: 'en-linea',
    verified: true,
    acceptsSubcontracting: false,
    wallet: '0x1e9a17c2B4d6E8f0A2c4E6b8D0f2A4c6E8b0D9F2',
    walletShort: '0x1e9a…D9F2',
    skills: ['Términos de servicio', 'NDAs', 'GDPR', 'MiCA', 'Banderas de riesgo'],
    totalEarned: 673,
    memberSince: 'nov 2025',
    volume24h: 18.6,
    trend7d: [14, 16, 15, 17, 19, 18, 21],
  },
  {
    id: 'translatorbot',
    name: 'TranslatorBot',
    category: 'texto',
    type: 'ia',
    tagline: 'Traducción técnica ES⇄EN⇄PT con glosario on-chain.',
    description:
      'Traducción técnica y de producto entre español, inglés y portugués. Mantiene glosarios por cliente anclados on-chain para consistencia verificable entre entregas.',
    pricePerTask: 0.01,
    rating: 4.9,
    reviews: 96203,
    tasksCompleted: 96203,
    avgResponse: '3s',
    avgResponseSec: 3,
    successRate: 99.8,
    status: 'en-linea',
    verified: true,
    acceptsSubcontracting: true,
    wallet: '0x7aA1c3E5b7D9f1A3c5E7b9D1f3A5c7E9b1D3F5c2',
    walletShort: '0x7aA1…F5c2',
    skills: ['ES⇄EN⇄PT', 'Documentación técnica', 'Glosarios', 'Localización'],
    totalEarned: 962,
    memberSince: 'oct 2025',
    volume24h: 22.4,
    trend7d: [20, 19, 22, 21, 24, 23, 25],
  },
  {
    id: 'researchagent',
    name: 'ResearchAgent',
    category: 'datos',
    type: 'ia',
    tagline: 'Investigación web con fuentes citadas y síntesis.',
    description:
      'Investiga cualquier tema en la web, cita fuentes verificables y entrega una síntesis estructurada. Cada afirmación lleva su enlace y el hash del informe queda anclado on-chain.',
    pricePerTask: 0.03,
    rating: 4.8,
    reviews: 21554,
    tasksCompleted: 21554,
    avgResponse: '18s',
    avgResponseSec: 18,
    successRate: 98.9,
    status: 'en-linea',
    verified: true,
    acceptsSubcontracting: true,
    wallet: '0xRe5e4B3c2D1f0A9c8E7b6D5f4A3c2E1b0D9F8a71',
    walletShort: '0xRe5e…8a71',
    skills: ['Investigación', 'Citas verificadas', 'Síntesis', 'Due diligence'],
    totalEarned: 647,
    memberSince: 'oct 2025',
    volume24h: 12.8,
    trend7d: [9, 11, 10, 12, 14, 13, 15],
  },
  {
    id: 'summarizerai',
    name: 'SummarizerAI',
    category: 'texto',
    type: 'ia',
    tagline: 'Resúmenes ejecutivos de documentos largos.',
    description:
      'Convierte documentos de cualquier extensión en resúmenes ejecutivos accionables: puntos clave, riesgos y próximos pasos. El agente más barato por tarea del panal.',
    pricePerTask: 0.005,
    rating: 4.8,
    reviews: 143901,
    tasksCompleted: 143901,
    avgResponse: '2s',
    avgResponseSec: 2,
    successRate: 99.9,
    status: 'en-linea',
    verified: true,
    acceptsSubcontracting: false,
    wallet: '0x5B44d1a3A1c5E7b9D2f4A6c8E0b2D4f6A8c0E107',
    walletShort: '0x5B44…E107',
    skills: ['Resúmenes', 'PDF', 'Transcripciones', 'Puntos clave'],
    totalEarned: 719,
    memberSince: 'oct 2025',
    volume24h: 16.1,
    trend7d: [12, 13, 15, 14, 16, 18, 17],
  },
  {
    id: 'datascout',
    name: 'DataScout',
    category: 'datos',
    type: 'ia',
    tagline: 'Análisis on-chain: wallets, flujos y protocolos.',
    description:
      'Rastrea wallets, flujos de fondos y salud de protocolos en Monad y otras EVM. Entrega paneles de señales con el hash de cada dataset anclado para auditoría.',
    pricePerTask: 0.05,
    rating: 4.7,
    reviews: 15332,
    tasksCompleted: 15332,
    avgResponse: '9s',
    avgResponseSec: 9,
    successRate: 98.4,
    status: 'ocupado',
    verified: true,
    acceptsSubcontracting: true,
    wallet: '0xDa7A5c0a7B3d5F1a9C2e4B6d8F0a2C4e6B8d0F13',
    walletShort: '0xDa7A…0F13',
    skills: ['On-chain analytics', 'Wallets', 'Flujos', 'Dune', 'Indexadores'],
    totalEarned: 766,
    memberSince: 'nov 2025',
    volume24h: 15.3,
    trend7d: [11, 12, 14, 13, 15, 14, 16],
  },
  {
    id: 'imageanalyst',
    name: 'ImageAnalyst',
    category: 'vision',
    type: 'ia',
    tagline: 'Visión por computadora: OCR, defectos, moderación.',
    description:
      'Procesa imágenes a escala: OCR de documentos, detección de defectos industriales y moderación de contenido. Entrega resultados estructurados en JSON firmado.',
    pricePerTask: 0.02,
    rating: 4.6,
    reviews: 34871,
    tasksCompleted: 34871,
    avgResponse: '6s',
    avgResponseSec: 6,
    successRate: 98.1,
    status: 'en-linea',
    verified: false,
    acceptsSubcontracting: false,
    wallet: '0x1B49e2d4a6F8a0c2e4B6d8F0a2C4e6B8d0F2a4C1',
    walletShort: '0x1B49…a4C1',
    skills: ['OCR', 'Defectos', 'Moderación', 'Clasificación'],
    totalEarned: 697,
    memberSince: 'nov 2025',
    volume24h: 9.7,
    trend7d: [8, 9, 8, 10, 9, 11, 10],
  },
  {
    id: 'priceoracle-bot',
    name: 'PriceOracle Bot',
    category: 'defi',
    type: 'ia',
    tagline: 'Feeds de precios agregados con latencia <1s.',
    description:
      'Agrega precios de DEX y CEX en tiempo real y publica feeds firmados con latencia inferior a un segundo. La columna vertebral de las finanzas del panal.',
    pricePerTask: 0.001,
    rating: 4.5,
    reviews: 210445,
    tasksCompleted: 210445,
    avgResponse: '1s',
    avgResponseSec: 1,
    successRate: 99.7,
    status: 'en-linea',
    verified: true,
    acceptsSubcontracting: false,
    wallet: '0x9b1c30a4c13B0aA5c7E9d1F3a5B7e9C1d3F5a7B9',
    walletShort: '0x9b1c…a7B9',
    skills: ['Price feeds', 'DEX', 'Latencia <1s', 'ETH/USD', 'MON/USD'],
    totalEarned: 420,
    memberSince: 'oct 2025',
    volume24h: 26.9,
    trend7d: [22, 24, 23, 25, 27, 26, 28],
  },
  {
    id: 'sentryguard',
    name: 'SentryGuard',
    category: 'defi',
    type: 'ia',
    tagline: 'Monitoreo de protocolos y alertas de riesgo.',
    description:
      'Vigila protocolos DeFi las 24 horas: TVL anómalo, transacciones de administradores, depegs. Alerta en segundos con evidencia firmada on-chain.',
    pricePerTask: 0.02,
    rating: 4.7,
    reviews: 9204,
    tasksCompleted: 9204,
    avgResponse: '4s',
    avgResponseSec: 4,
    successRate: 99.2,
    status: 'en-linea',
    verified: false,
    acceptsSubcontracting: true,
    wallet: '0x5eD7a9b1ad3B5a7C9e1F3a5B7d9F1a3C5e7B9d24',
    walletShort: '0x5eD7…9d24',
    skills: ['Monitoreo 24/7', 'Alertas', 'TVL', 'Depeg', 'Runbooks'],
    totalEarned: 184,
    memberSince: 'dic 2025',
    volume24h: 7.4,
    trend7d: [6, 7, 6, 8, 7, 9, 8],
  },
  {
    id: 'yieldkeeper',
    name: 'YieldKeeper',
    category: 'defi',
    type: 'ia',
    tagline: 'Estrategias y rebalanceo de liquidez en Monad.',
    description:
      'Diseña y ejecuta estrategias de liquidez en los DEX de Monad: rebalanceos, rangos concentrados y cosecha de rendimientos, todo con escrow y límites on-chain.',
    pricePerTask: 0.06,
    rating: 4.6,
    reviews: 5678,
    tasksCompleted: 5678,
    avgResponse: '22s',
    avgResponseSec: 22,
    successRate: 97.8,
    status: 'desconectado',
    verified: false,
    acceptsSubcontracting: true,
    wallet: '0xB13d1K33c3eB5a7C9e1F3a5B7d9F1a3C5e7B9d04',
    walletShort: '0xB13d…9d04',
    skills: ['LP', 'Rebalanceo', 'Rangos concentrados', 'Monad DEX'],
    totalEarned: 340,
    memberSince: 'dic 2025',
    volume24h: 5.2,
    trend7d: [7, 6, 5, 6, 4, 5, 4],
  },
  {
    id: 'helenarojas-eth',
    name: 'HelenaRojas.eth',
    category: 'creativo',
    type: 'humano',
    tagline: 'Auditoría UX y diseño de producto web3.',
    description:
      'Diseñadora de producto con 9 años en web3. Auditorías UX de dApps, sistemas de diseño y prototipos de alto nivel. Cobra por sprint con escrow, sin facturas ni esperas.',
    pricePerTask: 0.5,
    rating: 4.9,
    reviews: 312,
    tasksCompleted: 312,
    avgResponse: '2h',
    avgResponseSec: 7200,
    successRate: 100,
    status: 'en-linea',
    verified: true,
    acceptsSubcontracting: false,
    wallet: '0xH313e4a0c4eB7d9F1a3C5e7B9d1F3a5C7e9B1d38',
    walletShort: '0xH313…1d38',
    skills: ['Auditoría UX', 'Design systems', 'Figma', 'Web3', 'Research'],
    totalEarned: 156,
    memberSince: 'nov 2025',
    volume24h: 4.1,
    trend7d: [2, 3, 3, 4, 3, 5, 4],
  },
  {
    id: 'studionadir',
    name: 'StudioNadir',
    category: 'creativo',
    type: 'humano',
    tagline: 'Branding e identidad para protocolos.',
    description:
      'Estudio independiente de identidad visual para protocolos y DAOs: naming, logotipo, sistema y dirección de arte. Dos proyectos simultáneos como máximo.',
    pricePerTask: 0.8,
    rating: 4.8,
    reviews: 189,
    tasksCompleted: 189,
    avgResponse: '4h',
    avgResponseSec: 14400,
    successRate: 100,
    status: 'ocupado',
    verified: false,
    acceptsSubcontracting: false,
    wallet: '0x57Bd10d4d1eB5a7C9e1F3a5B7d9F1a3C5e7B9d06',
    walletShort: '0x57Bd…9d06',
    skills: ['Branding', 'Identidad', 'Naming', 'Dirección de arte'],
    totalEarned: 151,
    memberSince: 'dic 2025',
    volume24h: 3.3,
    trend7d: [2, 2, 3, 3, 4, 3, 4],
  },
];

export function getAgent(id: string): Agent | undefined {
  return AGENTS.find((a) => a.id === id);
}

/** Top N por rating, desempatando por tareas (marketplace.md S6) */
export function topAgents(n = 3): Agent[] {
  return [...AGENTS]
    .sort((a, b) => b.rating - a.rating || b.tasksCompleted - a.tasksCompleted)
    .slice(0, n);
}

/* ---------- Formatters es-ES (design.md §8) ---------- */

const nfES = new Intl.NumberFormat('es-ES');

/** 12847 → "12.847" */
export function formatInt(n: number): string {
  return nfES.format(Math.round(n));
}

/** Rating: 4.9 → "4,9" (coma decimal en texto corrido) */
export function formatRating(r: number): string {
  return r.toFixed(1).replace('.', ',');
}

/** Precio cripto en MON: convención de punto decimal (0.015) */
export function formatMon(amount: number, decimals = 3): string {
  const s = amount.toFixed(decimals);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

/** "0.15 MON/tarea" */
export function formatPricePerTask(amount: number): string {
  return `${formatMon(amount)} MON/tarea`;
}

export const WALLET_USER = '0x7A4f9e2B8c3D5a7F1b6E4d8C2a0F9e3B7c5Df9B2';
export const WALLET_USER_SHORT = '0x7A4f…f9B2';
