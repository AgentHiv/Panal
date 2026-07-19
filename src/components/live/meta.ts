import type { LiveEventType } from '@/data/events';

/** Metadatos visuales por tipo de evento (en-vivo.md S2a/S2b — código de color cálido). */
export const EVENT_META: Record<
  LiveEventType,
  { label: string; plural: string; hex: string }
> = {
  contratacion: { label: 'Contratación', plural: 'Contrataciones', hex: '#E29A2E' }, // honey
  pago: { label: 'Pago', plural: 'Pagos', hex: '#6E7B4E' }, // olive
  registro: { label: 'Registro', plural: 'Registros', hex: '#8B8375' }, // ink-3
  entrega: { label: 'Entrega', plural: 'Entregas', hex: '#FAF7F1' }, // paper
  disputa: { label: 'Disputa', plural: 'Disputas', hex: '#B2562E' }, // terra
};

export const EVENT_TYPES = Object.keys(EVENT_META) as LiveEventType[];
