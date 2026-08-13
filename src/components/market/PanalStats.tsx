/**
 * Panal — cómo se está usando el $PANAL en la red.
 *
 * Van en el MERCADO, no en el panel: son de la red, no de quien mira. El panel
 * responde "qué he gastado yo"; esto responde "se usa esto de verdad".
 *
 * Las cuatro salen de datos que ya existen —los días del indexador y el volumen
 * por moneda de cada agente—, así que no cuestan ni una llamada RPC de más.
 *
 * NO se enseña el supply como si fuera circulante. Son mil millones, y hoy casi
 * todos están en una sola cartera: pintarlo como si circulara sería el tipo de
 * cifra que queda bien y engaña.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeftRight, Hexagon, TrendingUp, Users } from 'lucide-react';
import { formatEther } from 'viem';
import { useIndexStats } from '@/lib/indexer';
import { usePanalAgents } from '@/hooks/usePanalAgents';
import { IS_MAINNET, PANAL_TOKEN_ADDRESS } from '@/contracts/config';

const compacto = (n: number): string =>
  new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 }).format(n);

/** Suma un campo en wei de una serie de días, sin perder precisión por el camino. */
function sumaWei(dias: { panalMoved: string }[]): number {
  const total = dias.reduce((acc, d) => acc + BigInt(d.panalMoved || '0'), 0n);
  return Number(formatEther(total));
}

export default function PanalStats() {
  const { t } = useTranslation();
  const { stats } = useIndexStats();
  const { agents } = usePanalAgents();

  const datos = useMemo(() => {
    const mes = stats ? sumaWei(stats.daily30) : 0;
    const semana = stats ? sumaWei(stats.daily7) : 0;

    const onchain = agents.filter((a) => 'currency' in a);
    const enPanal = onchain.filter(
      (a) => String(a.currency).toLowerCase() === PANAL_TOKEN_ADDRESS.toLowerCase(),
    ).length;

    // Lo cobrado desde siempre, sumando el volumen en $PANAL de cada agente.
    // Es lo que de verdad han ganado trabajando, no lo que se ha repartido.
    const ganado = onchain.reduce(
      (acc, a) => acc + BigInt(a.indexStats?.volume?.['$PANAL'] ?? '0'),
      0n,
    );

    return { mes, semana, enPanal, total: onchain.length, ganado: Number(formatEther(ganado)) };
  }, [stats, agents]);

  if (!IS_MAINNET) return null;

  const celdas = [
    { icono: TrendingUp, etiqueta: t('token.stats.moved30'), valor: `${compacto(datos.mes)} $PANAL` },
    { icono: ArrowLeftRight, etiqueta: t('token.stats.moved7'), valor: `${compacto(datos.semana)} $PANAL` },
    {
      icono: Users,
      etiqueta: t('token.stats.pricedIn'),
      valor: `${datos.enPanal} / ${datos.total}`,
    },
    { icono: Hexagon, etiqueta: t('token.stats.earned'), valor: `${compacto(datos.ganado)} $PANAL` },
  ];

  return (
    <div className="rounded-2xl border border-line bg-paper p-5 shadow-card md:p-6">
      <p className="font-display text-[0.9375rem] font-semibold text-ink">{t('token.stats.title')}</p>
      <p className="mt-1 text-[0.8125rem] text-ink-3">{t('token.stats.sub')}</p>

      <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {celdas.map(({ icono: Icono, etiqueta, valor }) => (
          <div key={etiqueta} className="rounded-xl border border-line bg-sand/40 p-4">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-honey-soft">
              <Icono size={15} className="text-honey-deep" aria-hidden />
            </span>
            <p className="mt-3 font-display text-[1.15rem] font-semibold tracking-[-0.02em] text-ink">{valor}</p>
            <p className="mt-0.5 text-[0.75rem] leading-snug text-ink-3">{etiqueta}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
