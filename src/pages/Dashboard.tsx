/**
 * Panal — Dashboard (`/dashboard`), 100% datos on-chain.
 * Sin mocks: header con la wallet real, KPIs calculados de PanalEscrow +
 * PanalReputation, serie acumulada real de gasto (cliente) a partir de
 * createdAt de las tareas, agente propio real (PanalRegistry), tareas,
 * disputa, pagos y reputación reales. Sin wallet conectada muestra el
 * estado "conecta tu wallet". Conserva el flip de perspectiva.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Check, Copy, Plus, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { formatEther } from 'viem';
import HexAvatar from '@/components/HexAvatar';
import SectionHeader from '@/components/SectionHeader';
import StatBlock from '@/components/StatBlock';
import { useWallet } from '@/hooks/useWallet';
import { cn } from '@/lib/utils';
import WalletCard from '@/components/dashboard/WalletCard';
import TokenCard from '@/components/dashboard/TokenCard';
import PanalStatsCard from '@/components/dashboard/PanalStatsCard';
import PanalChart from '@/components/dashboard/PanalChart';
import RegisterAgentDialog from '@/components/dashboard/RegisterAgentDialog';
import OwnAgentCard from '@/components/dashboard/OwnAgentCard';
import TasksSection from '@/components/dashboard/TasksSection';
import DisputeCard from '@/components/dashboard/DisputeCard';
import PaymentsSection from '@/components/dashboard/PaymentsSection';
import AdminCard from '@/components/dashboard/AdminCard';
import ArbitrationCard from '@/components/dashboard/ArbitrationCard';
import ReputationSection from '@/components/dashboard/ReputationSection';
import { EarningsAreaChart, EmptyChart } from '@/components/dashboard/charts';
import type { EarningsPoint, Perspective } from '@/components/dashboard/data';
import { formatMonEs, formatRatingEs } from '@/components/dashboard/data';
import { TASK_STATUS, useMyTasks } from '@/hooks/useMyTasks';
import type { RealTask } from '@/hooks/useMyTasks';
import { avgRating, useMyAgentProfile } from '@/hooks/useMyAgentProfile';
import { NATIVE_CURRENCY, currencySymbol } from '@/contracts/config';

type RangeKey = '7' | '30' | '90';

/**
 * Suma los importes de unas tareas SEPARADOS POR MONEDA.
 *
 * Sumarlos en una sola cifra es lo que hacía antes el KPI de gasto: 100 $PANAL
 * más 0,01 MON le salían "100,01 MON". Son monedas distintas y sin tipo de
 * cambio, así que no hay una cifra honesta que las junte; se enseñan las dos.
 */
function sumaPorMoneda(tareas: RealTask[]): { symbol: string; amount: number }[] {
  const porMoneda = new Map<string, bigint>();
  for (const tk of tareas) {
    const s = currencySymbol(tk.currency);
    porMoneda.set(s, (porMoneda.get(s) ?? 0n) + tk.amountWei);
  }
  return [...porMoneda]
    .map(([symbol, wei]) => ({ symbol, amount: Number(formatEther(wei)) }))
    .filter((x) => x.amount > 0)
    // MON primero por ser la nativa; con una sola moneda da igual el orden.
    .sort((a, b) => (a.symbol === currencySymbol(NATIVE_CURRENCY) ? -1 : b.symbol === currencySymbol(NATIVE_CURRENCY) ? 1 : 0));
}

const RANGE_LABELS: { key: RangeKey; label: string }[] = [
  { key: '7', label: '7D' },
  { key: '30', label: '30D' },
  { key: '90', label: '90D' },
];

const RANGE_DAYS: Record<RangeKey, number> = { '7': 7, '30': 30, '90': 90 };

/* Flip al cambiar de perspectiva (dashboard.md S1 · Interacción clave) */
const flipContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
};
const flipItem = {
  hidden: { opacity: 0, rotateX: 8, y: 24 },
  show: {
    opacity: 1,
    rotateX: 0,
    y: 0,
    transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] },
  },
};

/** Serie REAL acumulada por día a partir de createdAt de las tareas (gasto del cliente). */
function buildCumulativeSeries(tasks: RealTask[], days: number): EarningsPoint[] {
  const DAY = 86_400;
  const now = Math.floor(Date.now() / 1000);
  const end = now - (now % DAY) + DAY; // final del día actual
  const start = end - days * DAY;
  const amounts = tasks.map((tk) => ({
    t: Number(tk.createdAt),
    mon: Number(formatEther(tk.amountWei)),
  }));
  const out: EarningsPoint[] = [];
  let acc = amounts.filter((a) => a.t < start).reduce((s, a) => s + a.mon, 0);
  for (let d = 0; d < days; d++) {
    const dayStart = start + d * DAY;
    const dayEnd = dayStart + DAY;
    const dayTasks = amounts.filter((a) => a.t >= dayStart && a.t < dayEnd);
    acc += dayTasks.reduce((s, a) => s + a.mon, 0);
    out.push({
      label: new Date(dayStart * 1000).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }),
      mon: Math.round(acc * 1e6) / 1e6,
      tareas: dayTasks.length,
    });
  }
  return out;
}

interface KpiCard {
  id: string;
  label: string;
  /** valor numérico (StatBlock con count-up) o texto crudo (p. ej. "—") */
  value?: number;
  rawText?: string;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  sub?: string;
}

export default function Dashboard() {
  const { t, i18n } = useTranslation();
  useEffect(() => {
    document.title = t('dash.metaTitle');
  }, [t, i18n.language]);

  const { address, addressShort, connected, connect } = useWallet();
  const [perspective, setPerspective] = useState<Perspective>('proveedor');
  const [range, setRange] = useState<RangeKey>('30');
  const [copied, setCopied] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);

  /* ---------- Datos reales on-chain ---------- */
  const { tasks, refetch: refetchTasks } = useMyTasks();
  const profile = useMyAgentProfile();

  const workerTasks = useMemo(() => tasks.filter((tk) => tk.role === 'worker'), [tasks]);
  const clientTasks = useMemo(() => tasks.filter((tk) => tk.role === 'client'), [tasks]);
  const disputedTasks = useMemo(
    () => tasks.filter((tk) => tk.status === TASK_STATUS.Disputed),
    [tasks],
  );
  const isLive = (tk: RealTask) =>
    tk.status === TASK_STATUS.Open || tk.status === TASK_STATUS.Delivered;

  const rep = profile.reputation;
  const rating = avgRating(rep);

  const copyAddress = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
    } catch {
      /* portapapeles no disponible */
    }
    setCopied(true);
    toast(t('detail.copied'), { icon: <Check size={14} className="text-olive" /> });
    window.setTimeout(() => setCopied(false), 1600);
  };

  /* ---------- KPIs reales (sin deltas inventados) ---------- */
  const kpis: KpiCard[] = useMemo(() => {
    // Moneda REAL del agente (v1 no la tenía: allí todo era MON).
    const monedaDelAgente = currencySymbol(profile.agent?.currency ?? NATIVE_CURRENCY);
    const monedasCobradas = sumaPorMoneda(
      workerTasks.filter((tk) => tk.status === TASK_STATUS.Completed),
    );
    if (perspective === 'proveedor') {
      return [
        {
          id: 'ingresos',
          label: t('dash.kpi.incomeTotal'),
          value: Number(formatEther(rep.totalEarned)),
          decimals: 2,
          // PanalReputation guarda `totalEarned` SIN moneda: recordCompletion
          // recibe solo (agent, rating, earned). La cifra sola no dice en qué
          // se cobró, y antes se etiquetaba "MON" a ciegas — un agente que
          // cobra en $PANAL veía sus ingresos anunciados en la moneda que no
          // era. La moneda la declara él en su registro, que es donde vive.
          ...(monedasCobradas.length > 1
            ? // Cambió de moneda con updatePrice en algún momento: la cifra
              // mezcla las dos y no hay etiqueta honesta. Se dice cuáles son.
              { sub: t('dash.kpi.incomeMixed', { list: monedasCobradas.map((m) => m.symbol).join(' + ') }) }
            : { suffix: monedaDelAgente }),
        },
        {
          id: 'activas',
          label: t('dash.kpi.activeTasks'),
          value: workerTasks.filter(isLive).length,
        },
        {
          id: 'rating',
          label: t('dash.kpi.avgRating'),
          ...(rating !== null
            ? { value: rating, decimals: 1, suffix: '★' }
            : { rawText: '—' }),
          sub: t('dash.kpi.reviewsCount', { count: Number(rep.ratingCount) }),
        },
        {
          id: 'completadas',
          label: t('dash.kpi.completed'),
          value: Number(rep.tasksCompleted),
        },
      ];
    }
    // Antes: clientTasks.reduce((s, tk) => s + tk.amountWei) con sufijo "MON"
    // fijo. Quien contrataba a un agente de $PANAL y a otro de MON veía las dos
    // cifras sumadas y anunciadas como MON. Ahora van separadas.
    const gastos = sumaPorMoneda(clientTasks);
    const [principal, ...resto] = gastos;
    return [
      {
        id: 'gastado',
        label: t('dash.kpi.spentTotal'),
        value: principal?.amount ?? 0,
        decimals: 2,
        suffix: principal?.symbol ?? currencySymbol(NATIVE_CURRENCY),
        // La segunda moneda no cabe en el número: va debajo, sin sumarse.
        sub: resto.length > 0 ? resto.map((r) => `+ ${formatMonEs(r.amount)} ${r.symbol}`).join(' · ') : undefined,
      },
      { id: 'pedidas', label: t('dash.kpi.requested'), value: clientTasks.length },
      {
        id: 'encurso',
        label: t('dash.kpi.inProgressNow'),
        value: clientTasks.filter(isLive).length,
      },
      {
        id: 'completadas',
        label: t('dash.kpi.completed'),
        value: clientTasks.filter((tk) => tk.status === TASK_STATUS.Completed).length,
      },
    ];
  }, [perspective, rep, rating, workerTasks, clientTasks, profile.agent?.currency, t]);

  /* ---------- Serie real de gasto (cliente) ---------- */
  const spendSeries = useMemo(
    () =>
      perspective === 'cliente' && clientTasks.length > 0
        ? buildCumulativeSeries(clientTasks, RANGE_DAYS[range])
        : null,
    [perspective, clientTasks, range],
  );

  const memberSince = profile.agent
    ? new Date(Number(profile.agent.registeredAt) * 1000).toLocaleDateString(i18n.language, {
        month: 'short',
        year: 'numeric',
      })
    : null;

  /* ---------- Estado sin wallet ---------- */
  if (!connected || !address) {
    return (
      <div className="bg-paper">
        <section className="container-hive relative pb-10 pt-28">
          <div className="glow-monad-soft right-[-12%] top-[-35%] h-[400px] w-[520px]" aria-hidden />
          <nav aria-label="Breadcrumb" className="font-mono text-[0.75rem] text-ink-3">
            <Link to="/" className="transition-colors hover:text-honey-deep">Panal</Link>
            <span className="mx-2">/</span>
            <span className="text-ink-2">Dashboard</span>
          </nav>
          <h1 className="display-l mt-6 text-ink">{t('dash.connectTitle')}</h1>
          <div className="mt-8 flex flex-col items-center gap-4 rounded-2xl border border-line bg-paper py-12 text-center shadow-card">
            <div className="flex h-14 w-14 items-center justify-center rounded-full border border-line bg-cream">
              <Wallet size={24} className="text-honey" aria-hidden />
            </div>
            <p className="max-w-sm text-[0.9375rem] leading-relaxed text-ink-2">
              {t('dash.connectDesc')}
            </p>
            <button type="button" onClick={connect} className="btn-monad px-6 py-3 text-[0.9375rem] font-semibold">
              {t('nav.connect')}
            </button>
          </div>
          <div className="mt-6">
            <WalletCard />
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="bg-paper">
      {/* ── S1 · Header del panel ─────────────────────────────────────────── */}
      <section className="container-hive relative pb-8 pt-28">
      <div className="glow-monad-soft right-[-12%] top-[-35%] h-[400px] w-[520px]" aria-hidden />
      <div className="glow-honey left-[30%] top-[-20%] h-[260px] w-[360px]" aria-hidden />
        <nav aria-label="Breadcrumb" className="font-mono text-[0.75rem] text-ink-3">
          <Link to="/" className="transition-colors hover:text-honey-deep">Panal</Link>
          <span className="mx-2">/</span>
          <span className="text-ink-2">Dashboard</span>
        </nav>

        <div className="mt-6 flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex items-start gap-5">
            <HexAvatar seed={address} size={56} className="mt-2 hidden sm:block" />
            <div>
              {/* H1 word-reveal */}
              <motion.h1
                className="display-l text-ink"
                initial="hidden"
                animate="show"
                variants={{ hidden: {}, show: { transition: { staggerChildren: 0.09 } } }}
              >
                {[t('dash.hello')].map((w) => (
                  <motion.span
                    key={w}
                    className="mr-3 inline-block"
                    variants={{ hidden: { opacity: 0, y: 18 }, show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: 'easeOut' } } }}
                  >
                    {w}
                  </motion.span>
                ))}
                <motion.span
                  className="serif-accent inline-flex items-center gap-2 text-honey-deep"
                  variants={{ hidden: { opacity: 0, y: 18 }, show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: 'easeOut' } } }}
                >
                  {addressShort}
                  <button
                    type="button"
                    onClick={copyAddress}
                    aria-label={t('dash.copyAddress')}
                    className="rounded-full p-1.5 text-ink-3 transition-colors hover:bg-honey-soft hover:text-honey-deep"
                  >
                    {copied ? <Check size={16} className="text-olive" /> : <Copy size={16} />}
                  </button>
                </motion.span>
              </motion.h1>
              {/* Miembro desde / reputación global: solo si la wallet es agente real */}
              {memberSince && (
                <p className="mt-3 text-[1.0625rem] text-ink-2">
                  {t('dash.memberSince', { date: memberSince })}
                  {rating !== null &&
                    ` · ${t('dash.memberRating', {
                      rating: formatRatingEs(rating),
                      count: Number(rep.ratingCount),
                    })}`}
                </p>
              )}
            </div>
          </div>

          {/* Toggle + acciones */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2, ease: 'easeOut' }}
            className="flex flex-col items-start gap-4 sm:flex-row sm:items-center"
          >
            {/* Toggle segmentado con layoutId animado */}
            <div className="relative flex rounded-full border border-line bg-cream p-1" role="tablist" aria-label={t('dash.perspectiveAria')}>
              {(['proveedor', 'cliente'] as Perspective[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  role="tab"
                  aria-selected={perspective === p}
                  onClick={() => setPerspective(p)}
                  className={cn(
                    'relative z-10 rounded-full px-4 py-2 text-[0.8125rem] font-semibold transition-colors',
                    perspective === p ? 'text-ink' : 'text-ink-3 hover:text-ink-2',
                  )}
                >
                  {perspective === p && (
                    <motion.span
                      layoutId="perspective-pill"
                      className="absolute inset-0 -z-10 rounded-full bg-paper shadow-sm"
                      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                    />
                  )}
                  {p === 'proveedor' ? t('dash.asProvider') : t('dash.asClient')}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setRegisterOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-honey px-4 py-2 text-[0.875rem] font-semibold text-[#1B1814] transition-colors hover:bg-honey-deep"
            >
              <Plus size={15} />
              {t('dash.registerAgent')}
            </button>
          </motion.div>
        </div>
      </section>

      {/* Contenido que intercambia la perspectiva (flip) */}
      <motion.div
        key={perspective}
        variants={flipContainer}
        initial="hidden"
        animate="show"
        style={{ perspective: 1200 }}
      >
        {/* ── S2 · KPIs + Wallet (cream) ─────────────────────────────────── */}
        <motion.section variants={flipItem} className="bg-cream">
          <div className="container-hive py-10 md:py-12">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {kpis.map((kpi) => (
                <div key={kpi.id} className="rounded-2xl border border-line bg-paper p-5 shadow-card">
                  {kpi.rawText !== undefined ? (
                    <div className="flex flex-col gap-2">
                      <span className="stat-number text-ink">{kpi.rawText}</span>
                      <span className="eyebrow text-ink-3">{kpi.label}</span>
                    </div>
                  ) : (
                    <StatBlock
                      value={kpi.value ?? 0}
                      decimals={kpi.decimals}
                      prefix={kpi.prefix}
                      suffix={kpi.suffix ? ` ${kpi.suffix}` : undefined}
                      label={kpi.label}
                    />
                  )}
                  {kpi.sub && (
                    <motion.p
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 0.6, duration: 0.3 }}
                      className="mt-3 text-[0.8125rem] text-ink-3"
                    >
                      {kpi.sub}
                    </motion.p>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-6 flex flex-col gap-4">
              <WalletCard />
              <TokenCard />
              <PanalStatsCard />
            </div>
          </div>
        </motion.section>

        {/* ── S3 · Gráficas (solo series computables de datos reales) ────── */}
        <motion.section variants={flipItem} className="container-hive py-14 md:py-20">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Gasto acumulado (cliente, real) / no computable (proveedor) */}
            <div className="rounded-2xl border border-line bg-paper p-6 shadow-card lg:col-span-8">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
                <h3 className="font-display text-[1.125rem] font-semibold tracking-[-0.015em] text-ink">
                  {perspective === 'proveedor' ? t('dash.earnings') : t('dash.spending')}
                </h3>
                {spendSeries && (
                  <div className="flex gap-1 rounded-full border border-line bg-cream p-0.5">
                    {RANGE_LABELS.map((r) => (
                      <button
                        key={r.key}
                        type="button"
                        onClick={() => setRange(r.key)}
                        className={cn(
                          'rounded-full px-3 py-1 font-mono text-[0.75rem] transition-colors',
                          range === r.key ? 'bg-paper text-ink shadow-sm' : 'text-ink-3 hover:text-ink-2',
                        )}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {perspective === 'proveedor' ? (
                <EmptyChart title={t('dash.chartEmpty')} text={t('dash.chartProviderEmpty')} />
              ) : spendSeries ? (
                <EarningsAreaChart data={spendSeries} rangeKey={`cliente-${range}`} />
              ) : (
                <EmptyChart title={t('dash.chartEmpty')} text={t('dash.chartClientEmpty')} />
              )}
            </div>

            {/* Donut por categoría: sin categorías on-chain → empty state honesto */}
            <div className="rounded-2xl border border-line bg-paper p-6 shadow-card lg:col-span-4">
              <h3 className="mb-5 font-display text-[1.125rem] font-semibold tracking-[-0.015em] text-ink">
                {t(perspective === 'proveedor' ? 'dash.donut.tasksByCategory' : 'dash.donut.spendByCategory')}
              </h3>
              <EmptyChart title={t('dash.chartEmpty')} text={t('dash.chartDonutEmpty')} />
            </div>

            {/* $PANAL movido en la red: mismo gráfico que el de MON, y al lado */}
            <PanalChart />

            {/* Reputación en el tiempo: sin historial de rating on-chain → empty state */}
            <div className="rounded-2xl border border-line bg-paper p-6 shadow-card lg:col-span-12">
              <div className="mb-4 flex items-baseline justify-between gap-4">
                <h3 className="font-display text-[1.125rem] font-semibold tracking-[-0.015em] text-ink">
                  {t('dash.reputationOverTime')}
                </h3>
              </div>
              <EmptyChart title={t('dash.chartEmpty')} text={t('dash.chartReputationEmpty')} />
            </div>
          </div>
        </motion.section>

        {/* ── S4 · Mi agente (solo perspectiva proveedor) ────────────────── */}
        {perspective === 'proveedor' && (
          <motion.section variants={flipItem} className="container-hive pb-14 md:pb-20">
            <SectionHeader
              eyebrow={t('dash.yourAgents')}
              title={
                <>
                  {t('dash.myAgentsTitle')} <em className="serif-accent text-honey-deep">{t('dash.myAgentsEm')}</em>
                </>
              }
              sub={t('dash.myAgentsSub')}
              className="mb-8"
            />
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <OwnAgentCard onRegister={() => setRegisterOpen(true)} />
            </div>
          </motion.section>
        )}

        {/* ── S5 · Tareas reales ─────────────────────────────────────────── */}
        <motion.section variants={flipItem} className="container-hive pb-14 md:pb-20">
          <SectionHeader
            eyebrow={t('dash.escrowRunning')}
            title={
              <>
                {t('dash.tasksTitle')} <em className="serif-accent text-honey-deep">{t('dash.tasksEm')}</em>
              </>
            }
            sub={t('dash.tasksSubReal')}
            className="mb-8"
          />
          <TasksSection perspective={perspective} />
        </motion.section>
      </motion.div>

      {/* ── S6 · Disputa en curso (solo si hay alguna real) ─────────────── */}
      {disputedTasks.length > 0 && (
        <section className="container-hive pb-14 md:pb-20">
          <SectionHeader
            eyebrow={t('dash.arbitration')}
            title={
              <>
                {t('dash.disputeTitle')} <em className="serif-accent text-honey-deep">{t('dash.disputeEm')}</em>
              </>
            }
            className="mb-8"
          />
          <DisputeCard tasks={disputedTasks} onResolved={refetchTasks} />
        </section>
      )}

      {/* ── S6b · Administración del protocolo (solo owner/arbitrator) ──── */}
      <section className="container-hive pb-14">
        <ArbitrationCard />

        <AdminCard />
      </section>

      {/* ── S7 · Pagos reales ───────────────────────────────────────────── */}
      <section className="container-hive pb-14 md:pb-20">
        <SectionHeader
          eyebrow={t('dash.movements')}
          title={
            <>
              {t('dash.paymentsTitle')} <em className="serif-accent text-honey-deep">{t('dash.paymentsEm')}</em>
            </>
          }
          sub={t('dash.paymentsSub')}
          className="mb-8"
        />
        <PaymentsSection />
      </section>

      {/* ── S8 · Reputación real (cream, cierre) ────────────────────────── */}
      <section className="relative overflow-hidden bg-cream">
        <div className="bg-honeycomb pointer-events-none absolute inset-0 opacity-[0.08]" aria-hidden />
        <div className="container-hive relative py-16 md:py-24">
          <SectionHeader
            eyebrow={t('dash.reputationEyebrow')}
            title={
              <>
                {t('dash.reputationTitle')} <em className="serif-accent text-honey-deep">{t('dash.reputationEm')}</em>
              </>
            }
            className="mb-10"
          />
          <ReputationSection />
        </div>
      </section>

      {/* Alta on-chain en PanalRegistry */}
      <RegisterAgentDialog open={registerOpen} onOpenChange={setRegisterOpen} />
    </div>
  );
}
