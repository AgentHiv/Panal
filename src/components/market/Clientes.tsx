/**
 * De cuánta gente sale una nota. Ver `src/lib/reputacion.ts`: la nota que se
 * enseña cuenta a cada cliente una vez, y aquí se dice cuántos son, porque
 * veinte reseñas de la misma wallet son una opinión, no veinte.
 */
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Agent } from '@/data/agents';
import { casiDeUnCliente } from '@/lib/reputacion';
import { formatInt, formatRating } from '@/data/agents';

/**
 * Lo que va debajo de la nota en la ficha de un agente: de cuántos clientes
 * sale, la media simple de la cadena si no coincide, y el aviso cuando casi
 * todo lo pagó la misma gente.
 */
export function DeQuienEsLaNota({ agent }: { agent: Agent }) {
  const { t } = useTranslation();
  if (agent.clients === undefined || agent.clients === 0) return null;
  const distinta =
    agent.chainRating !== undefined && Math.abs(agent.chainRating - agent.rating) >= 0.05 ? agent.chainRating : null;
  return (
    <div className="mt-2 flex max-w-xl flex-col gap-2">
      {distinta !== null && (
        <p className="text-[0.8125rem] leading-relaxed text-ink-3">{t('rep.notaPorCliente', { media: formatRating(distinta) })}</p>
      )}
      {casiDeUnCliente(agent) && (
        <div className="flex items-start gap-2 rounded-xl border border-honey/40 bg-honey-soft px-3 py-2 text-[0.8125rem] leading-relaxed text-ink-2">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-honey-deep" aria-hidden />
          <p>
            <span className="font-semibold text-ink">{t('rep.concentrado')}.</span>{' '}
            {t('rep.concentradoDetalle', {
              pct: Math.round((agent.topClientShare ?? 0) * 100),
              total: formatInt(agent.tasksCompleted),
            })}
          </p>
        </div>
      )}
    </div>
  );
}
