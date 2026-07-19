import { useState } from 'react';
import { ArrowUpRight, Check, Copy, FileCode2 } from 'lucide-react';
import { toast } from 'sonner';
import type { ContractInfo } from '@/data/protocol';
import { cn } from '@/lib/utils';

export interface ContractChipProps {
  contract: ContractInfo;
  className?: string;
}

/**
 * Chip de contrato (protocolo.md S1): pill mono con hairline, icono FileCode2,
 * copy de la dirección (toast) y link a MonadVision. Hover: y -2 + borde honey.
 */
export default function ContractChip({ contract, className }: ContractChipProps) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(contract.address);
    } catch {
      /* portapapeles no disponible: el toast igualmente confirma la acción */
    }
    setCopied(true);
    toast('Hash copiado', { icon: <Check size={14} className="text-olive" /> });
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className={cn('inline-flex', className)}>
      <div className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-full border border-line bg-paper px-4 py-2 font-mono text-[12px] text-ink-2 transition-[transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-honey">
        <FileCode2 size={14} className="text-honey-deep" aria-hidden />
        <span className="font-semibold text-ink">{contract.name}</span>
        <span className="text-ink-3">{contract.addressShort}</span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center text-ink-3 transition-colors hover:text-honey-deep"
          aria-label={`Copiar dirección de ${contract.name}`}
        >
          {copied ? <Check size={12} className="text-olive" /> : <Copy size={12} />}
        </button>
        <span className="h-3.5 w-px bg-line" aria-hidden />
        <a
          href={`https://monadvision.com/address/${contract.address}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-0.5 text-honey-deep transition-colors hover:text-honey"
        >
          MonadVision
          <ArrowUpRight size={11} aria-hidden />
        </a>
      </div>
    </div>
  );
}
