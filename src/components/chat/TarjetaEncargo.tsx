/**
 * Panal — un encargo, dentro de la conversación.
 *
 * No es una burbuja de chat y no debe parecerlo: un mensaje cuesta céntimos y
 * se responde al momento; un encargo bloquea el pago, tiene plazo, entrega
 * verificable y derecho a disputa. Se ve distinto porque ES distinto.
 *
 * Lo que se enseña sale de la CADENA, así que el estado es el de verdad y no
 * una copia local que se queda vieja. Lo único que puede faltar es el texto de
 * lo que se pidió: on-chain sólo viaja su hash, y el texto se guardó en el
 * navegador desde el que se contrató. Cuando no está, se dice.
 */

import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { formatUnits } from 'viem';
import { FileText } from 'lucide-react';
import { ESTADO, type EncargoEnHilo } from '@/lib/conversaciones';
import { cn } from '@/lib/utils';

/** Cómo se llama y de qué color va cada estado del escrow. */
function estadoDe(estado: number): { clave: string; color: string } {
  switch (estado) {
    case ESTADO.Entregado:
      return { clave: 'chat.order.delivered', color: 'bg-monad/15 text-monad-mist' };
    case ESTADO.Completado:
      return { clave: 'chat.order.completed', color: 'bg-olive/15 text-olive' };
    case ESTADO.Disputado:
      return { clave: 'chat.order.disputed', color: 'bg-terra/15 text-terra' };
    case ESTADO.Cancelado:
      return { clave: 'chat.order.cancelled', color: 'bg-line text-ink-3' };
    default:
      return { clave: 'chat.order.open', color: 'bg-honey/15 text-honey' };
  }
}

export default function TarjetaEncargo({ encargo }: { encargo: EncargoEnHilo }) {
  const { t } = useTranslation();
  const { clave, color } = estadoDe(encargo.estado);
  const importe = `${formatUnits(BigInt(encargo.importe), 18)} ${encargo.simbolo}`;

  return (
    <div className="mx-auto w-full max-w-[92%] rounded-2xl border border-line bg-sand/60 px-4 py-3.5">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-[0.8125rem] font-semibold text-ink">
          <FileText className="size-3.5 text-ink-3" aria-hidden />
          {t('chat.order.title', { id: encargo.id })}
        </span>
        <span className={cn('shrink-0 rounded-full px-2.5 py-0.5 text-[0.6875rem] font-medium', color)}>
          {t(clave)}
        </span>
      </div>

      {encargo.brief ? (
        <p className="mt-2.5 whitespace-pre-wrap break-words text-[0.875rem] leading-relaxed text-ink-2">
          {encargo.brief}
        </p>
      ) : (
        <p className="mt-2.5 text-[0.8125rem] italic leading-relaxed text-ink-3">
          {t('chat.order.noBrief')}
        </p>
      )}

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-2.5">
        <span className="font-mono text-[0.75rem] text-ink-3">
          {t('chat.order.locked', { amount: importe })}
        </span>
        <Link
          to="/dashboard"
          className="shrink-0 text-[0.75rem] font-medium text-honey transition-colors hover:text-honey-deep"
        >
          {t('chat.order.follow')}
        </Link>
      </div>
    </div>
  );
}
