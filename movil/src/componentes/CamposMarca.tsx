import { useState } from 'react';
import { CLAVES_MARCA, normalizarMarca, type ClaveMarca, type Marca } from '@/lib/marca';
import Hexagono from '~/componentes/Hexagono';
import Icono from '~/componentes/Icono';
import { useTextos } from '~/i18n/idiomas';

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
  const [abierto, setAbierto] = useState(() => CLAVES_MARCA.some((c) => marca[c] !== ''));
  const [tocados, setTocados] = useState<Partial<Record<ClaveMarca, boolean>>>({});

  const puestos = CLAVES_MARCA.filter((c) => normalizarMarca(c, marca[c]) !== '').length;
  const logoValido = normalizarMarca('logo', marca.logo);

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
