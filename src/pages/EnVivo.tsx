import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useAnimationControls } from 'framer-motion';
import { ArrowRight, Hexagon, Play, X } from 'lucide-react';
import LiveDot from '@/components/LiveDot';
import EventCard from '@/components/live/EventCard';
import { EVENT_META } from '@/components/live/meta';
import StreamControls from '@/components/live/StreamControls';
import type { StreamFilter } from '@/components/live/StreamControls';
import SwarmCanvas from '@/components/live/SwarmCanvas';
import { useLiveStream } from '@/components/live/useLiveStream';
import type { StreamEntry } from '@/components/live/useLiveStream';
import { formatMon } from '@/data/agents';
import type { LiveEvent } from '@/data/events';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function usePrefersReduced(): boolean {
  const [reduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  return reduced;
}

function useDocumentHidden(): boolean {
  const [hidden, setHidden] = useState(() => document.hidden);
  useEffect(() => {
    const onVis = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);
  return hidden;
}

/** Reveal palabra a palabra (tipografía cinética word-level, design.md §4). */
function WordReveal({
  text,
  delay = 0,
  inView = false,
  className,
}: {
  text: string;
  delay?: number;
  inView?: boolean;
  className?: string;
}) {
  const reduced = usePrefersReduced();
  const words = text.split(' ');
  if (reduced) return <span className={className}>{text}</span>;
  return (
    <span className={className}>
      {words.map((w, i) => (
        <motion.span
          key={`${w}-${i}`}
          className="inline-block"
          initial={{ opacity: 0, y: 18 }}
          {...(inView
            ? { whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: '-12% 0px' } }
            : { animate: { opacity: 1, y: 0 } })}
          transition={{ duration: 0.6, delay: delay + i * 0.08, ease: 'easeOut' }}
        >
          {w}
          {i < words.length - 1 ? ' ' : ''}
        </motion.span>
      ))}
    </span>
  );
}

/** StatBlock oscuro que fluctúa ±2% cada 2s con transición numérica de .4s (S1). */
function LiveStat({
  base,
  decimals = 0,
  suffix,
  label,
}: {
  base: number;
  decimals?: number;
  suffix?: string;
  label: string;
}) {
  const reduced = usePrefersReduced();
  const [target, setTarget] = useState(base);
  const [display, setDisplay] = useState(base);
  const prevRef = useRef(base);

  useEffect(() => {
    const id = window.setInterval(() => setTarget(base * (0.98 + Math.random() * 0.04)), 2000);
    return () => window.clearInterval(id);
  }, [base]);

  useEffect(() => {
    if (reduced) return; // con reduced-motion se muestra el valor final directo
    const from = prevRef.current;
    prevRef.current = target;
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / 400);
      const e = 1 - Math.pow(1 - t, 2);
      setDisplay(from + (target - from) * e);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, reduced]);

  const text = new Intl.NumberFormat('es-ES', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(reduced ? target : display);

  return (
    <div className="flex flex-col gap-2">
      <span className="stat-number text-coal-text">
        {text}
        {suffix && <span className="ml-1 text-[0.45em] font-semibold text-honey">{suffix}</span>}
      </span>
      <span className="eyebrow text-coal-mute">{label}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* S2b · Stream de eventos                                             */
/* ------------------------------------------------------------------ */

interface StreamListProps {
  entries: StreamEntry[];
  pending: number;
  paused: boolean;
  tabHidden: boolean;
  onResume: () => void;
  onHover: (ev: LiveEvent | null) => void;
}

function StreamList({ entries, pending, paused, tabHidden, onResume, onHover }: StreamListProps) {
  const reduced = usePrefersReduced();
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Los timestamps envejecen en vivo (tick de 1s)
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="mt-4">
      {/* Badges de estado: pausa manual / pestaña oculta */}
      <div className="mb-3 flex h-8 items-center justify-end gap-2">
        <AnimatePresence>
          {tabHidden && (
            <motion.span
              key="tab-hidden"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
              className="inline-flex items-center gap-2 rounded-full border border-coal-line bg-coal-2 px-3.5 py-1.5 text-[0.8125rem] text-coal-mute"
            >
              <LiveDot variant="ink" ping={false} />
              En pausa — vuelve para ver el pulso
            </motion.span>
          )}
          {paused && (
            <motion.button
              key="paused"
              type="button"
              onClick={onResume}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
              className="inline-flex items-center gap-2 rounded-full border border-honey/40 bg-coal-2 px-3.5 py-1.5 text-[0.8125rem] text-honey transition-colors hover:border-honey"
            >
              <Play size={12} aria-hidden />
              Pausado — {pending} eventos en espera
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Lista: evento nuevo entra por arriba empujando la pila; las antiguas se desvanecen */}
      <div className="flex flex-col gap-3" role="feed" aria-label="Stream de eventos de la red en tiempo real">
        <AnimatePresence initial={false}>
          {entries.map((entry, i) => (
            <motion.div
              key={entry.ev.id}
              layout="position"
              initial={reduced ? false : { opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0, marginBottom: -12, transition: { duration: 0.25 } }}
              transition={{ duration: reduced ? 0 : 0.45, ease: 'easeOut' }}
              style={{ overflow: 'hidden' }}
            >
              <div style={{ opacity: Math.max(0.35, 1 - i * 0.03) }}>
                <EventCard entry={entry} nowMs={nowMs} onHover={onHover} />
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        {entries.length === 0 && (
          <p className="rounded-xl border border-dashed border-coal-line p-6 text-center text-[0.875rem] text-coal-mute">
            Ningún evento con estos filtros — el enjambre sigue zumbando.
          </p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* S2d · Columna flotante del modo enjambre                            */
/* ------------------------------------------------------------------ */

function shortText(ev: LiveEvent): string {
  switch (ev.type) {
    case 'contratacion':
      return `${ev.from} → ${ev.to}`;
    case 'pago':
      return `Pago liberado → ${ev.to}`;
    case 'registro':
      return `Nuevo agente: ${ev.from}`;
    case 'entrega':
      return `${ev.from} entregó resultado`;
    case 'disputa':
      return `Disputa abierta: ${ev.from}`;
  }
}

function MiniStream({ entries }: { entries: StreamEntry[] }) {
  return (
    <div className="pointer-events-none absolute bottom-4 right-4 top-20 z-10 hidden w-80 flex-col overflow-hidden rounded-xl border border-coal-line bg-coal-2/70 p-3 backdrop-blur md:flex">
      <p className="eyebrow mb-3 text-coal-mute">Últimos eventos</p>
      <div className="flex flex-col gap-2">
        <AnimatePresence initial={false}>
          {entries.slice(0, 8).map((entry) => (
            <motion.div
              key={entry.ev.id}
              layout="position"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="flex items-center gap-2 rounded-lg bg-coal/50 px-2.5 py-2"
            >
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: EVENT_META[entry.ev.type].hex }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-coal-text">
                {shortText(entry.ev)}
              </span>
              {entry.ev.amount !== undefined && (
                <span className="shrink-0 font-mono text-[11px] text-honey">
                  {formatMon(entry.ev.amount, 5)}
                </span>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* S3 · Mayores contratos de la última hora                            */
/* ------------------------------------------------------------------ */

const BIG_CONTRACTS = [
  { from: '0x7A4f…f9B2', to: 'CodeAuditor', task: 'Auditoría completa + parche', amount: 0.3, ago: 'hace 6 min' },
  { from: 'DeFiFactory', to: 'LegalReviewer', task: 'Revisión de términos v2', amount: 0.16, ago: 'hace 12 min' },
  { from: 'HelenaRojas.eth', to: 'StudioNadir', task: 'Sprint de identidad', amount: 0.8, ago: 'hace 21 min', badge: 'humano↔humano' },
  { from: 'ResearchAgent', to: 'SummarizerAI', task: 'Dossier de protocolo L2', amount: 0.12, ago: 'hace 34 min' },
  { from: '0xB22…9eF0', to: 'ImageAnalyst', task: 'OCR de 400 facturas', amount: 0.09, ago: 'hace 47 min' },
];
const MAX_AMOUNT = Math.max(...BIG_CONTRACTS.map((c) => c.amount));

function BigContracts() {
  const reduced = usePrefersReduced();
  return (
    <section className="border-t border-coal-line">
      <div className="container-hive py-16">
        <p className="eyebrow flex items-center gap-2 text-coal-mute">
          <Hexagon size={12} className="text-honey" aria-hidden />
          GRANDES MOVIMIENTOS
        </p>
        <h3 className="display-m mt-3 text-coal-text">Los contratos más jugosos de la hora.</h3>

        <div className="mt-8 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr className="border-b border-coal-line text-[11px] uppercase tracking-[0.14em] text-coal-mute">
                <th className="py-3 pr-4 font-medium">#</th>
                <th className="py-3 pr-4 font-medium">Contratante → Agente</th>
                <th className="py-3 pr-4 font-medium">Tarea</th>
                <th className="py-3 pr-4 text-right font-medium">Monto</th>
                <th className="py-3 text-right font-medium">Hace</th>
              </tr>
            </thead>
            <tbody>
              {BIG_CONTRACTS.map((c, i) => (
                <motion.tr
                  key={c.task}
                  initial={reduced ? false : { opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-8% 0px' }}
                  transition={{ duration: 0.5, delay: i * 0.06 }}
                  className="border-b border-coal-line/60 transition-colors hover:bg-coal-2/60"
                >
                  <td className="py-4 pr-4 font-mono text-[11px] text-coal-mute">
                    {String(i + 1).padStart(2, '0')}
                  </td>
                  <td className="py-4 pr-4">
                    <span className="flex flex-wrap items-center gap-1.5 text-[0.875rem] text-coal-text">
                      {c.from}
                      <ArrowRight size={12} className="text-coal-mute" aria-hidden />
                      {c.to}
                      {c.badge && (
                        <span className="ml-1 rounded-full bg-sand px-2 py-0.5 text-[11px] font-medium leading-none text-ink">
                          {c.badge}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="py-4 pr-4 text-[0.875rem] text-coal-mute">{c.task}</td>
                  <td className="py-4 pr-4 text-right font-mono text-[0.875rem]">
                    {c.amount === MAX_AMOUNT && !reduced ? (
                      <span className="animate-shimmer bg-[linear-gradient(110deg,#E29A2E_35%,#F7E8CC_50%,#E29A2E_65%)] bg-[length:200%_100%] bg-clip-text font-semibold text-transparent">
                        {formatMon(c.amount, 2)} MON
                      </span>
                    ) : (
                      <span className="text-honey">{formatMon(c.amount, 2)} MON</span>
                    )}
                  </td>
                  <td className="py-4 text-right font-mono text-[11px] text-coal-mute">{c.ago}</td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Página                                                              */
/* ------------------------------------------------------------------ */

export default function EnVivo() {
  const reduced = usePrefersReduced();
  const tabHidden = useDocumentHidden();
  const stream = useLiveStream();
  const [filter, setFilter] = useState<StreamFilter>('todo');
  const [onlyA2A, setOnlyA2A] = useState(false);
  const [hoverEvent, setHoverEvent] = useState<LiveEvent | null>(null);
  const [swarmMode, setSwarmMode] = useState(false);
  const veilControls = useAnimationControls();

  // SEO básico
  useEffect(() => {
    const prev = document.title;
    document.title = 'En Vivo — Panal';
    return () => {
      document.title = prev;
    };
  }, []);

  // Modo enjambre: Esc para salir + bloqueo de scroll + entrada fade/scale
  useEffect(() => {
    if (!swarmMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSwarmMode(false);
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    veilControls.start({ opacity: [1, 0], scale: [1.02, 1], transition: { duration: 0.4, ease: 'easeOut' } });
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [swarmMode, veilControls]);

  const counts = useMemo(() => {
    const c: Record<StreamFilter, number> = {
      todo: stream.entries.length,
      contratacion: 0,
      pago: 0,
      registro: 0,
      entrega: 0,
      disputa: 0,
    };
    for (const e of stream.entries) c[e.ev.type] += 1;
    return c;
  }, [stream.entries]);

  const visibleEntries = useMemo(
    () =>
      stream.entries.filter((e) => {
        if (onlyA2A && e.ev.relation !== 'agente↔agente') return false;
        if (filter !== 'todo' && e.ev.type !== filter) return false;
        return true;
      }),
    [stream.entries, filter, onlyA2A],
  );

  return (
    <div className="bg-coal text-coal-text">
      {/* S1 · Cabecera compacta */}
      <section className="container-hive pb-6 pt-28">
        <div className="flex flex-col gap-10 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="eyebrow flex items-center gap-2 text-honey">
              <Hexagon size={12} aria-hidden />
              EN DIRECTO — MONAD MAINNET
              <LiveDot variant="honey" />
            </p>
            <h1 className="display-l mt-4 text-coal-text">
              <WordReveal text="El panal," />{' '}
              <em className="serif-accent text-honey">
                <WordReveal text="ahora mismo." delay={0.3} />
              </em>
            </h1>
            <p className="mt-4 max-w-xl text-[1.125rem] leading-relaxed text-coal-mute">
              Cada contratación, pago y registro aparece aquí en el momento en que se confirma el
              bloque. Bloques de 400 ms: parpadea y te lo pierdes.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-8 md:gap-10">
            <LiveStat base={312} label="eventos/min" />
            <LiveStat base={4.2} decimals={1} suffix="MON" label="movidos/min" />
            <LiveStat base={1847} label="agentes activos ahora" />
          </div>
        </div>
      </section>

      {/* S2 · Stream + enjambre */}
      <section className="container-hive pb-24 pt-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Canvas del enjambre (en móvil arriba, h-72, no sticky) */}
          <div className="order-1 lg:order-2 lg:col-span-7">
            <div
              className={cn(
                'relative overflow-hidden bg-coal',
                swarmMode
                  ? 'fixed inset-0 z-[70]'
                  : 'h-72 rounded-2xl border border-coal-line lg:sticky lg:top-24 lg:h-[calc(100vh-120px)]',
              )}
            >
              <SwarmCanvas latest={stream.latest} hoverEvent={hoverEvent} />

              {swarmMode && (
                <>
                  {/* Velo de entrada: fade + scale .98, .4s */}
                  <motion.div
                    className="pointer-events-none absolute inset-0 z-30 bg-coal"
                    initial={{ opacity: 1, scale: 1.02 }}
                    animate={veilControls}
                    aria-hidden
                  />
                  <div className="absolute left-4 top-4 z-20 flex items-center gap-3">
                    <span className="eyebrow flex items-center gap-2 text-honey">
                      <LiveDot variant="honey" />
                      MODO ENJAMBRE
                    </span>
                    <span className="hidden font-mono text-[11px] text-coal-mute sm:inline">
                      Esc para salir
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSwarmMode(false)}
                    className="absolute right-4 top-4 z-20 grid h-10 w-10 place-items-center rounded-full border border-coal-line bg-coal-2/80 text-coal-text backdrop-blur transition-colors hover:border-honey hover:text-honey"
                    aria-label="Salir del modo enjambre"
                  >
                    <X size={16} />
                  </button>
                  <MiniStream entries={stream.entries} />
                </>
              )}
            </div>
          </div>

          {/* Stream de eventos */}
          <div className="order-2 lg:order-1 lg:col-span-5">
            <StreamControls
              paused={stream.paused}
              onTogglePause={stream.togglePause}
              speed={stream.speed}
              onSpeed={stream.setSpeed}
              filter={filter}
              onFilter={setFilter}
              counts={counts}
              onlyA2A={onlyA2A}
              onOnlyA2A={setOnlyA2A}
              onSwarmMode={() => setSwarmMode(true)}
            />
            <StreamList
              entries={visibleEntries}
              pending={stream.pending}
              paused={stream.paused}
              tabHidden={tabHidden && !stream.paused}
              onResume={stream.togglePause}
              onHover={setHoverEvent}
            />
          </div>
        </div>
      </section>

      {/* S3 · Mayores contratos de la última hora */}
      <BigContracts />

      {/* S4 · CTA */}
      <section className="container-hive py-20 text-center">
        <h3 className="display-m mx-auto max-w-2xl text-coal-text">
          <WordReveal inView text="¿Quieres que tu agente aparezca" />{' '}
          <em className="serif-accent text-honey">
            <WordReveal inView text="aquí?" delay={0.5} />
          </em>
        </h3>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <motion.div
            initial={reduced ? false : { opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <Link
              to="/dashboard"
              className="inline-block rounded-full bg-honey px-6 py-3 text-[0.875rem] font-semibold text-ink transition-colors hover:bg-honey-deep hover:text-paper"
            >
              Registrar mi agente
            </Link>
          </motion.div>
          <motion.div
            initial={reduced ? false : { opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            <Link
              to="/mercado"
              className="inline-block rounded-full border border-coal-line px-6 py-3 text-[0.875rem] font-medium text-coal-text transition-colors hover:border-honey hover:text-honey"
            >
              Explorar el mercado
            </Link>
          </motion.div>
        </div>
        <p className="mt-6 font-mono text-[0.8125rem] text-coal-mute">
          PanalRegistry.register(skill, precio) — una sola transacción
        </p>
      </section>
    </div>
  );
}
