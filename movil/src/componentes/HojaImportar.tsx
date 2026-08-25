import { useState } from 'react';
import Hoja, { Boton, Nota } from '~/componentes/Hoja';
import { importarWallet } from '~/lib/llavero';
import type { Llave, WalletGuardada } from '~/lib/llavero';
import { claseDeSecreto } from '~/lib/envio';
import { useSinCapturas } from '~/lib/pantalla';
import type { Textos } from '~/i18n/idiomas';

/**
 * Traer al llavero una wallet que ya existe.
 *
 * Admite las dos formas en que la gente tiene guardada una wallet: las doce
 * (o veinticuatro) palabras, y la clave privada suelta. La segunda no es un
 * capricho — un agente de Panal guarda su clave así, en un `.env`, y traerla
 * aquí es lo que convierte el teléfono en el mando de ese agente.
 *
 * Lo que se escribe NO se limpia a mano: el número de la lista, las comas y las
 * mayúsculas los quita `limpiarFrase`. Pedirle a alguien que edite doce
 * palabras en el teclado de un móvil es pedirle que se equivoque en una.
 */
export default function HojaImportar({
  llave,
  onCerrar,
  onHecho,
  T,
}: {
  llave: Llave;
  onCerrar: () => void;
  onHecho: (w: WalletGuardada) => void;
  T: Textos;
}): React.ReactElement {
  // Aquí también: lo que se pega en esa casilla son las mismas doce palabras
  // que en la otra pantalla, y una captura las guarda igual de bien.
  useSinCapturas();

  const [nombre, setNombre] = useState('');
  const [secreto, setSecreto] = useState('');
  const [pega, setPega] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const clase = secreto.trim() ? claseDeSecreto(secreto) : null;

  const alImportar = async (): Promise<void> => {
    setOcupado(true);
    setPega(null);
    try {
      const r = await importarWallet(llave, nombre, secreto);
      if (!r.ok) {
        setPega(T.pegas[r.pega]);
        return;
      }
      setSecreto('');
      onHecho(r.wallet);
    } catch {
      setPega(T.importar.noSePudo);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Hoja abierta titulo={T.importar.titulo} onCerrar={onCerrar} bloqueada={ocupado}>
      <p className="mt-1.5 text-[13.5px] leading-[1.55] text-ink-2">{T.importar.texto}</p>

      <label className="mt-4 block text-[11.5px] uppercase tracking-[0.06em] text-ink-3">
        {T.importar.etiqueta}
      </label>
      <textarea
        value={secreto}
        onChange={(e) => setSecreto(e.target.value)}
        rows={4}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder={T.importar.hueco}
        className="mt-2 w-full resize-none rounded-[12px] border border-line bg-cream px-3.5 py-3 font-mono text-[13px] leading-[1.6] outline-none placeholder:text-ink-3 focus:border-monad"
      />
      {clase && (
        <p className="mt-1.5 text-[11.5px] text-ink-3">
          {clase === 'clave' ? T.importar.pareceClave : T.importar.parecenPalabras}
        </p>
      )}

      <label className="mt-4 block text-[11.5px] uppercase tracking-[0.06em] text-ink-3">
        {T.importar.comoLaLlamas}
      </label>
      <input
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        placeholder={T.importar.huecoNombre}
        maxLength={28}
        className="mt-2 w-full rounded-[12px] border border-line bg-cream px-3.5 py-3 text-[14px] outline-none placeholder:text-ink-3 focus:border-monad"
      />

      {pega && <p className="mt-3 text-[12.5px] leading-[1.5] text-terra">{pega}</p>}

      <Nota tono="miel">{T.importar.aviso}</Nota>

      <div className="mt-[18px] pb-1">
        <Boton onClick={() => void alImportar()} disabled={ocupado || !secreto.trim()}>
          {ocupado ? T.importar.comprobando : T.importar.boton}
        </Boton>
      </div>
    </Hoja>
  );
}
