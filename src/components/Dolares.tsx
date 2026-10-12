/**
 * «≈ $0.075»: lo que vale en dólares una cantidad en MON o en $PANAL.
 *
 * Al precio de ahora y con su fecha en el título: quien pase el ratón ve de
 * cuándo es el precio y de dónde sale. Con un precio de más de cinco minutos,
 * o sin precio, no se pinta nada —o, con `avisarSinPrecio`, que no lo hay—:
 * nunca un número viejo sin decirlo.
 *
 * Las monedas estables (GHO, USDC, AUSD) ya son dólares y no llevan nada.
 */

import { useTranslation } from 'react-i18next';
import { enDolares, formatearDolares, type FuentePrecio } from '@panal/sdk';
import { useAhora } from '@/hooks/useAhora';
import { usePrecios } from '@/hooks/usePrecios';
import { cn } from '@/lib/utils';

const FUENTE: Record<FuentePrecio, string> = {
  pyth: 'Pyth',
  coingecko: 'CoinGecko',
  'nadfun-curva': 'nad.fun',
  'nadfun-api': 'nad.fun',
};

export interface DolaresProps {
  /** En unidades mínimas (18 decimales). */
  cantidad: bigint;
  /** El símbolo tal como lo pinta la web: `MON` o `$PANAL`. */
  moneda: string;
  /** Si no hay precio, decirlo en vez de no pintar nada. Para donde se decide. */
  avisarSinPrecio?: boolean;
  className?: string;
}

export default function Dolares({ cantidad, moneda, avisarSinPrecio, className }: DolaresProps) {
  const { t } = useTranslation();
  const precios = usePrecios();
  // Con el reloj del componente: un precio que envejece mientras se mira la
  // página deja de pintarse a los cinco minutos, sin esperar a otro render.
  const ahora = useAhora(10_000);
  if (moneda !== 'MON' && moneda !== '$PANAL') return null;

  const d = enDolares(cantidad, moneda, precios, ahora);
  if (!d) {
    if (!avisarSinPrecio) return null;
    return <span className={cn('text-[0.75rem] text-ink-3', className)}>{t('dolares.noDisponible')}</span>;
  }
  const segundos = Math.max(0, ahora - d.actualizado);
  return (
    <span
      className={cn('font-mono text-[0.75rem] text-ink-3', className)}
      title={t('dolares.hace', { segundos, fuente: FUENTE[d.fuente] })}
    >
      ≈ {formatearDolares(d.usd)}
    </span>
  );
}
