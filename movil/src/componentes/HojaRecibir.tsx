import { useState } from 'react';
import { Share } from '@capacitor/share';
import { Capacitor } from '@capacitor/core';
import { activeChain } from '@/contracts/config';
import Hoja, { Nota } from '~/componentes/Hoja';
import Icono from '~/componentes/Icono';
import { copiar } from '~/lib/wallets';
import type { Textos } from '~/i18n/idiomas';

/**
 * Meterle dinero a una wallet del llavero.
 *
 * No hay nada que firmar aquí: recibir es que otro mande. Lo único que hace
 * falta es la dirección, y lo único que puede salir mal es que se copie a
 * medias — por eso va entera y en monoespaciada, y el botón copia siempre la
 * cadena completa y no lo que se ve.
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
  T,
}: {
  /**
   * Lo mínimo para recibir: una dirección y cómo llamarla.
   *
   * Era `WalletGuardada`, la del llavero, y eso dejaba fuera a la wallet
   * conectada por WalletConnect — que también recibe, porque recibir no exige
   * firmar nada. `WalletGuardada` encaja aquí sin tocar quien ya la pasaba.
   */
  wallet: { direccion: string; nombre: string };
  onCerrar: () => void;
  T: Textos;
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
        title: T.recibir.titulo(wallet.nombre),
        text: wallet.direccion,
        dialogTitle: T.recibir.compartir,
      });
    } catch {
      /* cerrar el selector no es un fallo */
    }
  };

  return (
    <Hoja abierta titulo={T.recibir.titulo(wallet.nombre)} onCerrar={onCerrar}>
      <p className="mt-1.5 text-[13.5px] leading-[1.55] text-ink-2">{T.recibir.texto}</p>

      <div className="mt-4 rounded-[14px] border border-line bg-cream p-4">
        <p className="text-[11.5px] uppercase tracking-[0.06em] text-ink-3">{T.comun.suDireccion}</p>
        {/* Entera y de corrido, no en grupos de cuatro. Aquí la dirección es
            TUYA y lo normal es copiarla o compartirla, no cantarla dígito a
            dígito: los espacios solo la hacían parecer rota. En `HojaEnviar`
            sigue troceada, y ahí sí importa — es una dirección ajena que estás
            comprobando antes de mandarle dinero.

            `break-all` porque una dirección no tiene espacios donde partir: sin
            él, el navegador la trata como una palabra de 42 letras y la deja
            desbordar la tarjeta. */}
        <p className="seleccionable mt-2.5 break-all font-mono text-[14px] leading-[1.7] tracking-[0.02em]">
          {wallet.direccion}
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
          {copiado ? T.comun.copiada : T.comun.copiar}
        </button>
        <button
          type="button"
          onClick={() => void alCompartir()}
          className="pulsable tocable flex grow items-center justify-center gap-2 rounded-full border border-line py-2.5 text-[13.5px] font-medium text-ink-2"
        >
          <Icono nombre="fuera" tamano={15} color="#948DAE" />
          {T.recibir.compartir}
        </button>
      </div>

      {/* La red equivocada es la forma más común de perder dinero recibiendo, y
          no la avisa nadie: la transacción sale bien, solo que en otra cadena. */}
      <Nota tono="miel">{T.recibir.redAviso(activeChain.name, activeChain.id)}</Nota>

      <Nota>{T.recibir.gasAviso}</Nota>

      <div className="pb-2" />
    </Hoja>
  );
}
