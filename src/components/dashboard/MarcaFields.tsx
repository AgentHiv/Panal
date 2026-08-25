import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import HexAvatar from '@/components/HexAvatar';
import { cn } from '@/lib/utils';
import { CLAVES_MARCA, normalizarMarca, type ClaveMarca, type Marca } from '@/lib/marca';

/**
 * Los campos de marca del agente: su logo, su web, su GitHub, sus redes.
 *
 * Vive en un componente propio porque lo usan los dos formularios —el registro
 * y la edición del perfil— y son cinco campos con la misma validación. Tenerlo
 * dos veces sería dos sitios donde admitir cosas distintas, y lo que se admite
 * aquí acaba escrito en la cadena.
 *
 * VA PLEGADO. Todo esto es opcional y la mayoría de agentes no va a rellenar
 * nada: desplegado empujaría el precio y el endpoint —los campos que sí hacen
 * falta— fuera de la pantalla, y el registro es justo donde no conviene que
 * alguien se pierda. Se abre solo si ya hay algo dentro, para que editando un
 * agente con logo no parezca que se ha perdido.
 *
 * El error no bloquea el registro: un GitHub mal escrito no se guarda y ya. Lo
 * que NO puede pasar es que se guarde otra cosa —«dos palabras» convertido en
 * el usuario `dospalabras`, que es de alguien— así que se avisa en el momento.
 */
export default function MarcaFields({
  marca,
  onChange,
  idPrefix,
  seed,
}: {
  marca: Marca;
  onChange: (marca: Marca) => void;
  /** Para los `id` de los labels: hay dos formularios y no pueden chocar. */
  idPrefix: string;
  /** La wallet, para el avatar de siempre cuando aún no hay logo. */
  seed: string;
}) {
  const { t } = useTranslation();
  const [abierto, setAbierto] = useState(() => CLAVES_MARCA.some((c) => marca[c] !== ''));
  /** Qué campos se han tocado: el error solo sale al salir del campo. */
  const [tocados, setTocados] = useState<Partial<Record<ClaveMarca, boolean>>>({});

  const puestos = CLAVES_MARCA.filter((c) => normalizarMarca(c, marca[c]) !== '').length;
  const logoValido = normalizarMarca('logo', marca.logo);

  return (
    <div className="rounded-xl border border-line">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="min-w-0">
          <span className="block text-[0.8125rem] font-medium text-ink-2">
            {t('marca.title')}
          </span>
          <span className="block text-[0.75rem] text-ink-3">
            {puestos > 0 ? t('marca.filled', { count: puestos }) : t('marca.optional')}
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
          <p className="text-[0.75rem] leading-relaxed text-ink-3">{t('marca.hint')}</p>

          {CLAVES_MARCA.map((clave) => {
            const crudo = marca[clave];
            const roto = tocados[clave] && crudo.trim() !== '' && normalizarMarca(clave, crudo) === '';
            return (
              <div key={clave} className="flex flex-col gap-1.5">
                <label
                  htmlFor={`${idPrefix}-${clave}`}
                  className="text-[0.8125rem] font-medium text-ink-2"
                >
                  {t(`marca.fields.${clave}`)}
                </label>
                <input
                  id={`${idPrefix}-${clave}`}
                  value={crudo}
                  onChange={(e) => onChange({ ...marca, [clave]: e.target.value })}
                  onBlur={() => setTocados((p) => ({ ...p, [clave]: true }))}
                  inputMode={clave === 'logo' || clave === 'web' ? 'url' : 'text'}
                  placeholder={t(`marca.placeholders.${clave}`)}
                  aria-invalid={roto}
                  className={cn(
                    'h-11 rounded-xl border bg-paper px-3.5 font-mono text-[0.875rem] text-ink outline-none transition-colors placeholder:font-sans placeholder:text-ink-3 focus:border-honey',
                    roto ? 'border-terra' : 'border-line',
                  )}
                />
                {roto && (
                  <p className="text-[0.75rem] text-terra">{t(`marca.errors.${clave}`)}</p>
                )}
              </div>
            );
          })}

          {/*
            Cómo va a quedar. El logo lo sirve el dominio del agente, así que
            esto es además la única forma de enterarse aquí de que la URL no
            carga: si no llega, se ve el hexágono de siempre, que es exactamente
            lo que verá el mercado.
          */}
          <div className="flex items-center gap-3 rounded-xl bg-cream px-4 py-3">
            <HexAvatar seed={seed} size={44} logo={logoValido || undefined} />
            <p className="text-[0.75rem] leading-relaxed text-ink-3">
              {logoValido ? t('marca.previewWithLogo') : t('marca.previewNoLogo')}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
