/**
 * Panal — Picker de wallets. Se abre al pulsar "Conectar wallet" cuando hay
 * varias wallets EVM disponibles (MetaMask, Trust Wallet, Rabby… detectadas
 * vía EIP-6963 o por conector dirigido). Cada entrada conecta con su
 * conector wagmi; con una sola wallet instalada se conecta directo y este
 * diálogo no llega a mostrarse.
 */

import { useTranslation } from 'react-i18next';
import { Wallet } from 'lucide-react';
import type { Connector } from 'wagmi';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';

export interface WalletPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectors: Connector[];
  connecting: boolean;
  onSelect: (connector: Connector) => void;
}

/**
 * El icono llega del anuncio EIP-6963 de la wallet: solo se renderiza si es
 * un data URI de imagen o una URL https (nunca javascript: ni esquemas
 * arbitrarios) y dentro de <img>, donde un SVG no ejecuta scripts.
 */
function safeIconSrc(icon: string | undefined): string | null {
  if (!icon) return null;
  return /^(data:image\/|https:\/\/)/.test(icon) ? icon : null;
}

export default function WalletPickerDialog({
  open,
  onOpenChange,
  connectors,
  connecting,
  onSelect,
}: WalletPickerDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-line bg-paper p-0 sm:rounded-2xl">
        <div className="flex flex-col gap-5 px-7 py-8">
          <div className="space-y-2 text-center">
            <DialogTitle className="font-display text-2xl font-semibold text-ink">
              {t('wallet.chooseWallet')}
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed text-ink-2">
              {t('wallet.chooseWalletDesc')}
            </DialogDescription>
          </div>
          <div className="flex w-full flex-col gap-2">
            {connectors.map((c) => {
              const icon = safeIconSrc(c.icon);
              return (
                <button
                  key={c.uid}
                  type="button"
                  disabled={connecting}
                  onClick={() => onSelect(c)}
                  className="flex w-full items-center gap-3 rounded-xl border border-line bg-cream px-4 py-3 text-left transition-colors hover:border-honey disabled:opacity-50"
                >
                  {icon ? (
                    <img src={icon} alt="" className="size-7 rounded-md" />
                  ) : (
                    <span className="grid size-7 place-items-center rounded-md bg-honey/15">
                      <Wallet size={16} className="text-honey-deep" aria-hidden />
                    </span>
                  )}
                  <span className="font-medium text-ink">{c.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
