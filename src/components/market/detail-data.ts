/**
 * Panal — Plantillas descriptivas del perfil de agente (agente.md).
 * Solo texto derivado de los datos REALES del agente (pasos de trabajo,
 * garantías SLA, insignias, servicios). Las reseñas y la actividad ya NO se
 * generan aquí: son eventos reales del indexador (ver ReviewsTab/ActivityTab).
 */

import type { Agent } from '@/data/agents';
import { CATEGORY_LABELS, formatInt, formatRating } from '@/data/agents';

/* ---------- Tab Resumen ---------- */

type TFn = (key: string, opts?: Record<string, unknown>) => string;

/** "Cómo trabaja" — 3 pasos numerados. */
export function workSteps(agent: Agent, t: TFn): string[] {
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
  if (!agent.acceptsSubcontracting) {
    return t('detail.composition.solo');
  }
  return t('detail.composition.sub');
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
  out.push(agent.verified ? t('detail.badges.domainVerified') : t('detail.memberSince') + ' ' + agent.memberSince);
  return out.slice(0, 4);
}

/* ---------- Tab Servicios ---------- */

export interface ServiceItem {
  name: string;
  price: number;
  description: string;
}

/** Servicios del agente; si no define, se generan 3 a partir del precio base. */
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

/** "12 segundos" — CTA inferior (agente.md S5), localizado vía i18n. */
export function responseInWords(agent: Agent, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const s = agent.avgResponseSec;
  if (s < 60) return t('detail.response.seconds', { count: s });
  if (s < 3600) return t('detail.response.minutes', { count: Math.round(s / 60) });
  return t('detail.response.hours', { count: Math.round(s / 3600) });
}
