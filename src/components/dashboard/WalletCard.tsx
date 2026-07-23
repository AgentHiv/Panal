/**
 * Panal — Card de wallet del dashboard (dashboard.md S2).
 * 3 bloques mono (Disponible / En escrow / Total ganado) + sparkline 30d +
 * botones "Enviar" / "Recibir" (Recibir abre Dialog con QR mock y copia).
 */

import { useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useWallet } from '@/hooks/useWallet';
import { WalletSparkline } from './charts';
import { WALLET_SUMMARY, formatMonEs } from './data';

/** QR mock determinista a partir de la dirección (sin dependencias extra). */
function MockQr({ seed, size = 168 }: { seed: string; size?: number }) {
  const cells = 21;
  const grid = useMemo(() => {
    let h = 2166136261;
    const next = () => {
      h ^= h << 13;
      h ^= h >>> 17;
      h ^= h << 5;
      return (h >>> 0) / 4294967295;
    };
    for (let i = 0; i < seed.length; i++) h = (h ^ seed.charCodeAt(i)) >>> 0;
    const g: boolean[][] = [];
    for (let y = 0; y < cells; y++) {
      const row: boolean[] = [];
      for (let x = 0; x < cells; x++) row.push(next() > 0.52);
      g.push(row);
    }
    // esquinas de anclaje estilo QR
    const anchor = (ox: number, oy: number) => {
      for (let y = 0; y < 7; y++)
        for (let x = 0; x < 7; x++) {
          const edge = x === 0 || x === 6 || y === 0 || y === 6;
          const core = x >= 2 && x <= 4 && y >= 2 && y <= 4;
          g[oy + y][ox + x] = edge || core;
        }
    };
    anchor(0, 0);
    anchor(cells - 7, 0);
    anchor(0, cells - 7);
    return g;
  }, [seed]);

  const cell = size / cells;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="rounded-lg border border-line bg-paper p-0" role="img" aria-label="Código QR de la dirección">
      <rect width={size} height={size} fill="#FAF7F1" />
      {grid.flatMap((row, y) =>
        row.map((on, x) =>
          on ? <rect key={`${x}-${y}`} x={x * cell} y={y * cell} width={cell + 0.4} height={cell + 0.4} fill="#1B1814" /> : null,
        ),
      )}
      <polygon
        points={`${size / 2},${size / 2 - 12} ${size / 2 + 10.4},${size / 2 - 6} ${size / 2 + 10.4},${size / 2 + 6} ${size / 2},${size / 2 + 12} ${size / 2 - 10.4},${size / 2 + 6} ${size / 2 - 10.4},${size / 2 - 6}`}
        fill="#E29A2E"
        stroke="#FAF7F1"
        strokeWidth={2}
      />
    </svg>
  );
}

function WalletBlock({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="eyebrow text-ink-3">{label}</span>
      <span className="font-mono text-[1.35rem] font-medium leading-tight text-ink md:text-[1.6rem]">
        {value}
        <span className="ml-1.5 text-[0.6em] text-ink-3">MON</span>
      </span>
      {hint && <span className="text-[0.8125rem] text-ink-3">{hint}</span>}
    </div>
  );
}

export default function WalletCard() {
  const { address, addressShort } = useWallet();
  const addr = address ?? '0x7A4f9e2B8c3D5a7F1b6E4d8C2a0F9e3B7c5Df9B2';
  const addrShort = addressShort ?? '0x7A4f…f9B2';
  const [copied, setCopied] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [sending, setSending] = useState(false);

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(addr);
    } catch {
      /* portapapeles no disponible */
    }
    setCopied(true);
    toast('Dirección copiada', { icon: <Check size={14} className="text-olive" /> });
    window.setTimeout(() => setCopied(false), 1600);
  };

  const fakeSend = (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    window.setTimeout(() => {
      setSending(false);
      setSendOpen(false);
      toast('Envío simulado confirmado', {
        description: 'La transacción se ha firmado y propagado a Monad (demo).',
      });
    }, 1200);
  };

  return (
    <div className="rounded-2xl border border-line bg-paper p-6 shadow-card md:p-7">
      <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
        {/* 3 bloques mono */}
        <div className="grid flex-1 grid-cols-1 gap-6 sm:grid-cols-3 sm:gap-8">
          <WalletBlock label="Disponible" value={formatMonEs(WALLET_SUMMARY.disponible)} />
          <WalletBlock label="En escrow" value={formatMonEs(WALLET_SUMMARY.escrow)} hint="se auto-libera en 72 h" />
          <WalletBlock label="Total ganado" value={formatMonEs(WALLET_SUMMARY.totalGanado)} hint="desde nov 2025" />
        </div>

        {/* Sparkline + acciones */}
        <div className="flex items-center gap-6">
          <div className="flex flex-col items-end gap-1">
            <span className="eyebrow text-ink-3">Saldo · 30 días</span>
            <WalletSparkline data={WALLET_SUMMARY.spark30d} />
          </div>
          <div className="flex flex-col gap-2">
            {/* Enviar */}
            <Dialog open={sendOpen} onOpenChange={setSendOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="rounded-full border-line bg-transparent font-mono text-[0.8125rem] hover:bg-cream">
                  <ArrowUpRight size={14} className="mr-1.5" />
                  Enviar
                </Button>
              </DialogTrigger>
              <DialogContent className="border-line bg-paper sm:max-w-md">
                <DialogHeader>
                  <DialogTitle className="font-display text-ink">Enviar MON</DialogTitle>
                  <DialogDescription className="text-ink-2">
                    Transferencia simulada desde {addrShort} — sin fondos reales.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={fakeSend} className="flex flex-col gap-4">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[0.8125rem] font-medium text-ink-2">Dirección destino</span>
                    <Input required placeholder="0x…" className="rounded-xl border-line bg-paper font-mono text-[0.8125rem]" />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[0.8125rem] font-medium text-ink-2">Cantidad (MON)</span>
                    <Input required type="number" min="0.001" step="0.001" placeholder="0.010" className="rounded-xl border-line bg-paper font-mono text-[0.8125rem]" />
                  </label>
                  <Button type="submit" disabled={sending} className="rounded-full bg-ink text-paper hover:bg-honey-deep">
                    {sending ? 'Firmando…' : 'Confirmar envío'}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>

            {/* Recibir → QR mock + copia */}
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="rounded-full border-line bg-transparent font-mono text-[0.8125rem] hover:bg-cream">
                  <ArrowDownLeft size={14} className="mr-1.5" />
                  Recibir
                </Button>
              </DialogTrigger>
              <DialogContent className="border-line bg-paper sm:max-w-sm">
                <DialogHeader>
                  <DialogTitle className="font-display text-ink">Recibir MON</DialogTitle>
                  <DialogDescription className="text-ink-2">
                    Comparte tu dirección del panal (red Monad · Chain ID 143).
                  </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col items-center gap-4 py-2">
                  <MockQr seed={addr} />
                  <button
                    type="button"
                    onClick={copyAddress}
                    className="group inline-flex max-w-full items-center gap-2 rounded-full border border-line bg-cream px-4 py-2 font-mono text-[0.75rem] text-ink-2 transition-colors hover:border-honey hover:text-ink"
                  >
                    <span className="truncate">{addr}</span>
                    {copied ? <Check size={13} className="shrink-0 text-olive" /> : <Copy size={13} className="shrink-0 opacity-50 group-hover:opacity-100" />}
                  </button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>
    </div>
  );
}
