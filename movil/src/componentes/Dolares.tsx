/**
 * «≈ $0.075» en la app: lo que vale en dólares una cantidad en MON o $PANAL.
 *
 * El mismo precio que la web —`usePrecios`, compartido por el alias `@/`—:
 * MON de Pyth y $PANAL de la curva de nad.fun, leídos en la cadena. Se
 * refresca cada 30 s mientras la app está a la vista. Con un precio de más de
 * cinco minutos, o sin precio, no se pinta nada, o con `avisarSinPrecio` se
 * dice que no lo hay: nunca un número viejo sin decirlo.
 *
 * Las estables (GHO, USDC, AUSD) ya son dólares y no llevan nada.
 */

import { enDolares, formatearDolares, type FuentePrecio } from '@panal/sdk';
import { useAhora } from '@/hooks/useAhora';
import { usePrecios } from '@/hooks/usePrecios';
import { useTextos } from '~/i18n/idiomas';

const FUENTE: Record<FuentePrecio, string> = {
  pyth: 'Pyth',
  coingecko: 'CoinGecko',
  'nadfun-curva': 'nad.fun',
  'nadfun-api': 'nad.fun',
};

export default function Dolares({
  wei,
  simbolo,
  avisarSinPrecio,
  className = '',
}: {
  wei: bigint;
  simbolo: string;
  avisarSinPrecio?: boolean;
  className?: string;
}): React.ReactElement | null {
  const T = useTextos();
  const precios = usePrecios();
  const ahora = useAhora(10_000);
  if (simbolo !== 'MON' && simbolo !== '$PANAL') return null;

  const d = enDolares(wei, simbolo, precios, ahora);
  if (!d) {
    if (!avisarSinPrecio) return null;
    return <span className={`text-[11.5px] text-ink-3 ${className}`}>{T.comun.sinPrecioDolares}</span>;
  }
  return (
    <span
      className={`font-mono text-[11.5px] text-ink-3 ${className}`}
      title={T.comun.precioDeHace(Math.max(0, ahora - d.actualizado), FUENTE[d.fuente])}
    >
      ≈ {formatearDolares(d.usd)}
    </span>
  );
}
