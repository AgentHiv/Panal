/**
 * Panal — confirmar y firmar un mensaje del chat.
 *
 * Lo que se enseña aquí es la COTIZACIÓN recién pedida, no lo que decía la
 * tarjeta del agente: entre una cosa y la otra el precio puede haber cambiado,
 * y el número que ve la persona tiene que ser el que va a firmar.
 *
 * Y dice en voz alta lo que un chat NO da, porque es lo que distingue esto de
 * un encargo: no queda constancia del contenido en la cadena, así que no hay
 * entrega verificable ni derecho a disputa. Quien quiera eso, encarga.
 */

import { useTranslation } from 'react-i18next';
import { formatUnits } from 'viem';
import { Check, ShieldQuestion } from 'lucide-react';
import type { X402Accept } from '@panal/sdk';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

export interface FirmarMensajeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** La cotización del agente. `null` mientras no hay ninguna pedida. */
  cotizacion: X402Accept | null;
  nombre: string;
  onConfirmar: () => void;
}

export default function FirmarMensajeDialog({
  open,
  onOpenChange,
  cotizacion,
  nombre,
  onConfirmar,
}: FirmarMensajeDialogProps) {
  const { t } = useTranslation();
  if (!cotizacion) return null;

  const importe = `${formatUnits(BigInt(cotizacion.amount), 18)} ${cotizacion.assetSymbol ?? '$PANAL'}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-line bg-paper p-0 sm:rounded-2xl">
        <div className="flex flex-col gap-5 px-7 py-8">
          <div className="space-y-2">
            <DialogTitle className="font-display text-2xl font-semibold text-ink">
              {t('chat.sign.title')}
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed text-ink-2">
              {t('chat.sign.desc')}
            </DialogDescription>
          </div>

          <div className="divide-y divide-line overflow-hidden rounded-xl border border-line">
            <div className="flex items-center justify-between px-4 py-3.5">
              <span className="text-[0.8125rem] text-ink-2">{t('chat.sign.agent')}</span>
              <span className="text-[0.875rem] font-medium text-ink">{nombre}</span>
            </div>
            <div className="flex items-center justify-between px-4 py-3.5">
              <span className="text-[0.8125rem] text-ink-2">{t('chat.sign.cost')}</span>
              <span className="font-mono text-[0.9375rem] text-ink">{importe}</span>
            </div>
            <div className="flex items-center justify-between px-4 py-3.5">
              <span className="text-[0.8125rem] text-ink-2">{t('chat.sign.gas')}</span>
              <span className="text-[0.8125rem] font-medium text-olive">{t('chat.sign.gasAgent')}</span>
            </div>
          </div>

          <p className="flex items-start gap-2 rounded-xl bg-sand px-3.5 py-3 text-[0.75rem] leading-relaxed text-ink-3">
            <ShieldQuestion className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t('chat.sign.noProof')}
          </p>

          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="flex-1 rounded-full border border-line py-3 text-[0.9375rem] font-medium text-ink-2 transition-colors hover:border-honey hover:text-ink"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={onConfirmar}
              className="btn-monad inline-flex flex-[1.6] py-3 text-[0.9375rem] font-semibold"
            >
              <Check className="size-4" aria-hidden />
              {t('chat.sign.confirm')}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
