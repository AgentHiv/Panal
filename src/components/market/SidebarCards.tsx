import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Lock, Timer } from 'lucide-react';
import HexAvatar from '@/components/HexAvatar';
import { FadeUp } from '@/components/market/motion';
import { badges, similarAgents } from '@/components/market/detail-data';
import type { Agent } from '@/data/agents';
import { formatMon, formatRating } from '@/data/agents';
import { ESCROW_AUTO_RELEASE_H, PROTOCOL_FEE } from '@/data/protocol';

const HEX_CLIP = 'polygon(50% 0%, 93.3% 25%, 93.3% 75%, 50% 100%, 6.7% 75%, 6.7% 25%)';

/** Insignias hexagonales del agente (agente.md Tab Resumen, columna lateral). */
export function InsigniasCard({ agent }: { agent: Agent }) {
  return (
    <FadeUp y={20} className="rounded-2xl border border-line bg-paper p-5">
      <h3 className="text-[0.875rem] font-semibold text-ink">Insignias</h3>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {badges(agent).map((b, i) => (
          <motion.span
            key={b}
            initial={{ scale: 0, opacity: 0 }}
            whileInView={{ scale: 1, opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.15 + i * 0.08, duration: 0.4, ease: [0.34, 1.56, 0.44, 1] }}
            className="flex aspect-[1.15] items-center justify-center bg-honey-soft p-3 text-center text-[0.75rem] font-medium leading-tight text-honey-deep"
            style={{ clipPath: HEX_CLIP }}
          >
            {b}
          </motion.span>
        ))}
      </div>
    </FadeUp>
  );
}

/**
 * Card "Protegido por escrow" (agente.md S4): desglose 97.5/2.5 con barra
 * dividida y auto-release 72h con mini-timeline.
 */
export function EscrowCard() {
  const agentPct = (1 - PROTOCOL_FEE) * 100;
  return (
    <FadeUp y={20} delay={0.05} className="rounded-2xl border border-line bg-paper p-5">
      <div className="flex items-center gap-2">
        <Lock size={16} className="text-honey-deep" aria-hidden />
        <h3 className="text-[0.875rem] font-semibold text-ink">Protegido por escrow</h3>
      </div>

      {/* barra dividida honey/sand */}
      <div className="mt-4 flex h-2.5 overflow-hidden rounded-full" role="img" aria-label="97,5% para el agente, 2,5% para el protocolo">
        <motion.div
          className="bg-honey"
          initial={{ scaleX: 0 }}
          whileInView={{ scaleX: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
          style={{ width: `${agentPct}%`, transformOrigin: 'left' }}
        />
        <div className="flex-1 bg-sand" />
      </div>
      <div className="mt-2 flex justify-between font-mono text-[11px] text-ink-3">
        <span>
          <span className="text-honey-deep">97,5%</span> agente
        </span>
        <span>
          <span className="text-ink-2">2,5%</span> protocolo
        </span>
      </div>

      {/* mini-timeline auto-release */}
      <div className="mt-5">
        <div className="flex items-center">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-1 items-center last:flex-none">
              <motion.span
                initial={{ scale: 0 }}
                whileInView={{ scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: 0.2 + i * 0.15, duration: 0.3, ease: [0.34, 1.56, 0.44, 1] }}
                className={i < 2 ? 'h-2 w-2 shrink-0 rounded-full bg-honey' : 'h-2 w-2 shrink-0 rounded-full border border-honey bg-paper'}
              />
              {i < 2 && <span className="mx-1 h-px flex-1 bg-line" />}
            </div>
          ))}
        </div>
        <div className="mt-1.5 flex justify-between text-[10.5px] font-medium text-ink-3">
          <span>Bloqueo</span>
          <span>Verificación</span>
          <span>Liberación {ESCROW_AUTO_RELEASE_H}h</span>
        </div>
      </div>

      <p className="mt-4 flex items-start gap-2 text-[0.75rem] leading-[1.5] text-ink-3">
        <Timer size={13} className="mt-0.5 shrink-0 text-honey-deep" aria-hidden />
        Si no hay disputa, el pago se libera solo en {ESCROW_AUTO_RELEASE_H} h.
      </p>
    </FadeUp>
  );
}

/** Card "Agentes similares" (agente.md S4): 3 mini-filas enlazadas. */
export function SimilarAgentsCard({ agent }: { agent: Agent }) {
  const similares = similarAgents(agent, 3);
  return (
    <FadeUp y={20} delay={0.1} className="rounded-2xl border border-line bg-paper p-5">
      <h3 className="text-[0.875rem] font-semibold text-ink">Agentes similares</h3>
      <div className="mt-3 flex flex-col">
        {similares.map((a) => (
          <Link
            key={a.id}
            to={`/agente/${a.id}`}
            className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors duration-200 hover:bg-cream"
          >
            <HexAvatar seed={a.wallet} size={40} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.875rem] font-medium text-ink">{a.name}</span>
              <span className="font-mono text-[11px] text-ink-3">★ {formatRating(a.rating)}</span>
            </span>
            <span className="font-mono text-[11px] text-ink-2">{formatMon(a.pricePerTask)} MON</span>
          </Link>
        ))}
      </div>
    </FadeUp>
  );
}
