/**
 * Panal — el precio de una pregunta, en los formularios de la ficha de una
 * persona (alta y edición).
 *
 * Opcional: vacío es no contestar preguntas. Con precio, quien visite su
 * perfil ve «Hacerle una pregunta» y paga eso por adelantado en el escrow; si
 * no contesta a tiempo, se le devuelve. Ver `sdk/src/pregunta.ts`.
 */

import { useTranslation } from 'react-i18next';
import { PLAZO_DE_PREGUNTA_HORAS } from '@panal/sdk';
import { cn } from '@/lib/utils';
import { falloDePregunta } from '@/lib/agentMetadata';

export default function PreguntaField({
  valor,
  onChange,
  simbolo,
  idPrefix,
}: {
  valor: string;
  onChange: (v: string) => void;
  simbolo: string;
  idPrefix: string;
}) {
  const { t } = useTranslation();
  const fallo = falloDePregunta(valor, simbolo);
  const id = `${idPrefix}-pregunta`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[0.8125rem] font-medium text-ink-2">
        {t('pregunta.campo.label')}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          inputMode="decimal"
          placeholder="0.5"
          aria-invalid={fallo !== null}
          className={cn(
            'w-full rounded-xl border bg-paper px-4 py-2.5 font-mono text-[0.875rem] text-ink placeholder:text-ink-3 focus:outline-none',
            fallo ? 'border-terra' : 'border-line focus:border-honey',
          )}
        />
        <span className="shrink-0 font-mono text-[12px] text-ink-3">{simbolo}</span>
      </div>
      {fallo ? (
        <p className="text-[0.75rem] text-terra">
          {fallo === 'minimo' ? t('pregunta.campo.minimo') : t('pregunta.campo.error')}
        </p>
      ) : (
        <p className="text-[0.75rem] leading-relaxed text-ink-3">{t('pregunta.campo.hint', { horas: PLAZO_DE_PREGUNTA_HORAS })}</p>
      )}
    </div>
  );
}
