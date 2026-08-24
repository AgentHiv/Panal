import { useState } from 'react';
import { Share } from '@capacitor/share';
import { Capacitor } from '@capacitor/core';
import { activeChain } from '@/contracts/config';
import Hoja, { Nota } from '~/componentes/Hoja';
import Icono from '~/componentes/Icono';
import { copiar } from '~/lib/wallets';
import { troceada } from '~/lib/formato';
import type { WalletGuardada } from '~/lib/llavero';

/**
 * Meterle dinero a una wallet del llavero.
 *
 * No hay nada que firmar aquí: recibir es que otro mande. Lo único que hace
 * falta es la dirección, y lo único que puede salir mal es que se copie a
 * medias — por eso va entera, en monoespaciada y partida en trozos de cuatro,
 * que es como se comprueba una dirección a ojo.
 *
 * Sin código QR, y conviene decir por qué: la única librería de QR del
 * repositorio es una dependencia de la web, y el APK no la declara. Meterla
 * aquí obligaría a tocar el lockfile del monorepo entero para una comodidad
 * que en un teléfono se resuelve con «Compartir» —te mandas la dirección a ti
 * mismo por donde quieras— o pegándola en la otra wallet, que casi siempre
 * está en este mismo móvil.
 */
export default function HojaRecibir({
  wallet,
  onCerrar,
}: {
  wallet: WalletGuardada;
  onCerrar: () => void;
}): React.ReactElement {
  const [copiado, setCopiado] = useState(false);

  const alCopiar = async (): Promise<void> => {
    if (await copiar(wallet.direccion)) {
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2200);
    }
  };

  const alCompartir = async (): Promise<void> => {
    if (!Capacitor.isNativePlatform()) {
      void alCopiar();
      return;
    }
    try {
      await Share.share({
        title: `Dirección de ${wallet.nombre}`,
        text: wallet.direccion,
        dialogTitle: 'Mandar la dirección',
      });
    } catch {
      /* cerrar el selector no es un fallo */
    }
  };

  return (
    <Hoja abierta titulo={`Meterle a ${wallet.nombre}`} onCerrar={onCerrar}>
      <p className="mt-1.5 text-[13.5px] leading-[1.55] text-ink-2">
        Manda MON o $PANAL a esta dirección desde donde ya los tengas: tu otra wallet, un exchange,
        otra persona.
      </p>

      <div className="mt-4 rounded-[14px] border border-line bg-cream p-4">
        <p className="text-[11.5px] uppercase tracking-[0.06em] text-ink-3">Su dirección</p>
        <p className="seleccionable mt-2.5 font-mono text-[14px] leading-[1.7] tracking-[0.02em]">
          {troceada(wallet.direccion)}
        </p>
      </div>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => void alCopiar()}
          className="pulsable tocable flex grow items-center justify-center gap-2 rounded-full border border-line py-2.5 text-[13.5px] font-medium text-ink-2"
        >
          <Icono
            nombre={copiado ? 'check' : 'copiar'}
            tamano={15}
            color={copiado ? '#92A268' : '#948DAE'}
          />
          {copiado ? 'Copiada' : 'Copiar'}
        </button>
        <button
          type="button"
          onClick={() => void alCompartir()}
          className="pulsable tocable flex grow items-center justify-center gap-2 rounded-full border border-line py-2.5 text-[13.5px] font-medium text-ink-2"
        >
          <Icono nombre="fuera" tamano={15} color="#948DAE" />
          Compartir
        </button>
      </div>

      {/* La red equivocada es la forma más común de perder dinero recibiendo, y
          no la avisa nadie: la transacción sale bien, solo que en otra cadena. */}
      <Nota tono="miel">
        Tiene que salir por {activeChain.name} ({activeChain.id}). La misma dirección existe en otras
        redes, y lo que llegue por otra no aparece aquí ni se puede recuperar desde la app.
      </Nota>

      <Nota>
        Deja algo de MON aunque solo vayas a mover $PANAL: la comisión de red se paga en MON, y una
        wallet con $PANAL y cero MON no puede mandar nada.
      </Nota>

      <div className="pb-2" />
    </Hoja>
  );
}
