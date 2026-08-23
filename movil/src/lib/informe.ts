/**
 * Panal — traer del indexador lo que necesitan las cuentas.
 *
 * La aritmética está en `cuentas.ts`; aquí solo está de dónde salen los datos.
 */

import type { IndexedEvent } from '@/lib/indexer';
import { INDEXER_URL } from '@/lib/indexer';
import type { TareaIndexada } from '~/lib/cuentas';

export * from '~/lib/cuentas';

/* ── traerlo del indexador ───────────────────────────────────────────────── */

/** Tope de páginas. 200 × 25 = 5.000 eventos, muy por encima de lo que hay. */
const MAX_PAGINAS = 25;

interface RespuestaEventos {
  events: IndexedEvent[];
  next: string | null;
}

/**
 * TODOS los eventos, paginando.
 *
 * La web pide una sola página de 200 y filtra por `args.worker`. Para un
 * informe eso no vale por dos motivos: se deja fuera lo más viejo en cuanto el
 * historial pasa de 200, y `DisputeResolved` no lleva `worker`, así que ese
 * filtro se salta justo los eventos que cambian las cuentas.
 */
export async function traerEventos(): Promise<IndexedEvent[]> {
  const todos: IndexedEvent[] = [];
  let cursor: string | null = null;

  for (let i = 0; i < MAX_PAGINAS; i++) {
    const url = `${INDEXER_URL}/index/events?limit=200${cursor ? `&before=${cursor}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) break;
    const datos = (await res.json()) as RespuestaEventos;
    todos.push(...datos.events);
    cursor = datos.next ?? null;
    if (!cursor) break;
  }
  return todos;
}

export async function traerTareas(direccion: string): Promise<TareaIndexada[]> {
  const res = await fetch(
    `${INDEXER_URL}/index/tasks?address=${direccion}&role=worker&limit=200`,
  );
  if (!res.ok) return [];
  const datos = (await res.json()) as { tasks: TareaIndexada[] };
  return datos.tasks ?? [];
}
