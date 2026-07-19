import { motion } from 'framer-motion';
import { ArrowRight, Check, Hexagon } from 'lucide-react';
import { FadeUp } from '@/components/market/motion';
import { compositionNote, slaGuarantees, workSteps } from '@/components/market/detail-data';
import type { Agent } from '@/data/agents';

const HEX_CLIP = 'polygon(50% 0%, 93.3% 25%, 93.3% 75%, 50% 100%, 6.7% 75%, 6.7% 25%)';

/**
 * Tab Resumen (agente.md S3): Cómo trabaja (3 pasos), Garantías SLA y
 * Composición. Las Insignias van en la columna lateral (InsigniasCard).
 */
export default function SummaryTab({ agent }: { agent: Agent }) {
  const steps = workSteps(agent);
  const sla = slaGuarantees(agent);

  return (
    <div className="flex flex-col gap-12">
      {/* Cómo trabaja — 3 pasos numerados */}
      <FadeUp y={24}>
        <h3 className="display-m text-ink">Cómo trabaja</h3>
        <ol className="mt-6 grid gap-4 md:grid-cols-3">
          {steps.map((step, i) => (
            <motion.li
              key={step}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1, duration: 0.5, ease: 'easeOut' }}
              className="relative flex flex-col gap-3 rounded-2xl border border-line bg-paper p-5"
            >
              <span
                className="flex h-9 w-9 items-center justify-center bg-honey font-mono text-[12px] font-semibold text-ink"
                style={{ clipPath: HEX_CLIP }}
                aria-hidden
              >
                {i + 1}
              </span>
              <p className="text-[0.875rem] font-medium leading-[1.5] text-ink">{step}</p>
              {i < steps.length - 1 && (
                <ArrowRight size={16} className="absolute -right-3 top-1/2 hidden -translate-y-1/2 text-honey md:block" aria-hidden />
              )}
            </motion.li>
          ))}
        </ol>
      </FadeUp>

      {/* Garantías del agente (SLA) */}
      <FadeUp y={24} delay={0.05}>
        <h3 className="display-m text-ink">Garantías del agente (SLA)</h3>
        <ul className="mt-6 flex flex-col gap-3">
          {sla.map((g, i) => (
            <motion.li
              key={g}
              initial={{ opacity: 0, x: -16 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08, duration: 0.4, ease: 'easeOut' }}
              className="flex items-start gap-3 text-[0.9375rem] leading-[1.55] text-ink-2"
            >
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-olive/15">
                <Check size={12} className="text-olive" strokeWidth={3} aria-hidden />
              </span>
              {g}
            </motion.li>
          ))}
        </ul>
      </FadeUp>

      {/* Composición — card honey-soft */}
      <FadeUp y={24} delay={0.1}>
        <div className="flex items-start gap-4 rounded-2xl border border-honey/40 bg-honey-soft p-6">
          <Hexagon size={22} className="mt-1 shrink-0 fill-honey text-honey" aria-hidden />
          <div>
            <h3 className="text-[0.875rem] font-semibold text-honey-deep">Composición</h3>
            <p className="mt-2 text-[0.9375rem] leading-[1.6] text-ink-2">{compositionNote(agent)}</p>
          </div>
        </div>
      </FadeUp>
    </div>
  );
}
