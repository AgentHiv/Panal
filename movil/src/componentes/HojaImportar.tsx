import { useState } from 'react';
import Hoja, { Boton, Nota } from '~/componentes/Hoja';
import { importarWallet } from '~/lib/llavero';
import type { Llave, WalletGuardada } from '~/lib/llavero';
import { claseDeSecreto } from '~/lib/envio';

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
}: {
  llave: Llave;
  onCerrar: () => void;
  onHecho: (w: WalletGuardada) => void;
}): React.ReactElement {
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
        setPega(r.pega);
        return;
      }
      setSecreto('');
      onHecho(r.wallet);
    } catch {
      setPega('No se ha podido guardar en este teléfono.');
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Hoja abierta titulo="Traer una wallet" onCerrar={onCerrar} bloqueada={ocupado}>
      <p className="mt-1.5 text-[13.5px] leading-[1.55] text-ink-2">
        Pega sus 12 o 24 palabras, o su clave privada. Se guarda cifrada con el mismo PIN que el
        resto del llavero.
      </p>

      <label className="mt-4 block text-[11.5px] uppercase tracking-[0.06em] text-ink-3">
        Palabras o clave
      </label>
      <textarea
        value={secreto}
        onChange={(e) => setSecreto(e.target.value)}
        rows={4}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder="abandon ability able…  ·  o  0x…"
        className="mt-2 w-full resize-none rounded-[12px] border border-line bg-cream px-3.5 py-3 font-mono text-[13px] leading-[1.6] outline-none placeholder:text-ink-3 focus:border-monad"
      />
      {clase && (
        <p className="mt-1.5 text-[11.5px] text-ink-3">
          {clase === 'clave' ? 'Parece una clave privada.' : 'Parecen palabras de recuperación.'}
        </p>
      )}

      <label className="mt-4 block text-[11.5px] uppercase tracking-[0.06em] text-ink-3">
        Cómo la llamas
      </label>
      <input
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        placeholder="Importada"
        maxLength={28}
        className="mt-2 w-full rounded-[12px] border border-line bg-cream px-3.5 py-3 text-[14px] outline-none placeholder:text-ink-3 focus:border-monad"
      />

      {pega && <p className="mt-3 text-[12.5px] leading-[1.5] text-terra">{pega}</p>}

      <Nota tono="miel">
        Escribe esto solo si el teléfono es tuyo y nadie mira. Quien tenga estas palabras puede
        vaciar la wallet desde cualquier sitio, sin el móvil y sin el PIN.
      </Nota>

      <div className="mt-[18px] pb-1">
        <Boton onClick={() => void alImportar()} disabled={ocupado || !secreto.trim()}>
          {ocupado ? 'Comprobando…' : 'Traerla al llavero'}
        </Boton>
      </div>
    </Hoja>
  );
}
