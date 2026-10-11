import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Lightbulb } from 'lucide-react';
import { EJEMPLOS_EDITABLES, falloDeEjemplo, MAX_EJEMPLO } from '@panal/sdk';
import { cn } from '@/lib/utils';

/**
 * Los encargos de ejemplo del agente: lo que se le propone a quien le contrata.
 *
 * QUÉ ARREGLA
 *
 * Debajo de la caja del encargo salían cuatro ejemplos fijos para CUALQUIER
 * agente —«Audita este contrato», «Resume este PDF»…—, y a uno de traducción
 * le proponían auditar un contrato. Se quitaron, y su sitio lo ocupan estos:
 * los escribe el dueño del agente, que es quien sabe qué le piden.
 *
 * Van a la cadena con el resto de la ficha (ver `ejemplos.ts` del SDK), así
 * que también los puede poner quien no tiene servidor, y siguen ahí con el bot
 * caído. Si el agente tiene servidor con la plantilla, los sirve traducidos.
 *
 * Plegado como los niveles y la marca, por lo mismo: es opcional y desplegado
 * empujaría fuera de la pantalla los campos que sí hacen falta. Se abre solo
 * si ya hay ejemplos escritos.
 */
export default function EjemplosFields({
  ejemplos,
  onChange,
  idPrefix,
}: {
  ejemplos: string[];
  onChange: (ejemplos: string[]) => void;
  /** Para los `id` de los labels: hay dos formularios y no pueden chocar. */
  idPrefix: string;
}) {
  const { t } = useTranslation();
  const [abierto, setAbierto] = useState(() => ejemplos.some((e) => e.trim()));
  /** Qué filas se han tocado: el error solo sale al salir del campo. */
  const [tocadas, setTocadas] = useState<Record<number, boolean>>({});

  const filas = Array.from({ length: EJEMPLOS_EDITABLES }, (_, i) => ejemplos[i] ?? '');
  const puestos = filas.filter((e) => e.trim() && falloDeEjemplo(e) === null).length;

  const cambiar = (i: number, valor: string): void => {
    onChange(filas.map((e, j) => (i === j ? valor : e)));
  };

  return (
    <div className="rounded-xl border border-line">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <Lightbulb size={16} aria-hidden className="shrink-0 text-ink-3" />
          <span className="min-w-0">
            <span className="block text-[0.8125rem] font-medium text-ink-2">{t('ejemplos.title')}</span>
            <span className="block text-[0.75rem] text-ink-3">
              {puestos > 0 ? t('ejemplos.filled', { n: puestos }) : t('ejemplos.optional')}
            </span>
          </span>
        </span>
        <ChevronDown
          size={16}
          aria-hidden
          className={cn('shrink-0 text-ink-3 transition-transform', abierto && 'rotate-180')}
        />
      </button>

      {abierto && (
        <div className="flex flex-col gap-3 border-t border-line px-4 py-4">
          <p className="text-[0.75rem] leading-relaxed text-ink-3">{t('ejemplos.hint')}</p>

          {filas.map((ejemplo, i) => {
            const fallo = tocadas[i] ? falloDeEjemplo(ejemplo) : null;
            return (
              <div key={i} className="flex flex-col gap-1.5">
                <label htmlFor={`${idPrefix}-ejemplo-${i}`} className="text-[0.8125rem] font-medium text-ink-2">
                  {t('ejemplos.nth', { n: i + 1 })}
                </label>
                <input
                  id={`${idPrefix}-ejemplo-${i}`}
                  value={ejemplo}
                  onChange={(e) => cambiar(i, e.target.value)}
                  onBlur={() => setTocadas((v) => ({ ...v, [i]: true }))}
                  // Uno de margen sobre el tope: así quien pega un texto largo
                  // ve el aviso en vez de un recorte callado.
                  maxLength={MAX_EJEMPLO + 1}
                  placeholder={t(`ejemplos.placeholders.p${i + 1}`)}
                  aria-invalid={fallo !== null}
                  className={cn(
                    'rounded-lg border bg-paper px-3 py-2 text-[0.875rem] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-honey',
                    fallo !== null ? 'border-terra' : 'border-line',
                  )}
                />
                {fallo && (
                  <p className="text-[0.75rem] text-terra">{t(`ejemplos.errors.${fallo}`, { n: MAX_EJEMPLO })}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
