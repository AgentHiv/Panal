/**
 * Panal — cómo va una transacción dentro de un diálogo: firmando, esperando a
 * que se mine y, al final, el enlace al explorador.
 *
 * Lo usan el panel y la tarjeta de encargo del chat, que firman lo mismo.
 */

import { useTranslation } from 'react-i18next';
import { ExternalLink, Loader2 } from 'lucide-react';
import { EXPLORER_TX } from '@/contracts/config';
import type { useContractAction } from '@/hooks/useContractAction';

/** Vista de progreso/éxito de tx dentro de los diálogos. */
export default function TxProgress({
  action,
  onClose,
}: {
  action: ReturnType<typeof useContractAction>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  if (action.mined && action.txHash) {
    return (
      <div className="flex flex-col items-center gap-4 py-4 text-center">
        <p className="font-display text-ink">{t('dashReal.txConfirmed')}</p>
        <a
          href={EXPLORER_TX(action.txHash)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 font-mono text-[12px] text-ink-2 transition-colors hover:border-honey hover:text-honey-deep"
        >
          {t('hire.step3.viewTx')}
          <ExternalLink size={13} />
        </a>
        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-full border border-line px-5 py-3 text-[0.875rem] font-medium text-ink-2 transition-colors hover:border-honey"
        >
          {t('common.close')}
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center">
      <Loader2 size={28} className="animate-spin text-honey-deep" aria-hidden />
      <p className="text-[0.875rem] font-medium text-ink">
        {action.signing ? t('hire.step3.signing') : t('hire.step3.confirming')}
      </p>
      {action.txHash && (
        <a
          href={EXPLORER_TX(action.txHash)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 font-mono text-[12px] text-ink-2 transition-colors hover:border-honey hover:text-honey-deep"
        >
          {t('hire.step3.viewTx')}
          <ExternalLink size={13} />
        </a>
      )}
    </div>
  );
}
