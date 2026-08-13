/**
 * Panal — cuánto $PANAL se mueve en la red, día a día.
 *
 * Es el gemelo del gráfico de MON, con el mismo componente y la misma forma,
 * para que se lean juntos sin tener que aprender dos cosas. La diferencia es de
 * dónde salen los datos: el de MON son las tareas de QUIEN MIRA, y este es la
 * red entera, porque el $PANAL solo lo mueve hoy un agente y una serie por
 * usuario saldría vacía para casi todo el mundo.
 *
 * Los días sin movimiento se dibujan igual, en cero. Saltárselos comprimiría el
 * eje y haría parecer continuo lo que fue un pico suelto.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatEther } from 'viem';
import { EarningsAreaChart, EmptyChart } from '@/components/dashboard/charts';
import type { EarningsPoint } from '@/components/dashboard/data';
import { useIndexStats } from '@/lib/indexer';

/** Cuántos días se pintan. Los mismos que trae `daily30` del indexador. */
const DIAS = 30;

export default function PanalChart() {
  const { t, i18n } = useTranslation();
  const { stats } = useIndexStats();

  const serie = useMemo<EarningsPoint[] | null>(() => {
    if (!stats?.daily30?.length) return null;

    const dias = stats.daily30.slice(-DIAS);
    // Si en 30 días no se movió nada, es más honesto decirlo que pintar una
    // línea plana en cero que parece un gráfico roto.
    const hubo = dias.some((d) => BigInt(d.panalMoved || '0') > 0n);
    if (!hubo) return null;

    return dias.map((d) => ({
      label: new Date(`${d.date}T00:00:00Z`).toLocaleDateString(i18n.language, {
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
      }),
      mon: Number(formatEther(BigInt(d.panalMoved || '0'))),
      tareas: 0,
    }));
  }, [stats, i18n.language]);

  return (
    <div className="rounded-2xl border border-line bg-paper p-6 shadow-card lg:col-span-12">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-[1.125rem] font-semibold tracking-[-0.015em] text-ink">
          {t('dash.panalMoved')}
        </h3>
        <p className="text-[0.8125rem] text-ink-3">{t('dash.panalMovedSub')}</p>
      </div>
      {serie ? (
        <EarningsAreaChart data={serie} rangeKey="panal-30" unit="$PANAL" />
      ) : (
        <EmptyChart title={t('dash.chartEmpty')} text={t('dash.panalMovedEmpty')} />
      )}
    </div>
  );
}
