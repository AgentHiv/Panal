import { useRef, useState } from 'react';
import { CLAVES_MARCA, bytesDeLogo, normalizarMarca, type ClaveMarca, type Marca } from '@/lib/marca';
import { ErrorDeLogo, LOGO_ACEPTA, prepararLogo, type FalloDeLogo } from '@/lib/logoImagen';
import Hexagono from '~/componentes/Hexagono';
import Icono from '~/componentes/Icono';
import { useIdioma, useTextos } from '~/i18n/idiomas';

/**
 * Los campos de marca del agente: su logo, su web, su GitHub, sus redes.
 *
 * Los usan las dos pantallas que escriben la ficha —el alta y la edición del
 * panel— y son cinco campos con la misma validación. Tenerlos dos veces sería
 * dos sitios donde admitir cosas distintas, y lo que se admite aquí acaba
 * escrito en la cadena.
 *
 * VA PLEGADO. Todo esto es opcional y la mayoría no va a rellenar nada:
 * desplegado empujaría el precio fuera de una pantalla de teléfono, que es
 * justo donde no conviene que alguien se pierda. Se abre solo si ya hay algo,
 * para que al editar un agente con logo no parezca que se ha perdido.
 *
 * El error no bloquea nada: un GitHub mal escrito sencillamente no se guarda.
 * Lo que NO puede pasar es que se guarde otra cosa —«dos palabras» convertido
 * en el usuario `dospalabras`, que es de alguien— así que se avisa en cuanto
 * se sale del campo.
 *
 * EL LOGO ES EL ÚNICO CAMPO QUE NO ES UN TEXTO, y en un teléfono eso importa
 * más que en el escritorio: pedir una URL https es pedir que alguien aloje un
 * archivo en algún sitio, y desde el móvil la imagen está en la galería. Aquí
 * se elige y se guarda dentro de la ficha. Lo prepara `logoImagen.ts`, que
 * además rasteriza los SVG: a la cadena no va nunca un documento con scripts.
 */
export default function CamposMarca({
  marca,
  onCambio,
  semilla,
}: {
  marca: Marca;
  onCambio: (m: Marca) => void;
  /** La dirección del agente, para el avatar de siempre cuando no hay logo. */
  semilla: string;
}): React.ReactElement {
  const T = useTextos();
  const idioma = useIdioma();
  const [abierto, setAbierto] = useState(() => CLAVES_MARCA.some((c) => marca[c] !== ''));
  const [tocados, setTocados] = useState<Partial<Record<ClaveMarca, boolean>>>({});

  /** El input de archivo real: lo dispara el botón, que sí se puede pintar. */
  const selector = useRef<HTMLInputElement>(null);
  const [preparando, setPreparando] = useState(false);
  const [falloLogo, setFalloLogo] = useState<FalloDeLogo | null>(null);

  const puestos = CLAVES_MARCA.filter((c) => normalizarMarca(c, marca[c]) !== '').length;
  const logoValido = normalizarMarca('logo', marca.logo);
  /** ¿La imagen viaja dentro de la ficha, en vez de vivir en un dominio? */
  const incrustado = logoValido.startsWith('data:');
  /**
   * El peso, escrito como se escribe en cada idioma: en español el separador
   * decimal es la coma, y un «1.1 KB» ahí es una falta, no un redondeo.
   */
  const kbLogo = incrustado
    ? new Intl.NumberFormat(idioma, { maximumFractionDigits: 1 }).format(
        Math.round(bytesDeLogo(logoValido) / 102.4) / 10,
      )
    : '';

  const tomarArchivo = async (archivo: File | undefined): Promise<void> => {
    if (!archivo) return;
    setFalloLogo(null);
    setPreparando(true);
    try {
      const listo = await prepararLogo(archivo);
      onCambio({ ...marca, logo: listo.uri });
    } catch (err) {
      setFalloLogo(err instanceof ErrorDeLogo ? err.codigo : 'ilegible');
    } finally {
      setPreparando(false);
    }
  };

  return (
    <div className="mt-3.5 shrink-0 overflow-hidden rounded-[14px] border border-line">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="pulsable flex w-full items-center gap-3 px-3.5 py-3 text-left"
      >
        <div className="min-w-0 grow">
          <p className="text-[13px] font-medium text-ink">{T.marca.titulo}</p>
          <p className="mt-0.5 text-[11.5px] text-ink-3">
            {puestos > 0 ? T.marca.puestos(puestos) : T.marca.opcional}
          </p>
        </div>
        <span className={`shrink-0 transition-transform ${abierto ? 'rotate-180' : ''}`}>
          <Icono nombre="desplegar" tamano={16} color="#948DAE" grosor={2} />
        </span>
      </button>

      {abierto && (
        <div className="border-t border-line px-3.5 pb-3.5">
          <p className="mt-3 text-[11.5px] leading-[1.55] text-ink-3">{T.marca.pie}</p>

          {CLAVES_MARCA.map((clave) => {
            const crudo = marca[clave];
            const roto = !!tocados[clave] && crudo.trim() !== '' && normalizarMarca(clave, crudo) === '';
            return (
              <div key={clave} className="mt-3">
                <p className="text-[11.5px] uppercase tracking-[0.06em] text-ink-3">
                  {T.marca.campos[clave]}
                </p>

                {clave === 'logo' && (
                  <>
                    {/* El input de verdad no se pinta: cada navegador escribe
                        un texto distinto en su botón y no se le da estilo. */}
                    <input
                      ref={selector}
                      type="file"
                      accept={LOGO_ACEPTA}
                      className="hidden"
                      onChange={(e) => {
                        const archivo = e.target.files?.[0];
                        // Se vacía para que elegir DOS VECES el mismo archivo
                        // vuelva a disparar el evento; si no, reintentar tras
                        // un error no hacía nada.
                        e.target.value = '';
                        void tomarArchivo(archivo);
                      }}
                    />
                    <div className="mt-1.5 flex items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => selector.current?.click()}
                        disabled={preparando}
                        className="pulsable inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line px-3 py-2 text-[12.5px] font-medium text-ink-2 disabled:opacity-50"
                      >
                        <Icono nombre="imagen" tamano={14} color="#6A6280" grosor={1.8} />
                        {incrustado ? T.marca.cambiarLogo : T.marca.elegirLogo}
                      </button>
                      {incrustado && (
                        <>
                          <span className="min-w-0 grow truncate text-[11.5px] text-ink-3">
                            {T.marca.logoDentro(kbLogo)}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setFalloLogo(null);
                              onCambio({ ...marca, logo: '' });
                            }}
                            aria-label={T.marca.quitarLogo}
                            className="pulsable shrink-0 rounded-full border border-line p-1.5"
                          >
                            <Icono nombre="cerrar" tamano={13} color="#948DAE" grosor={2} />
                          </button>
                        </>
                      )}
                    </div>
                    {falloLogo && (
                      <p className="mt-1 text-[11.5px] text-terra">{T.marca.erroresLogo[falloLogo]}</p>
                    )}
                    <p className="mt-1 text-[11.5px] leading-[1.5] text-ink-3">
                      {incrustado ? T.marca.logoDentroPie : T.marca.oPegaUrl}
                    </p>
                  </>
                )}

                {/* Con la imagen dentro de la ficha el campo de URL sobra, y
                    dejarlo enseñando miles de caracteres de base64 sería
                    ilegible en una pantalla de teléfono. */}
                {!(clave === 'logo' && incrustado) && (
                  <input
                    value={crudo}
                    onChange={(e) => onCambio({ ...marca, [clave]: e.target.value })}
                    onBlur={() => setTocados((p) => ({ ...p, [clave]: true }))}
                    placeholder={T.marca.huecos[clave]}
                    inputMode={clave === 'logo' || clave === 'web' ? 'url' : 'text'}
                    spellCheck={false}
                    autoCapitalize="none"
                    aria-invalid={roto}
                    className={`mt-1.5 w-full rounded-[11px] border bg-sand px-3 py-2.5 font-mono text-[12.5px] text-ink outline-none placeholder:font-sans placeholder:text-ink-3 focus:border-honey ${
                      roto ? 'border-terra' : 'border-line'
                    }`}
                  />
                )}
                {roto && <p className="mt-1 text-[11.5px] text-terra">{T.marca.errores[clave]}</p>}
              </div>
            );
          })}

          {/*
            Cómo va a quedar. El logo lo sirve el dominio del agente, así que
            esto es además la única forma de enterarse aquí de que no carga: si
            no llega, se ve la inicial de siempre, que es lo que verá el mercado.
          */}
          <div className="mt-3.5 flex items-center gap-3 rounded-[11px] bg-sand px-3 py-2.5">
            <Hexagono
              semilla={semilla}
              inicial={(marca.web || semilla || 'A').replace(/^https?:\/\//, '').slice(0, 1)}
              tamano={40}
              logo={logoValido || undefined}
            />
            <p className="text-[11.5px] leading-[1.5] text-ink-3">
              {logoValido ? T.marca.vistaConLogo : T.marca.vistaSinLogo}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
