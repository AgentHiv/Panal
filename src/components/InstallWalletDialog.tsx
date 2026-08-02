/**
 * Panal — Diálogo "Necesitas una wallet".
 * Se abre desde WalletProvider cuando el usuario pulsa "Conectar wallet"
 * sin tener ninguna wallet EVM inyectada (móvil o desktop sin extensión).
 * Ofrece instalar MetaMask o Trust Wallet y, en móvil, abrir la dapp dentro
 * del navegador de cada app vía deep link.
 */

import { useTranslation } from 'react-i18next';
import { ExternalLink, Smartphone } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export interface InstallWalletDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const IS_MOBILE =
  typeof navigator !== 'undefined' && /Android|iPhone|iPad/i.test(navigator.userAgent);

/** window.open siempre con noopener/noreferrer (la pestaña nueva queda aislada). */
function openExternal(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

export default function InstallWalletDialog({ open, onOpenChange }: InstallWalletDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-line bg-paper p-0 sm:rounded-2xl">
        <div className="flex flex-col items-center gap-5 px-7 py-9 text-center">
          <div className="grid size-20 place-items-center rounded-2xl bg-honey/15">
            <img src="/logo.svg" alt="" className="size-12" />
          </div>
          <div className="space-y-2">
            <DialogTitle className="font-display text-2xl font-semibold text-ink">
              {t('wallet.needWallet')}
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed text-ink-2">
              {t('wallet.needWalletDesc')}
            </DialogDescription>
          </div>
          <div className="flex w-full flex-col gap-3">
            {IS_MOBILE ? (
              <>
                <Button
                  size="lg"
                  className="w-full gap-2"
                  onClick={() =>
                    openExternal(`https://metamask.app.link/dapp/${window.location.host}`)
                  }
                >
                  <Smartphone className="size-4" />
                  {t('wallet.openInMetamask')}
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="w-full gap-2"
                  onClick={() =>
                    openExternal(
                      `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(window.location.href)}`,
                    )
                  }
                >
                  <Smartphone className="size-4" />
                  {t('wallet.openInTrust')}
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="lg"
                  className="w-full gap-2"
                  onClick={() => openExternal('https://metamask.io/download')}
                >
                  <ExternalLink className="size-4" />
                  {t('wallet.installMetamask')}
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="w-full gap-2"
                  onClick={() => openExternal('https://trustwallet.com/download')}
                >
                  <ExternalLink className="size-4" />
                  {t('wallet.installTrust')}
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
