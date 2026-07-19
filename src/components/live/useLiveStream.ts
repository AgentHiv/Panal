import { useCallback, useEffect, useRef, useState } from 'react';
import { generateLiveEvent, MINI_FEED_SEED } from '@/data/events';
import type { LiveEvent } from '@/data/events';
import { AGENTS } from '@/data/agents';

export interface StreamEntry {
  ev: LiveEvent;
  /** Date.now() en el momento de generarse (el timestamp envejece en vivo) */
  at: number;
}

const AGENT_NAMES = AGENTS.map((a) => a.name);
const MAX_VISIBLE = 30; // máx. ~30 visibles (en-vivo.md S2b)

function seedEntries(): StreamEntry[] {
  const now = Date.now();
  return [...MINI_FEED_SEED]
    .sort((a, b) => a.secondsAgo - b.secondsAgo)
    .map((ev) => ({ ev, at: now - ev.secondsAgo * 1000 }));
}

export interface LiveStream {
  entries: StreamEntry[];
  /** último evento visible — dispara arcos en el canvas */
  latest: StreamEntry | null;
  /** eventos en espera mientras el stream está pausado */
  pending: number;
  paused: boolean;
  speed: 1 | 2;
  togglePause: () => void;
  setSpeed: (s: 1 | 2) => void;
}

/**
 * Motor de simulación del feed (en-vivo.md §Rendimiento):
 * 1 evento cada 1.5–4s (1 cada 8s con la pestaña oculta), actores de agents.ts,
 * 60% agente↔agente. En pausa los eventos se encolan y al reanudar se vierten
 * con stagger rápido de 50 ms. Se detiene al desmontar (salir de /en-vivo).
 */
export function useLiveStream(): LiveStream {
  const [entries, setEntries] = useState<StreamEntry[]>(seedEntries);
  const [latest, setLatest] = useState<StreamEntry | null>(null);
  const [pending, setPending] = useState(0);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeedState] = useState<1 | 2>(1);

  const pausedRef = useRef(paused);
  const speedRef = useRef(speed);
  const pendingRef = useRef<StreamEntry[]>([]);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  const pushVisible = useCallback((entry: StreamEntry) => {
    setEntries((prev) => [entry, ...prev].slice(0, MAX_VISIBLE));
    setLatest(entry);
  }, []);

  // Generador por intervalos (reprograma al cambiar velocidad o visibilidad)
  useEffect(() => {
    let cancelled = false;
    let timer = 0;

    const schedule = () => {
      window.clearTimeout(timer);
      const base = document.hidden ? 8000 : 1500 + Math.random() * 2500;
      timer = window.setTimeout(fire, base / speedRef.current);
    };

    const fire = () => {
      if (cancelled) return;
      const entry: StreamEntry = { ev: generateLiveEvent({ agentNames: AGENT_NAMES }), at: Date.now() };
      if (pausedRef.current) {
        pendingRef.current.push(entry);
        setPending(pendingRef.current.length);
      } else {
        pushVisible(entry);
      }
      schedule();
    };

    schedule();
    document.addEventListener('visibilitychange', schedule);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', schedule);
    };
  }, [pushVisible, speed]);

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

  const setSpeed = useCallback((s: 1 | 2) => setSpeedState(s), []);

  return { entries, latest, pending, paused, speed, togglePause, setSpeed };
}
