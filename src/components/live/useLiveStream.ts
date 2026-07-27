import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOnchainEvents } from '@/hooks/useOnchainEvents';
import type { LiveEvent } from '@/data/events';

export interface StreamEntry {
  ev: LiveEvent;
  /** Date.now() cuando la entrada se materializó (el timestamp envejece en vivo) */
  at: number;
}

const MAX_VISIBLE = 30; // máx. ~30 visibles (en-vivo.md S2b)

export interface LiveStream {
  entries: StreamEntry[];
  /** último evento visible — dispara arcos en el canvas */
  latest: StreamEntry | null;
  /** eventos en espera mientras el stream está pausado */
  pending: number;
  paused: boolean;
  togglePause: () => void;
  /** no-op: ya no hay generador cliente; la cadencia la marca la red (polling 12 s) */
  setSpeed: (s: 1 | 2) => void;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Stream del feed en vivo alimentado por eventos REALES on-chain
 * (useOnchainEvents: getLogs + polling 12 s). Mantiene la API del antiguo
 * motor simulado: en pausa los eventos nuevos se encolan (pending) y al
 * reanudar se vierten con stagger rápido de 50 ms.
 */
export function useLiveStream(): LiveStream {
  const { entries: events, loading, error, refetch } = useOnchainEvents();

  const [entries, setEntries] = useState<StreamEntry[]>([]);
  const [latest, setLatest] = useState<StreamEntry | null>(null);
  const [pending, setPending] = useState(0);
  const [paused, setPaused] = useState(false);

  const pausedRef = useRef(paused);
  const pendingRef = useRef<StreamEntry[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const pushVisible = useCallback((entry: StreamEntry) => {
    setEntries((prev) => [entry, ...prev].slice(0, MAX_VISIBLE));
    setLatest(entry);
  }, []);

  // Materializa los eventos on-chain en entries del stream (dedupe por id).
  useEffect(() => {
    if (events.length === 0) return;
    const fresh: StreamEntry[] = [];
    for (const ev of events) {
      if (seenRef.current.has(ev.id)) continue;
      seenRef.current.add(ev.id);
      fresh.push({ ev, at: Date.now() });
    }
    if (fresh.length === 0) return;

    if (pausedRef.current) {
      pendingRef.current.push(...fresh);
      setPending(pendingRef.current.length);
    } else {
      setEntries((prev) => [...fresh, ...prev].slice(0, MAX_VISIBLE));
      setLatest(fresh[0]);
    }
  }, [events]);

  // Limpieza del drenaje al desmontar
  const drainRef = useRef(0);
  useEffect(() => () => window.clearInterval(drainRef.current), []);

  const togglePause = useCallback(() => {
    setPaused((prev) => {
      if (prev) {
        // Reanudar: verter los eventos en espera con stagger rápido (.05s)
        window.clearInterval(drainRef.current);
        drainRef.current = window.setInterval(() => {
          const next = pendingRef.current.shift();
          if (!next) {
            window.clearInterval(drainRef.current);
            setPending(0);
            return;
          }
          setPending(pendingRef.current.length);
          pushVisible(next);
        }, 50);
      }
      return !prev;
    });
  }, [pushVisible]);

  const setSpeed = useCallback(() => {
    /* no-op: el feed ya no se genera en cliente; llega del RPC cada 12 s */
  }, []) as (s: 1 | 2) => void;

  return useMemo(
    () => ({ entries, latest, pending, paused, togglePause, setSpeed, loading, error, refetch }),
    [entries, latest, pending, paused, togglePause, setSpeed, loading, error, refetch],
  );
}
