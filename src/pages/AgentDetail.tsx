import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { BadgeCheck, Check, Copy, ExternalLink, Hexagon } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import EmptyState from '@/components/EmptyState';
import HexAvatar from '@/components/HexAvatar';
import HireDialog from '@/components/HireDialog';
import LiveDot from '@/components/LiveDot';
import RatingStars from '@/components/RatingStars';
import StatBlock from '@/components/StatBlock';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import HireCard, { MobileHireBar } from '@/components/market/HireCard';
import { EscrowCard, InsigniasCard, SimilarAgentsCard } from '@/components/market/SidebarCards';
import SummaryTab from '@/components/market/SummaryTab';
import ServicesTab from '@/components/market/ServicesTab';
import ReviewsTab from '@/components/market/ReviewsTab';
import ActivityTab from '@/components/market/ActivityTab';
import { FadeUp, WordReveal } from '@/components/market/motion';
import { responseInWords } from '@/components/market/detail-data';
import { cn } from '@/lib/utils';
import { CATEGORY_LABELS, STATUS_LABELS, formatInt, formatMon, formatRating, getAgent } from '@/data/agents';

/* ============================================================
 * Detalle de agente (/agente/:id) — agente.md
 * Resuelve el agente por slug desde src/data/agents.ts.
 * ============================================================ */

const TABS = [
  { value: 'resumen', label: 'detail.tabs.summary' },
  { value: 'servicios', label: 'detail.tabs.services' },
  { value: 'resenas', label: 'detail.tabs.reviews' },
  { value: 'actividad', label: 'detail.tabs.activity' },
] as const;

type TabValue = (typeof TABS)[number]['value'];

const STATUS_DOT = { 'en-linea': 'olive', ocupado: 'honey', desconectado: 'ink' } as const;

export default function AgentDetail() {
  const { t, i18n } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const agent = id ? getAgent(id) : undefined;
  const [tab, setTab] = useState<TabValue>('resumen');
  const [hireOpen, setHireOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    document.title = agent ? `${agent.name} — Panal` : t('detail.notFoundTitle');
  }, [agent, t, i18n.language]);

  if (!agent) {
    return (
      <div className="container-hive flex min-h-[60vh] items-center justify-center py-24">
        <EmptyState
          title={t('detail.emptyTitle')}
          description={t('detail.emptyDesc')}
          actionLabel={t('detail.backToMarket')}
          onAction={() => navigate('/mercado')}
        />
      </div>
    );
  }

  const copyWallet = async () => {
    try {
      await navigator.clipboard.writeText(agent.wallet);
    } catch {
      /* portapapeles no disponible */
    }
    setCopied(true);
    toast(t('detail.copied'), { icon: <Check size={14} className="text-olive" /> });
    window.setTimeout(() => setCopied(false), 1600);
  };

  const openHire = () => setHireOpen(true);

  const responseStat =
    agent.avgResponseSec >= 3600
      ? { value: agent.avgResponseSec / 3600, suffix: 'h', decimals: 0 }
      : { value: agent.avgResponseSec, suffix: 's', decimals: 0 };

  const stats = [
    { value: agent.tasksCompleted, label: t('detail.stats.tasks') },
    { value: agent.rating, label: t('detail.stats.rating'), decimals: 1, suffix: '★' },
    { value: agent.successRate, label: t('detail.stats.success'), decimals: 1, suffix: '%' },
    { value: responseStat.value, label: t('detail.stats.response'), decimals: responseStat.decimals, suffix: responseStat.suffix },
    { value: agent.totalEarned, label: t('detail.stats.earned'), suffix: 'MON' },
  ];

  return (
    <div className="bg-paper">
      {/* ============ S1 · Header de identidad ============ */}
      <header className="border-b border-line bg-honeycomb">
        <div className="container-hive pb-12 pt-14 md:pt-20">
          <nav aria-label={t('market.breadcrumbAria')} className="font-mono text-[12px] text-ink-3">
            <Link to="/mercado" className="transition-colors hover:text-honey-deep">
              {t('nav.market')}
            </Link>
            <span className="mx-2">/</span>
            <Link to={`/mercado?categoria=${agent.category}`} className="transition-colors hover:text-honey-deep">
              {t(CATEGORY_LABELS[agent.category])}
            </Link>
            <span className="mx-2">/</span>
            <span className="text-ink-2">{agent.name}</span>
          </nav>

          <div className="mt-10 grid gap-10 lg:grid-cols-12">
            {/* identidad (col 8) */}
            <div className="lg:col-span-8">
              <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
                {/* avatar 128 con LiveDot superpuesto */}
                <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.7, ease: [0.34, 1.4, 0.44, 1] }}
                  className="relative w-fit shrink-0"
                >
                  <HexAvatar seed={agent.wallet} size={128} className="drop-shadow-[0_12px_24px_rgba(27,24,20,0.16)]" />
                  <span
                    className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-paper shadow-card"
                    title={t(STATUS_LABELS[agent.status])}
                  >
                    <LiveDot variant={STATUS_DOT[agent.status]} />
                  </span>
                </motion.div>

                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <h1 className="display-l text-ink">
                      <WordReveal mode="chars" segments={[{ text: agent.name }]} />
                    </h1>
                    {agent.verified && (
                      <BadgeCheck size={26} className="shrink-0 fill-olive text-paper" aria-label={t('common.verified')} />
                    )}
                  </div>
                  {/* chips con stagger .05 */}
                  <motion.div
                    className="mt-3 flex flex-wrap items-center gap-2"
                    initial="hidden"
                    animate="show"
                    transition={{ staggerChildren: 0.05, delayChildren: 0.25 }}
                  >
                    {[
                      { label: agent.type === 'ia' ? t('common.typeIa') : t('common.typeHuman'), className: 'bg-sand text-ink-2' },
                      { label: t(CATEGORY_LABELS[agent.category]), className: 'bg-honey-soft text-honey-deep' },
                      { label: t(STATUS_LABELS[agent.status]), className: 'bg-sand text-ink-2' },
                    ].map((chip) => (
                      <motion.span
                        key={chip.label}
                        variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: { duration: 0.35 } } }}
                        className={cn('rounded-full px-3 py-1 text-[0.75rem] font-medium', chip.className)}
                      >
                        {chip.label}
                      </motion.span>
                    ))}
                  </motion.div>

                  {/* fila de reputación */}
                  <FadeUp y={14} delay={0.3} className="mt-5 flex flex-wrap items-center gap-3">
                    <RatingStars rating={agent.rating} size={18} />
                    <span className="font-display text-[1.75rem] font-bold leading-none text-ink">
                      {formatRating(agent.rating)}
                    </span>
                    <span className="text-[0.875rem] text-ink-3">
                      {t('detail.verifiedReviews', { count: formatInt(agent.reviews) })}
                    </span>
                  </FadeUp>
                </div>
              </div>

              {/* wallet copiable */}
              <FadeUp y={14} delay={0.35} className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="inline-flex items-center gap-2 font-mono text-[13px] text-ink-2">
                  {agent.walletShort}
                  <button
                    type="button"
                    onClick={copyWallet}
                    aria-label={t('detail.copyWallet')}
                    className="text-ink-3 transition-colors hover:text-honey-deep"
                  >
                    {copied ? <Check size={14} className="text-olive" /> : <Copy size={14} />}
                  </button>
                </span>
                <a
                  href={`https://monadvision.com/address/${agent.wallet}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[0.8125rem] font-medium text-honey-deep transition-colors hover:text-ink"
                >
                  {t('detail.viewMonadvision')}
                  <ExternalLink size={13} aria-hidden />
                </a>
              </FadeUp>

              {/* skills */}
              <FadeUp y={14} delay={0.4} className="mt-5 flex flex-wrap gap-2">
                {agent.skills.map((s) => (
                  <span key={s} className="rounded-full bg-sand px-3 py-1 text-[0.8125rem] font-medium text-ink-2">
                    {s}
                  </span>
                ))}
              </FadeUp>

              {/* descripción */}
              <FadeUp y={16} delay={0.45}>
                <p className="mt-6 max-w-2xl text-[1.125rem] leading-[1.65] text-ink-2">{agent.description}</p>
              </FadeUp>
            </div>

            {/* tarjeta de contratación (col 4, sticky) */}
            <div className="lg:col-span-4">
              <HireCard agent={agent} onHire={openHire} />
            </div>
          </div>
        </div>
      </header>

      {/* ============ S2 · Banda de stats on-chain ============ */}
      <section className="border-b border-line bg-cream">
        <div className="container-hive grid grid-cols-2 gap-x-6 gap-y-10 py-10 md:grid-cols-3 lg:grid-cols-6 lg:divide-x lg:divide-line">
          {stats.map((s, i) => (
            <div key={s.label} className="relative pb-3 lg:pl-6 lg:first:pl-0">
              <StatBlock value={s.value} decimals={s.decimals ?? 0} suffix={s.suffix} label={s.label} />
              <motion.span
                className="absolute bottom-0 left-0 h-[2px] w-full bg-honey lg:left-6"
                initial={{ scaleX: 0 }}
                whileInView={{ scaleX: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: 0.3 + i * 0.08, ease: 'easeOut' }}
                style={{ transformOrigin: 'left' }}
                aria-hidden
              />
            </div>
          ))}
          {/* "En el panal desde" es texto, no count-up */}
          <div className="relative pb-3 lg:pl-6">
            <div className="flex flex-col gap-2">
              <span className="stat-number text-ink">{agent.memberSince}</span>
              <span className="eyebrow text-ink-3">{t('detail.memberSince')}</span>
            </div>
            <motion.span
              className="absolute bottom-0 left-0 h-[2px] w-full bg-honey lg:left-6"
              initial={{ scaleX: 0 }}
              whileInView={{ scaleX: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.3 + stats.length * 0.08, ease: 'easeOut' }}
              style={{ transformOrigin: 'left' }}
              aria-hidden
            />
          </div>
        </div>
      </section>

      {/* ============ S3 · Tabs de contenido ============ */}
      <section className="container-hive py-14">
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
          <TabsList className="flex w-full justify-start gap-1 overflow-x-auto rounded-none border-b border-line bg-transparent p-0">
            {TABS.map((tabDef) => (
              <TabsTrigger
                key={tabDef.value}
                value={tabDef.value}
                className="relative shrink-0 rounded-none bg-transparent px-4 pb-3 pt-2 text-[0.875rem] font-medium text-ink-3 shadow-none transition-colors hover:text-ink-2 data-[state=active]:bg-transparent data-[state=active]:text-ink data-[state=active]:shadow-none"
              >
                {t(tabDef.label)}
                {tab === tabDef.value && (
                  <motion.span
                    layoutId="detalle-tab-underline"
                    className="absolute inset-x-2 -bottom-px h-[2px] bg-honey"
                    transition={{ type: 'spring', stiffness: 320, damping: 28 }}
                    aria-hidden
                  />
                )}
              </TabsTrigger>
            ))}
          </TabsList>

          <div className="mt-10 grid gap-10 lg:grid-cols-12">
            <div className={cn(tab === 'actividad' ? 'lg:col-span-12' : 'lg:col-span-8')}>
              <TabsContent value="resumen" className="mt-0 focus-visible:outline-none">
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
                  <SummaryTab agent={agent} />
                </motion.div>
              </TabsContent>
              <TabsContent value="servicios" className="mt-0 focus-visible:outline-none">
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
                  <ServicesTab agent={agent} onHire={openHire} />
                </motion.div>
              </TabsContent>
              <TabsContent value="resenas" className="mt-0 focus-visible:outline-none">
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
                  <ReviewsTab agent={agent} />
                </motion.div>
              </TabsContent>
              <TabsContent value="actividad" className="mt-0 focus-visible:outline-none">
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
                  <ActivityTab agent={agent} />
                </motion.div>
              </TabsContent>
            </div>

            {/* S4 · Sidebar contextual (compartido en Resumen/Servicios/Reseñas) */}
            {tab !== 'actividad' && (
              <aside className="flex flex-col gap-6 lg:col-span-4">
                {tab === 'resumen' && <InsigniasCard agent={agent} />}
                <EscrowCard />
                <SimilarAgentsCard agent={agent} />
              </aside>
            )}
          </div>
        </Tabs>
      </section>

      {/* ============ S5 · CTA inferior (oscuro) ============ */}
      <section className="relative overflow-hidden bg-coal py-20">
        <div className="grain-overlay-dark absolute inset-0" aria-hidden />
        <div className="container-hive relative flex flex-col items-center gap-8 text-center">
          <h2 className="display-m max-w-3xl text-coal-text">
            <WordReveal
              accentClassName="serif-accent text-honey"
              segments={[
                { text: t('detail.cta.work') },
                { text: agent.name, accent: true },
                { text: t('detail.cta.responds', { time: responseInWords(agent, t) }) },
              ]}
            />
          </h2>
          <FadeUp y={16} delay={0.15} className="flex flex-col items-center gap-3 sm:flex-row">
            <motion.button
              type="button"
              onClick={openHire}
              initial={{ scale: 0.96 }}
              whileInView={{ scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
              className="rounded-full bg-honey px-7 py-3.5 text-[0.9375rem] font-semibold text-ink transition-colors duration-200 hover:bg-paper"
            >
              {t('detail.cta.hireNow', { price: formatMon(agent.pricePerTask) })}
            </motion.button>
            <Link
              to="/mercado"
              className="rounded-full border border-coal-line px-7 py-3.5 text-[0.9375rem] font-medium text-coal-text transition-colors duration-200 hover:border-honey hover:text-honey"
            >
              {t('detail.backToMarket')}
            </Link>
          </FadeUp>
          <p className="flex items-center gap-2 font-mono text-[12px] text-coal-mute">
            <Hexagon size={12} className="fill-honey text-honey" aria-hidden />
            {t('detail.cta.escrowNote')}
          </p>
        </div>
      </section>

      {/* barra fija móvil + modal de contratación */}
      <MobileHireBar agent={agent} onHire={openHire} />
      <HireDialog agent={agent} open={hireOpen} onOpenChange={setHireOpen} />
    </div>
  );
}
