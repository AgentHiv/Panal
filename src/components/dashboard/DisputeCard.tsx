/**
 * Panal — Disputa en curso (dashboard.md S6).
 * Card con borde terra y fondo terra diluido, timeline de 4 pasos del jurado
 * con línea de progreso animada (scaleX), plazo mono con tick cada minuto,
 * CTA "Ver expediente" y nota de resolución.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Check, Gavel, Hexagon, Scale, Users } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { DISPUTE } from './data';

/** Contador de plazo: tick a la baja cada minuto (mono). */
function useDeadline(initialMin: number): { h: number; m: number } {
  const [minutes, setMinutes] = useState(initialMin);
  useEffect(() => {
    const id = window.setInterval(() => setMinutes((m) => Math.max(0, m - 1)), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return { h: Math.floor(minutes / 60), m: minutes % 60 };
}

export default function DisputeCard() {
  const { t } = useTranslation();
  const deadline = useDeadline(DISPUTE.deadlineMin);
  const doneCount = DISPUTE.steps.filter((s) => s.done).length;
  // progreso de la línea: pasos completos + mitad del paso en curso
  const progress = (doneCount + 0.5) / DISPUTE.steps.length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 32 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      className="rounded-2xl border border-terra bg-[#B2562E0D] p-6 shadow-card md:p-8"
    >
      <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl flex-1">
          <p className="eyebrow flex items-center gap-2 text-terra">
            <Hexagon size={12} className="fill-terra/20 text-terra" aria-hidden />
            {t('dash.dispute.eyebrow')} {DISPUTE.id}
          </p>
          <h3 className="display-m mt-3 text-ink">{t(DISPUTE.title)}</h3>
          <p className="mt-2 text-[0.9375rem] text-ink-2">
            {t('dash.dispute.line', { task: DISPUTE.taskId, counterparty: DISPUTE.counterparty })}{' '}
            <span className="font-mono">{DISPUTE.amount.toFixed(3)} MON</span> {t('dash.dispute.locked')}
          </p>

          {/* Timeline del jurado */}
          <div className="mt-8">
            <div className="relative">
              {/* raíl + progreso */}
              <div className="absolute left-0 right-0 top-[13px] h-0.5 rounded bg-terra/15" aria-hidden />
              <motion.div
                className="absolute left-0 top-[13px] h-0.5 rounded bg-terra"
                style={{ transformOrigin: 'left center', width: `${progress * 100}%` }}
                initial={{ scaleX: 0 }}
                whileInView={{ scaleX: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 1, ease: 'easeOut', delay: 0.2 }}
                aria-hidden
              />
              <ol className="relative grid grid-cols-4 gap-2">
                {DISPUTE.steps.map((step, i) => (
                  <li key={step.title} className="flex flex-col items-start gap-2">
                    <span
                      className={cn(
                        'flex h-7 w-7 items-center justify-center rounded-full border text-[0.75rem] font-semibold',
                        step.done
                          ? 'border-terra bg-terra text-paper'
                          : step.current
                            ? 'border-terra bg-paper text-terra'
                            : 'border-terra/30 bg-paper text-ink-3',
                      )}
                    >
                      {step.done ? <Check size={13} /> : i + 1}
                    </span>
                    <div>
                      <p className={cn('text-[0.8125rem] font-semibold leading-tight', step.current ? 'text-terra' : step.done ? 'text-ink' : 'text-ink-3')}>
                        {t(step.title)}
                      </p>
                      {step.detail && (
                        <p className="mt-0.5 flex items-center gap-1 font-mono text-[0.6875rem] text-ink-3">
                          {step.title === 'dash.dispute.step2' && <Users size={10} />}
                          {step.title === 'dash.dispute.step3' && <Gavel size={10} />}
                          {t(step.detail)}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>

        {/* Plazo + CTA */}
        <div className="flex shrink-0 flex-col items-start gap-4 lg:items-end">
          <div className="rounded-xl border border-terra/30 bg-paper px-4 py-3">
            <p className="eyebrow text-ink-3">{t('dash.dispute.deadline')}</p>
            <p className="mt-1 font-mono text-[1.125rem] font-medium text-terra">
              {t('dash.dispute.remaining', { h: deadline.h, m: String(deadline.m).padStart(2, '0') })}
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              toast(t('dash.dispute.caseToast', { id: DISPUTE.id }), {
                icon: <Scale size={14} className="text-terra" />,
                description: t('dash.dispute.caseToastDesc'),
              })
            }
            className="rounded-full border border-terra/50 px-4 py-2 text-[0.875rem] font-semibold text-terra transition-colors hover:bg-terra/10"
          >
            {t('dash.dispute.viewCase')}
          </button>
          <p className="max-w-[260px] text-[0.8125rem] leading-relaxed text-ink-2 lg:text-right">{t(DISPUTE.note)}</p>
        </div>
      </div>
    </motion.div>
  );
}
