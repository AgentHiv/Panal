/**
 * AgentHive — Dashboard (`/dashboard`, dashboard.md).
 * Panel del usuario con doble perspectiva (Como proveedor / Como cliente):
 * header con toggle segmentado, KPIs + wallet, gráficas recharts, mis agentes,
 * tareas activas con estados vivos, disputa en curso, historial de pagos y
 * reputación con insignias. Al cambiar el toggle las tarjetas hacen flip
 * (rotateX 8°→0, opacity, .35s, stagger .05) y los datos se intercambian.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowDownToLine, Check, Copy, Plus, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import AgentCard from '@/components/AgentCard';
import HexAvatar from '@/components/HexAvatar';
import SectionHeader from '@/components/SectionHeader';
import StatBlock from '@/components/StatBlock';
import { useWallet } from '@/hooks/useWallet';
import { cn } from '@/lib/utils';
import { WALLET_USER, WALLET_USER_SHORT } from '@/data/agents';
import WalletCard from '@/components/dashboard/WalletCard';
import OwnAgentCard from '@/components/dashboard/OwnAgentCard';
import TasksSection from '@/components/dashboard/TasksSection';
import DisputeCard from '@/components/dashboard/DisputeCard';
import PaymentsSection from '@/components/dashboard/PaymentsSection';
import ReputationSection from '@/components/dashboard/ReputationSection';
import { CategoryDonut, EarningsAreaChart, ReputationLineChart } from '@/components/dashboard/charts';
import type { Perspective } from '@/components/dashboard/data';
import {
  CATEGORY_SPLIT,
  EARNINGS,
  FAVORITE_AGENTS,
  KPIS,
  OWN_AGENTS,
  REPUTATION_TIMELINE,
} from '@/components/dashboard/data';

type RangeKey = '7' | '30' | '90';

const RANGE_LABELS: { key: RangeKey; label: string }[] = [
  { key: '7', label: '7D' },
  { key: '30', label: '30D' },
  { key: '90', label: '90D' },
];

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

export default function Dashboard() {
  useEffect(() => {
    document.title = 'AgentHive — Dashboard: tu panel de la colmena';
  }, []);

  const { addressShort } = useWallet();
  const addrShort = addressShort ?? WALLET_USER_SHORT;
  const [perspective, setPerspective] = useState<Perspective>('proveedor');
  const [range, setRange] = useState<RangeKey>('30');
  const [copied, setCopied] = useState(false);

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(WALLET_USER);
    } catch {
      /* portapapeles no disponible */
    }
    setCopied(true);
    toast('Dirección copiada', { icon: <Check size={14} className="text-olive" /> });
    window.setTimeout(() => setCopied(false), 1600);
  };

  const earnings = EARNINGS[perspective][range];
  const donut = CATEGORY_SPLIT[perspective];

  return (
    <div className="bg-paper">
      {/* ── S1 · Header del panel ─────────────────────────────────────────── */}
      <section className="container-hive pb-8 pt-28">
        <nav aria-label="Breadcrumb" className="font-mono text-[0.75rem] text-ink-3">
          <Link to="/" className="transition-colors hover:text-honey-deep">Colmena</Link>
          <span className="mx-2">/</span>
          <span className="text-ink-2">Dashboard</span>
        </nav>

        <div className="mt-6 flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex items-start gap-5">
            <HexAvatar seed={WALLET_USER} size={56} className="mt-2 hidden sm:block" />
            <div>
              {/* H1 word-reveal */}
              <motion.h1
                className="display-l text-ink"
                initial="hidden"
                animate="show"
                variants={{ hidden: {}, show: { transition: { staggerChildren: 0.09 } } }}
              >
                {['Hola,'].map((w) => (
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
                  {addrShort}
                  <button
                    type="button"
                    onClick={copyAddress}
                    aria-label="Copiar dirección"
                    className="rounded-full p-1.5 text-ink-3 transition-colors hover:bg-honey-soft hover:text-honey-deep"
                  >
                    {copied ? <Check size={16} className="text-olive" /> : <Copy size={16} />}
                  </button>
                </motion.span>
              </motion.h1>
              <p className="mt-3 text-[1.0625rem] text-ink-2">
                Miembro de la colmena desde nov 2025 · Reputación global{' '}
                <span className="font-medium text-ink">4,9 ★</span> · Posición{' '}
                <span className="font-mono text-[0.9375rem]">#12</span> en Texto.
              </p>
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
            <div className="relative flex rounded-full border border-line bg-cream p-1" role="tablist" aria-label="Perspectiva del panel">
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
                  {p === 'proveedor' ? 'Como proveedor' : 'Como cliente'}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  toast('Retiro iniciado', {
                    icon: <ArrowDownToLine size={14} className="text-honey-deep" />,
                    description: `1.284,50 MON → ${addrShort} (simulado).`,
                  })
                }
                className="rounded-full border border-line px-4 py-2 text-[0.875rem] font-medium text-ink-2 transition-colors hover:border-honey hover:text-honey-deep"
              >
                Retirar fondos
              </button>
              <button
                type="button"
                onClick={() =>
                  toast('Registro de agente', {
                    description: 'El alta de nuevos agentes se habilita con AgentRegistry v2 (demo).',
                  })
                }
                className="inline-flex items-center gap-1.5 rounded-full bg-honey px-4 py-2 text-[0.875rem] font-semibold text-ink transition-colors hover:bg-honey-deep hover:text-paper"
              >
                <Plus size={15} />
                Registrar nuevo agente
              </button>
            </div>
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
              {KPIS[perspective].map((kpi) => (
                <div key={kpi.id} className="rounded-2xl border border-line bg-paper p-5 shadow-card">
                  <StatBlock
                    value={kpi.value}
                    decimals={kpi.decimals}
                    prefix={kpi.prefix}
                    suffix={kpi.suffix ? ` ${kpi.suffix}` : undefined}
                    label={kpi.label}
                  />
                  {(kpi.delta || kpi.sub) && (
                    <motion.p
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 0.6, duration: 0.3 }}
                      className="mt-3 flex items-center gap-1.5 text-[0.8125rem]"
                    >
                      {kpi.delta && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-olive/10 px-2 py-0.5 font-mono text-[0.75rem] font-medium text-olive">
                          {kpi.deltaIcon === 'up' && <TrendingUp size={12} />}
                          {kpi.delta}
                        </span>
                      )}
                      {kpi.sub && <span className="text-ink-3">{kpi.sub}</span>}
                    </motion.p>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-6">
              <WalletCard />
            </div>
          </div>
        </motion.section>

        {/* ── S3 · Gráficas ──────────────────────────────────────────────── */}
        <motion.section variants={flipItem} className="container-hive py-14 md:py-20">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Ganancias / Gasto */}
            <div className="rounded-2xl border border-line bg-paper p-6 shadow-card lg:col-span-8">
              <div className="mb-5 flex items-center justify-between gap-4">
                <h3 className="font-display text-[1.125rem] font-semibold tracking-[-0.015em] text-ink">
                  {perspective === 'proveedor' ? 'Ganancias' : 'Gasto'}
                </h3>
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
              </div>
              <EarningsAreaChart data={earnings} rangeKey={`${perspective}-${range}`} />
            </div>

            {/* Donut por categoría */}
            <div className="rounded-2xl border border-line bg-paper p-6 shadow-card lg:col-span-4">
              <h3 className="mb-5 font-display text-[1.125rem] font-semibold tracking-[-0.015em] text-ink">
                {donut.title}
              </h3>
              <CategoryDonut slices={donut.slices} center={donut.center} centerLabel={donut.centerLabel} />
            </div>

            {/* Reputación en el tiempo */}
            <div className="rounded-2xl border border-line bg-paper p-6 shadow-card lg:col-span-12">
              <div className="mb-4 flex items-baseline justify-between gap-4">
                <h3 className="font-display text-[1.125rem] font-semibold tracking-[-0.015em] text-ink">
                  Reputación en el tiempo
                </h3>
                <p className="font-mono text-[0.75rem] text-ink-3">hitos: 1.000 tareas · Top 25</p>
              </div>
              <ReputationLineChart data={REPUTATION_TIMELINE} />
            </div>
          </div>
        </motion.section>

        {/* ── S4 · Mis agentes / Favoritos ───────────────────────────────── */}
        <motion.section variants={flipItem} className="container-hive pb-14 md:pb-20">
          <SectionHeader
            eyebrow={perspective === 'proveedor' ? 'Tus agentes' : 'Favoritos'}
            title={
              perspective === 'proveedor' ? (
                <>
                  Mis <em className="serif-accent text-honey-deep">agentes</em>
                </>
              ) : (
                <>
                  Tus agentes <em className="serif-accent text-honey-deep">favoritos</em>
                </>
              )
            }
            sub={
              perspective === 'proveedor'
                ? 'Pausa, ajusta precios y retira ganancias de tus agentes publicados.'
                : 'Los agentes que más contratas, a un clic de distancia.'
            }
            action={
              perspective === 'proveedor' ? (
                <button
                  type="button"
                  onClick={() =>
                    toast('Registro de agente', {
                      description: 'El alta de nuevos agentes se habilita con AgentRegistry v2 (demo).',
                    })
                  }
                  className="inline-flex items-center gap-1.5 rounded-full bg-honey px-4 py-2 text-[0.875rem] font-semibold text-ink transition-colors hover:bg-honey-deep hover:text-paper"
                >
                  <Plus size={15} />
                  Registrar nuevo agente
                </button>
              ) : undefined
            }
            className="mb-8"
          />
          {perspective === 'proveedor' ? (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              {OWN_AGENTS.map((a) => (
                <OwnAgentCard key={a.id} agent={a} />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              {FAVORITE_AGENTS.map((a) => (
                <AgentCard key={a.id} agent={a} />
              ))}
            </div>
          )}
        </motion.section>

        {/* ── S5 · Tareas activas ────────────────────────────────────────── */}
        <motion.section variants={flipItem} className="container-hive pb-14 md:pb-20">
          <SectionHeader
            eyebrow="Escrow en marcha"
            title={
              <>
                Tareas <em className="serif-accent text-honey-deep">activas</em>
              </>
            }
            sub="El progreso avanza en vivo; las entregas llegan a la primera fila para que las verifiques."
            className="mb-8"
          />
          <TasksSection perspective={perspective} />
        </motion.section>
      </motion.div>

      {/* ── S6 · Disputa en curso ─────────────────────────────────────────── */}
      <section className="container-hive pb-14 md:pb-20">
        <SectionHeader
          eyebrow="Arbitraje"
          title={
            <>
              Disputa <em className="serif-accent text-honey-deep">en curso</em>
            </>
          }
          className="mb-8"
        />
        <DisputeCard />
      </section>

      {/* ── S7 · Historial de pagos ───────────────────────────────────────── */}
      <section className="container-hive pb-14 md:pb-20">
        <SectionHeader
          eyebrow="Movimientos"
          title={
            <>
              Historial de <em className="serif-accent text-honey-deep">pagos</em>
            </>
          }
          sub="Cobros y pagos con su hash verificable en el explorador de Monad."
          className="mb-8"
        />
        <PaymentsSection />
      </section>

      {/* ── S8 · Reputación e insignias (cream, cierre) ───────────────────── */}
      <section className="relative overflow-hidden bg-cream">
        <div className="bg-honeycomb pointer-events-none absolute inset-0 opacity-40" aria-hidden />
        <div className="container-hive relative py-16 md:py-24">
          <SectionHeader
            eyebrow="Reputación on-chain"
            title={
              <>
                Tu palabra, <em className="serif-accent text-honey-deep">medida</em>
              </>
            }
            className="mb-10"
          />
          <ReputationSection />
        </div>
      </section>
    </div>
  );
}
