import { motion } from 'framer-motion';
import { ArrowUpRight, Check, Minus, X } from 'lucide-react';
import { WordReveal } from '@/components/home/Reveal';
import SectionHeader from '@/components/SectionHeader';
import { NETWORK_COMPARISON } from '@/data/protocol';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

const GRID_COLS = 'grid-cols-[1.1fr_0.9fr_0.9fr_0.7fr_1.2fr_0.8fr]';

/**
 * S6 · Por qué Monad (claro, tabla + cita): reutiliza el patrón de tabla de
 * home con más columnas técnicas (Comisión/tx · Finalidad · TPS · Micro-tarea
 * $0.002 · EVM). Fila Monad destacada. Blockquote serif con línea honey que
 * crece scaleY primero y word-reveal después.
 */
export default function MonadSection() {
  const { t } = useTranslation();
  return (
    <section className="border-t border-line bg-paper py-24 md:py-32">
      <div className="mx-auto max-w-4xl px-6">
        <SectionHeader
          align="center"
          eyebrow={t('monadPage.eyebrow')}
          title={
            <WordReveal>
              {t('monadPage.title')} <em className="serif-accent text-honey-deep">{t('monadPage.titleEm')}</em>
            </WordReveal>
          }
        />

        {/* Tabla comparativa (patrón de home, más columnas) */}
        <div className="mt-12">
          <div
            className={cn(
              'grid gap-3 border-b border-line pb-3 text-[0.75rem] font-semibold uppercase tracking-[0.1em] text-ink-3 max-md:hidden',
              GRID_COLS,
            )}
          >
            <span>{t('home.monad.colNetwork')}</span>
            <span>{t('home.monad.colFee')}</span>
            <span>{t('home.monad.colFinality')}</span>
            <span>TPS</span>
            <span>{t('monadPage.colMicrotask')}</span>
            <span>EVM</span>
          </div>
          {NETWORK_COMPARISON.map((row, i) => (
            <motion.div
              key={row.network}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-10%' }}
              transition={{ duration: 0.6, delay: i * 0.1 }}
              className={cn(
                'relative grid items-center gap-3 border-b border-line py-5 max-md:grid-cols-2 max-md:gap-y-2',
                GRID_COLS,
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
                {row.microtask === 'apenas' && (
                  <>
                    <Minus size={16} className="text-honey-deep" strokeWidth={3} />
                    <span className="text-ink-2">{t(row.microtaskLabel)}</span>
                  </>
                )}
              </span>
              <span className="font-mono text-[0.875rem] text-ink-2">{row.evm ? t(row.evm) : '—'}</span>
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

        {/* Cita */}
        <blockquote className="relative mt-16 pl-8">
          <motion.span
            initial={{ scaleY: 0 }}
            whileInView={{ scaleY: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, ease: 'easeOut' }}
            className="absolute left-0 top-0 h-full w-[2px] origin-top bg-honey"
            aria-hidden
          />
          <p className="serif-accent text-[clamp(1.5rem,3vw,2.1rem)] leading-[1.35] text-ink">
            <WordReveal delay={0.25}>
              {t('monadPage.quote')}
            </WordReveal>
          </p>
          <footer className="mt-4 font-mono text-[12px] tracking-[0.06em] text-ink-3">
            MONADBFT · ejecución paralela · MonadDb
          </footer>
        </blockquote>

        {/* Links */}
        <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
          <a
            href="https://monad.xyz"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-[0.9375rem] font-semibold text-honey-deep transition-colors hover:text-honey"
          >
            monad.xyz
            <ArrowUpRight size={15} aria-hidden />
          </a>
          <span className="font-mono text-[12px] text-ink-3">Chain ID 143 · RPC rpc.monad.xyz</span>
        </div>
      </div>
    </section>
  );
}
