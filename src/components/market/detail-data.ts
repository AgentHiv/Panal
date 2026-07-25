/**
 * Panal — Generadores deterministas de contenido del perfil de agente (agente.md).
 * CodeAuditor lleva los textos canónicos del diseño; el resto de agentes del mock
 * recibe contenido plausible derivado de sus propios datos (misma plantilla).
 */

import type { Agent } from '@/data/agents';
import { AGENTS, CATEGORY_LABELS, formatInt, formatRating } from '@/data/agents';
import { randomTxHash } from '@/data/events';

/* ---------- rng determinista por agente ---------- */

function hashString(s: string): number {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cotización mock para el "≈ $" de la tarjeta de contratación. */
export const MON_USD = 2.07;

/** Cola actual simulada y determinista (agente.md S1). */
export function currentQueue(agent: Agent): number {
  return (agent.tasksCompleted % 5) + 1;
}

/* ---------- Tab Resumen ---------- */

type TFn = (key: string, opts?: Record<string, unknown>) => string;

/** "Cómo trabaja" — 3 pasos numerados. */
export function workSteps(agent: Agent, t: TFn): string[] {
  if (agent.id === 'codeauditor') {
    return [t('detail.steps.audit1'), t('detail.steps.audit2'), t('detail.steps.audit3')];
  }
  if (agent.type === 'humano') {
    return [
      t('detail.steps.human1'),
      t('detail.steps.human2', { name: agent.name }),
      t('detail.steps.human3'),
    ];
  }
  return [
    t('detail.steps.ia1'),
    t('detail.steps.ia2', { name: agent.name }),
    t('detail.steps.ia3'),
  ];
}

function slaWindow(agent: Agent): string {
  const s = agent.avgResponseSec * 5;
  if (s < 60) return `${Math.max(5, Math.round(s))}s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  return `${Math.round(s / 3600)}h`;
}

/** "Garantías del agente (SLA)". */
export function slaGuarantees(agent: Agent, t: TFn): string[] {
  if (agent.id === 'codeauditor') {
    return [t('detail.sla.audit1'), t('detail.sla.audit2'), t('detail.sla.audit3')];
  }
  const out: string[] = [];
  if (agent.type === 'humano') {
    out.push(t('detail.sla.humanDelivery'));
  } else {
    out.push(t('detail.sla.iaDelivery', { window: slaWindow(agent) }));
  }
  out.push(t('detail.sla.refund'));
  out.push(agent.acceptsSubcontracting ? t('detail.sla.subcontract') : t('detail.sla.solo'));
  return out;
}

/** Card "Composición" (honey-soft). */
export function compositionNote(agent: Agent, t: TFn): string {
  if (agent.id === 'codeauditor') {
    return t('detail.composition.audit');
  }
  if (!agent.acceptsSubcontracting) {
    return t('detail.composition.solo');
  }
  const others = AGENTS.filter((a) => a.id !== agent.id && a.type === 'ia');
  const h = hashString(agent.id);
  const a1 = others[h % others.length];
  const a2 = others[(h + 3) % others.length];
  return t('detail.composition.reinvest', { a1: a1.name, a2: a2.name });
}

/** Insignias hexagonales del sidebar en Resumen. */
export function badges(agent: Agent, t: TFn): string[] {
  const out: string[] = [];
  out.push(
    t(agent.rating >= 4.7 ? 'detail.badges.top1' : 'detail.badges.top10', {
      category: t(CATEGORY_LABELS[agent.category]),
    }),
  );
  const milestone = [100000, 50000, 10000, 5000, 1000, 100].find((m) => agent.tasksCompleted >= m);
  if (milestone) out.push(t('detail.badges.tasks', { count: formatInt(milestone) }));
  out.push(
    agent.successRate >= 99
      ? t('detail.badges.zeroDisputes')
      : t('detail.badges.success', { rate: formatRating(agent.successRate) }),
  );
  out.push(agent.verified ? t('detail.badges.communityVerified') : t('detail.memberSince') + ' ' + agent.memberSince);
  return out.slice(0, 4);
}

/* ---------- Tab Servicios ---------- */

export interface ServiceItem {
  name: string;
  price: number;
  description: string;
}

/** Servicios del agente; si el mock no define, se generan 3 a partir del precio base. */
export function servicesFor(agent: Agent, t?: TFn): ServiceItem[] {
  if (agent.services && agent.services.length > 0) return agent.services;
  const base = agent.pricePerTask;
  const tt: TFn = t ?? ((k) => k);
  return [
    {
      name: tt('detail.services.standard.name'),
      price: base,
      description: tt('detail.services.standard.desc', { tagline: agent.tagline }),
    },
    {
      name: tt('detail.services.priority.name'),
      price: Math.round(base * 1.5 * 1000) / 1000,
      description: tt('detail.services.priority.desc'),
    },
    {
      name: tt('detail.services.pack.name'),
      price: Math.round(base * 9 * 1000) / 1000,
      description: tt('detail.services.pack.desc'),
    },
  ];
}

/* ---------- Tab Reseñas ---------- */

export interface Review {
  author: string;
  kind: 'humano' | 'agente';
  rating: number;
  text: string;
  tx: string;
  ago: string;
}

const REVIEW_TEMPLATES = [
  'Cumplió el SLA al segundo. La entrega firmada on-chain nos ahorró la verificación manual.',
  'La relación precio/resultado es imbatible en el panal. Repetiremos cada sprint.',
  'Lo integramos en nuestro pipeline; cada entrega llega con su hash anclado. Cero fricción.',
  'Tuvimos una disputa menor y el escrow la resolvió en horas, sin correos ni facturas.',
  'Resultados consistentes incluso con tareas ambiguas. El informe final es impecable.',
  'Contratamos desde una DAO: la evidencia on-chain nos sirvió para rendir cuentas.',
];

const REVIEW_AUTHORS: Array<{ name: string; kind: 'humano' | 'agente' }> = [
  { name: '0x7A4f…f9B2', kind: 'humano' },
  { name: '0xB22…9eF0', kind: 'humano' },
  { name: '0x8F1c…2Aa4', kind: 'humano' },
  { name: 'DeFiFactory', kind: 'agente' },
  { name: 'SentimentHive', kind: 'agente' },
];

export function reviewsFor(agent: Agent, t?: TFn): Review[] {
  const rng = mulberry32(hashString(`${agent.id}-resenas`));
  const tt: TFn = t ?? ((k) => k);
  const ago = [
    tt('detail.ago.day', { count: 1 }),
    tt('detail.ago.day', { count: 3 }),
    tt('detail.ago.week', { count: 1 }),
    tt('detail.ago.week', { count: 2 }),
  ];
  if (agent.id === 'codeauditor') {
    return [
      {
        author: '0x7A4f…f9B2',
        kind: 'humano',
        rating: 5,
        text: 'Detectó una reentrancy que dos auditorías humanas habían pasado por alto. El PoC funcionó a la primera.',
        tx: randomTxHash(rng),
        ago: t ? t('detail.ago.day', { count: 2 }) : 'hace 2 días',
      },
      {
        author: 'DeFiFactory',
        kind: 'agente',
        rating: 5,
        text: 'Lo uso como segunda opinión en cada despliegue. 12 segundos por auditoría es absurdo.',
        tx: randomTxHash(rng),
        ago: t ? t('detail.ago.day', { count: 4 }) : 'hace 4 días',
      },
      {
        author: '0xB22…9eF0',
        kind: 'humano',
        rating: 5,
        text: 'El informe firmado on-chain nos sirvió como evidencia en gobernanza.',
        tx: randomTxHash(rng),
        ago: t ? t('detail.ago.week', { count: 1 }) : 'hace 1 semana',
      },
      {
        author: 'YieldKeeper',
        kind: 'agente',
        rating: 5,
        text: 'Solo una vez falló la entrega y el reembolso fue automático. Confianza total.',
        tx: randomTxHash(rng),
        ago: t ? t('detail.ago.week', { count: 2 }) : 'hace 2 semanas',
      },
    ];
  }
  const ratings = agent.rating >= 4.8 ? [5, 5, 5, 5] : agent.rating >= 4.6 ? [5, 5, 4, 5] : [5, 4, 5, 4];
  return Array.from({ length: 4 }, (_, i) => {
    const a = REVIEW_AUTHORS[Math.floor(rng() * REVIEW_AUTHORS.length)];
    return {
      author: a.name,
      kind: a.kind,
      rating: ratings[i],
      text: REVIEW_TEMPLATES[Math.floor(rng() * REVIEW_TEMPLATES.length)],
      tx: randomTxHash(rng),
      ago: ago[i],
    };
  });
}

/** Histograma 5★→1★ en porcentaje (agente.md Tab Reseñas). */
export function ratingHistogram(agent: Agent): number[] {
  if (agent.id === 'codeauditor') return [96, 3, 1, 0, 0];
  if (agent.rating >= 4.8) return [88, 8, 3, 1, 0];
  if (agent.rating >= 4.6) return [80, 13, 5, 1, 1];
  return [72, 17, 7, 3, 1];
}

/* ---------- Tab Actividad on-chain ---------- */

export type ActivityStatus = 'completada' | 'en-curso' | 'disputa';

export interface ActivityRow {
  tx: string;
  client: string;
  service: string;
  amount: number;
  status: ActivityStatus;
  duration: string;
  ago: string;
}


const ACTIVITY_WALLETS = ['0x7A4f…f9B2', '0xB22…9eF0', '0x8F1c…2Aa4', '0x3f9a…c21e', 'DeFiFactory', 'SentimentHive'];

function durationFor(agent: Agent, rng: () => number): string {
  const jitter = 0.7 + rng() * 0.8;
  const s = agent.avgResponseSec * jitter;
  if (s < 60) return `${Math.max(1, Math.round(s))}s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  const h = Math.floor(s / 3600);
  const m = Math.round(((s - h * 3600) / 3600) * 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function activityFor(agent: Agent, t?: TFn): ActivityRow[] {
  const rng = mulberry32(hashString(`${agent.id}-actividad`));
  const tt: TFn = t ?? ((k) => k);
  const agos = [
    tt('common.timeAgo.minutes', { count: 12 }),
    tt('common.timeAgo.minutes', { count: 38 }),
    tt('common.timeAgo.hours', { count: 1 }),
    tt('common.timeAgo.hours', { count: 3 }),
    tt('common.timeAgo.hours', { count: 7 }),
    tt('detail.ago.d', { count: 1 }),
    tt('detail.ago.d', { count: 2 }),
    tt('detail.ago.d', { count: 4 }),
  ];
  const services = servicesFor(agent, t);
  const others = AGENTS.filter((a) => a.id !== agent.id).map((a) => a.name);
  const clients = [...ACTIVITY_WALLETS, ...others.slice(0, 3)];
  return Array.from({ length: 8 }, (_, i) => {
    const svc = services[Math.floor(rng() * services.length)];
    const status: ActivityStatus =
      i === 1 ? 'en-curso' : i === 6 && agent.successRate < 99.5 ? 'disputa' : 'completada';
    return {
      tx: randomTxHash(rng),
      client: clients[Math.floor(rng() * clients.length)],
      service: svc.name,
      amount: svc.price,
      status,
      duration: durationFor(agent, rng),
      ago: agos[i],
    };
  });
}

/* ---------- Sidebar: agentes similares ---------- */

export function similarAgents(agent: Agent, n = 3): Agent[] {
  const sameCategory = AGENTS.filter((a) => a.id !== agent.id && a.category === agent.category).sort(
    (a, b) => b.rating - a.rating,
  );
  if (sameCategory.length >= n) return sameCategory.slice(0, n);
  const fillers = AGENTS.filter((a) => a.id !== agent.id && a.category !== agent.category).sort(
    (a, b) => b.rating - a.rating || b.tasksCompleted - a.tasksCompleted,
  );
  return [...sameCategory, ...fillers].slice(0, n);
}

/** "12 segundos" — CTA inferior (agente.md S5), localizado vía i18n. */
export function responseInWords(agent: Agent, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const s = agent.avgResponseSec;
  if (s < 60) return t('detail.response.seconds', { count: s });
  if (s < 3600) return t('detail.response.minutes', { count: Math.round(s / 60) });
  return t('detail.response.hours', { count: Math.round(s / 3600) });
}
