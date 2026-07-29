import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import type { AdvancedFilters } from '@/components/market/filters';
import { cn } from '@/lib/utils';

/* ---------- slider logarítmico (rango según moneda) ----------
 * MON: 10^-3–10^3 (0.001–1.000) · $PANAL: 10^0–10^3 (1–1.000) */
const SLIDER_MIN = 0;
const SLIDER_MAX = 100;
const expMinFor = (cur: 'todas' | 'mon' | 'panal') => (cur === 'panal' ? 0 : -3);
const toPrice = (v: number, expMin: number) =>
  v >= SLIDER_MAX
    ? Number.POSITIVE_INFINITY // extremo derecho = sin límite
    : Math.round(Math.pow(10, expMin + ((3 - expMin) * v) / 100) * 1000) / 1000;
const toSlider = (p: number, expMin: number) =>
  !Number.isFinite(p) ? SLIDER_MAX : Math.round(((Math.log10(p) - expMin) / (3 - expMin)) * 100);
const fmtSliderMon = (v: number) =>
  !Number.isFinite(v)
    ? '∞'
    : v >= 100
      ? v.toFixed(0)
      : v >= 0.1
        ? v.toFixed(2)
        : v >= 1
          ? v.toFixed(1).replace(/\.0$/, '')
          : v.toFixed(3);

const CURRENCY_OPTIONS = [
  { value: 'todas', label: 'filters.currAll' },
  { value: 'mon', label: 'filters.currMon' },
  { value: 'panal', label: 'filters.currPanal' },
] as const;

const RATING_STEPS = [4, 4.5, 4.8, 5] as const;
const TYPE_OPTIONS = [
  { value: 'todos', label: 'market.all' },
  { value: 'ia', label: 'common.typeIa' },
  { value: 'humano', label: 'common.typeHuman' },
] as const;

export interface FilterSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: AdvancedFilters;
  onChange: (filters: AdvancedFilters) => void;
  resultCount: number;
  onClear: () => void;
}

export default function FilterSheet({ open, onOpenChange, filters, onChange, resultCount, onClear }: FilterSheetProps) {
  const { t } = useTranslation();
  const set = (patch: Partial<AdvancedFilters>) => onChange({ ...filters, ...patch });
  const expMin = expMinFor(filters.currency);
  const sliderValue = [toSlider(filters.priceMin, expMin), toSlider(filters.priceMax, expMin)];
  const priceUnit = filters.currency === 'panal' ? '$PANAL' : 'MON';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-[380px] max-w-[92vw] flex-col border-line bg-paper p-0">
        <SheetHeader className="border-b border-line px-6 py-5 text-left">
          <SheetTitle className="display-m text-ink">{t('market.filters')}</SheetTitle>
          <SheetDescription className="sr-only">{t('filters.desc')}</SheetDescription>
        </SheetHeader>

        <motion.div
          className="flex-1 overflow-y-auto px-6 py-6"
          initial="hidden"
          animate="show"
          variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }}
        >
          {/* Precio por tarea — slider doble logarítmico */}
          <motion.section
            variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.35 } } }}
            className="flex flex-col gap-4"
          >
            <div className="flex items-baseline justify-between">
              <h3 className="text-[0.875rem] font-semibold text-ink">{t('filters.pricePerTask')}</h3>
              <span className="font-mono text-[12px] text-honey-deep">
                {fmtSliderMon(filters.priceMin)} – {fmtSliderMon(filters.priceMax)} {priceUnit}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {CURRENCY_OPTIONS.map((opt) => {
                const active = filters.currency === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      // Al cambiar a $PANAL el mínimo técnico es 1; al volver, 0.001
                      const nextExp = expMinFor(opt.value);
                      set({
                        currency: opt.value,
                        priceMin: Math.pow(10, nextExp),
                        priceMax: Number.POSITIVE_INFINITY,
                      });
                    }}
                    className={cn(
                      'rounded-full border px-2 py-2 text-[0.8125rem] transition-colors',
                      active
                        ? 'border-honey bg-honey-soft text-honey-deep'
                        : 'border-line bg-transparent text-ink-2 hover:border-honey/50 hover:text-ink',
                    )}
                  >
                    {t(opt.label)}
                  </button>
                );
              })}
            </div>
            <Slider
              value={sliderValue}
              onValueChange={([lo, hi]) =>
                set({ priceMin: toPrice(lo ?? SLIDER_MIN, expMin), priceMax: toPrice(hi ?? SLIDER_MAX, expMin) })
              }
              min={SLIDER_MIN}
              max={SLIDER_MAX}
              step={1}
              minStepsBetweenThumbs={1}
              aria-label={t('filters.priceAria')}
              className="py-2"
            />
            <div className="flex justify-between font-mono text-[11px] text-ink-3">
              <span>{filters.currency === 'panal' ? '1 $PANAL' : '0.001 MON'}</span>
              <span>{t('filters.logScale')}</span>
              <span>∞</span>
            </div>
          </motion.section>

          {/* Rating mínimo — segmented */}
          <motion.section
            variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.35 } } }}
            className="mt-8 flex flex-col gap-3"
          >
            <h3 className="text-[0.875rem] font-semibold text-ink">{t('filters.minRating')}</h3>
            <div className="grid grid-cols-4 gap-2">
              {RATING_STEPS.map((r) => {
                const active = filters.minRating === r;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => set({ minRating: active ? 0 : r })}
                    aria-pressed={active}
                    className={cn(
                      'rounded-full border px-3 py-2 font-mono text-[12px] transition-colors duration-200',
                      active
                        ? 'border-honey bg-honey-soft text-honey-deep'
                        : 'border-line text-ink-2 hover:border-honey hover:text-honey-deep',
                    )}
                  >
                    {r.toFixed(1)}
                  </button>
                );
              })}
            </div>
          </motion.section>

          {/* Switches */}
          <motion.section
            variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.35 } } }}
            className="mt-8 flex flex-col gap-4"
          >
            {(
              [
                ['onlyVerified', t('filters.onlyVerified')],
                ['onlyOnline', t('filters.onlyOnline')],
                ['onlySubcontracting', t('filters.onlySubcontracting')],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex cursor-pointer items-center justify-between gap-3 text-[0.875rem] text-ink-2">
                {label}
                <Switch
                  checked={filters[key]}
                  onCheckedChange={(v) => set({ [key]: v } as Partial<AdvancedFilters>)}
                  className="data-[state=checked]:bg-honey"
                />
              </label>
            ))}
          </motion.section>

          {/* Tipo — radio pills */}
          <motion.section
            variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.35 } } }}
            className="mt-8 flex flex-col gap-3"
          >
            <h3 className="text-[0.875rem] font-semibold text-ink">{t('filters.type')}</h3>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t('filters.typeAria')}>
              {TYPE_OPTIONS.map((opt) => {
                const active = filters.type === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => set({ type: opt.value })}
                    className={cn(
                      'rounded-full border px-3 py-2 text-[0.8125rem] font-medium transition-colors duration-200',
                      active
                        ? 'border-honey bg-honey-soft text-honey-deep'
                        : 'border-line text-ink-2 hover:border-honey hover:text-honey-deep',
                    )}
                  >
                    {t(opt.label)}
                  </button>
                );
              })}
            </div>
          </motion.section>
        </motion.div>

        {/* Footer */}
        <div className="flex items-center gap-3 border-t border-line px-6 py-4">
          <button
            type="button"
            onClick={onClear}
            className="rounded-full px-4 py-2.5 text-[0.875rem] font-medium text-ink-2 transition-colors hover:text-honey-deep"
          >
            {t('filters.clearAll')}
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex-1 rounded-full bg-honey px-4 py-2.5 text-[0.875rem] font-semibold text-ink transition-colors hover:bg-honey-deep hover:text-paper"
          >
            {t('filters.see')}{' '}
            <motion.span
              key={resultCount}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className="inline-block font-mono"
            >
              {resultCount}
            </motion.span>{' '}
            {t('filters.results')}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
