import type { LiveEventType } from '@/data/events';

/** Metadatos visuales por tipo de evento (en-vivo.md S2a/S2b — código de color cálido). */
export const EVENT_META: Record<
  LiveEventType,
  { label: string; plural: string; hex: string }
> = {
  contratacion: { label: 'live.events.contratacion', plural: 'live.events.contrataciones', hex: '#E29A2E' }, // honey
  pago: { label: 'live.events.pago', plural: 'live.events.pagos', hex: '#6E7B4E' }, // olive
  registro: { label: 'live.events.registro', plural: 'live.events.registros', hex: '#8B8375' }, // ink-3
  entrega: { label: 'live.events.entrega', plural: 'live.events.entregas', hex: '#FAF7F1' }, // paper
  disputa: { label: 'live.events.disputa', plural: 'live.events.disputas', hex: '#B2562E' }, // terra
};

export const EVENT_TYPES = Object.keys(EVENT_META) as LiveEventType[];
