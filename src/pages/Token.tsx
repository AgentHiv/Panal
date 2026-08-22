/**
 * Panal — Página /token: tokenomics del token oficial $PANAL.
 * Regla de oro: TODOS los datos numéricos se leen on-chain en tiempo real
 * (totalSupply, name, symbol, decimals, balanceOf) vía wagmi useReadContract.
 * Sin precio ni market cap (no hay oráculo): no se muestran.
 * La distribución inicial NO es verificable on-chain sin indexador: se muestra
 * solo el supply y una nota honesta (sin gráfico inventado).
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, useReducedMotion } from 'framer-motion';
import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Check,
  Coins,
  Copy,
  Hexagon,
  Loader2,
  Plus,
  Receipt,
  Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { useReadContract, useWatchAsset } from 'wagmi';
import { formatUnits } from 'viem';
import Reveal, { WordReveal } from '@/components/home/Reveal';
import StatBlock from '@/components/StatBlock';
import { panalTokenAbi } from '@/contracts/abis';
import {
  EXPLORER_ADDRESS,
  IS_MAINNET,
  PANAL_MARKET_URL,
  PANAL_TOKEN_ADDRESS,
  activeChain,
} from '@/contracts/config';
import { useWallet } from '@/hooks/useWallet';

const DECIMALS_FALLBACK = 18;

const full = (n: number) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 }).format(n);
const compact = (n: number) =>
  new Intl.NumberFormat('es-ES', { notation: 'compact', maximumFractionDigits: 2 }).format(n);

/** Lecturas on-chain compartidas por las secciones de la página. */
function usePanalToken() {
  const { address } = useWallet();
  const addr = (address ?? null) as `0x${string}` | null;
  const base = { address: PANAL_TOKEN_ADDRESS, abi: panalTokenAbi, chainId: activeChain.id } as const;
  const staticOpts = { enabled: IS_MAINNET, staleTime: 300_000, retry: 1 } as const;

  const { data: supply } = useReadContract({ ...base, functionName: 'totalSupply', query: staticOpts });
  const { data: name } = useReadContract({ ...base, functionName: 'name', query: staticOpts });
  const { data: symbol } = useReadContract({ ...base, functionName: 'symbol', query: staticOpts });
  const { data: decimals } = useReadContract({ ...base, functionName: 'decimals', query: staticOpts });
  const { data: balance } = useReadContract({
    ...base,
    functionName: 'balanceOf',
    args: addr ? [addr] : undefined,
    query: { enabled: IS_MAINNET && !!addr, refetchInterval: 15_000, retry: 1 },
  });

  const dec = decimals ?? DECIMALS_FALLBACK;
  return {
    name,
    symbol,
    decimals: dec,
    supply: supply !== undefined ? Number(formatUnits(supply, dec)) : undefined,
    balance: balance !== undefined ? Number(formatUnits(balance, dec)) : undefined,
  };
}

/* ============================================================
 * S1 · Hero (claro): identidad del token + datos on-chain
 * ============================================================ */
function TokenHero({ token }: { token: ReturnType<typeof usePanalToken> }) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const [copied, setCopied] = useState(false);
  const short = `${PANAL_TOKEN_ADDRESS.slice(0, 8)}…${PANAL_TOKEN_ADDRESS.slice(-6)}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(PANAL_TOKEN_ADDRESS);
    } catch {
      /* portapapeles no disponible */
    }
    setCopied(true);
    toast(t('tokenPage.hero.contractCopied'), { icon: <Check size={14} className="text-olive" /> });
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <section className="relative overflow-hidden bg-paper pb-20 pt-32">
      <div className="bg-honeycomb pointer-events-none absolute inset-0 opacity-[0.05]" aria-hidden />
      <div className="glow-monad left-[-10%] top-[-30%] h-[420px] w-[520px]" aria-hidden />

      {/* Hexágonos flotantes sutiles (reduced-motion: estáticos) */}
      {!reduceMotion && (
        <>
          <motion.span
            className="pointer-events-none absolute right-[12%] top-[18%] hidden md:block"
            animate={{ y: [0, -14, 0], rotate: [0, 8, 0] }}
            transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
            aria-hidden
          >
            <Hexagon size={56} className="text-honey/30" />
          </motion.span>
          <motion.span
            className="pointer-events-none absolute bottom-[14%] left-[8%] hidden md:block"
            animate={{ y: [0, 12, 0], rotate: [0, -6, 0] }}
            transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
            aria-hidden
          >
            <Hexagon size={36} className="fill-monad/10 text-monad/25" />
          </motion.span>
        </>
      )}

      <div className="container-hive relative flex flex-col items-center text-center">
        <Reveal>
          <p className="eyebrow flex items-center gap-2 text-ink-3">
            <Hexagon size={12} className="fill-honey text-honey" aria-hidden />
            {t('tokenPage.hero.eyebrow')}
          </p>
        </Reveal>

        <Reveal delay={0.05}>
          <h1 className="display-xl mt-6 text-ink">
            <span className="block">{t('tokenPage.hero.title1')}</span>
            <span className="serif-accent block text-honey-deep">{t('tokenPage.hero.title2')}</span>
          </h1>
        </Reveal>

        <Reveal delay={0.1}>
          <p className="mt-6 max-w-2xl text-[1.125rem] leading-[1.65] text-ink-2">
            {t('tokenPage.hero.sub')}
          </p>
        </Reveal>

        {/* Badges: estándar + red (Chain ID real de activeChain) */}
        <Reveal delay={0.15} className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <span className="rounded-full border border-line bg-paper px-4 py-2 font-mono text-[12px] font-medium text-ink-2">
            ERC-20
          </span>
          <span className="chip-monad px-4 py-2">
            {activeChain.name} · Chain ID {activeChain.id}
          </span>
        </Reveal>

        {/* Chip de contrato: copiar + MonadVision */}
        <Reveal delay={0.2} className="mt-4">
          <div className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-full border border-line bg-paper px-4 py-2 font-mono text-[12px] text-ink-2 transition-[transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-honey">
            <Hexagon size={14} className="fill-honey text-honey" aria-hidden />
            <span className="font-semibold text-ink">
              {token.name ?? 'PANAL'} ({token.symbol ? `$${token.symbol}` : '$PANAL'})
            </span>
            <span className="text-ink-3">{short}</span>
            <button
              type="button"
              onClick={copy}
              className="inline-flex items-center text-ink-3 transition-colors hover:text-honey-deep"
              aria-label={t('token.copy')}
            >
              {copied ? <Check size={12} className="text-olive" /> : <Copy size={12} />}
            </button>
            <span className="h-3.5 w-px bg-line" aria-hidden />
            <a
              href={EXPLORER_ADDRESS(PANAL_TOKEN_ADDRESS)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-honey-deep transition-colors hover:text-honey"
            >
              MonadVision
              <ArrowUpRight size={11} aria-hidden />
            </a>
          </div>
        </Reveal>

        {/* Stats 100 % on-chain */}
        <Reveal delay={0.25} className="mt-14 flex flex-wrap items-start justify-center gap-x-14 gap-y-8">
          {token.supply !== undefined ? (
            <StatBlock value={token.supply} label={t('tokenPage.hero.statSupply')} className="items-center" />
          ) : (
            <span className="inline-flex flex-col items-center gap-1">
              <Loader2 size={20} className="animate-spin text-ink-3" aria-hidden />
              <span className="eyebrow text-ink-3">{t('tokenPage.hero.statSupply')}</span>
            </span>
          )}
          <StatBlock value={token.decimals} label={t('tokenPage.hero.statDecimals')} className="items-center" durationMs={600} />
          <div className="flex flex-col items-center gap-1">
            <span className="font-display text-[2rem] font-bold leading-none tracking-[-0.02em] text-ink">
              ${token.symbol ?? 'PANAL'}
            </span>
            <span className="eyebrow text-ink-3">{t('tokenPage.hero.statSymbol')}</span>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ============================================================
 * S2 · Tu posición (oscuro): balance real + añadir a MetaMask
 * ============================================================ */
function PositionSection({ token }: { token: ReturnType<typeof usePanalToken> }) {
  const { t } = useTranslation();
  const { connected, connect, connecting } = useWallet();

  const { watchAsset, isPending: watching } = useWatchAsset({
    mutation: {
      onSuccess: () => toast(t('token.addedToast')),
      onError: (e) =>
        toast.error(
          e.message.includes('User rejected') ? t('hire.step3.rejected') : e.message.split('\n')[0],
        ),
    },
  });

  const addToWallet = () =>
    watchAsset({
      type: 'ERC20',
      options: { address: PANAL_TOKEN_ADDRESS, symbol: 'PANAL', decimals: 18 },
    });

  return (
    <section className="relative overflow-hidden border-t border-coal-line bg-coal py-20 md:py-24">
      <div className="glow-monad right-[15%] top-[-30%] h-[360px] w-[460px]" aria-hidden />
      <div className="container-hive relative flex flex-col items-center">
        <Reveal className="flex flex-col items-center text-center">
          <p className="eyebrow text-coal-mute">{t('tokenPage.position.eyebrow')}</p>
          <h2 className="display-l mt-4 max-w-2xl text-balance text-coal-text">
            <WordReveal>{t('tokenPage.position.title')}</WordReveal>
          </h2>
        </Reveal>

        <Reveal delay={0.1} className="mt-10 w-full max-w-3xl">
          <div className="ring-glow-monad flex flex-col gap-5 rounded-2xl border border-monad/30 bg-coal-2 p-5 md:flex-row md:items-center md:justify-between md:p-6">
            <div className="flex items-start gap-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-monad/15">
                <Wallet size={20} className="text-monad-mist" aria-hidden />
              </span>
              <div className="flex flex-col gap-1.5">
                <p className="font-display text-[1.05rem] font-semibold text-coal-text">
                  {connected ? t('tokenPage.position.balanceTitle') : t('tokenPage.position.connectTitle')}
                </p>
                {connected ? (
                  <p className="font-mono text-[13px] text-coal-mute">
                    {t('token.yourBalance')}:{' '}
                    <span className="text-[1.05rem] font-semibold text-monad-mist">
                      {token.balance !== undefined ? `${compact(token.balance)} $PANAL` : '…'}
                    </span>
                  </p>
                ) : (
                  <p className="max-w-md text-[0.875rem] leading-relaxed text-coal-mute">
                    {t('tokenPage.position.connectDesc')}
                  </p>
                )}
                {!IS_MAINNET && (
                  <p className="max-w-md text-[0.8125rem] text-coal-mute">{t('tokenPage.mainnetOnly')}</p>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row md:flex-col lg:flex-row">
              {!connected && (
                <button
                  type="button"
                  onClick={connect}
                  disabled={connecting}
                  className="btn-monad inline-flex items-center justify-center gap-2 px-5 py-2.5 text-[0.875rem] font-semibold disabled:opacity-50"
                >
                  {connecting ? t('nav.connecting') : t('nav.connect')}
                </button>
              )}
              <button
                type="button"
                onClick={addToWallet}
                disabled={watching}
                className="inline-flex items-center justify-center gap-2 rounded-full border border-coal-line px-5 py-2.5 text-[0.875rem] font-semibold text-coal-text transition-colors hover:border-monad hover:text-monad-mist disabled:opacity-50"
              >
                {watching ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} aria-hidden />}
                {t('token.addToWallet')}
              </button>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ============================================================
 * S3 · Utilidad (claro): 3 tarjetas editoriales reales
 * ============================================================ */
function UtilitySection() {
  const { t } = useTranslation();
  const cards = [
    { icon: Receipt, title: t('tokenPage.utility.pay.title'), desc: t('tokenPage.utility.pay.desc') },
    { icon: Coins, title: t('tokenPage.utility.earn.title'), desc: t('tokenPage.utility.earn.desc') },
    { icon: BadgeCheck, title: t('tokenPage.utility.withdraw.title'), desc: t('tokenPage.utility.withdraw.desc') },
  ];

  return (
    <section className="bg-paper py-20 md:py-28">
      <div className="container-hive flex flex-col items-center">
        <Reveal className="flex flex-col items-center text-center">
          <p className="eyebrow text-ink-3">{t('tokenPage.utility.eyebrow')}</p>
          <h2 className="display-l mt-4 max-w-3xl text-balance text-ink">
            <WordReveal>
              {t('tokenPage.utility.title1')}{' '}
              <em className="serif-accent text-honey-deep">{t('tokenPage.utility.title2')}</em>
            </WordReveal>
          </h2>
          <p className="mt-5 max-w-2xl text-[1.0625rem] leading-[1.65] text-ink-2">
            {t('tokenPage.utility.sub')}
          </p>
        </Reveal>

        <Reveal stagger className="mt-12 grid w-full grid-cols-1 gap-5 md:grid-cols-3">
          {cards.map((c) => (
            <article
              key={c.title}
              className="flex flex-col gap-4 rounded-2xl border border-line bg-paper p-6 transition-[transform,border-color] duration-200 hover:-translate-y-1 hover:border-honey"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-honey/10">
                <c.icon size={20} className="text-honey-deep" aria-hidden />
              </span>
              <h3 className="font-display text-[1.125rem] font-semibold text-ink">{c.title}</h3>
              <p className="text-[0.9375rem] leading-[1.65] text-ink-2">{c.desc}</p>
            </article>
          ))}
        </Reveal>
      </div>
    </section>
  );
}

/* ============================================================
 * S4 · Supply + nota honesta de distribución (oscuro)
 * ============================================================ */
function SupplySection({ token }: { token: ReturnType<typeof usePanalToken> }) {
  const { t } = useTranslation();

  return (
    <section className="relative overflow-hidden border-t border-coal-line bg-coal py-20 md:py-28">
      <div className="bg-honeycomb pointer-events-none absolute inset-0 opacity-[0.06]" aria-hidden />
      <div className="glow-honey left-[10%] bottom-[-40%] h-[320px] w-[420px]" aria-hidden />
      <div className="container-hive relative flex flex-col items-center text-center">
        <Reveal>
          <p className="eyebrow text-coal-mute">{t('tokenPage.supply.eyebrow')}</p>
        </Reveal>
        <Reveal delay={0.05}>
          <h2 className="display-l mt-4 max-w-2xl text-balance text-coal-text">
            <WordReveal>{t('tokenPage.supply.title')}</WordReveal>
          </h2>
        </Reveal>

        <Reveal delay={0.1} className="mt-12 flex flex-col items-center gap-3">
          <span className="font-display font-bold leading-none tracking-[-0.02em] text-honey" style={{ fontSize: 'clamp(2.75rem, 8vw, 5.5rem)' }}>
            {token.supply !== undefined ? full(token.supply) : '…'}
          </span>
          <span className="eyebrow text-coal-mute">{t('tokenPage.supply.totalLabel')}</span>
          <a
            href={EXPLORER_ADDRESS(PANAL_TOKEN_ADDRESS)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex items-center gap-1.5 font-mono text-[12px] text-coal-mute transition-colors hover:text-monad-mist"
          >
            totalSupply() · {t('tokenPage.supply.onchainNote')}
            <ArrowUpRight size={11} aria-hidden />
          </a>
        </Reveal>

        {/* Distribución: NO verificable on-chain sin indexador → nota honesta, sin gráfico */}
        <Reveal delay={0.15} className="mt-12 w-full max-w-2xl">
          <div className="rounded-2xl border border-coal-line bg-coal-2 p-6 text-left md:p-7">
            <h3 className="font-display text-[1.05rem] font-semibold text-coal-text">
              {t('tokenPage.supply.distributionTitle')}
            </h3>
            <p className="mt-2 text-[0.9375rem] leading-[1.65] text-coal-mute">
              {t('tokenPage.supply.distributionNote')}
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ============================================================
 * S5 · Cómo conseguir $PANAL (claro)
 * ============================================================ */
function GetSection() {
  const { t } = useTranslation();
  const cards = [
    {
      title: t('tokenPage.get.hire.title'),
      desc: t('tokenPage.get.hire.desc'),
      cta: t('tokenPage.get.hire.cta'),
      to: '/mercado?moneda=panal',
    },
    {
      title: t('tokenPage.get.earnAgent.title'),
      desc: t('tokenPage.get.earnAgent.desc'),
      cta: t('tokenPage.get.earnAgent.cta'),
      to: '/dashboard',
    },
    // El mercado es de otros, así que sale sólo si hay enlace de verdad que dar:
    // ver PANAL_MARKET_URL en contracts/config.ts.
    ...(PANAL_MARKET_URL
      ? [
          {
            title: t('tokenPage.get.market.title'),
            desc: t('tokenPage.get.market.desc'),
            cta: t('tokenPage.get.market.cta'),
            to: PANAL_MARKET_URL,
            externo: true,
          },
        ]
      : []),
  ];

  return (
    <section className="bg-paper py-20 md:py-28">
      <div className="container-hive flex flex-col items-center">
        <Reveal className="flex flex-col items-center text-center">
          <p className="eyebrow text-ink-3">{t('tokenPage.get.eyebrow')}</p>
          <h2 className="display-l mt-4 max-w-2xl text-balance text-ink">
            <WordReveal>{t('tokenPage.get.title')}</WordReveal>
          </h2>
        </Reveal>

        <Reveal
          stagger
          className={`mt-12 grid w-full grid-cols-1 gap-5 ${
            cards.length > 2 ? 'max-w-5xl md:grid-cols-3' : 'max-w-4xl md:grid-cols-2'
          }`}
        >
          {cards.map((c) => {
            const cuerpo = (
              <>
                <h3 className="font-display text-[1.125rem] font-semibold text-ink">{c.title}</h3>
                <p className="text-[0.9375rem] leading-[1.65] text-ink-2">{c.desc}</p>
                <span className="mt-auto inline-flex items-center gap-1.5 text-[0.875rem] font-semibold text-honey-deep transition-colors group-hover:text-honey">
                  {c.cta}
                  <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" aria-hidden />
                </span>
              </>
            );
            const clases =
              'group flex flex-col gap-4 rounded-2xl border border-line bg-paper p-6 transition-[transform,border-color] duration-200 hover:-translate-y-1 hover:border-honey md:p-7';
            // El mercado vive fuera: enlace externo de verdad, no una ruta del router.
            return 'externo' in c && c.externo ? (
              <a key={c.title} href={c.to} target="_blank" rel="noopener noreferrer" className={clases}>
                {cuerpo}
              </a>
            ) : (
              <Link key={c.title} to={c.to} className={clases}>
                {cuerpo}
              </Link>
            );
          })}
        </Reveal>

        <Reveal delay={0.1} className="mt-8 max-w-2xl text-center">
          <p className="text-[0.875rem] leading-relaxed text-ink-3">{t('tokenPage.get.dexNote')}</p>
        </Reveal>
      </div>
    </section>
  );
}

/* ============================================================
 * S6 · CTA final (oscuro)
 * ============================================================ */
function FinalCta() {
  const { t } = useTranslation();
  return (
    <section className="relative overflow-hidden border-t border-coal-line bg-coal py-24 md:py-32">
      <div className="bg-honeycomb pointer-events-none absolute inset-0 opacity-[0.06]" aria-hidden />
      <div className="glow-monad left-[20%] top-[-20%] h-[420px] w-[520px]" aria-hidden />
      <div className="container-hive relative flex flex-col items-center text-center">
        <h2 className="display-l max-w-3xl text-balance text-coal-text">
          <WordReveal>
            {t('tokenPage.cta.title1')}{' '}
            <em className="serif-accent text-honey">{t('tokenPage.cta.title2')}</em>
          </WordReveal>
        </h2>
        <Reveal stagger className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <Link
            to="/mercado?moneda=panal"
            className="rounded-full bg-honey px-7 py-3.5 text-[0.9375rem] font-semibold text-ink transition-colors hover:bg-honey-deep hover:text-paper"
          >
            {t('tokenPage.cta.market')}
          </Link>
          <Link
            to="/dashboard"
            className="rounded-full border border-coal-line px-7 py-3.5 text-[0.9375rem] font-semibold text-coal-text transition-colors hover:border-monad hover:text-monad-mist"
          >
            {t('tokenPage.cta.dashboard')}
          </Link>
        </Reveal>
      </div>
    </section>
  );
}

export default function Token() {
  const { t, i18n } = useTranslation();
  const token = usePanalToken();

  // SEO básico (título + meta description por idioma)
  useEffect(() => {
    const prevTitle = document.title;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const prevDesc = meta?.content ?? null;
    document.title = t('tokenPage.metaTitle');
    meta?.setAttribute('content', t('tokenPage.metaDesc'));
    return () => {
      document.title = prevTitle;
      if (meta && prevDesc !== null) meta.setAttribute('content', prevDesc);
    };
  }, [t, i18n.language]);

  return (
    <>
      <TokenHero token={token} />
      <PositionSection token={token} />
      <UtilitySection />
      <SupplySection token={token} />
      <GetSection />
      <FinalCta />
    </>
  );
}
