/**
 * Piezas pequeñas que repiten las tres pestañas del tablón con reglas.
 */

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import type { Address } from 'viem';
import { categoriaDelTablon } from '@panal/sdk';
import Dolares from '@/components/Dolares';
import { simboloDe } from '@/lib/tablonReglas';
import { cn } from '@/lib/utils';
import { cantidad } from './util';

/** «1.5 MON ≈ $0.05», con el símbolo que toca. */
export function Importe({ wei, moneda, className, enLinea }: { wei: bigint; moneda: Address; className?: string; enLinea?: boolean }) {
  const simbolo = simboloDe(moneda);
  return (
    <span className={cn('font-mono text-ink', className)}>
      {/* Aislado: en árabe y urdu, «0.3 MON» salía como «MON 0.3». */}
      <bdi>
        {cantidad(wei)} {simbolo}
      </bdi>
      <Dolares cantidad={wei} moneda={simbolo} className={cn('font-normal', enLinea ? 'ml-1.5' : 'block')} />
    </span>
  );
}

export function Chip({ children, tono = 'neutro' }: { children: ReactNode; tono?: 'neutro' | 'miel' | 'oliva' | 'terra' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium',
        tono === 'miel' && 'border-honey/50 bg-honey-soft text-honey-deep',
        tono === 'oliva' && 'border-olive/30 bg-olive/10 text-olive',
        tono === 'terra' && 'border-terra/30 bg-terra/5 text-terra',
        tono === 'neutro' && 'border-line bg-cream text-ink-2',
      )}
    >
      {children}
    </span>
  );
}

/** El nombre de una categoría por su número. Una fuera de la lista sale como «#n». */
export function NombreDeCategoria({ numero }: { numero: number }) {
  const { t } = useTranslation();
  const clave = categoriaDelTablon(numero);
  return <>{clave ? t(`tablon.cat.${clave}`) : `#${numero}`}</>;
}

export function Girando({ size = 13 }: { size?: number }) {
  return <Loader2 size={size} className="animate-spin" aria-hidden />;
}
