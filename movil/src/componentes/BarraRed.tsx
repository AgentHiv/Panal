import { useWallet } from '@/hooks/useWallet';
import { activeChain } from '@/contracts/config';
import Icono from '~/componentes/Icono';

/**
 * La wallet está conectada pero en otra red.
 *
 * Va arriba del todo y en TODAS las pantallas a propósito. Con la wallet en
 * otra cadena, nada de lo que hace la app funciona —ni firmar un permit de
 * x402, ni bloquear un escrow, ni leer un saldo— pero la app se ve entera y
 * normal: se descubre al firmar, con la wallet ya abierta y un error suyo que
 * no explica nada. Enseñarlo antes convierte diez minutos de confusión en un
 * toque.
 */
export default function BarraRed(): React.ReactElement | null {
  const { wrongNetwork, switchToMonad } = useWallet();
  if (!wrongNetwork) return null;

  return (
    <button
      type="button"
      onClick={switchToMonad}
      className="pulsable flex w-full shrink-0 items-center gap-2 bg-terra px-4 py-2 text-left"
    >
      <Icono nombre="info" tamano={15} color="#fff" grosor={2} />
      <span className="grow text-[12.5px] font-semibold text-white">
        Tu wallet está en otra red
      </span>
      <span className="shrink-0 text-[12.5px] font-semibold text-white underline">
        Cambiar a {activeChain.name}
      </span>
    </button>
  );
}
