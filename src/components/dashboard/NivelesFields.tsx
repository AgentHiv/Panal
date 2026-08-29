import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Layers } from 'lucide-react';
import { NIVELES_EDITABLES } from '@panal/sdk';
import { cn } from '@/lib/utils';
import { falloDeNivel, NIVEL_VACIO, type NivelEditable } from '@/lib/agentMetadata';

/**
 * Los niveles del agente: el mismo trabajo en tres tamaños.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * QUÉ ARREGLA
 *
 * Hasta ahora un agente que vendía tres cosas distintas las declaraba en su
 * CÓDIGO, en un `export const NIVELES` de su `agent.ts`. O sea que cambiar lo
 * que cobra exigía editar TypeScript, desplegar y reiniciar el bot: quien no
 * programa no podía tocar su propio precio. Y como vivían solo en la ficha que
 * sirve el bot, un agente caído se quedaba sin niveles y el escaparate
 * enseñaba un precio suelto de alguien que en realidad vende tres cosas.
 *
 * Escritos en la cadena se editan desde aquí, los guarda el registro y los lee
 * cualquiera sin preguntarle a ningún servidor.
 *
 * POR QUÉ TRES Y POR QUÉ PLEGADO
 *
 * Tres es lo que se entiende de un vistazo y lo que ya publican los agentes
 * que los usan. El lector admite hasta ocho, para no recortarle a nadie lo que
 * ya escribió por otra vía.
 *
 * Y va plegado como la marca, por lo mismo: es opcional, la mayoría no va a
 * rellenar nada, y desplegado empujaría el precio y el endpoint —los campos
 * que sí hacen falta— fuera de la pantalla justo en el registro, que es donde
 * peor sienta perderse. Se abre solo si ya hay niveles escritos.
 *
 * LO QUE NO HACE
 *
 * No toca los topes de caracteres. Se leen, se arrastran y se vuelven a
 * escribir, pero no se editan: serían dieciocho campos más en pantalla para
 * algo que declara el agente desde su código y que casi nadie cambia. Lo que
 * NO puede pasar es perderlos por editar una tilde desde aquí.
 * ───────────────────────────────────────────────────────────────────────────
 */
export default function NivelesFields({
  niveles,
  onChange,
  idPrefix,
  simbolo,
  precioBase,
}: {
  niveles: NivelEditable[];
  onChange: (niveles: NivelEditable[]) => void;
  /** Para los `id` de los labels: hay dos formularios y no pueden chocar. */
  idPrefix: string;
  /** MON o $PANAL: los niveles se cobran en la moneda del agente, no en otra. */
  simbolo: string;
  /** El precio del registro, para avisar si el nivel más barato no es ese. */
  precioBase: string;
}) {
  const { t } = useTranslation();
  const [abierto, setAbierto] = useState(() => niveles.some((n) => n.name.trim() || n.precio.trim()));
  /** Qué filas se han tocado: el error solo sale al salir del campo. */
  const [tocadas, setTocadas] = useState<Record<number, boolean>>({});

  const filas = Array.from(
    { length: NIVELES_EDITABLES },
    (_, i) => niveles[i] ?? { ...NIVEL_VACIO },
  );
  const puestos = filas.filter((n) => falloDeNivel(n) === null && n.name.trim()).length;

  const cambiar = (i: number, parche: Partial<NivelEditable>): void => {
    const copia = filas.map((n, j) => (i === j ? { ...n, ...parche } : n));
    onChange(copia);
  };

  /**
   * El nivel más barato de los que están bien escritos.
   *
   * Sirve para el aviso de abajo: el mercado enseña `pricePerTask` como EL
   * precio del agente, así que si el nivel más barato no es ese, el escaparate
   * anuncia una cifra por la que no se puede comprar nada.
   */
  const masBarato = filas
    .filter((n) => falloDeNivel(n) === null && n.name.trim() && n.precio.trim())
    .map((n) => n.precio.replace(',', '.').trim())
    .sort((a, b) => Number(a) - Number(b))[0];
  const base = precioBase.replace(',', '.').trim();
  const descuadre =
    masBarato !== undefined && base !== '' && Number(masBarato) !== Number(base) ? masBarato : null;

  return (
    <div className="rounded-xl border border-line">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <Layers size={16} aria-hidden className="shrink-0 text-ink-3" />
          <span className="min-w-0">
            <span className="block text-[0.8125rem] font-medium text-ink-2">
              {t('niveles.title')}
            </span>
            <span className="block text-[0.75rem] text-ink-3">
              {puestos > 0 ? t('niveles.filled', { n: puestos }) : t('niveles.optional')}
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
        <div className="flex flex-col gap-4 border-t border-line px-4 py-4">
          <p className="text-[0.75rem] leading-relaxed text-ink-3">{t('niveles.hint')}</p>

          {filas.map((nivel, i) => {
            const fallo = tocadas[i] ? falloDeNivel(nivel) : null;
            return (
              <div key={i} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <label
                    htmlFor={`${idPrefix}-nivel-${i}-nombre`}
                    className="text-[0.8125rem] font-medium text-ink-2"
                  >
                    {t('niveles.nth', { n: i + 1 })}
                  </label>
                  {nivel.maxBriefChars !== null && (
                    // Se enseña porque no se edita: si no, alguien que declaró
                    // topes desde su código creería que este formulario se los
                    // ha comido al no verlos por ninguna parte.
                    <span className="font-mono text-[0.6875rem] text-ink-3">
                      {t('niveles.limitsKept', { n: nivel.maxBriefChars })}
                    </span>
                  )}
                </div>

                <div className="flex gap-2">
                  <input
                    id={`${idPrefix}-nivel-${i}-nombre`}
                    value={nivel.name}
                    onChange={(e) => cambiar(i, { name: e.target.value })}
                    onBlur={() => setTocadas((v) => ({ ...v, [i]: true }))}
                    maxLength={60}
                    placeholder={t('niveles.placeholders.name')}
                    aria-invalid={fallo !== null}
                    className={campo(fallo !== null, 'min-w-0 flex-1')}
                  />
                  <span className="relative shrink-0">
                    <input
                      value={nivel.precio}
                      onChange={(e) => cambiar(i, { precio: e.target.value })}
                      onBlur={() => setTocadas((v) => ({ ...v, [i]: true }))}
                      inputMode="decimal"
                      placeholder="0.00"
                      aria-label={t('niveles.priceAria', { n: i + 1 })}
                      aria-invalid={fallo === 'precio' || fallo === 'incompleto'}
                      className={campo(fallo === 'precio' || fallo === 'incompleto', 'w-32 pr-14 text-right')}
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[0.6875rem] text-ink-3">
                      {simbolo}
                    </span>
                  </span>
                </div>

                <input
                  value={nivel.description}
                  onChange={(e) => cambiar(i, { description: e.target.value })}
                  onBlur={() => setTocadas((v) => ({ ...v, [i]: true }))}
                  maxLength={200}
                  placeholder={t('niveles.placeholders.desc')}
                  aria-label={t('niveles.descAria', { n: i + 1 })}
                  aria-invalid={fallo === 'separador'}
                  className={campo(fallo === 'separador', '')}
                />

                {fallo && <p className="text-[0.75rem] text-terra">{t(`niveles.errors.${fallo}`)}</p>}
              </div>
            );
          })}

          {descuadre && (
            <p className="rounded-lg bg-honey-soft px-3 py-2 text-[0.75rem] leading-relaxed text-ink-2">
              {t('niveles.mismatch', { barato: descuadre, base, simbolo })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** El mismo campo que el resto del formulario, en rojo cuando algo no cuadra. */
function campo(roto: boolean, extra: string): string {
  return cn(
    'rounded-lg border bg-paper px-3 py-2 text-[0.875rem] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-honey',
    roto ? 'border-terra' : 'border-line',
    extra,
  );
}
