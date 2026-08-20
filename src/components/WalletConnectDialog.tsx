/**
 * Panal — la pantalla de WalletConnect, nuestra.
 *
 * El conector puede abrir el modal de Reown (AppKit) por su cuenta, y no lo
 * hace: se le pasa `showQrModal: false` y él se limita a emitir la URI de la
 * sesión. Lo que se ve aquí lo pintamos nosotros, por tres razones —el modal
 * ajeno viene en inglés dentro de una web que se cuida en diez idiomas, trae
 * su propia estética, y arrastra un catálogo de wallets que se descarga de una
 * API que hay que tener dada de alta.
 *
 * Dos caminos según dónde esté la persona:
 *
 *   - ESCRITORIO. Un QR con la URI. Lo escanea el teléfono.
 *   - MÓVIL. Un QR no sirve —el teléfono no puede escanear su propia
 *     pantalla—, así que se abre la app instalada con un enlace universal.
 *
 * Y en los dos, copiar la URI a mano, que funciona con cualquier wallet que no
 * esté en la lista.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import { Check, Copy, Loader2, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { WALLETS_MOVIL, enlaceWallet, esMovil } from '@/lib/deepLinks';

export interface WalletConnectDialogProps {
  /** La URI de la sesión, o null mientras el conector todavía la prepara. */
  uri: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function WalletConnectDialog({ uri, open, onOpenChange }: WalletConnectDialogProps) {
  const { t } = useTranslation();
  /**
   * El QR va con SU uri al lado.
   *
   * Guardar solo la imagen obligaba a limpiarla desde el efecto cuando la uri
   * cambiaba, y eso son renders en cascada. Llevándolas juntas, al pintar se
   * compara: un QR de una sesión anterior sencillamente no se enseña.
   */
  const [qr, setQr] = useState<{ uri: string; dataUrl: string } | null>(null);
  const [copiado, setCopiado] = useState(false);
  const movil = esMovil();

  // El QR solo hace falta en escritorio, y se regenera si la URI cambia: una
  // sesión caducada y su QR viejo se parecen demasiado.
  useEffect(() => {
    if (!uri || movil) return;
    let vigente = true;
    void QRCode.toDataURL(uri, { margin: 1, width: 320, color: { dark: '#1B1814', light: '#E9E4FF' } })
      .then((dataUrl) => {
        if (vigente) setQr({ uri, dataUrl });
      })
      .catch(() => {
        /* Sin QR queda la copia manual, que funciona igual. */
      });
    return () => {
      vigente = false;
    };
  }, [uri, movil]);

  /** Solo vale el QR de ESTA sesión; el de una anterior no se enseña. */
  const qrVigente = qr && qr.uri === uri ? qr.dataUrl : null;

  const copiar = (): void => {
    if (!uri) return;
    void navigator.clipboard.writeText(uri).then(() => {
      setCopiado(true);
      toast(t('wallet.wc.copied'));
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(abierto) => {
        // Se limpia aquí y no en un efecto: cerrar es un evento, y reaccionar
        // a él con setState desde un efecto son renders en cascada.
        if (!abierto) setCopiado(false);
        onOpenChange(abierto);
      }}
    >
      <DialogContent className="max-w-md border-line bg-paper p-0 sm:rounded-2xl">
        <div className="flex flex-col items-center gap-5 px-7 py-8">
          <div className="space-y-2 text-center">
            <DialogTitle className="font-display text-2xl font-semibold text-ink">
              {movil ? t('wallet.wc.titleMobile') : t('wallet.wc.title')}
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed text-ink-2">
              {movil ? t('wallet.wc.descMobile') : t('wallet.wc.desc')}
            </DialogDescription>
          </div>

          {/* Sin URI todavía: el conector está levantando la sesión contra el
              relé. Dura un instante, pero un hueco en blanco parece un fallo. */}
          {!uri ? (
            <div className="flex flex-col items-center gap-3 py-10 text-ink-3">
              <Loader2 className="size-6 animate-spin" aria-hidden />
              <span className="text-[0.8125rem]">{t('wallet.wc.preparing')}</span>
            </div>
          ) : movil ? (
            <div className="flex w-full flex-col gap-3">
              {WALLETS_MOVIL.map((w) => (
                <Button
                  key={w.id}
                  size="lg"
                  variant={w.id === 'metamask' ? 'default' : 'outline'}
                  className="w-full gap-2"
                  // Enlace directo, no window.open: en iOS una pestaña nueva
                  // se interpone entre el toque y la app, y a veces la bloquea.
                  onClick={() => {
                    window.location.href = enlaceWallet(w.id, uri);
                  }}
                >
                  <Smartphone className="size-4" aria-hidden />
                  {t('wallet.wc.openIn', { name: w.nombre })}
                </Button>
              ))}
            </div>
          ) : qrVigente ? (
            <img
              src={qrVigente}
              alt={t('wallet.wc.qrAlt')}
              className="size-64 rounded-xl border border-line bg-cream p-2"
            />
          ) : (
            <div className="grid size-64 place-items-center rounded-xl border border-line bg-cream">
              <Loader2 className="size-6 animate-spin text-ink-3" aria-hidden />
            </div>
          )}

          {uri && (
            <>
              {/* El aviso más importante de la pantalla. La sesión se cierra
                  por el relé, no por esta pestaña: en iOS la wallet no siempre
                  devuelve sola, y sin esta frase la persona se queda mirando
                  MetaMask creyendo que no ha pasado nada. */}
              <p className="flex items-center gap-2 text-[0.8125rem] text-ink-2">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                {t('wallet.wc.waiting')}
              </p>

              <button
                type="button"
                onClick={copiar}
                className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 text-[0.8125rem] text-ink-2 transition-colors hover:border-honey hover:text-ink"
              >
                {copiado ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
                {t('wallet.wc.copy')}
              </button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
