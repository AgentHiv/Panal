import { useWallet } from '@/hooks/useWallet';

export default function Saldo(): React.ReactElement {
  const { addressShort, connected, connect } = useWallet();

  return (
    <div className="flex min-h-0 grow flex-col">
      <header className="con-barra-arriba shrink-0 px-5 pb-3 pt-5">
        <h1 className="font-display text-[26px] font-semibold -tracking-[0.015em]">Saldo</h1>
      </header>

      <div className="min-h-0 grow overflow-y-auto px-5">
        {connected ? (
          <div className="rounded-[18px] border border-line bg-cream p-[18px]">
            <div className="flex items-center gap-2">
              <svg width="15" height="15" viewBox="0 0 40 40" aria-hidden>
                <polygon
                  points="20,2 36,11 36,29 20,38 4,29 4,11"
                  fill="none"
                  stroke="#948DAE"
                  strokeWidth="2.4"
                />
              </svg>
              <span className="seleccionable font-mono text-[12px] text-ink-3">{addressShort}</span>
            </div>
            <p className="mt-4 text-[13px] leading-relaxed text-ink-3">
              Los saldos y los movimientos entran cuando se porte el hilo.
            </p>
          </div>
        ) : (
          <button
            type="button"
            onClick={connect}
            className="pulsable h-[52px] w-full rounded-full bg-monad text-[15px] font-semibold text-white shadow-monad"
          >
            Conectar wallet
          </button>
        )}
      </div>
    </div>
  );
}
