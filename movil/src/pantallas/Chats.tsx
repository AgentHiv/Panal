import { useWallet } from '@/hooks/useWallet';
import Arranque from '~/pantallas/Arranque';

/**
 * La bandeja. Se abre aquí, como cualquier app de mensajería.
 *
 * Sin wallet o sin conversaciones se enseña el arranque, que es la pantalla
 * que más gente va a ver una sola vez en su vida y la que decide si se quedan.
 */
export default function Chats(): React.ReactElement {
  const { connected } = useWallet();

  // El historial todavía no está portado desde la web; hasta entonces, arranque.
  const hilos: never[] = [];

  if (!connected || hilos.length === 0) return <Arranque />;

  return (
    <div className="flex min-h-0 grow flex-col">
      <header className="con-barra-arriba shrink-0 px-5 pb-3 pt-5">
        <h1 className="font-display text-[26px] font-semibold -tracking-[0.015em]">Chats</h1>
      </header>
    </div>
  );
}
