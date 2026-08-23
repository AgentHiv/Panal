import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useWallet } from '@/hooks/useWallet';
import { activeChain } from '@/contracts/config';
import { useSaldos } from '~/lib/usarSaldos';
import { copiar } from '~/lib/wallets';
import Icono from '~/componentes/Icono';

/**
 * El saldo.
 *
 * Era un botón «Conectar wallet» pegado al título sobre una pantalla entera
 * vacía, y el botón además no hacía nada. Ahora es lo que tiene que ser: qué
 * tienes, en qué se gasta cada cosa y cuál es tu dirección para recibir.
 *
 * Las dos monedas van separadas y con su explicación al lado a propósito. Es la
 * pregunta que de verdad se hace quien abre esta pantalla —«¿puedo pagar lo que
 * quiero hacer?»— y la respuesta depende de CUÁL de las dos tengas: con $PANAL
 * y cero MON se puede hablar con un agente, pero no encargarle un trabajo.
 */
export default function Saldo(): React.ReactElement {
  const { address, addressShort, connected, connecting, connect, disconnect, wrongNetwork, switchToMonad } =
    useWallet();
  const { panal, mon, cargando } = useSaldos();
  const [copiado, setCopiado] = useState(false);

  const alCopiar = async (): Promise<void> => {
    if (!address) return;
    if (await copiar(address)) {
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2200);
    }
  };

  return (
    <div className="flex min-h-0 grow flex-col">
      <header className="shrink-0 px-5 pb-3 pt-5">
        <h1 className="font-display text-[26px] font-semibold -tracking-[0.015em]">Saldo</h1>
      </header>

      {!connected ? (
        <SinWallet conectando={connecting} onConectar={connect} />
      ) : (
        <div className="flex min-h-0 grow flex-col gap-3 overflow-y-auto px-5 pb-5">
          {wrongNetwork && (
            <div className="shrink-0 rounded-[14px] border border-terra/40 bg-terra/10 p-3.5">
              <div className="flex items-center gap-2">
                <Icono nombre="info" tamano={16} color="#C9653B" />
                <p className="text-[13px] font-semibold text-terra">Wallet en otra red</p>
              </div>
              <p className="mt-1.5 text-[12px] leading-[1.5] text-ink-2">
                Panal vive en {activeChain.name}. Mientras tu wallet esté en otra red no se puede
                firmar nada.
              </p>
              <button
                type="button"
                onClick={switchToMonad}
                className="pulsable tocable mt-3 w-full rounded-full bg-terra py-2.5 text-[14px] font-semibold text-white"
              >
                Cambiar a {activeChain.name}
              </button>
            </div>
          )}

          <Moneda
            simbolo="$PANAL"
            color="#E29A2E"
            valor={panal?.texto ?? null}
            cargando={cargando}
            paraQue="Paga cada mensaje que le mandas a un agente."
            pie="Hablar no gasta gas: en x402 firmas tú y la transacción la manda quien cobra."
          />

          <Moneda
            simbolo="MON"
            color="#B7A8FC"
            valor={mon?.texto ?? null}
            cargando={cargando}
            paraQue="Paga los encargos con escrow, y el gas de bloquearlos."
            pie="Sin MON puedes hablar, pero no encargar un trabajo."
          />

          {/* La dirección va abajo y entera: es para recibir, no para mirarla. */}
          <div className="shrink-0 rounded-[14px] border border-line p-3.5">
            <p className="text-[11.5px] uppercase tracking-[0.06em] text-ink-3">Tu dirección</p>
            <p className="seleccionable mt-2 break-all font-mono text-[12.5px] leading-[1.5] text-ink-2">
              {address}
            </p>
            <button
              type="button"
              onClick={alCopiar}
              className="pulsable tocable mt-3 flex w-full items-center justify-center gap-2 rounded-full border border-line py-2.5 text-[13.5px] font-medium text-ink-2"
            >
              <Icono
                nombre={copiado ? 'check' : 'copiar'}
                tamano={15}
                color={copiado ? '#92A268' : '#948DAE'}
              />
              {copiado ? 'Copiada' : 'Copiar dirección'}
            </button>
            <p className="mt-2.5 text-[11.5px] leading-[1.5] text-ink-3">
              $PANAL se cambia en nad.fun, y MON lo traes aquí desde donde ya tengas. Panal no vende
              ninguna de las dos.
            </p>
          </div>

          {/* El llavero cuelga de aquí y no de una pestaña propia: es otra
              forma de tener una wallet, así que vive donde se mira la que hay. */}
          <Link
            to="/llavero"
            className="pulsable flex shrink-0 items-center gap-3 rounded-[14px] border border-line p-3.5"
          >
            <Icono nombre="llave" tamano={18} color="#E29A2E" className="shrink-0" />
            <div className="min-w-0 grow">
              <p className="text-[13.5px] font-medium">Tu llavero</p>
              <p className="mt-0.5 text-[11.5px] leading-[1.45] text-ink-3">
                Crea wallets en este teléfono. La clave se cifra con un PIN y no sale de aquí.
              </p>
            </div>
            <Icono nombre="atras" tamano={15} color="#948DAE" className="rotate-180" />
          </Link>

          <button
            type="button"
            onClick={disconnect}
            className="pulsable tocable mt-1 shrink-0 rounded-full py-3 text-center text-[13.5px] font-medium text-ink-3"
          >
            Desconectar {addressShort}
          </button>
        </div>
      )}
    </div>
  );
}

function Moneda({
  simbolo,
  color,
  valor,
  cargando,
  paraQue,
  pie,
}: {
  simbolo: string;
  color: string;
  valor: string | null;
  cargando: boolean;
  paraQue: string;
  pie: string;
}): React.ReactElement {
  return (
    <div className="shrink-0 rounded-[18px] border border-line bg-cream p-[18px]">
      <div className="flex items-baseline gap-2">
        {cargando && valor === null ? (
          <span className="my-1 block h-7 w-24 animate-pulse rounded bg-sand" />
        ) : (
          <span className="font-mono text-[30px] font-medium leading-none" style={{ color }}>
            {valor ?? '—'}
          </span>
        )}
        <span className="text-[14px] font-semibold" style={{ color }}>
          {simbolo}
        </span>
      </div>
      <p className="mt-2.5 text-[13px] leading-[1.5] text-ink-2">{paraQue}</p>
      <p className="mt-1 text-[11.5px] leading-[1.5] text-ink-3">{pie}</p>
    </div>
  );
}

/** Sin wallet no hay saldo que enseñar, así que la pantalla es la puerta. */
function SinWallet({
  conectando,
  onConectar,
}: {
  conectando: boolean;
  onConectar: () => void;
}): React.ReactElement {
  return (
    <div className="flex min-h-0 grow flex-col items-center justify-center px-6 pb-10">
      <svg width="72" height="72" viewBox="0 0 40 40" className="opacity-90" aria-hidden>
        <polygon
          points="20,2 36,11 36,29 20,38 4,29 4,11"
          fill="#1A1726"
          stroke="#342E4A"
          strokeWidth="1.4"
        />
        <path
          d="M13 20.5l4 4 9-9"
          fill="none"
          stroke="#342E4A"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      <h2 className="mt-5 text-center font-display text-[20px] font-semibold -tracking-[0.015em]">
        Conecta tu wallet
      </h2>
      <p className="mt-2 max-w-[280px] text-pretty text-center text-[13.5px] leading-[1.55] text-ink-2">
        Es tu cuenta y tu saldo a la vez. No hay registro, ni correo, ni contraseña que recordar.
      </p>

      <button
        type="button"
        onClick={onConectar}
        disabled={conectando}
        className="pulsable mt-7 flex h-[52px] w-full max-w-[300px] items-center justify-center gap-2 rounded-full bg-monad text-[15px] font-semibold text-white shadow-monad disabled:opacity-60"
      >
        {conectando ? 'Conectando…' : 'Conectar wallet'}
      </button>
    </div>
  );
}
