/**
 * Panal — Gráficas del dashboard alimentadas con datos reales.
 * EarningsAreaChart (serie acumulada de gasto del cliente a partir de
 * createdAt on-chain) y WalletSparkline (retiros reales del usuario).
 */

import { useId } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { motion } from 'framer-motion';
import { Hexagon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { EarningsPoint } from './data';
import { formatMonEs } from './data';

const HONEY = '#E29A2E';
const HONEY_DEEP = '#B4781B';
const HONEY_SOFT = '#F2EFFA';
const LINE = '#342E4A';
const INK_3 = '#948DAE';

const AXIS_STYLE = { fontFamily: 'JetBrains Mono, monospace', fontSize: 11, fill: INK_3 } as const;

/* ---------- Tooltip personalizado (paper, hairline, mono) ---------- */

interface TooltipPayloadItem {
  value?: number | string;
  payload?: Record<string, unknown>;
}

function HiveTooltip({ active, payload, label, unit }: { active?: boolean; payload?: TooltipPayloadItem[]; label?: string; unit?: string }) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload as { mon?: number; tareas?: number } | undefined;
  return (
    <div className="rounded-xl border border-line bg-paper px-3 py-2 shadow-card">
      {label && <p className="mb-0.5 font-mono text-[0.6875rem] uppercase tracking-wide text-ink-3">{label}</p>}
      {point?.mon !== undefined && (
        <p className="font-mono text-[0.8125rem] text-ink">
          {formatMonEs(point.mon)} {unit ?? 'MON'}
          {point.tareas !== undefined && <span className="text-ink-3"> · {point.tareas} tareas</span>}
        </p>
      )}
    </div>
  );
}

/* ---------- Hueco de una grafica sin datos ---------- */

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

/* ---------- Área acumulada de gasto (cliente, real) ---------- */

export function EarningsAreaChart({ data, rangeKey, unit }: { data: EarningsPoint[]; rangeKey: string; unit?: string }) {
  const gid = useId();
  return (
    <motion.div
      initial={{ scaleX: 0, opacity: 0.4 }}
      animate={{ scaleX: 1, opacity: 1 }}
      transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
      style={{ transformOrigin: 'left center' }}
      className="h-[280px] w-full"
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -14 }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={HONEY_SOFT} stopOpacity={0.95} />
              <stop offset="100%" stopColor={HONEY_SOFT} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={LINE} strokeDasharray="0" vertical={false} />
          <XAxis dataKey="label" tick={AXIS_STYLE} tickLine={false} axisLine={{ stroke: LINE }} interval="preserveStartEnd" />
          <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={52} />
          <Tooltip content={<HiveTooltip unit={unit} />} cursor={{ stroke: HONEY, strokeDasharray: '3 3' }} />
          <Area
            key={rangeKey}
            type="monotone"
            dataKey="mon"
            stroke={HONEY_DEEP}
            strokeWidth={2}
            fill={`url(#${gid})`}
            isAnimationActive
            animationDuration={900}
            activeDot={{ r: 4, fill: HONEY_DEEP, stroke: '#F2EFFA', strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </motion.div>
  );
}

/* ---------- Sparkline de saldo (se dibuja, dashoffset 1s) ---------- */

export function WalletSparkline({
  data,
  width = 220,
  height = 64,
  className,
}: {
  data: number[];
  width?: number;
  height?: number;
  /** clases extra (p. ej. ancho fluido en móvil); el viewBox mantiene la proporción */
  className?: string;
}) {
  const { t } = useTranslation();
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const step = width / (data.length - 1);
  const points = data.map((v, i) => `${(i * step).toFixed(1)},${(height - 6 - ((v - min) / span) * (height - 14)).toFixed(1)}`);
  const path = `M${points.join(' L')}`;
  const area = `${path} L${width},${height} L0,${height} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={['overflow-visible', className].filter(Boolean).join(' ')}
      role="img"
      aria-label={t('wallet.chartAria')}
    >
      <path d={area} fill={HONEY_SOFT} opacity={0.5} />
      <motion.path
        d={path}
        fill="none"
        stroke={HONEY_DEEP}
        strokeWidth={2}
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        whileInView={{ pathLength: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 1, ease: 'easeOut' }}
      />
      <circle cx={width} cy={points[points.length - 1].split(',')[1]} r={3.5} fill={HONEY} stroke="#EFEAF8" strokeWidth={1.5} />
    </svg>
  );
}
