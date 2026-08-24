import Icono from '~/componentes/Icono';
import { abrirFuera } from '~/lib/wallets';
import { useTextos } from '~/i18n/idiomas';

/**
 * «Hay algo esperando tu firma en la wallet».
 *
 * Existe porque una redirección puede fallar siempre: la wallet puede no haber
 * mandado su enlace de vuelta, el sistema puede no asociarlo, o la persona
 * puede volver a Panal sin firmar. En cualquiera de esos casos, sin esto la
 * app se queda quieta sin decir nada y parece rota —que es literalmente el
 * fallo que se estaba arreglando—.
 *
 * Va abajo y no en una hoja porque no hay nada que decidir aquí: lo que se
 * decide está en la otra app. Esto solo dice dónde mirar.
 */
export default function AvisoFirma({
  visible,
  enlace,
}: {
  visible: boolean;
  enlace: string | null;
}): React.ReactElement | null {
  const T = useTextos();
  if (!visible) return null;

  return (
    <div className="con-barra-abajo fixed inset-x-0 bottom-0 z-40 border-t border-honey-line bg-honey-soft px-5 pt-3.5">
      <div className="flex items-start gap-2.5">
        <span className="mt-px h-4 w-4 shrink-0 animate-pulse rounded-full bg-honey/40" />
        <div className="min-w-0 grow">
          <p className="text-[13px] font-semibold text-honey">{T.avisoFirma.titulo}</p>
          <p className="mt-1 text-[12px] leading-[1.5] text-ink-2">
            {enlace ? T.avisoFirma.conEnlace : T.avisoFirma.sinEnlace}
          </p>
        </div>
      </div>

      {enlace && (
        <button
          type="button"
          onClick={() => abrirFuera(enlace)}
          className="pulsable tocable mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-honey py-2.5 text-[14px] font-semibold text-paper"
        >
          <Icono nombre="fuera" tamano={15} color="#161320" grosor={2} />
          {T.avisoFirma.abrir}
        </button>
      )}
    </div>
  );
}
