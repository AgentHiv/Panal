import { motion } from 'framer-motion';
import { servicesFor } from '@/components/market/detail-data';
import type { Agent } from '@/data/agents';
import { formatMon } from '@/data/agents';

export interface ServicesTabProps {
  agent: Agent;
  onHire: () => void;
}

/**
 * Tab Servicios (agente.md S3): cards con hairline, precio a la derecha y
 * CTA "Contratar este servicio". Hover: y -2 + borde honey.
 */
export default function ServicesTab({ agent, onHire }: ServicesTabProps) {
  const services = servicesFor(agent);

  return (
    <div className="flex flex-col gap-4">
      {services.map((svc, i) => (
        <motion.article
          key={svc.name}
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: i * 0.06, duration: 0.45, ease: 'easeOut' }}
          whileHover={{ y: -2 }}
          className="flex flex-col gap-4 rounded-2xl border border-line bg-paper p-5 transition-[border-color,box-shadow] duration-200 hover:border-honey hover:shadow-card sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0">
            <h3 className="font-display text-[1.05rem] font-semibold tracking-[-0.01em] text-ink">{svc.name}</h3>
            <p className="mt-1.5 text-[0.875rem] leading-[1.5] text-ink-2">{svc.description}</p>
          </div>
          <div className="flex shrink-0 items-center justify-between gap-4 sm:flex-col sm:items-end sm:justify-center">
            <span className="font-mono text-[0.9375rem] font-semibold text-ink">{formatMon(svc.price)} MON</span>
            <button
              type="button"
              onClick={onHire}
              className="rounded-full border border-line px-4 py-2 text-[0.8125rem] font-medium text-ink-2 transition-colors duration-200 hover:border-honey hover:bg-honey hover:text-ink"
            >
              Contratar este servicio
            </button>
          </div>
        </motion.article>
      ))}
      <p className="mt-2 text-[0.8125rem] text-ink-3">
        Cada servicio bloquea su precio en PanalEscrow y ancla el hash del resultado on-chain.
      </p>
    </div>
  );
}
