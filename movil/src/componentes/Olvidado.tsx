import { useState } from 'react';
import Icono from '~/componentes/Icono';
import type { Textos } from '~/i18n/idiomas';

/**
 * La salida del PIN olvidado.
 *
 * Existe porque desde que el PIN se pide al abrir la app, olvidarlo ya no deja
 * a nadie sin sus wallets: lo deja sin la aplicación, delante de un teclado que
 * no se puede pasar y que no lleva a ningún sitio. Sin esta pantalla la única
 * salida sería desinstalar, que borra exactamente lo mismo pero sin avisar de
 * nada.
 *
 * NO PROMETE RECUPERAR NADA, y no es un descuido: no se puede. La clave está
 * cifrada con el PIN y sin él no hay forma de descifrarla —ni aquí, ni con el
 * código delante, ni con el teléfono en la mano—. Lo único honesto que se puede
 * ofrecer es empezar de cero, y decir con todas las letras qué se pierde: una
 * wallet cuyas doce palabras no estén apuntadas fuera del teléfono no la
 * recupera nadie.
 *
 * Por eso el botón que borra no está a un toque. El primero enseña lo que pasa;
 * el segundo lo hace.
 */
export default function Olvidado({
  onBorrar,
  onVolver,
  T,
}: {
  onBorrar: () => void;
  onVolver: () => void;
  T: Textos;
}): React.ReactElement {
  const [seguro, setSeguro] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-paper">
      <div className="con-barra-arriba flex shrink-0 items-center px-4 pt-3">
        <button
          type="button"
          onClick={onVolver}
          className="pulsable tocable flex items-center gap-1.5 rounded-full px-2 py-1.5 text-[13px] font-medium text-ink-3"
        >
          <Icono nombre="atras" tamano={15} color="#948DAE" />
          {T.olvidado.volver}
        </button>
      </div>

      <div className="flex min-h-0 grow flex-col justify-center px-6 pb-8">
        <h1 className="shrink-0 text-pretty font-display text-[23px] font-semibold -tracking-[0.015em]">
          {T.olvidado.titulo}
        </h1>
        <p className="mt-3 shrink-0 text-[13.5px] leading-[1.6] text-ink-2">{T.olvidado.texto}</p>

        <div className="mt-5 flex shrink-0 gap-2.5 rounded-[14px] border border-honey-line bg-honey-soft p-3.5">
          <Icono nombre="llave" tamano={16} color="#E29A2E" grosor={2} className="mt-px shrink-0" />
          <p className="text-[12.5px] leading-[1.55] text-ink-2">{T.olvidado.conPalabras}</p>
        </div>

        {seguro ? (
          <>
            <div className="mt-5 flex shrink-0 gap-2.5 rounded-[14px] border border-terra/40 bg-terra/10 p-3.5">
              <Icono nombre="info" tamano={16} color="#C9653B" grosor={2} className="mt-px shrink-0" />
              <p className="text-[12.5px] leading-[1.55] text-ink-2">{T.olvidado.seguroTexto}</p>
            </div>
            <button
              type="button"
              onClick={onBorrar}
              className="pulsable tocable mt-4 shrink-0 rounded-full bg-terra py-3.5 text-[15px] font-semibold text-white"
            >
              {T.olvidado.borrarSeguro}
            </button>
            <button
              type="button"
              onClick={() => setSeguro(false)}
              className="pulsable tocable mt-2.5 shrink-0 rounded-full border border-line py-3 text-[14px] font-medium text-ink-2"
            >
              {T.comun.cancelar}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setSeguro(true)}
            className="pulsable tocable mt-6 shrink-0 rounded-full border border-terra/50 py-3.5 text-[14.5px] font-semibold text-terra"
          >
            {T.olvidado.borrar}
          </button>
        )}
      </div>
    </div>
  );
}
