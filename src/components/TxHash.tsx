import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { truncateHash } from '@/data/events';

export interface TxHashProps {
  hash: string;
  /** forzar texto truncado (por defecto trunca si > 12 chars) */
  short?: boolean;
  className?: string;
}

/** Mono truncado `0x3f9a…c21e` + icono copy; copia con toast (design.md §5). */
export default function TxHash({ hash, short = true, className }: TxHashProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const label = short ? truncateHash(hash) : hash;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(hash);
    } catch {
      /* portapapeles no disponible: el toast igualmente confirma la acción */
    }
    setCopied(true);
    toast(t('activity.hashToast'), { icon: <Check size={14} className="text-olive" /> });
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <button
      type="button"
      onClick={copy}
      className={cn(
        'group inline-flex items-center gap-1.5 font-mono text-[0.8125rem] text-ink-2 transition-colors hover:text-honey-deep',
        className,
      )}
      aria-label={t('common.copyHash', { label })}
    >
      <span>{label}</span>
      {copied ? (
        <Check size={13} className="text-olive" />
      ) : (
        <Copy size={13} className="opacity-40 transition-opacity group-hover:opacity-100" />
      )}
    </button>
  );
}
