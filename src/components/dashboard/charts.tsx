/**
 * AgentHive — Gráficas del dashboard (dashboard.md S3/S4).
 * Recharts en tonos cálidos: honey-deep (área ganancias), donut por categoría,
 * línea de reputación olive con hitos honey, sparkline y mini-áreas sin ejes.
 */

import { useId } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { motion } from 'framer-motion';
import type { CategorySlice, EarningsPoint, ReputationPoint } from './data';
import { formatMonEs } from './data';

const HONEY = '#E29A2E';
const HONEY_DEEP = '#B4781B';
const HONEY_SOFT = '#F7E8CC';
const OLIVE = '#6E7B4E';
const LINE = '#E2DAC6';
const INK_3 = '#8B8375';

const AXIS_STYLE = { fontFamily: 'JetBrains Mono, monospace', fontSize: 11, fill: INK_3 } as const;

/* ---------- Tooltip personalizado (paper, hairline, mono) ---------- */

interface TooltipPayloadItem {
  value?: number | string;
  payload?: Record<string, unknown>;
}

function HiveTooltip({ active, payload, label, unit }: { active?: boolean; payload?: TooltipPayloadItem[]; label?: string; unit?: string }) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload as { mon?: number; tareas?: number; rating?: number } | undefined;
  return (
    <div className="rounded-xl border border-line bg-paper px-3 py-2 shadow-card">
      {label && <p className="mb-0.5 font-mono text-[0.6875rem] uppercase tracking-wide text-ink-3">{label}</p>}
      {point?.mon !== undefined && (
        <p className="font-mono text-[0.8125rem] text-ink">
          {formatMonEs(point.mon)} {unit ?? 'MON'}
          {point.tareas !== undefined && <span className="text-ink-3"> · {point.tareas} tareas</span>}
        </p>
      )}
      {point?.rating !== undefined && (
        <p className="font-mono text-[0.8125rem] text-ink">{point.rating.toFixed(2).replace('.', ',')} ★</p>
      )}
    </div>
  );
}

/* ---------- S3 · Área de ganancias / gasto ---------- */

export function EarningsAreaChart({ data, rangeKey, unit }: { data: EarningsPoint[]; rangeKey: string; unit?: string }) {
  const gid = useId();
  return (
    <motion.div
      initial={{ scaleX: 0, opacity: 0.4 }}
      whileInView={{ scaleX: 1, opacity: 1 }}
      viewport={{ once: true, margin: '-60px' }}
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
            activeDot={{ r: 4, fill: HONEY_DEEP, stroke: '#FAF7F1', strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </motion.div>
  );
}

/* ---------- S3 · Donut por categoría ---------- */

export function CategoryDonut({ slices, center, centerLabel }: { slices: CategorySlice[]; center: string; centerLabel: string }) {
  return (
    <div className="flex h-full flex-col">
      <div className="relative mx-auto h-[210px] w-full max-w-[240px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="pct"
              nameKey="name"
              innerRadius="68%"
              outerRadius="92%"
              paddingAngle={3}
              strokeWidth={0}
              isAnimationActive
              animationDuration={900}
            >
              {slices.map((s) => (
                <Cell key={s.name} fill={s.color} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }: { active?: boolean; payload?: TooltipPayloadItem[] }) =>
                active && payload?.length ? (
                  <div className="rounded-xl border border-line bg-paper px-3 py-2 shadow-card">
                    <p className="font-mono text-[0.8125rem] text-ink">
                      {(payload[0]?.payload as { name?: string } | undefined)?.name} · {payload[0]?.value}%
                    </p>
                  </div>
                ) : null
              }
            />
          </PieChart>
        </ResponsiveContainer>
        {/* Centro: total en Space Grotesk */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-[1.9rem] font-bold leading-none tracking-[-0.02em] text-ink">{center}</span>
          <span className="mt-1 text-[0.75rem] font-medium text-ink-3">{centerLabel}</span>
        </div>
      </div>
      {/* Leyenda con chips */}
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {slices.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1.5 rounded-full bg-cream px-2.5 py-1 text-[0.75rem] font-medium text-ink-2">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
            {s.name} · {s.pct}%
          </span>
        ))}
      </div>
    </div>
  );
}

/* ---------- S3 · Reputación en el tiempo ---------- */

export function ReputationLineChart({ data }: { data: ReputationPoint[] }) {
  return (
    <motion.div
      initial={{ scaleX: 0, opacity: 0.4 }}
      whileInView={{ scaleX: 1, opacity: 1 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
      style={{ transformOrigin: 'left center' }}
      className="h-[170px] w-full"
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 16, right: 16, bottom: 0, left: -18 }}>
          <CartesianGrid stroke={LINE} vertical={false} />
          <XAxis dataKey="label" tick={AXIS_STYLE} tickLine={false} axisLine={{ stroke: LINE }} />
          <YAxis domain={[4.5, 5]} tick={AXIS_STYLE} tickLine={false} axisLine={false} width={46} tickFormatter={(v: number) => v.toFixed(1)} />
          <Tooltip content={<HiveTooltip />} cursor={{ stroke: OLIVE, strokeDasharray: '3 3' }} />
          <Line
            type="monotone"
            dataKey="rating"
            stroke={OLIVE}
            strokeWidth={2}
            isAnimationActive
            animationDuration={900}
            dot={(props) => {
              const { cx, cy, payload, index } = props as unknown as { cx: number; cy: number; payload: ReputationPoint; index: number };
              if (payload.milestone) {
                return (
                  <g key={`dot-${index}`}>
                    <circle cx={cx} cy={cy} r={5} fill={HONEY} stroke="#FAF7F1" strokeWidth={2} />
                    <text x={cx} y={cy - 12} textAnchor="middle" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fill: HONEY_DEEP }}>
                      {payload.milestone}
                    </text>
                  </g>
                );
              }
              return <circle key={`dot-${index}`} cx={cx} cy={cy} r={3} fill={OLIVE} stroke="#FAF7F1" strokeWidth={1.5} />;
            }}
            activeDot={{ r: 4, fill: OLIVE, stroke: '#FAF7F1', strokeWidth: 2 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </motion.div>
  );
}

/* ---------- S2 · Sparkline de saldo (se dibuja, dashoffset 1s) ---------- */

export function WalletSparkline({ data, width = 220, height = 64 }: { data: number[]; width?: number; height?: number }) {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const step = width / (data.length - 1);
  const points = data.map((v, i) => `${(i * step).toFixed(1)},${(height - 6 - ((v - min) / span) * (height - 14)).toFixed(1)}`);
  const path = `M${points.join(' L')}`;
  const area = `${path} L${width},${height} L0,${height} Z`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible" role="img" aria-label="Evolución del saldo en 30 días">
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
      <circle cx={width} cy={points[points.length - 1].split(',')[1]} r={3.5} fill={HONEY} stroke="#F2EDE2" strokeWidth={1.5} />
    </svg>
  );
}

/* ---------- S4 · Mini área de ingresos 14d (48px, sin ejes) ---------- */

export function MiniAreaChart({ data }: { data: number[] }) {
  const gid = useId();
  const points = data.map((v, i) => ({ i, v }));
  return (
    <div className="h-12 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={HONEY_SOFT} stopOpacity={0.9} />
              <stop offset="100%" stopColor={HONEY_SOFT} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="v" stroke={HONEY} strokeWidth={1.5} fill={`url(#${gid})`} isAnimationActive={false} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
