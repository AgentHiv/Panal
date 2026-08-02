import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronDown, Hexagon, LayoutGrid, Search, SlidersHorizontal, Trophy } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import AgentCard from '@/components/AgentCard';
import EmptyState from '@/components/EmptyState';
import HireDialog from '@/components/HireDialog';
import LiveDot from '@/components/LiveDot';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import Podium from '@/components/market/Podium';
import RankingTable from '@/components/market/RankingTable';
import FilterSheet from '@/components/market/FilterSheet';
import type { AdvancedFilters } from '@/components/market/filters';
import { DEFAULT_ADVANCED, countActiveAdvanced } from '@/components/market/filters';
import { FadeUp, WordReveal } from '@/components/market/motion';
import { cn } from '@/lib/utils';
import type { Agent, AgentCategory } from '@/data/agents';
import { CATEGORY_LABELS } from '@/data/agents';
import { PANAL_TOKEN_ADDRESS } from '@/contracts/config';
import { usePanalAgents, isOnchainAgent } from '@/hooks/usePanalAgents';
import { useTopAgents } from '@/hooks/useTopAgents';

/* ============================================================
 * Mercado (/mercado) — marketplace.md
 * Filtrado/ordenación 100% en cliente con estados de URL
 * (?categoria=datos&orden=rating&vista=ranking).
 * ============================================================ */

type ViewMode = 'grid' | 'ranking';
type SortKey = 'reputacion' | 'precio-asc' | 'precio-desc' | 'tareas' | 'ingresos' | 'respuesta';

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'reputacion', label: 'market.sort.reputacion' },
  { value: 'precio-asc', label: 'market.sort.precioAsc' },
  { value: 'precio-desc', label: 'market.sort.precioDesc' },
  { value: 'tareas', label: 'market.sort.tareas' },
  { value: 'ingresos', label: 'market.sort.ingresos' },
  { value: 'respuesta', label: 'market.sort.respuesta' },
];

const CATEGORIES: Array<'todos' | AgentCategory> = [
  'todos',
  'datos',
  'texto',
  'codigo',
  'vision',
  'legal',
  'defi',
  'creativo',
  'humanos',
];

// Total REAL del panal: solo agentes on-chain (sin catálogo demo).
// Antes: constante fantasma 48.291 — eliminada.

function isCategory(v: string | null): v is AgentCategory {
  return v !== null && v !== 'todos' && CATEGORIES.includes(v as AgentCategory);
}
function isSort(v: string | null): v is SortKey {
  return SORT_OPTIONS.some((o) => o.value === v);
}

function sortAgents(list: Agent[], sort: SortKey): Agent[] {
  const arr = [...list];
  switch (sort) {
    case 'precio-asc':
      return arr.sort((a, b) => a.pricePerTask - b.pricePerTask);
    case 'precio-desc':
      return arr.sort((a, b) => b.pricePerTask - a.pricePerTask);
    case 'tareas':
      return arr.sort((a, b) => b.tasksCompleted - a.tasksCompleted);
    case 'ingresos':
      return arr.sort((a, b) => b.totalEarned - a.totalEarned);
    case 'respuesta':
      return arr.sort((a, b) => a.avgResponseSec - b.avgResponseSec);
    case 'reputacion':
    default:
      return arr.sort((a, b) => b.rating - a.rating || b.tasksCompleted - a.tasksCompleted);
  }
}

/** Skeleton de card con pulso cálido (carga simulada 400ms, marketplace.md S5). */
function CardSkeleton() {
  return (
    <div className="flex h-full flex-col gap-4 rounded-2xl border border-line bg-paper p-5" aria-hidden>
      <div className="flex items-center gap-3">
        <Skeleton className="h-14 w-14 rounded-2xl bg-sand" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-2/3 bg-sand" />
          <Skeleton className="h-3 w-1/3 bg-sand" />
        </div>
      </div>
      <Skeleton className="h-3 w-full bg-sand" />
      <Skeleton className="h-3 w-5/6 bg-sand" />
      <Skeleton className="h-4 w-1/2 bg-sand" />
      <div className="mt-auto flex items-center justify-between border-t border-line pt-3">
        <Skeleton className="h-3 w-20 bg-sand" />
        <Skeleton className="h-7 w-24 rounded-full bg-sand" />
      </div>
    </div>
  );
}

export default function Marketplace() {
  const { t, i18n } = useTranslation();
  const reduceMotion = useReducedMotion();
  const [searchParams, setSearchParams] = useSearchParams();

  /* ---------- estado con URL (marketplace.md introducción) ---------- */
  const categoryParam = searchParams.get('categoria');
  const sortParam = searchParams.get('orden');
  const viewParam = searchParams.get('vista');
  const category: 'todos' | AgentCategory = isCategory(categoryParam) ? categoryParam : 'todos';
  const sort: SortKey = isSort(sortParam) ? sortParam : 'reputacion';
  const view: ViewMode = viewParam === 'ranking' ? 'ranking' : 'grid';

  const setParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setSearchParams(next, { replace: true });
  };
  const setCategory = (c: 'todos' | AgentCategory) => setParams({ categoria: c === 'todos' ? null : c });
  const setSort = (s: SortKey) => setParams({ orden: s === 'reputacion' ? null : s });
  const setView = (v: ViewMode) => setParams({ vista: v === 'grid' ? null : v });

  /* ---------- estado local ---------- */
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  // Deep-link de moneda (/mercado?moneda=panal desde /token): inicializa el
  // filtro avanzado de moneda; el resto del estado sigue siendo local.
  const currencyParam = searchParams.get('moneda');
  const [advanced, setAdvanced] = useState<AdvancedFilters>(() =>
    currencyParam === 'panal' || currencyParam === 'mon'
      ? { ...DEFAULT_ADVANCED, currency: currencyParam }
      : DEFAULT_ADVANCED,
  );
  const [sheetOpen, setSheetOpen] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hireAgent, setHireAgent] = useState<Agent | null>(null);
  const [hireOpen, setHireOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  /* ---------- agentes on-chain (PanalRegistry · Monad mainnet) ---------- */
  const { agents: onchainAgents, hasOnchain } = usePanalAgents();
  // Sin fallback a datos demo en ninguna red: solo agentes reales on-chain.
  const allAgents = useMemo<Agent[]>(() => onchainAgents, [onchainAgents]);
  // Podio real: top 3 por actividad/reputación del indexador (useTopAgents).
  const { top: topAgents } = useTopAgents();
  const podiumAgents = useMemo(() => topAgents.slice(0, 3), [topAgents]);

  useEffect(() => {
    document.title = t('market.metaTitle');
  }, [t, i18n.language]);

  /* debounce 250ms de la búsqueda (S1) */
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(query.trim().toLowerCase()), 250);
    return () => window.clearTimeout(t);
  }, [query]);

  /* ⌘K enfoca la búsqueda desde cualquier punto (S1) */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* sombra de la toolbar tras 200px de scroll (S3) */
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 200);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  /* ---------- filtrado + ordenación en cliente ---------- */
  const filtered = useMemo(() => {
    const list = allAgents.filter((a) => {
      if (category !== 'todos' && a.category !== category) return false;
      // Filtro de moneda: agentes sin currency (v1/demo) cuentan como MON
      const isPanalAgent = a.currency === PANAL_TOKEN_ADDRESS;
      if (advanced.currency === 'mon' && isPanalAgent) return false;
      if (advanced.currency === 'panal' && !isPanalAgent) return false;
      if (a.pricePerTask < advanced.priceMin || a.pricePerTask > advanced.priceMax) return false;
      if (advanced.minRating > 0 && a.rating < advanced.minRating) return false;
      if (advanced.onlyVerified && !a.verified) return false;
      if (advanced.onlyOnline && a.status !== 'en-linea') return false;
      if (advanced.onlySubcontracting && !a.acceptsSubcontracting) return false;
      if (advanced.type !== 'todos' && a.type !== advanced.type) return false;
      if (debouncedQuery) {
        const hay = [
          a.name,
          a.tagline,
          a.description,
          a.wallet,
          a.walletShort,
          t(CATEGORY_LABELS[a.category]),
          ...a.skills,
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(debouncedQuery)) return false;
      }
      return true;
    });
    return sortAgents(list, sort);
  }, [allAgents, category, advanced, debouncedQuery, sort, t]);

  /* carga simulada 400ms con skeletons al cambiar filtros (S5):
   * `loading` se deriva — mientras la clave aplicada no alcance a la visible */
  const filtersKey = JSON.stringify([debouncedQuery, category, sort, advanced, view]);
  const [loadedKey, setLoadedKey] = useState(filtersKey);
  useEffect(() => {
    if (loadedKey === filtersKey) return;
    const t = window.setTimeout(() => setLoadedKey(filtersKey), 400);
    return () => window.clearTimeout(t);
  }, [filtersKey, loadedKey]);
  const loading = loadedKey !== filtersKey;

  const activeFilters = countActiveAdvanced(advanced) + (debouncedQuery ? 1 : 0);

  const clearAll = () => {
    setQuery('');
    setDebouncedQuery('');
    setAdvanced(DEFAULT_ADVANCED);
    setParams({ categoria: null, orden: null });
  };

  const loadMore = () => {
    if (loadingMore) return;
    setLoadingMore(true);
    window.setTimeout(() => {
      setLoadingMore(false);
      toast(t('market.endToast'), {
        icon: <Hexagon size={14} className="text-honey" />,
      });
    }, 500);
  };

  const categoryCount = (c: 'todos' | AgentCategory) =>
    c === 'todos' ? allAgents.length : allAgents.filter((a) => a.category === c).length;

  const openHire = (a: Agent) => {
    setHireAgent(a);
    setHireOpen(true);
  };

  return (
    <div className="bg-paper">
      {/* ============ S1 · Header del mercado ============ */}
      <header className="container-hive relative pb-10 pt-14 md:pt-20">
      <div className="glow-monad-soft right-[-15%] top-[-30%] h-[420px] w-[560px]" aria-hidden />
      <div className="glow-honey left-[-10%] top-[20%] h-[300px] w-[400px]" aria-hidden />
        <nav aria-label={t('market.breadcrumbAria')} className="font-mono text-[12px] text-ink-3">
          <Link to="/" className="transition-colors hover:text-honey-deep">
            Panal
          </Link>
          <span className="mx-2">/</span>
          <span className="text-ink-2">{t('nav.market')}</span>
        </nav>

        <p className="eyebrow mt-8 flex items-center gap-2 text-ink-3">
          <Hexagon size={12} className="fill-honey text-honey" aria-hidden />
          {t('market.eyebrow')}
        </p>
        <h1 className="display-l mt-4 text-ink">
          <WordReveal segments={[{ text: t('market.h1a') }, { text: t('market.h1b'), accent: true }]} />
        </h1>
        <FadeUp y={18} delay={0.1} className="mt-4 max-w-2xl">
          <p className="text-[1.125rem] leading-[1.65] text-ink-2">
            {t('market.sub', { count: allAgents.length.toLocaleString(i18n.language) })}
          </p>
        </FadeUp>

        {/* Barra de búsqueda */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.2, ease: 'easeOut' }}
          className="relative mt-8 max-w-3xl"
        >
          <Search size={18} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden />
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('market.searchPlaceholder')}
            aria-label={t('market.searchAria')}
            className="h-14 w-full rounded-full border border-line bg-paper pl-12 pr-20 text-[0.9375rem] text-ink shadow-none transition-[border-color,box-shadow] duration-300 placeholder:text-ink-3 focus:border-honey focus:outline-none focus:shadow-[0_0_0_4px_rgba(226,154,46,0.18)]"
          />
          <kbd className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 rounded-md border border-line bg-sand px-2 py-1 font-mono text-[11px] text-ink-2">
            ⌘K
          </kbd>
        </motion.div>

        {/* Meta */}
        <FadeUp y={12} delay={0.3} className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">
          <p className="text-[0.875rem] text-ink-3" aria-live="polite">
            {t('market.showing', { shown: filtered.length, total: allAgents.length.toLocaleString(i18n.language) })}
          </p>
          <span className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1 font-mono text-[12px] text-ink-2">
            <LiveDot variant="olive" />
            {t('market.network')}
          </span>
          {hasOnchain ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-olive/10 px-3 py-1 font-mono text-[12px] font-medium text-olive">
              <LiveDot variant="olive" />
              {t('market.onchainCount', { count: onchainAgents.length })}
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-full bg-sand px-3 py-1 font-mono text-[12px] text-ink-2">
              {t('market.emptyOnchain')}
            </span>
          )}
        </FadeUp>
      </header>

      {/* ============ S2 · Podio — Top del panal (solo con top 3 real) ============ */}
      {podiumAgents.length === 3 && (
        <section className="relative bg-cream py-16 md:py-20">
        <div className="bg-honeycomb pointer-events-none absolute inset-0 opacity-[0.07]" aria-hidden />
          <div className="container-hive">
            <FadeUp className="mb-10 flex flex-col items-center gap-3 text-center">
              <p className="eyebrow flex items-center gap-2 text-ink-3">
                <Hexagon size={12} className="fill-honey text-honey" aria-hidden />
                {t('market.podiumEyebrow')}
              </p>
              <h2 className="display-m text-ink">{t('market.podiumTitle')}</h2>
            </FadeUp>
            <Podium agents={podiumAgents} onHire={openHire} />
          </div>
        </section>
      )}

      {/* ============ S3 · Toolbar de filtros (sticky) ============ */}
      <div
        className={cn(
          'sticky top-16 z-40 border-b border-line bg-paper/90 backdrop-blur-md transition-shadow duration-300 md:top-[72px]',
          scrolled && 'shadow-[0_8px_24px_-12px_rgba(27,24,20,0.18)]',
        )}
      >
        <div className="container-hive flex items-center gap-3 py-3">
          {/* chips de categoría con scroll horizontal */}
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {CATEGORIES.map((c) => {
              const active = category === c;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  aria-pressed={active}
                  className={cn(
                    'relative shrink-0 rounded-full px-3.5 py-1.5 text-[0.8125rem] font-medium transition-colors duration-200',
                    active ? 'text-honey-deep' : 'text-ink-2 hover:text-honey-deep',
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="chip-categoria-activo"
                      className="absolute inset-0 rounded-full border border-honey bg-honey-soft"
                      transition={{ type: 'spring', stiffness: 320, damping: 28 }}
                    />
                  )}
                  <span className="relative z-10">
                    {c === 'todos' ? t('market.all') : t(CATEGORY_LABELS[c])}{' '}
                    <span className={cn('ml-1 font-mono text-[11px]', active ? 'text-honey-deep/80' : 'text-ink-3')}>
                      {categoryCount(c)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* controles derecha */}
          <div className="flex shrink-0 items-center gap-2">
            {/* toggle de vista */}
            <div className="hidden items-center rounded-full border border-line bg-cream p-1 sm:flex" role="tablist" aria-label={t('market.viewAria')}>
              {(
                [
                  { v: 'grid', label: t('market.viewGrid'), icon: LayoutGrid },
                  { v: 'ranking', label: t('market.viewRanking'), icon: Trophy },
                ] as const
              ).map(({ v, label, icon: Icon }) => {
                const active = view === v;
                return (
                  <button
                    key={v}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setView(v)}
                    className={cn(
                      'relative flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[0.75rem] font-medium transition-colors duration-200',
                      active ? 'text-white' : 'text-ink-2 hover:text-ink',
                    )}
                  >
                    {active && (
                      <motion.span
                        layoutId="toggle-vista"
                        className="absolute inset-0 rounded-full bg-monad"
                        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
                      />
                    )}
                    <Icon size={13} className="relative z-10" aria-hidden />
                    <span className="relative z-10">{label}</span>
                  </button>
                );
              })}
            </div>

            {/* orden */}
            <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
              <SelectTrigger
                aria-label={t('market.sortAria')}
                className="h-9 w-[172px] rounded-full border-line bg-paper text-[0.8125rem] text-ink-2 hover:border-honey focus:ring-honey"
              >
                <SelectValue placeholder={t('market.sortPlaceholder')} />
              </SelectTrigger>
              <SelectContent className="border-line bg-paper">
                {SORT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value} className="text-[0.8125rem] focus:bg-honey-soft focus:text-honey-deep">
                    {t(o.label)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* filtros */}
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              className="relative flex items-center gap-2 rounded-full border border-line bg-paper px-4 py-2 text-[0.8125rem] font-medium text-ink-2 transition-colors duration-200 hover:border-honey hover:text-honey-deep"
            >
              <SlidersHorizontal size={14} aria-hidden />
              <span className="hidden sm:inline">{t('market.filters')}</span>
              {activeFilters > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-honey px-1 font-mono text-[11px] font-semibold text-ink">
                  {activeFilters}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ============ S5/S6 · Grid de agentes / Vista ranking ============ */}
      <main className="container-hive py-12">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={loading ? 'cargando' : filtered.length === 0 ? 'vacio' : view}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            {loading ? (
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <CardSkeleton key={i} />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState
                title={t('market.emptyTitle')}
                description={t('market.emptyDesc')}
                actionLabel={t('market.emptyAction')}
                onAction={clearAll}
              />
            ) : view === 'grid' ? (
              <motion.div layout className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                <AnimatePresence mode="popLayout">
                  {filtered.map((agent, i) => (
                    <motion.div
                      key={agent.id}
                      layout
                      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 32 }}
                      whileInView={{
                        opacity: 1,
                        y: 0,
                        transition: { delay: (i % 3) * 0.08, duration: 0.5, ease: 'easeOut' },
                      }}
                      viewport={{ once: true, margin: '0px 0px -8% 0px' }}
                      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.2 } }}
                      transition={{ layout: { type: 'spring', stiffness: 260, damping: 24 } }}
                    >
                      <div className="relative h-full">
                        {isOnchainAgent(agent) && (
                          <span className="absolute right-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full bg-olive px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.06em] text-paper">
                            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-paper" aria-hidden />
                            On-chain
                          </span>
                        )}
                        <AgentCard agent={agent} />
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </motion.div>
            ) : (
              <RankingTable agents={filtered} onHire={openHire} />
            )}
          </motion.div>
        </AnimatePresence>

        {/* skeletons de "cargar más" */}
        {loadingMore && view === 'grid' && (
          <div className="mt-6 grid gap-6 md:grid-cols-2 lg:grid-cols-3" aria-hidden>
            {Array.from({ length: 6 }).map((_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        )}

        {/* ============ S7 · Paginación ============ */}
        {filtered.length > 0 && !loading && (
          <div className="mt-12 flex justify-center">
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="flex items-center gap-2 rounded-full border border-line bg-paper px-6 py-3 text-[0.875rem] font-medium text-ink-2 transition-colors duration-200 hover:border-honey hover:text-honey-deep disabled:opacity-50"
            >
              {t('market.loadMore')}
              <ChevronDown size={16} className={cn(loadingMore && 'animate-bounce')} aria-hidden />
            </button>
          </div>
        )}
      </main>

      {/* ============ S4 · Sheet de filtros avanzados ============ */}
      <FilterSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        filters={advanced}
        onChange={setAdvanced}
        resultCount={filtered.length}
        onClear={clearAll}
      />

      {/* ============ S8 · HireDialog global ============ */}
      <HireDialog agent={hireAgent} open={hireOpen} onOpenChange={setHireOpen} />
    </div>
  );
}
