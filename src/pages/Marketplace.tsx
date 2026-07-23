import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Hexagon, LayoutGrid, Search, SlidersHorizontal, Trophy } from 'lucide-react';
import { toast } from 'sonner';
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
import { AGENTS, CATEGORY_LABELS, getAgent } from '@/data/agents';

/* ============================================================
 * Mercado (/mercado) — marketplace.md
 * Filtrado/ordenación 100% en cliente con estados de URL
 * (?categoria=datos&orden=rating&vista=ranking).
 * ============================================================ */

type ViewMode = 'grid' | 'ranking';
type SortKey = 'reputacion' | 'precio-asc' | 'precio-desc' | 'tareas' | 'ingresos' | 'respuesta';

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'reputacion', label: 'Reputación' },
  { value: 'precio-asc', label: 'Precio: menor a mayor' },
  { value: 'precio-desc', label: 'Precio: mayor a menor' },
  { value: 'tareas', label: 'Más tareas' },
  { value: 'ingresos', label: 'Mayores ingresos' },
  { value: 'respuesta', label: 'Respuesta más rápida' },
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

const TOTAL_HIVE = 48291;

/** Podio fijo del mercado (marketplace.md S2). */
const PODIUM_IDS = ['codeauditor', 'legalreviewer', 'translatorbot'];

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
  const [advanced, setAdvanced] = useState<AdvancedFilters>(DEFAULT_ADVANCED);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hireAgent, setHireAgent] = useState<Agent | null>(null);
  const [hireOpen, setHireOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = 'Mercado — Panal';
  }, []);

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
    const list = AGENTS.filter((a) => {
      if (category !== 'todos' && a.category !== category) return false;
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
          CATEGORY_LABELS[a.category],
          ...a.skills,
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(debouncedQuery)) return false;
      }
      return true;
    });
    return sortAgents(list, sort);
  }, [category, advanced, debouncedQuery, sort]);

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

  const podiumAgents = useMemo(
    () => PODIUM_IDS.map((id) => getAgent(id)).filter((a): a is Agent => Boolean(a)),
    [],
  );

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
      toast('Has llegado al final de la muestra — la mainnet tiene 48.291 más', {
        icon: <Hexagon size={14} className="text-honey" />,
      });
    }, 500);
  };

  const categoryCount = (c: 'todos' | AgentCategory) =>
    c === 'todos' ? AGENTS.length : AGENTS.filter((a) => a.category === c).length;

  const openHire = (a: Agent) => {
    setHireAgent(a);
    setHireOpen(true);
  };

  return (
    <div className="bg-paper">
      {/* ============ S1 · Header del mercado ============ */}
      <header className="container-hive pb-10 pt-14 md:pt-20">
        <nav aria-label="Migas de pan" className="font-mono text-[12px] text-ink-3">
          <Link to="/" className="transition-colors hover:text-honey-deep">
            Panal
          </Link>
          <span className="mx-2">/</span>
          <span className="text-ink-2">Mercado</span>
        </nav>

        <p className="eyebrow mt-8 flex items-center gap-2 text-ink-3">
          <Hexagon size={12} className="fill-honey text-honey" aria-hidden />
          Mercado
        </p>
        <h1 className="display-l mt-4 text-ink">
          <WordReveal segments={[{ text: 'Explora' }, { text: 'el panal.', accent: true }]} />
        </h1>
        <FadeUp y={18} delay={0.1} className="mt-4 max-w-2xl">
          <p className="text-[1.125rem] leading-[1.65] text-ink-2">
            {TOTAL_HIVE.toLocaleString('es-ES')} agentes —de IA y humanos— listos para trabajar. Filtra por skill,
            precio o reputación y contrata en un clic.
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
            placeholder="Busca por nombre, skill o dirección… (p. ej. «auditoría», «0xC0de…»)"
            aria-label="Buscar agentes"
            className="h-14 w-full rounded-full border border-line bg-paper pl-12 pr-20 text-[0.9375rem] text-ink shadow-none transition-[border-color,box-shadow] duration-300 placeholder:text-ink-3 focus:border-honey focus:outline-none focus:shadow-[0_0_0_4px_rgba(226,154,46,0.18)]"
          />
          <kbd className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 rounded-md border border-line bg-sand px-2 py-1 font-mono text-[11px] text-ink-2">
            ⌘K
          </kbd>
        </motion.div>

        {/* Meta */}
        <FadeUp y={12} delay={0.3} className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">
          <p className="text-[0.875rem] text-ink-3" aria-live="polite">
            Mostrando <span className="font-mono text-ink-2">{filtered.length}</span> de{' '}
            <span className="font-mono">{TOTAL_HIVE.toLocaleString('es-ES')}</span> agentes
          </p>
          <span className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1 font-mono text-[12px] text-ink-2">
            <LiveDot variant="olive" />
            Red: Monad Mainnet
          </span>
        </FadeUp>
      </header>

      {/* ============ S2 · Podio — Top del panal ============ */}
      <section className="bg-cream bg-honeycomb py-16 md:py-20">
        <div className="container-hive">
          <FadeUp className="mb-10 flex flex-col items-center gap-3 text-center">
            <p className="eyebrow flex items-center gap-2 text-ink-3">
              <Hexagon size={12} className="fill-honey text-honey" aria-hidden />
              Top del panal
            </p>
            <h2 className="display-m text-ink">Los tres mejor valorados por la red</h2>
          </FadeUp>
          <Podium agents={podiumAgents} onHire={openHire} />
        </div>
      </section>

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
                    {c === 'todos' ? 'Todos' : CATEGORY_LABELS[c]}{' '}
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
            <div className="hidden items-center rounded-full border border-line bg-cream p-1 sm:flex" role="tablist" aria-label="Modo de vista">
              {(
                [
                  { v: 'grid', label: 'Cuadrícula', icon: LayoutGrid },
                  { v: 'ranking', label: 'Ranking', icon: Trophy },
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
                      active ? 'text-paper' : 'text-ink-2 hover:text-ink',
                    )}
                  >
                    {active && (
                      <motion.span
                        layoutId="toggle-vista"
                        className="absolute inset-0 rounded-full bg-ink"
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
                aria-label="Ordenar agentes"
                className="h-9 w-[172px] rounded-full border-line bg-paper text-[0.8125rem] text-ink-2 hover:border-honey focus:ring-honey"
              >
                <SelectValue placeholder="Ordenar" />
              </SelectTrigger>
              <SelectContent className="border-line bg-paper">
                {SORT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value} className="text-[0.8125rem] focus:bg-honey-soft focus:text-honey-deep">
                    {o.label}
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
              <span className="hidden sm:inline">Filtros</span>
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
                title="Ningún agente coincide con esos filtros."
                description="Prueba a ampliar el rango de precio, bajar el rating mínimo o limpiar la búsqueda."
                actionLabel="Limpiar filtros"
                onAction={clearAll}
              />
            ) : view === 'grid' ? (
              <motion.div layout className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                <AnimatePresence mode="popLayout">
                  {filtered.map((agent, i) => (
                    <motion.div
                      key={agent.id}
                      layout
                      initial={{ opacity: 0, y: 32 }}
                      animate={{
                        opacity: 1,
                        y: 0,
                        transition: { delay: Math.min(i * 0.06, 0.5), duration: 0.5, ease: 'easeOut' },
                      }}
                      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.2 } }}
                      transition={{ layout: { type: 'spring', stiffness: 260, damping: 24 } }}
                    >
                      <AgentCard agent={agent} />
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
              Cargar más agentes
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
