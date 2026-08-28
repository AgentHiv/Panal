import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ImagePlus, Loader2, X } from 'lucide-react';
import HexAvatar from '@/components/HexAvatar';
import { cn } from '@/lib/utils';
import { CLAVES_MARCA, bytesDeLogo, normalizarMarca, type ClaveMarca, type Marca } from '@/lib/marca';
import { ErrorDeLogo, LOGO_ACEPTA, prepararLogo, type FalloDeLogo } from '@/lib/logoImagen';

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
 *
 * EL LOGO ES EL ÚNICO CAMPO QUE NO ES UN TEXTO. Pedir una URL es pedir un sitio
 * donde alojar un archivo, y quien se registra desde el navegador tiene el logo
 * en su ordenador. Así que aquí se elige el archivo y se guarda la imagen
 * dentro de la ficha; la URL sigue estando, para quien ya la tiene. Lo que se
 * guarda lo prepara `logoImagen.ts`, que además rasteriza los SVG: a la cadena
 * nunca va un documento con scripts dentro.
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
  const { t, i18n } = useTranslation();
  const [abierto, setAbierto] = useState(() => CLAVES_MARCA.some((c) => marca[c] !== ''));
  /** Qué campos se han tocado: el error solo sale al salir del campo. */
  const [tocados, setTocados] = useState<Partial<Record<ClaveMarca, boolean>>>({});

  /** El input de archivo real: se dispara desde el botón, que sí se puede pintar. */
  const selector = useRef<HTMLInputElement>(null);
  const [preparando, setPreparando] = useState(false);
  const [falloLogo, setFalloLogo] = useState<FalloDeLogo | null>(null);

  const puestos = CLAVES_MARCA.filter((c) => normalizarMarca(c, marca[c]) !== '').length;
  const logoValido = normalizarMarca('logo', marca.logo);
  /** ¿La imagen viaja dentro de la ficha, en vez de vivir en un dominio? */
  const incrustado = logoValido.startsWith('data:');
  /**
   * El peso, escrito como se escribe en cada idioma.
   *
   * Un `1.1 KB` en español es un error de ortografía, no un redondeo: aquí el
   * separador decimal es la coma. Lo pone `Intl`, que ya sabe de eso; pasar el
   * número crudo a i18next lo dejaría con el punto de JavaScript en los diez.
   */
  const kbLogo = incrustado
    ? new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(
        Math.round(bytesDeLogo(logoValido) / 102.4) / 10,
      )
    : '';

  /**
   * Del archivo que elige alguien al `data:` que se guarda.
   *
   * El fallo se enseña en el momento, sin esperar a ningún `blur`: aquí no hay
   * un campo del que salir, y quien acaba de elegir una foto de 12 MB tiene que
   * enterarse ya de que no ha entrado.
   */
  const tomarArchivo = async (archivo: File | undefined): Promise<void> => {
    if (!archivo) return;
    setFalloLogo(null);
    setPreparando(true);
    try {
      const listo = await prepararLogo(archivo);
      onChange({ ...marca, logo: listo.uri });
    } catch (err) {
      setFalloLogo(err instanceof ErrorDeLogo ? err.codigo : 'ilegible');
    } finally {
      setPreparando(false);
    }
  };

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
            {puestos > 0 ? t('marca.filled', { n: puestos }) : t('marca.optional')}
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

                {clave === 'logo' && (
                  <>
                    {/* El input de verdad no se pinta: no se puede dar estilo a
                        su botón y cada navegador escribe un texto distinto. */}
                    <input
                      ref={selector}
                      type="file"
                      accept={LOGO_ACEPTA}
                      className="hidden"
                      onChange={(e) => {
                        const archivo = e.target.files?.[0];
                        // Se vacía para que elegir DOS VECES el mismo archivo
                        // vuelva a disparar el evento; si no, el segundo intento
                        // tras un error no hacía nada.
                        e.target.value = '';
                        void tomarArchivo(archivo);
                      }}
                    />
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => selector.current?.click()}
                        disabled={preparando}
                        className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 text-[0.8125rem] font-medium text-ink-2 transition-colors hover:border-honey disabled:opacity-50"
                      >
                        {preparando ? (
                          <Loader2 size={14} className="animate-spin" aria-hidden />
                        ) : (
                          <ImagePlus size={14} aria-hidden />
                        )}
                        {incrustado ? t('marca.logoChange') : t('marca.logoPick')}
                      </button>
                      {incrustado && (
                        <>
                          <span className="min-w-0 flex-1 truncate text-[0.75rem] text-ink-3">
                            {t('marca.logoEmbedded', { kb: kbLogo })}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setFalloLogo(null);
                              onChange({ ...marca, logo: '' });
                            }}
                            aria-label={t('marca.logoRemove')}
                            className="rounded-full border border-line p-1.5 text-ink-3 transition-colors hover:border-terra hover:text-terra"
                          >
                            <X size={13} aria-hidden />
                          </button>
                        </>
                      )}
                    </div>
                    {falloLogo && (
                      <p className="text-[0.75rem] text-terra">{t(`marca.logoErrors.${falloLogo}`)}</p>
                    )}
                    <p className="text-[0.75rem] leading-relaxed text-ink-3">
                      {incrustado ? t('marca.logoEmbeddedHint') : t('marca.logoOr')}
                    </p>
                  </>
                )}

                {/* Con la imagen dentro de la ficha el campo de URL sobra, y
                    dejarlo enseñando 5 000 caracteres de base64 sería ilegible. */}
                {!(clave === 'logo' && incrustado) && (
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
                )}
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
