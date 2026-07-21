import { memo } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import HexAvatar from '@/components/HexAvatar';
import TxHash from '@/components/TxHash';
import { formatMon } from '@/data/agents';
import { timeAgoEs, truncateHash } from '@/data/events';
import type { LiveEvent } from '@/data/events';
import { EVENT_META } from './meta';
import type { StreamEntry } from './useLiveStream';
import { cn } from '@/lib/utils';

export interface EventCardProps {
  entry: StreamEntry;
  nowMs: number;
  onHover: (ev: LiveEvent | null) => void;
}

function Names({ ev }: { ev: LiveEvent }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
      <HexAvatar seed={ev.from} size={24} />
      <span className="truncate font-medium text-coal-text">{ev.from}</span>
      {ev.to && (
        <>
          <ArrowRight size={12} className="shrink-0 text-coal-mute" aria-hidden />
          <HexAvatar seed={ev.to} size={24} />
          <span className="truncate font-medium text-coal-text">{ev.to}</span>
        </>
      )}
    </span>
  );
}

/** EventCard — coal-2, hairline coal-line, p-4, borde izquierdo 2px del color del tipo. */
function EventCardInner({ entry, nowMs, onHover }: EventCardProps) {
  const { ev, at } = entry;
  const meta = EVENT_META[ev.type];
  const ageSec = ev.secondsAgo + Math.max(0, (nowMs - at) / 1000);

  return (
    <article
      onMouseEnter={() => onHover(ev)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(ev)}
      onBlur={() => onHover(null)}
      className="rounded-xl border border-coal-line bg-coal-2 p-4 transition-colors hover:border-honey/50"
      style={{ borderLeft: `2px solid ${meta.hex}` }}
      aria-label={`${meta.label} · ${timeAgoEs(ageSec)}`}
    >
      {/* Contratación: A → B + monto + badge de relación */}
      {ev.type === 'contratacion' && (
        <>
          <div className="flex items-start justify-between gap-3">
            <Names ev={ev} />
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              {ev.amount !== undefined && (
                <span className="font-mono text-[0.8125rem] text-honey">{formatMon(ev.amount, 5)} MON</span>
              )}
              {ev.relation && (
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[11px] font-medium leading-none',
                    ev.relation === 'agente↔agente'
                      ? 'bg-honey-soft text-honey-deep'
                      : 'bg-sand text-ink',
                  )}
                >
                  {ev.relation}
                </span>
              )}
            </div>
          </div>
          {ev.task && <p className="mt-2 text-[0.875rem] leading-snug text-coal-mute">{ev.task}</p>}
        </>
      )}

      {/* Pago liberado: ✓ monto → agente + nota de fee */}
      {ev.type === 'pago' && (
        <>
          <div className="flex items-center gap-2">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-olive/20">
              <Check size={12} className="text-olive" aria-hidden />
            </span>
            <span className="min-w-0 truncate font-medium text-coal-text">
              <span className="font-mono text-[0.8125rem] text-olive">
                {ev.amount !== undefined ? `${formatMon(ev.amount, 5)} MON` : ''}
              </span>{' '}
              → {ev.to}
            </span>
          </div>
          {ev.task && <p className="mt-2 text-[0.875rem] leading-snug text-coal-mute">{ev.task}</p>}
          <p className="mt-1 text-[11px] text-coal-mute/70">2,5% protocolo</p>
        </>
      )}

      {/* Registro: nuevo agente en el panal */}
      {ev.type === 'registro' && (
        <>
          <div className="flex items-center gap-2">
            <HexAvatar seed={ev.from} size={24} />
            <span className="min-w-0 truncate font-medium text-coal-text">
              Nuevo agente en el panal: «{ev.from}»
            </span>
          </div>
          {ev.task && (
            <p className="mt-2 text-[0.875rem] leading-snug text-coal-mute">
              {ev.task.replace('Nuevo agente en el panal · ', 'Registro on-chain · ')}
            </p>
          )}
        </>
      )}

      {/* Entrega: resultado con hash anclado */}
      {ev.type === 'entrega' && (
        <>
          <div className="flex items-center gap-2">
            <HexAvatar seed={ev.from} size={24} />
            <span className="min-w-0 truncate font-medium text-coal-text">{ev.from} entregó resultado</span>
          </div>
          <p className="mt-2 text-[0.875rem] leading-snug text-coal-mute">
            hash anclado on-chain · <span className="font-mono text-[0.8125rem]">{truncateHash(ev.txHash)}</span>
          </p>
        </>
      )}

      {/* Disputa: caso raro (~2%) */}
      {ev.type === 'disputa' && (
        <>
          <span className="font-medium text-terra">{ev.task?.split(' · ')[0] ?? 'Disputa abierta'}</span>
          <p className="mt-2 text-[0.875rem] leading-snug text-coal-mute">
            {ev.from} vs {ev.to} · jurado convocado
          </p>
        </>
      )}

      {/* Pie: tx + tiempo que envejece en vivo */}
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-coal-line/60 pt-2.5">
        <TxHash hash={ev.txHash} className="text-[11px] text-coal-mute hover:text-honey" />
        <span className="shrink-0 font-mono text-[11px] text-coal-mute">{timeAgoEs(ageSec)}</span>
      </div>
    </article>
  );
}

const EventCard = memo(EventCardInner);
export default EventCard;
