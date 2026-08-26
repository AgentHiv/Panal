import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import { useGSAP } from '@gsap/react';
import { AnimatePresence, motion, useScroll, useTransform } from 'framer-motion';
import {
  ArrowRight,
  BadgeCheck,
  Check,
  Download,
  Hexagon,
  KeyRound,
  Paperclip,
  ShieldCheck,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { activeChain, currencySymbol } from '@/contracts/config';
import { priceKey } from '@/hooks/usePanalAgents';
import Reveal, { WordReveal } from '@/components/home/Reveal';
import MiniSwarm from '@/components/home/MiniSwarm';
import SectionHeader from '@/components/SectionHeader';
import StatBlock from '@/components/StatBlock';
import LiveDot from '@/components/LiveDot';
import RatingStars from '@/components/RatingStars';
import AgentCard from '@/components/AgentCard';
import HexAvatar from '@/components/HexAvatar';
import HireDialog from '@/components/HireDialog';
import Magnetic from '@/components/Magnetic';
import { cn } from '@/lib/utils';
import type { Agent } from '@/data/agents';
import { formatInt, formatMon, formatRating, CATEGORY_LABELS } from '@/data/agents';
import { timeAgo, truncateHash } from '@/data/events';
import type { LiveEvent, TickerItem } from '@/data/events';
import { EVENT_META } from '@/components/live/meta';
import { useOnchainEvents } from '@/hooks/useOnchainEvents';
import { useNetworkStats } from '@/hooks/useNetworkStats';
import { useTopAgents } from '@/hooks/useTopAgents';
import { useIndexStats } from '@/lib/indexer';
import { formatEther } from 'viem';
import { APK_RELEASES_URL, CONTRACTS, NETWORK_COMPARISON, ROADMAP_PHASES } from '@/data/protocol';

const HeroSwarm = lazy(() => import('@/components/home/HeroSwarm'));

gsap.registerPlugin(ScrollTrigger, SplitText);

const REDUCED = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ============================================================
 * S1 · Hero — "El panal" (oscuro, 100vh)
 * ============================================================ */
function Hero() {
  const { t } = useTranslation();
  const sectionRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [swarmReady, setSwarmReady] = useState(false);

  useGSAP(
    () => {
      if (REDUCED()) return;

      // Entrada: eyebrow → H1 char-level → sub y CTAs → confianza → ticker
      const split = new SplitText('.hero-h1-line', { type: 'words,chars' });
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
      tl.fromTo(
        '.hero-eyebrow',
        { y: 16, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.6 },
      )
        .fromTo(
          split.chars,
          { yPercent: 110, rotate: 4, opacity: 0 },
          { yPercent: 0, rotate: 0, opacity: 1, duration: 0.9, ease: 'power4.out', stagger: 0.018 },
          '-=0.15',
        )
        .fromTo(
          ['.hero-sub', '.hero-ctas'],
          { y: 24, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.8, stagger: 0.1 },
          '-=0.45',
        )
        .fromTo('.hero-trust', { opacity: 0 }, { opacity: 1, duration: 0.6 }, '-=0.35')
        .fromTo('.hero-ticker', { yPercent: 100 }, { yPercent: 0, duration: 0.8 }, '-=0.3');

      // Salida al hacer scroll: contenido sube con parallax y las partículas se desvanecen
      gsap.to(contentRef.current, {
        y: -80,
        ease: 'none',
        scrollTrigger: { trigger: sectionRef.current, start: 'top top', end: 'bottom top', scrub: true },
      });
      gsap.to(canvasRef.current, {
        opacity: 0.25,
        ease: 'none',
        scrollTrigger: { trigger: sectionRef.current, start: 'top top', end: '60% top', scrub: true },
      });

      return () => split.revert();
    },
    { scope: sectionRef },
  );

  return (
    <section ref={sectionRef} className="relative flex min-h-[100dvh] flex-col overflow-hidden bg-coal text-coal-text">
      {/* Canvas 3D + fallback */}
      <div ref={canvasRef} className="absolute inset-0">
        <img
          src="/hero-swarm-fallback.webp"
          alt=""
          decoding="async"
          className={cn(
            'absolute inset-0 h-full w-full object-cover transition-opacity duration-1000',
            swarmReady ? 'opacity-0' : 'opacity-100',
          )}
        />
        <Suspense fallback={null}>
          <HeroSwarm onReady={() => setSwarmReady(true)} />
        </Suspense>
        {/* halo púrpura Monad ambiental */}
        <div className="glow-monad right-[-10%] top-[-15%] h-[70vh] w-[60vw]" aria-hidden />
        <div className="glow-monad-soft bottom-[5%] left-[30%] h-[50vh] w-[40vw]" aria-hidden />
        {/* veladura para legibilidad del texto a la izquierda */}
        <div className="absolute inset-0 bg-gradient-to-r from-coal via-coal/55 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-coal to-transparent" />
      </div>

      {/* Contenido */}
      <div className="container-hive relative z-10 flex flex-1 items-center pb-48 pt-32">
        <div ref={contentRef} className="max-w-3xl will-change-transform">
          <p className="hero-eyebrow eyebrow flex items-center gap-2 text-monad-mist">
            <Hexagon size={12} className="fill-monad text-monad" aria-hidden />
            {t('home.hero.eyebrow')}
          </p>
          <h1 className="display-xl mt-6 text-coal-text">
            <span className="hero-h1-line block">{t('home.hero.title1')}</span>
            <span className="hero-h1-line serif-accent block text-gradient-hive">{t('home.hero.title2')}</span>
            <span className="hero-h1-line block">{t('home.hero.title3')}</span>
          </h1>
          <p className="hero-sub mt-7 max-w-xl text-[1.125rem] leading-[1.65] text-coal-mute">
            {t('home.hero.sub')}
          </p>
          <div className="hero-ctas mt-9 flex flex-wrap items-center gap-4">
            <Magnetic>
              <Link
                to="/mercado"
                className="btn-monad group inline-flex px-6 py-3.5 text-[0.9375rem] font-semibold"
              >
                {t('home.hero.ctaMarket')}
                <ArrowRight size={17} className="transition-transform duration-200 group-hover:translate-x-1" />
              </Link>
            </Magnetic>
            <Magnetic>
              <Link
                to="/en-vivo"
                className="inline-flex items-center gap-2.5 rounded-full border border-coal-line px-6 py-3.5 text-[0.9375rem] font-medium text-coal-text transition-colors hover:border-monad hover:text-monad-mist"
              >
                <LiveDot variant="monad" />
                {t('home.hero.ctaLive')}
              </Link>
            </Magnetic>
          </div>
          <p className="hero-trust mt-10 font-mono text-[12px] text-coal-mute">
            <span className="text-monad-mist">{activeChain.name}</span> · Chain ID {activeChain.id} · Finalidad ~800ms · &lt;$0.001 por tx
          </p>
        </div>
      </div>

      {/* Indicador de scroll */}
      <div className="absolute bottom-[76px] left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-2">
        <span className="block h-10 w-px origin-top animate-heartbeat bg-ink-3/60" />
        <span className="text-[0.8125rem] text-ink-3">{t('home.hero.scroll')}</span>
      </div>

      {/* Ticker de transacciones */}
      <HeroTicker />
    </section>
  );
}

function HeroTicker() {
  const { t } = useTranslation();
  const { entries, fetchedAt } = useOnchainEvents();
  const [now, setNow] = useState(() => Date.now());

  // Envejecido de los timestamps entre polls (12 s)
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(id);
  }, []);

  // Los 10 eventos reales más recientes con monto; si no hay, el ticker se oculta
  const items = useMemo<(TickerItem & { secondsAgo: number })[]>(
    () =>
      entries
        .filter((ev) => ev.amount !== undefined)
        .slice(0, 10)
        .map((ev) => ({
          hash: ev.txHash,
          actor: ev.from,
          target: ev.to ?? '',
          task: t(EVENT_META[ev.type].label),
          amount: `${formatMon(ev.amount as number, 5)} MON`,
          time: '',
          secondsAgo: ev.secondsAgo,
        })),
    [entries, t],
  );

  // El tiempo envejece en vivo desde el sello del último fetch
  const aged = useMemo<TickerItem[]>(
    () =>
      items.map(({ secondsAgo, ...item }) => ({
        ...item,
        time: timeAgo(secondsAgo + Math.max(0, (now - fetchedAt) / 1000), t),
      })),
    [items, now, fetchedAt, t],
  );

  const copyTx = async (hash: string) => {
    try {
      await navigator.clipboard.writeText(hash);
    } catch {
      /* noop */
    }
    toast(t('home.ticker.copied'), { icon: <Check size={14} className="text-olive" /> });
  };

  // Sin eventos reales todavía: no mostrar hashes falsos — ticker oculto
  if (aged.length === 0) return null;

  const loop = [...aged, ...aged];
  return (
    <div className="hero-ticker marquee relative z-10 overflow-hidden border-t border-coal-line bg-coal/90 py-3.5 backdrop-blur-sm">
      <div className="marquee-track flex w-max animate-marquee items-center">
        {loop.map((item, i) => (
          <button
            key={i}
            type="button"
            onClick={() => copyTx(item.hash)}
            className="flex items-center gap-3 whitespace-nowrap px-5 font-mono text-[13px] text-coal-mute transition-colors hover:text-honey"
          >
            <span>
              <span className="text-coal-mute/70">{truncateHash(item.hash)}</span>{' '}
              <span className="text-coal-text/80">{item.actor}</span> {t('home.ticker.hired')}{' '}
              <span className="text-coal-text/80">{item.target}</span> · {item.task} ·{' '}
              <span className="text-honey">{item.amount}</span> · <span className="text-olive">✓</span>{' '}
              {item.time}
            </span>
            <Hexagon size={9} className="fill-honey/70 text-honey/70" aria-hidden />
          </button>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
 * S2 · Banda de stats (claro) — datos REALES del indexador;
 * fallback a getAgentCount (RPC) para agentes; '—' si no hay dato.
 * ============================================================ */
function StatsBand() {
  const { t } = useTranslation();
  const { stats } = useIndexStats();
  const { agentCount } = useNetworkStats();

  // MON movidos en los últimos 30 días (suma de las series diarias del índice).
  const volume30 = useMemo(() => {
    if (!stats) return null;
    const wei = stats.daily30.reduce((acc, d) => acc + BigInt(d.monMoved), 0n);
    return Number(formatEther(wei));
  }, [stats]);

  const agents = stats?.totals.agents ?? agentCount;
  const tasks = stats?.totals.completed ?? null;

  const items: Array<{ value: number | null; decimals?: number; suffix?: string; label: string }> = [
    { value: agents, label: t('home.stats.agents') },
    { value: tasks, label: t('home.stats.tasks') },
    { value: volume30, decimals: 2, suffix: 'MON', label: t('home.stats.volume30') },
    // Constante de spec de red (no es un dato medido por Panal)
    { value: 812, suffix: 'ms', label: t('home.stats.finality') },
  ];

  return (
    <section className="border-y border-line bg-paper">
      <Reveal stagger className="container-hive grid grid-cols-2 md:grid-cols-4 md:divide-x md:divide-line">
        {items.map((s) => (
          <div key={s.label} className="py-10 md:px-10 md:py-14 md:first:pl-0 md:last:pr-0">
            {s.value === null ? (
              <div className="flex flex-col gap-2">
                <span className="stat-number text-ink">—</span>
                <span className="eyebrow text-ink-3">{s.label}</span>
              </div>
            ) : (
              <StatBlock value={s.value} decimals={s.decimals} suffix={s.suffix} label={s.label} />
            )}
          </div>
        ))}
      </Reveal>
    </section>
  );
}

/* ============================================================
 * S3 · El problema (editorial claro)
 * ============================================================ */
const PROBLEMS = [
  { title: 'home.problem.1.title', text: 'home.problem.1.text' },
  { title: 'home.problem.2.title', text: 'home.problem.2.text' },
  { title: 'home.problem.3.title', text: 'home.problem.3.text' },
  { title: 'home.problem.4.title', text: 'home.problem.4.text' },
];

function ProblemSection() {
  const { t } = useTranslation();
  return (
    <section className="bg-paper py-24 md:py-32">
      <div className="container-hive grid grid-cols-1 gap-12 md:grid-cols-12 md:gap-6">
        <div className="md:col-span-5">
          <p className="eyebrow flex items-center gap-2 text-ink-3">
            <Hexagon size={12} className="fill-honey text-honey" aria-hidden />
            {t('home.problem.eyebrow')}
          </p>
          <h2 className="display-l mt-4 text-ink">
            <WordReveal>
              {t('home.problem.title')}{' '}
              <em className="serif-accent text-honey-deep">{t('home.problem.titleEm')}</em>
            </WordReveal>
          </h2>
          <p className="mt-4 max-w-md text-[1.125rem] leading-[1.65] text-ink-2">
            {t('home.problem.sub')}
          </p>
        </div>
        <div className="flex flex-col md:col-span-7">
          {PROBLEMS.map((p, i) => (
            <motion.div
              key={p.title}
              initial={{ opacity: 0, x: 40 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: '-12%' }}
              transition={{ duration: 0.8, delay: i * 0.12, ease: 'easeOut' }}
              className="group flex gap-6 border-t border-line px-3 py-7 transition-colors duration-200 last:border-b hover:bg-cream md:px-5"
            >
              <motion.span
                initial={{ scale: 0.8 }}
                whileInView={{ scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: i * 0.12 + 0.15 }}
                className="font-mono text-[0.9375rem] font-medium text-honey transition-colors duration-200 group-hover:text-honey-deep"
              >
                {String(i + 1).padStart(2, '0')}
              </motion.span>
              <div>
                <h3 className="display-m text-ink">{t(p.title)}</h3>
                <p className="mt-2 max-w-xl leading-[1.6] text-ink-2">{t(p.text)}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
 * S4 · El protocolo en tres contratos (cream)
 * ============================================================ */
function ProtocolSection() {
  const { t } = useTranslation();
  return (
    <section className="relative overflow-hidden bg-cream py-24 md:py-32">
      <div className="bg-honeycomb pointer-events-none absolute inset-0 opacity-[0.08]" aria-hidden />
      <div className="glow-honey left-[-8%] bottom-[-20%] h-[380px] w-[480px]" aria-hidden />
      <div className="container-hive relative">
        <SectionHeader
          align="center"
          eyebrow={t('home.protocol.eyebrow')}
          title={
            <WordReveal>
              {t('home.protocol.title')} <em className="serif-accent text-honey-deep">{t('home.protocol.titleEm')}</em>
            </WordReveal>
          }
        />
        <Reveal stagger className="mt-14 grid gap-6 md:grid-cols-3">
          {CONTRACTS.map((c) => (
            <div
              key={c.id}
              className="group flex flex-col gap-4 rounded-2xl border border-line bg-paper p-8 shadow-card transition-all duration-200 hover:-translate-y-1.5 hover:border-honey hover:shadow-card-hover"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-honey-soft transition-transform duration-300 group-hover:rotate-[8deg]">
                <c.icon size={22} className="text-honey-deep" />
              </span>
              <h3 className="display-m text-ink">{c.name}</h3>
              <p className="flex-1 leading-[1.6] text-ink-2">{t(c.tagline)}</p>
              <span className="font-mono text-[12px] text-ink-3">{c.addressShort}</span>
            </div>
          ))}
        </Reveal>
        <Reveal className="mt-12 text-center">
          <Link
            to="/protocolo"
            className="group inline-flex items-center gap-2 text-[0.9375rem] font-semibold text-honey-deep transition-colors hover:text-ink"
          >
            {t('home.protocol.cta')}
            <ArrowRight size={17} className="transition-transform duration-200 group-hover:translate-x-1" />
          </Link>
        </Reveal>
      </div>
    </section>
  );
}

/* ============================================================
 * S5 · El panal en vivo (oscuro)
 * ============================================================ */
function LiveSection() {
  const { t } = useTranslation();
  // Los 5 eventos reales más recientes (getLogs + polling 12 s)
  const { entries: chainEvents, loading: chainLoading, fetchedAt } = useOnchainEvents();
  const eventsPerMin = useMemo(
    () => chainEvents.filter((e) => e.secondsAgo <= 3600).length / 60,
    [chainEvents],
  );
  type StampedEvent = LiveEvent & { ts: number };
  const events = useMemo<StampedEvent[]>(
    () => chainEvents.slice(0, 5).map((ev) => ({ ...ev, ts: fetchedAt - ev.secondsAgo * 1000 })),
    [chainEvents, fetchedAt],
  );
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, []);

  return (
    <section className="relative overflow-hidden bg-coal py-24 text-coal-text md:py-32">
      <div className="grain-overlay-dark absolute inset-0" aria-hidden />
      <div className="glow-monad right-[-12%] top-[-20%] h-[55vh] w-[45vw]" aria-hidden />
      <div className="container-hive relative grid items-center gap-12 md:grid-cols-12">
        <div className="md:col-span-5">
          <p className="eyebrow flex items-center gap-2 text-honey">
            <Hexagon size={12} className="fill-honey text-honey" aria-hidden />
            {t('home.live.eyebrow')}
          </p>
          <h2 className="display-l mt-4 text-coal-text">
            <WordReveal>
              {t('home.live.title')} <em className="serif-accent text-honey">{t('home.live.titleEm')}</em>
            </WordReveal>
          </h2>
          <p className="mt-4 text-[1.125rem] leading-[1.65] text-coal-mute">
            {t('home.live.sub')}
          </p>

          {/* Mini-feed de actividad real on-chain */}
          <div className="mt-8 flex flex-col gap-2.5">
            {events.length === 0 && !chainLoading && (
              <p className="rounded-xl border border-dashed border-coal-line px-4 py-3 text-[0.8125rem] text-coal-mute">
                {t('live.empty')}
              </p>
            )}
            <AnimatePresence initial={false} mode="popLayout">
              {events.map((ev) => (
                <motion.div
                  key={ev.id}
                  layout
                  initial={{ opacity: 0, y: -16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.5 }}
                  className="flex items-center justify-between gap-3 rounded-xl border border-coal-line bg-coal-2 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-[0.875rem] leading-snug text-coal-text break-words sm:truncate">
                      <span className="font-medium">{ev.from}</span>
                      {ev.to && (
                        <>
                          <span className="text-coal-mute"> → </span>
                          <span className="font-medium">{ev.to}</span>
                        </>
                      )}
                      {ev.task && <span className="text-coal-mute"> · {ev.task}</span>}
                    </p>
                    <p className="mt-0.5 font-mono text-[11px] text-coal-mute">
                      {timeAgo((now - ev.ts) / 1000, t)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {typeof ev.amount === 'number' && (
                      <span className="font-mono text-[12px] text-honey">{formatMon(ev.amount, 5)} {currencySymbol(ev.currency)}</span>
                    )}
                    {ev.relation && (
                      <span className="rounded-full bg-honey-soft px-2 py-0.5 font-mono text-[10px] text-honey-deep">
                        {ev.relation === 'agente↔agente' ? t('live.relation.agentAgent') : t('live.relation.humanAgent')}
                      </span>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          <div className="mt-8 flex flex-col items-stretch gap-4 sm:flex-row sm:items-center sm:gap-6">
            <StatBlock dark value={eventsPerMin} decimals={1} suffix={t('home.live.perMin')} label={t('home.live.statLabel')} />
            <Link
              to="/en-vivo"
              className="group inline-flex max-w-full items-center justify-center gap-2 rounded-full border border-coal-line px-5 py-2.5 text-center text-[0.875rem] font-medium text-coal-text transition-colors hover:border-honey hover:text-honey"
            >
              {t('home.live.cta')}
              <ArrowRight size={15} className="transition-transform duration-200 group-hover:translate-x-1" />
            </Link>
          </div>
        </div>

        {/* Canvas de enjambre pequeño */}
        <Reveal className="md:col-span-7">
          <div className="relative h-[380px] overflow-hidden rounded-2xl border border-coal-line bg-coal-2/50 md:h-[460px]">
            <MiniSwarm />
            <div className="absolute bottom-4 left-4 flex items-center gap-4 font-mono text-[11px] text-coal-mute">
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-honey" /> {t('home.live.legendHiring')}
              </span>
              <span>{t('home.live.legendSize')}</span>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ============================================================
 * S6 · Ranking semanal (claro)
 * ============================================================ */
function RankBadge({ rank }: { rank: number }) {
  return (
    <span
      className={cn(
        'flex h-9 w-9 items-center justify-center font-display text-[0.8125rem] font-bold',
        rank === 1 ? 'bg-honey text-ink' : 'bg-sand text-ink-2',
      )}
      style={{ clipPath: 'polygon(50% 0%, 93.3% 25%, 93.3% 75%, 50% 100%, 6.7% 75%, 6.7% 25%)' }}
    >
      Nº{rank}
    </span>
  );
}

function PodiumCard({ agent, rank }: { agent: Agent; rank: number }) {
  const { t } = useTranslation();
  const [hireOpen, setHireOpen] = useState(false);
  const first = rank === 1;
  return (
    <div className={cn('relative', first && 'md:-translate-y-4')}>
      {first && (
        <motion.span
          className="absolute -inset-1.5 rounded-[22px] bg-honey-soft"
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
          aria-hidden
        />
      )}
      <div
        className={cn(
          'relative flex flex-col gap-4 rounded-2xl border bg-paper p-6 shadow-card transition-all duration-200 hover:-translate-y-1 hover:shadow-card-hover',
          first ? 'border-honey' : 'border-line hover:border-honey',
        )}
      >
        <div className="flex items-start justify-between">
          <HexAvatar seed={agent.wallet} size={56} />
          <RankBadge rank={rank} />
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <h3 className="font-display text-[1.15rem] font-semibold tracking-[-0.015em] text-ink">{agent.name}</h3>
            {agent.verified && <BadgeCheck size={16} className="fill-olive text-paper" />}
          </div>
          <span className="mt-1 inline-block rounded-full bg-honey-soft px-2.5 py-0.5 text-[0.75rem] font-medium text-honey-deep">
            {t(CATEGORY_LABELS[agent.category])}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <RatingStars rating={agent.rating} />
          <span className="text-[0.875rem] font-semibold text-ink">{formatRating(agent.rating)}</span>
        </div>
        <p className="font-mono text-[12px] text-ink-2">
          {t(priceKey('home.rank.priceTasks', agent), {
            price: formatMon(agent.pricePerTask),
            tasks: formatInt(agent.tasksCompleted),
          })}
        </p>
        <button
          type="button"
          onClick={() => setHireOpen(true)}
          className={cn(
            'mt-1 rounded-full px-5 py-2.5 text-[0.875rem] font-semibold transition-colors',
            first ? 'bg-honey text-ink hover:bg-honey-deep hover:text-paper' : 'border border-line text-ink transition-colors hover:border-honey hover:bg-honey',
          )}
        >
          {t('common.hire')}
        </button>
      </div>
      <HireDialog agent={agent} open={hireOpen} onOpenChange={setHireOpen} />
    </div>
  );
}

function RankingSection() {
  const { t, i18n } = useTranslation();
  // Ranking REAL: top del panal por actividad/reputación del indexador.
  const { top } = useTopAgents();
  /**
   * El número del enlace es el de los agentes que se van a ver.
   *
   * Salía de `getAgentCount()` del registro, que cuenta TODOS los que se
   * registraron alguna vez, incluidos los dados de baja: decía «ver los 9
   * agentes» y al pulsarlo aparecían seis.
   */
  const agentCountLabel = top.length > 0 ? new Intl.NumberFormat(i18n.language).format(top.length) : '—';
  const podium = top.slice(0, 3);
  /**
   * El resto del ranking, con su ficha entera.
   *
   * Antes salían como una fila fina con el nombre y poco más, y al lado de las
   * tarjetas del podio parecía que a esos agentes les faltaban los datos. No
   * era un fallo de datos: era que no se pintaban. Se reutiliza la tarjeta del
   * mercado, que ya enseña descripción, valoración, métricas y los dos botones.
   */
  const resto = top.slice(3, 9);

  return (
    <section className="bg-paper py-24 md:py-32">
      <div className="container-hive">
        <SectionHeader
          eyebrow={t('home.rank.eyebrow')}
          title={
            <WordReveal>
              {t('home.rank.title')} <em className="serif-accent text-honey-deep">{t('home.rank.titleEm')}</em>
            </WordReveal>
          }
          action={
            <Link
              to="/mercado"
              className="group inline-flex items-center gap-2 text-[0.9375rem] font-semibold text-honey-deep transition-colors hover:text-ink"
            >
              {t('home.rank.viewAll', { count: agentCountLabel })}
              <ArrowRight size={17} className="transition-transform duration-200 group-hover:translate-x-1" />
            </Link>
          }
        />
        {podium.length === 0 ? (
          <p className="mt-16 rounded-xl border border-dashed border-line px-4 py-6 text-center text-[0.875rem] text-ink-3">
            {t('home.rank.empty')}
          </p>
        ) : (
          <>
            <Reveal stagger className="mt-16 grid items-start gap-6 md:grid-cols-3">
              {podium.map((a, i) => (
                <PodiumCard key={a.id} agent={a} rank={i + 1} />
              ))}
            </Reveal>
            {resto.length > 0 && (
              <Reveal stagger className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {resto.map((a) => (
                  <AgentCard key={a.id} agent={a} />
                ))}
              </Reveal>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/* ============================================================
 * S7 · Para agentes y humanos (split)
 * ============================================================ */
function SplitSection() {
  const { t } = useTranslation();
  return (
    <section className="bg-paper pb-24 md:pb-32">
      <div className="container-hive grid gap-6 md:grid-cols-2">
        {/* Panel desarrolladores */}
        <motion.div
          initial={{ opacity: 0, x: -60 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: '-15%' }}
          transition={{ duration: 0.9, ease: 'easeOut' }}
          className="ring-glow-monad flex flex-col gap-6 rounded-3xl border border-coal-line bg-coal-2 p-9 text-coal-text md:p-12"
        >
          <p className="eyebrow text-honey">{t('home.split.devEyebrow')}</p>
          <h3 className="display-l text-coal-text">{t('home.split.devTitle')}</h3>
          <p className="max-w-md leading-[1.65] text-coal-text/75">
            {t('home.split.devText')}
          </p>
          <ol className="flex flex-col gap-3">
            {[t('home.split.devStep1'), t('home.split.devStep2'), t('home.split.devStep3')].map((s, i) => (
              <motion.li
                key={s}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.3 + i * 0.08 }}
                className="flex items-center gap-3 text-[0.9375rem] text-coal-text/90"
              >
                <span className="font-mono text-[0.8125rem] font-medium text-honey">{String(i + 1).padStart(2, '0')}</span>
                {s}
              </motion.li>
            ))}
          </ol>
          <div>
            {/* A la guía y no al panel: quien pulsa esto todavía no tiene un
                agente, y el panel es un formulario de alta que da por hecho
                que ya lo tienes construido y publicado. */}
            <Link
              to="/crear-agente"
              className="btn-monad group inline-flex px-6 py-3 text-[0.9375rem] font-semibold"
            >
              {t('home.split.devCta')}
              <ArrowRight size={16} className="transition-transform duration-200 group-hover:translate-x-1" />
            </Link>
          </div>
        </motion.div>

        {/* Panel humanos */}
        <motion.div
          initial={{ opacity: 0, x: 60 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: '-15%' }}
          transition={{ duration: 0.9, ease: 'easeOut' }}
          className="flex flex-col gap-6 rounded-3xl bg-honey-soft p-9 text-ink md:p-12"
        >
          <p className="eyebrow text-honey-deep">{t('home.split.humEyebrow')}</p>
          <h3 className="display-l text-ink">{t('home.split.humTitle')}</h3>
          <p className="max-w-md leading-[1.65] text-ink-2">
            {t('home.split.humText')}
          </p>
          <ul className="flex flex-col gap-3">
            {[t('home.split.humPoint1'), t('home.split.humPoint2'), t('home.split.humPoint3')].map((s, i) => (
              <motion.li
                key={s}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.3 + i * 0.08 }}
                className="flex items-center gap-3 text-[0.9375rem] text-ink"
              >
                <Check size={16} className="shrink-0 text-olive" strokeWidth={3} />
                {s}
              </motion.li>
            ))}
          </ul>
          <div>
            <Link
              to="/dashboard"
              className="btn-monad group inline-flex items-center gap-2 px-6 py-3 text-[0.9375rem] font-semibold"
            >
              {t('home.split.humCta')}
              <ArrowRight size={16} className="transition-transform duration-200 group-hover:translate-x-1" />
            </Link>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

/* ============================================================
 * S8 · La app de Android (oscuro)
 * ============================================================ */
function AndroidSection() {
  const { t } = useTranslation();
  const puntos = [
    { icon: KeyRound, text: t('home.android.point1') },
    { icon: Paperclip, text: t('home.android.point2') },
    { icon: ShieldCheck, text: t('home.android.point3') },
  ];

  return (
    <section className="border-t border-coal-line bg-coal py-24 text-coal-text md:py-32">
      <div className="container-hive grid items-center gap-14 md:grid-cols-2">
        <motion.div
          initial={{ opacity: 0, y: 28 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-15%' }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        >
          <p className="eyebrow text-honey">{t('home.android.eyebrow')}</p>
          <h2 className="display-l mt-4 text-coal-text">
            {t('home.android.title')}{' '}
            <em className="serif-accent text-honey">{t('home.android.titleEm')}</em>
          </h2>
          <p className="mt-5 max-w-md leading-[1.65] text-coal-text/75">{t('home.android.text')}</p>

          <ul className="mt-8 flex flex-col gap-4">
            {puntos.map(({ icon: Icono, text }, i) => (
              <motion.li
                key={text}
                initial={{ opacity: 0, x: -12 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.2 + i * 0.09 }}
                className="flex items-start gap-3 text-[0.9375rem] leading-[1.5] text-coal-text/90"
              >
                <Icono size={17} className="mt-[3px] shrink-0 text-honey" strokeWidth={1.9} />
                {text}
              </motion.li>
            ))}
          </ul>

          <div className="mt-9">
            <a
              href={APK_RELEASES_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-monad group inline-flex items-center gap-2 px-6 py-3 text-[0.9375rem] font-semibold"
            >
              <Download size={17} className="transition-transform duration-200 group-hover:translate-y-[2px]" />
              {t('home.android.cta')}
            </a>
          </div>
          <p className="mt-4 max-w-md text-[0.8125rem] leading-[1.5] text-coal-mute">
            {t('home.android.note')}
          </p>
        </motion.div>

        {/* Ilustración: un teléfono, no una captura. Los bloques son abstractos
            a propósito — una pantalla dibujada que imite texto real acabaría
            enseñando una app que no es la que se baja. */}
        <motion.div
          initial={{ opacity: 0, scale: 0.94 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, margin: '-15%' }}
          transition={{ duration: 0.9, ease: 'easeOut' }}
          className="mx-auto w-[244px]"
          aria-hidden="true"
        >
          <div className="ring-glow-monad rounded-[40px] border border-coal-line bg-coal-2 p-2.5">
            <div className="overflow-hidden rounded-[32px] bg-paper px-4 pb-6 pt-3">
              <div className="mb-5 flex justify-center">
                <span className="h-1 w-16 rounded-full bg-line" />
              </div>
              <div className="flex items-center gap-3">
                <span
                  className="flex h-9 w-9 items-center justify-center bg-honey-soft"
                  style={{ clipPath: 'polygon(50% 0%, 93.3% 25%, 93.3% 75%, 50% 100%, 6.7% 75%, 6.7% 25%)' }}
                >
                  <Hexagon size={15} className="text-honey" strokeWidth={2} />
                </span>
                <span className="flex flex-col gap-1.5">
                  <span className="block h-2 w-24 rounded-full bg-line" />
                  <span className="block h-1.5 w-16 rounded-full bg-sand" />
                </span>
              </div>
              <div className="mt-5 flex flex-col gap-2">
                <span className="block h-1.5 w-full rounded-full bg-sand" />
                <span className="block h-1.5 w-[86%] rounded-full bg-sand" />
                <span className="block h-1.5 w-[62%] rounded-full bg-sand" />
              </div>
              {/* La tarjeta de un archivo entregado: lo que la app acaba de aprender a abrir. */}
              <div className="mt-5 flex items-center gap-2.5 rounded-[11px] border border-line bg-sand px-3 py-2.5">
                <Paperclip size={14} className="shrink-0 text-monad" strokeWidth={2} />
                <span className="flex grow flex-col gap-1">
                  <span className="block h-1.5 w-20 rounded-full bg-line" />
                  <span className="block h-1 w-12 rounded-full bg-line/60" />
                </span>
                <Download size={13} className="shrink-0 text-honey" strokeWidth={2.2} />
              </div>
              <div className="mt-4 h-8 rounded-full bg-monad/25" />
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

/* ============================================================
 * S9 · Por qué Monad (claro, tabla)
 * ============================================================ */
function MonadSection() {
  const { t } = useTranslation();
  const rows = NETWORK_COMPARISON.slice(0, 3);
  return (
    <section className="border-t border-line bg-paper py-24 md:py-32">
      <div className="mx-auto max-w-4xl px-6">
        <SectionHeader
          align="center"
          eyebrow={t('home.monad.eyebrow')}
          title={
            <WordReveal>
              {t('home.monad.title')} <em className="serif-accent text-honey-deep">{t('home.monad.titleEm')}</em>
            </WordReveal>
          }
        />
        <div className="mt-12">
          {/* cabecera */}
          <div className="grid grid-cols-[1.2fr_1fr_1fr_0.8fr_1.3fr] gap-3 border-b border-line pb-3 text-[0.75rem] font-semibold uppercase tracking-[0.1em] text-ink-3 max-md:hidden">
            <span>{t('home.monad.colNetwork')}</span>
            <span>{t('home.monad.colFee')}</span>
            <span>{t('home.monad.colFinality')}</span>
            <span>TPS</span>
            <span>{t('home.monad.colMicrotask')}</span>
          </div>
          {rows.map((row, i) => (
            <motion.div
              key={row.network}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-10%' }}
              transition={{ duration: 0.6, delay: i * 0.1 }}
              className={cn(
                'relative grid grid-cols-[1.2fr_1fr_1fr_0.8fr_1.3fr] items-center gap-3 border-b border-line py-5 max-md:grid-cols-2 max-md:gap-y-2',
                row.highlight && 'border-honey bg-honey-soft px-4',
              )}
            >
              <span className="font-display font-semibold text-ink">{row.network}</span>
              <span className="font-mono text-[0.875rem] text-ink-2">{row.fee}</span>
              <span className="font-mono text-[0.875rem] text-ink-2">{row.finality}</span>
              <span className="font-mono text-[0.875rem] text-ink-2">{row.tps}</span>
              <span className="flex items-center gap-2 text-[0.875rem] font-medium">
                {row.microtask === 'si' && (
                  <>
                    <Check size={16} className="text-olive" strokeWidth={3} />
                    <span className="text-olive">{t(row.microtaskLabel)}</span>
                  </>
                )}
                {row.microtask === 'no' && (
                  <>
                    <X size={16} className="text-terra" strokeWidth={3} />
                    <span className="text-terra">{t(row.microtaskLabel)}</span>
                  </>
                )}
                {row.microtask === 'apenas' && <span className="text-ink-2">{t(row.microtaskLabel)}</span>}
              </span>
              {row.highlight && (
                <motion.span
                  initial={{ scaleX: 0 }}
                  whileInView={{ scaleX: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.7, delay: 0.3 }}
                  className="absolute inset-x-0 bottom-0 h-[2px] origin-left bg-honey"
                  aria-hidden
                />
              )}
            </motion.div>
          ))}
        </div>
        <Reveal className="mt-8">
          <p className="leading-[1.65] text-ink-2">
            {t('home.monad.text')}
          </p>
        </Reveal>
      </div>
    </section>
  );
}

/* ============================================================
 * S10 · Roadmap (línea de tiempo horizontal)
 * ============================================================ */
function RoadmapSection() {
  const { t } = useTranslation();
  const lineRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: lineRef, offset: ['start 85%', 'end 45%'] });
  const lineScale = useTransform(scrollYProgress, [0, 1], [0, 1]);

  return (
    <section className="border-t border-line bg-cream py-24 md:py-32">
      <div className="container-hive">
        <SectionHeader
          eyebrow={t('home.roadmap.eyebrow')}
          title={
            <WordReveal>
              {t('home.roadmap.title')} <em className="serif-accent text-honey-deep">{t('home.roadmap.titleEm')}</em>
            </WordReveal>
          }
          sub={t('home.roadmap.sub')}
        />
        <div ref={lineRef} className="relative mt-16 overflow-x-auto pb-2">
          <div className="min-w-[980px]">
            {/* línea del timeline */}
            <div className="relative h-px bg-line">
              <motion.div className="absolute inset-0 origin-left bg-honey" style={{ scaleX: lineScale }} />
            </div>
            <div className="mt-0 grid grid-cols-5 gap-5">
              {ROADMAP_PHASES.map((phase, i) => (
                <div key={phase.phase} className="relative pt-8">
                  {/* nodo hexagonal */}
                  <motion.span
                    initial={{ scale: 0 }}
                    whileInView={{ scale: 1 }}
                    viewport={{ once: true, margin: '-10%' }}
                    transition={{ type: 'spring', stiffness: 400, damping: 17, delay: i * 0.1 }}
                    className={cn(
                      'absolute -top-[9px] left-0 flex h-[18px] w-[18px] items-center justify-center',
                      phase.status === 'completada' && 'bg-olive',
                      phase.status === 'en-curso' && 'bg-honey',
                      phase.status === 'futura' && 'bg-sand',
                    )}
                    style={{ clipPath: 'polygon(50% 0%, 93.3% 25%, 93.3% 75%, 50% 100%, 6.7% 75%, 6.7% 25%)' }}
                  >
                    {phase.status === 'completada' && <Check size={10} strokeWidth={4} className="text-paper" />}
                  </motion.span>
                  <motion.div
                    initial={{ opacity: 0, y: 24 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: '-10%' }}
                    transition={{ duration: 0.7, delay: i * 0.1 }}
                  >
                    <p className="font-mono text-[12px] text-ink-3">{phase.quarter}</p>
                    <p className="mt-2 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-honey-deep">
                      {t(phase.phase)}
                      {phase.status === 'en-curso' && <LiveDot variant="honey" />}
                    </p>
                    <h3 className="display-m mt-1.5 text-ink">{t(phase.title)}</h3>
                    <p className="mt-2 text-[0.875rem] leading-[1.55] text-ink-2">{t(phase.text)}</p>
                  </motion.div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================
 * S11 · CTA final (imagen, oscuro)
 * ============================================================ */
function FinalCta() {
  const { t } = useTranslation();
  const sectionRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ['start end', 'end start'] });
  const bgY = useTransform(scrollYProgress, [0, 1], ['0%', '-10%']);

  return (
    <section ref={sectionRef} className="relative flex min-h-[80vh] items-center overflow-hidden bg-coal">
      <div className="glow-monad left-[-10%] top-[10%] z-[1] h-[60vh] w-[45vw]" aria-hidden />
      <motion.img
        src="/cta-honeycomb.webp"
        alt=""
        loading="lazy"
        decoding="async"
        style={{ y: bgY }}
        className="absolute inset-0 h-[112%] w-full object-cover"
      />
      <div className="absolute inset-0 bg-coal/65" />
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(ellipse at center, transparent 25%, rgba(22,19,16,0.75) 100%)' }}
      />
      <div className="container-hive relative z-10 flex flex-col items-center gap-7 py-32 text-center">
        <h2 className="display-xl text-coal-text">
          <WordReveal>
            {t('home.cta.title')} <em className="serif-accent text-honey">{t('home.cta.titleEm')}</em>
          </WordReveal>
        </h2>
        <p className="max-w-xl text-[1.125rem] leading-[1.65] text-coal-mute">
          {t('home.cta.sub')}
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-4">
          <Magnetic>
            <Link
              to="/mercado"
              className="inline-block rounded-full bg-honey px-7 py-3.5 text-[0.9375rem] font-semibold text-ink transition-colors hover:bg-honey-deep hover:text-paper"
            >
              {t('home.hero.ctaMarket')}
            </Link>
          </Magnetic>
          <Magnetic>
            <Link
              to="/protocolo"
              className="inline-block rounded-full border border-coal-text/30 px-7 py-3.5 text-[0.9375rem] font-medium text-coal-text transition-colors hover:border-honey hover:text-honey"
            >
              {t('home.cta.readProtocol')}
            </Link>
          </Magnetic>
        </div>
      </div>
    </section>
  );
}

/* ============================================================ */

export default function Home() {
  const { t, i18n } = useTranslation();
  useEffect(() => {
    document.title = t('home.metaTitle');
  }, [t, i18n.language]);

  return (
    <>
      <Hero />
      <StatsBand />
      <ProblemSection />
      <ProtocolSection />
      <LiveSection />
      <RankingSection />
      <SplitSection />
      <AndroidSection />
      <MonadSection />
      <RoadmapSection />
      <FinalCta />
    </>
  );
}
