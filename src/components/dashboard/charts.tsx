/**
 * Panal — la fachada de las gráficas.
 *
 * POR QUÉ HAY DOS ARCHIVOS. `recharts` pesa 512 kB y arrastra `lodash` entero,
 * otros 187: setecientos kilobytes que estaban en el paquete inicial de TODO el
 * sitio, portada incluida, para dibujar dos gráficas que solo existen en el
 * panel y en una tarjeta del mercado.
 *
 * Aquí se quedan la envoltura y `EmptyChart`, que no toca recharts. Lo pesado
 * vive en `charts.impl.tsx` y se descarga cuando de verdad hay una gráfica que
 * pintar. Quien las usa no cambia ni un import: sigue pidiéndolas a este
 * archivo.
 *
 * El `fallback` tiene la ALTURA EXACTA de la gráfica que sustituye. Si no, la
 * página da un salto cuando llega el trozo, y ese salto es peor que la espera:
 * mueve lo que alguien estaba leyendo.
 */

import { Suspense, lazy } from 'react';
import { Hexagon } from 'lucide-react';
import type { EarningsPoint } from './data';

/**
 * Se enseña en vez de una linea plana en cero.
 *
 * Vivia dentro de Dashboard.tsx, y salio de ahi al hacer el grafico de $PANAL:
 * una pagina no deberia ser de donde otros componentes importan sus piezas.
 */
export function EmptyChart({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex h-[280px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-line px-6 text-center">
      <Hexagon size={36} className="text-line" strokeWidth={1.25} aria-hidden />
      <p className="font-display text-[1rem] font-semibold text-ink">{title}</p>
      <p className="max-w-sm text-[0.8125rem] leading-relaxed text-ink-3">{text}</p>
    </div>
  );
}

/* ---------- Lo pesado, a demanda ---------- */

const AreaReal = lazy(() =>
  import('./charts.impl').then((m) => ({ default: m.EarningsAreaChart })),
);
const SparklineReal = lazy(() =>
  import('./charts.impl').then((m) => ({ default: m.WalletSparkline })),
);

/** Un hueco de la misma altura, para que no se mueva nada al llegar. */
function Hueco({ className }: { className?: string }) {
  return <div className={className ?? 'h-[280px] w-full'} aria-hidden />;
}

export function EarningsAreaChart(props: { data: EarningsPoint[]; rangeKey: string; unit?: string }) {
  return (
    <Suspense fallback={<Hueco />}>
      <AreaReal {...props} />
    </Suspense>
  );
}

export function WalletSparkline(props: { data: number[]; width?: number; height?: number; className?: string }) {
  return (
    <Suspense fallback={<Hueco className={props.className} />}>
      <SparklineReal {...props} />
    </Suspense>
  );
}
