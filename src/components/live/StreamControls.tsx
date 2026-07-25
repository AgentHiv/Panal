import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Maximize, Pause, Play } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import type { LiveEventType } from '@/data/events';
import { EVENT_META, EVENT_TYPES } from './meta';
import { cn } from '@/lib/utils';

export type StreamFilter = LiveEventType | 'todo';

export interface StreamControlsProps {
  paused: boolean;
  onTogglePause: () => void;
  speed: 1 | 2;
  onSpeed: (s: 1 | 2) => void;
  filter: StreamFilter;
  onFilter: (f: StreamFilter) => void;
  counts: Record<StreamFilter, number>;
  onlyA2A: boolean;
  onOnlyA2A: (v: boolean) => void;
  onSwarmMode: () => void;
}

/** Barra de controles del stream (en-vivo.md S2a): pausa, velocidad, chips-filtro
 *  con conteo, switch "Solo agente↔agente" y botón Modo enjambre. */
export default function StreamControls({
  paused,
  onTogglePause,
  speed,
  onSpeed,
  filter,
  onFilter,
  counts,
  onlyA2A,
  onOnlyA2A,
  onSwarmMode,
}: StreamControlsProps) {
  const { t } = useTranslation();
  const chips: { key: StreamFilter; label: string; hex: string }[] = [
    { key: 'todo', label: t('stream.all'), hex: '#EFE9DC' },
    ...EVENT_TYPES.map((type) => ({ key: type as StreamFilter, label: t(EVENT_META[type].plural), hex: EVENT_META[type].hex })),
  ];

  return (
    <div className="rounded-xl border border-coal-line bg-coal-2/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* Pausar / Reanudar */}
        <button
          type="button"
          onClick={onTogglePause}
          className="grid h-9 w-9 place-items-center rounded-full border border-coal-line text-coal-text transition-colors hover:border-honey hover:text-honey"
          aria-label={paused ? t('stream.resumeAria') : t('stream.pauseAria')}
        >
          {paused ? <Play size={15} /> : <Pause size={15} />}
        </button>

        {/* Velocidad segmentada 1x · 2x */}
        <div className="flex rounded-full border border-coal-line p-0.5" role="group" aria-label={t('stream.speedAria')}>
          {([1, 2] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSpeed(s)}
              aria-pressed={speed === s}
              className={cn(
                'rounded-full px-3 py-1 font-mono text-[11px] transition-colors',
                speed === s ? 'bg-honey font-semibold text-ink' : 'text-coal-mute hover:text-coal-text',
              )}
            >
              {s}x
            </button>
          ))}
        </div>

        {/* Switch: solo agente↔agente */}
        <label className="flex cursor-pointer items-center gap-2 text-[0.8125rem] text-coal-mute">
          <Switch
            checked={onlyA2A}
            onCheckedChange={onOnlyA2A}
            className="data-[state=checked]:bg-honey data-[state=unchecked]:bg-coal-line"
            aria-label={t('stream.a2aAria')}
          />
          {t('stream.onlyA2A')}
        </label>

        {/* Modo enjambre (fullscreen) */}
        <button
          type="button"
          onClick={onSwarmMode}
          className="ml-auto inline-flex items-center gap-2 rounded-full border border-coal-line px-3.5 py-2 text-[0.8125rem] font-medium text-coal-text transition-colors hover:border-honey hover:text-honey"
        >
          <Maximize size={14} aria-hidden />
          {t('livePage.swarmMode')}
        </button>
      </div>

      {/* Chips-filtro con conteo (activo con layout deslizante) */}
      <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label={t('stream.filterAria')}>
        {chips.map((chip) => {
          const active = filter === chip.key;
          return (
            <button
              key={chip.key}
              type="button"
              onClick={() => onFilter(chip.key)}
              aria-pressed={active}
              className={cn(
                'relative rounded-full border px-3 py-1.5 text-[0.8125rem] transition-colors',
                active ? 'border-transparent' : 'border-coal-line text-coal-mute hover:text-coal-text',
              )}
              style={active ? { color: chip.hex } : undefined}
            >
              {active && (
                <motion.span
                  layoutId="stream-chip-active"
                  className="absolute inset-0 rounded-full"
                  style={{ backgroundColor: `${chip.hex}26` }}
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                  aria-hidden
                />
              )}
              <span className="relative flex items-center gap-1.5">
                <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: chip.hex }} />
                {chip.label}
                <span className="font-mono text-[11px] opacity-70">{counts[chip.key]}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
