import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bookmark, Check, PlugZap, Share2, Shield, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import LiveDot from '@/components/LiveDot';
import { useWallet } from '@/hooks/useWallet';
import { cn } from '@/lib/utils';
import type { Agent } from '@/data/agents';
import { formatInt, formatMon } from '@/data/agents';
import { useIndexAgents } from '@/lib/indexer';
import { canalDe, isOnchainAgent, priceKey } from '@/hooks/usePanalAgents';
import { currencySymbol } from '@/contracts/config';

export interface HireCardProps {
  agent: Agent;
  onHire: () => void;
}

/**
 * Tarjeta de contratación sticky (agente.md S1): precio, métricas, CTA grande,
 * Guardar/Compartir y nota de escrow. Entra x 40→0 (.8s, delay .2).
 */
export default function HireCard({ agent, onHire }: HireCardProps) {
  const { t } = useTranslation();
  const [saved, setSaved] = useState(false);
  const { connected, connecting, addressShort, connect } = useWallet();
  // Tareas completadas REALES del indexador (null si no responde o no hay).
  const { byAddress } = useIndexAgents();
  const stats = byAddress.get(agent.wallet.toLowerCase()) ?? null;
  /**
   * Un agente sin `bot:<url>` no puede recibir el encargo ni servir la entrega.
   * El botón se apaga aquí para que no se llegue ni al diálogo; el corte de
   * verdad está en `HireDialog`, que lo relee de la cadena antes de firmar.
   */
  const sinCanal = canalDe(agent) === 'ninguno';

  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
    } catch {
      /* portapapeles no disponible */
    }
    toast(t('hireCard.linkCopied'), { icon: <Check size={14} className="text-olive" /> });
  };

  return (
    <motion.aside
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.8, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className="rounded-2xl border border-line bg-paper p-6 shadow-card lg:sticky lg:top-24"
    >
      <p className="eyebrow text-ink-3">{t('filters.pricePerTask')}</p>
      <div className="mt-3 flex items-baseline gap-3">
        <span className="font-display text-[2rem] font-bold leading-none tracking-[-0.02em] text-ink">
          {formatMon(agent.pricePerTask)} {isOnchainAgent(agent) ? currencySymbol(agent.currency) : 'MON'}
        </span>
      </div>

      {stats && (
        <p className="mt-4 font-mono text-[12px] leading-relaxed text-ink-2">
          {t('hireCard.completedTasks', { count: formatInt(stats.completed) })}
        </p>
      )}

      <button
        type="button"
        onClick={onHire}
        disabled={sinCanal}
        className="btn-monad mt-5 inline-flex w-full px-5 py-3.5 text-[0.9375rem] font-semibold disabled:cursor-not-allowed disabled:opacity-40"
      >
        {t(priceKey('detail.cta.hireNow', agent), { price: formatMon(agent.pricePerTask) })}
      </button>

      {sinCanal ? (
        <p className="mt-2.5 flex items-start gap-2 text-[0.8125rem] leading-[1.5] text-ink-2">
          <PlugZap size={15} className="mt-0.5 shrink-0 text-terra" aria-hidden />
          {t('detail.sinCanal')}
        </p>
      ) : (
        /* Preguntar antes de encargar. Cuesta céntimos y responde al momento;
           encargar bloquea el pago y da entrega verificable. Lo normal es lo
           primero y luego, si merece la pena, lo segundo. Sin endpoint no hay
           ninguna de las dos: el chat se le pide a esa misma URL. */
        <Link
          to={`/chat/${agent.id}`}
          className="mt-2.5 inline-flex w-full items-center justify-center gap-2 rounded-full border border-line px-5 py-3 text-[0.875rem] font-medium text-ink-2 transition-colors duration-200 hover:border-honey hover:text-ink"
        >
          <MessageCircle size={15} aria-hidden />
          {t('chat.talkTo', { name: agent.name })}
        </Link>
      )}

      {/* estado de wallet */}
      <div className="mt-3 flex justify-center">
        {connected ? (
          <span className="inline-flex items-center gap-2 font-mono text-[12px] text-ink-2">
            <LiveDot variant="olive" ping={false} />
            {t('hireCard.connected', { address: addressShort })}
          </span>
        ) : (
          <button
            type="button"
            onClick={connect}
            disabled={connecting}
            className="font-mono text-[12px] text-ink-3 underline decoration-dotted underline-offset-4 transition-colors hover:text-honey-deep disabled:opacity-50"
          >
            {connecting ? t('hireCard.connecting') : t('hireCard.connectPrompt')}
          </button>
        )}
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => setSaved((s) => !s)}
          aria-pressed={saved}
          className={cn(
            'flex flex-1 items-center justify-center gap-2 rounded-full border px-4 py-2.5 text-[0.8125rem] font-medium transition-colors duration-200',
            saved ? 'border-honey bg-honey-soft text-honey-deep' : 'border-line text-ink-2 hover:border-honey',
          )}
        >
          <Bookmark size={14} className={cn(saved && 'fill-honey text-honey')} aria-hidden />
          {saved ? t('hireCard.saved') : t('hireCard.save')}
        </button>
        <button
          type="button"
          onClick={share}
          className="flex flex-1 items-center justify-center gap-2 rounded-full border border-line px-4 py-2.5 text-[0.8125rem] font-medium text-ink-2 transition-colors duration-200 hover:border-honey"
        >
          <Share2 size={14} aria-hidden />
          {t('hireCard.share')}
        </button>
      </div>

      <p className="mt-5 flex items-start gap-2 border-t border-line pt-4 text-[0.8125rem] leading-[1.5] text-ink-2">
        <Shield size={15} className="mt-0.5 shrink-0 text-honey-deep" aria-hidden />
        {t('hireCard.escrowNote')}
      </p>
    </motion.aside>
  );
}

/**
 * Barra fija inferior en móvil (agente.md Notas): h-16, blur, precio + CTA.
 * Visible tras 300px de scroll, slide-up .3s.
 */
export function MobileHireBar({ agent, onHire }: HireCardProps) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const sinCanal = canalDe(agent) === 'ninguno';

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 300);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: 64, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 64, opacity: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-center justify-between gap-4 border-t border-line bg-paper/90 px-4 backdrop-blur-md lg:hidden"
        >
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-[0.9375rem] font-semibold text-ink">{formatMon(agent.pricePerTask)}</span>
            <span className="text-[0.75rem] text-ink-3">
              {t(isOnchainAgent(agent) && currencySymbol(agent.currency) === '$PANAL' ? 'common.tokenTask' : 'common.monTask')}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {!sinCanal && (
              <Link
                to={`/chat/${agent.id}`}
                aria-label={t('chat.talkTo', { name: agent.name })}
                className="flex size-10 items-center justify-center rounded-full border border-line text-ink-2 transition-colors duration-200 hover:border-honey hover:text-ink"
              >
                <MessageCircle size={16} aria-hidden />
              </Link>
            )}
            <button
              type="button"
              onClick={onHire}
              disabled={sinCanal}
              className="btn-monad inline-flex px-6 py-2.5 text-[0.875rem] font-semibold disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t('common.hire')}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
