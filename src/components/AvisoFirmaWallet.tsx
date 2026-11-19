/**
 * Panal — «tienes una firma esperando en la wallet».
 *
 * Sale abajo, en un teléfono conectado por WalletConnect, mientras una firma
 * espera en la otra app. `WalletProvider` ya intenta abrir la wallet solo,
 * pero eso puede fallar sin que nadie se entere: el navegador bloquea abrir
 * otra app si no viene justo de un toque, la wallet puede no haber mandado su
 * enlace, o la persona puede volver aquí sin firmar. Sin este aviso la página
 * se queda quieta y parece colgada, que es justo el fallo que se arregla.
 *
 * El botón SÍ es un toque, así que ese camino no lo bloquea nadie.
 */

import { useTranslation } from 'react-i18next';
import { ExternalLink, Loader2 } from 'lucide-react';

export default function AvisoFirmaWallet({
  firma,
  onAbrir,
}: {
  firma: { enlace: string | null; nombre: string } | null;
  onAbrir: (enlace: string) => void;
}) {
  const { t } = useTranslation();
  if (!firma) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[60] rounded-2xl border border-honey/40 bg-paper/95 p-4 shadow-[0_18px_40px_-18px_rgba(0,0,0,0.6)] backdrop-blur"
    >
      <div className="flex items-start gap-3">
        <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-honey" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">{t('wallet.firma.titulo', { wallet: firma.nombre })}</p>
          <p className="mt-0.5 text-[0.8125rem] leading-snug text-ink-2">
            {firma.enlace ? t('wallet.firma.conEnlace') : t('wallet.firma.sinEnlace')}
          </p>
        </div>
      </div>
      {firma.enlace && (
        <button
          type="button"
          onClick={() => onAbrir(firma.enlace!)}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-honey px-4 py-2.5 text-sm font-semibold text-[#1B1814] transition-opacity hover:opacity-90"
        >
          <ExternalLink className="size-4" aria-hidden />
          {t('wallet.firma.abrir', { wallet: firma.nombre })}
        </button>
      )}
    </div>
  );
}
