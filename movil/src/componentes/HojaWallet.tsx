import { useState } from 'react';
import { WALLETS, abrirFuera, copiar } from '~/lib/wallets';
import Icono from '~/componentes/Icono';

/**
 * La hoja de conectar la wallet.
 *
 * Es la única puerta de la app: sin esto no se puede hablar con un agente, ni
 * encargar, ni ver un saldo. Antes era un botón que no hacía nada.
 *
 * Sube desde abajo y no ocupa la pantalla entera a propósito: conectar no es
 * un trámite de registro, es un momento dentro de lo que estabas haciendo, y
 * al volver de la wallet quieres reconocer dónde estabas.
 */
export default function HojaWallet({
  abierta,
  uri,
  hayWalletConnect,
  fallo,
  onCerrar,
}: {
  abierta: boolean;
  uri: string | null;
  hayWalletConnect: boolean;
  fallo: string | null;
  onCerrar: () => void;
}): React.ReactElement | null {
  const [copiado, setCopiado] = useState(false);

  if (!abierta) return null;

  const alCopiar = async (): Promise<void> => {
    if (!uri) return;
    const ok = await copiar(uri);
    setCopiado(ok);
    if (ok) window.setTimeout(() => setCopiado(false), 2200);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-[rgba(12,10,18,.72)]">
      <button type="button" aria-label="Cerrar" className="grow" onClick={onCerrar} />

      <div className="con-barra-abajo max-h-[92%] overflow-y-auto rounded-t-[22px] border-t border-line bg-cream px-5 pt-2.5 shadow-hoja">
        <div className="mx-auto mb-4 h-1 w-[38px] rounded-full bg-line" />

        <h2 className="font-display text-[21px] font-semibold -tracking-[0.015em]">
          Conectar tu wallet
        </h2>
        <p className="mt-1.5 text-[13.5px] leading-[1.55] text-ink-2">
          Tu wallet es tu cuenta. Panal no guarda ninguna clave ni te pide correo.
        </p>

        {!hayWalletConnect ? (
          <SinWalletConnect />
        ) : fallo ? (
          <Fallo texto={fallo} />
        ) : !uri ? (
          <Esperando />
        ) : (
          <>
            {/* Lo primero es lo genérico: Android saca el selector con TODAS
                las wallets que tenga instaladas. No hay que reconocer ninguna
                marca de una lista. */}
            <button
              type="button"
              onClick={() => abrirFuera(uri)}
              className="pulsable mt-5 flex h-[54px] w-full items-center justify-center gap-2.5 rounded-full bg-monad text-[15px] font-semibold text-white shadow-monad"
            >
              <Icono nombre="fuera" tamano={18} color="#fff" grosor={2} />
              Abrir mi wallet
            </button>
            <p className="mt-2 text-center text-[11.5px] leading-[1.45] text-ink-3">
              Se abre la wallet que tengas instalada, apruebas allí y vuelves aquí.
            </p>

            <div className="mt-5 flex items-center gap-3">
              <div className="h-px grow bg-line" />
              <span className="text-[11px] uppercase tracking-[0.06em] text-ink-3">
                o elige la tuya
              </span>
              <div className="h-px grow bg-line" />
            </div>

            <ul className="mt-3 overflow-hidden rounded-[14px] border border-line">
              {WALLETS.map((w, i) => (
                <li key={w.id}>
                  {i > 0 && <div className="h-px bg-line" />}
                  <button
                    type="button"
                    onClick={() => abrirFuera(w.enlace(uri))}
                    className="pulsable tocable flex w-full items-center gap-3 px-3.5 py-3"
                  >
                    <SelloHex color={w.color} sigla={w.sigla} />
                    <span className="grow text-left text-[14px] font-medium">{w.nombre}</span>
                    <Icono nombre="fuera" tamano={15} color="#948DAE" />
                  </button>
                </li>
              ))}
            </ul>

            {/* La salida que funciona SIEMPRE. Si no hay ninguna wallet que
                sepa abrir un enlace `wc:`, tocar cualquier botón de arriba no
                hace nada visible —Android no encuentra a quién dárselo— y sin
                esto volveríamos al botón mudo que estamos arreglando. */}
            <button
              type="button"
              onClick={alCopiar}
              className="pulsable tocable mt-3 flex w-full items-center justify-center gap-2 rounded-full border border-line py-3 text-[13.5px] font-medium text-ink-2"
            >
              <Icono nombre={copiado ? 'check' : 'copiar'} tamano={16} color={copiado ? '#92A268' : '#948DAE'} />
              {copiado ? 'Enlace copiado' : 'Copiar el enlace'}
            </button>
            <p className="mt-2 pb-1 text-center text-[11.5px] leading-[1.45] text-ink-3">
              Para pegarlo a mano en tu wallet, en «escanear» o «conectar».
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function SelloHex({ color, sigla }: { color: string; sigla: string }): React.ReactElement {
  return (
    <svg width="32" height="32" viewBox="0 0 40 40" className="shrink-0" aria-hidden>
      <polygon points="20,2 36,11 36,29 20,38 4,29 4,11" fill="#232035" stroke={color} strokeWidth="1.3" />
      <text
        x="20"
        y="25.5"
        textAnchor="middle"
        fontFamily="Space Grotesk, sans-serif"
        fontSize="14"
        fontWeight="700"
        fill={color}
      >
        {sigla}
      </text>
    </svg>
  );
}

function Esperando(): React.ReactElement {
  return (
    <div className="flex flex-col items-center gap-3 py-10">
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-line border-t-monad" />
      <p className="text-[13px] text-ink-3">Preparando la conexión…</p>
    </div>
  );
}

function Fallo({ texto }: { texto: string }): React.ReactElement {
  return (
    <div className="mt-4 flex gap-2.5 rounded-xl border border-terra/40 bg-terra/10 px-3.5 py-3">
      <Icono nombre="info" tamano={16} color="#C9653B" className="mt-px shrink-0" />
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-terra">No se pudo conectar</p>
        <p className="seleccionable mt-1 break-words text-[12px] leading-[1.5] text-ink-2">{texto}</p>
      </div>
    </div>
  );
}

/**
 * El paquete se compiló sin `VITE_WALLETCONNECT_PROJECT_ID`.
 *
 * Se dice en voz alta en vez de enseñar una lista de wallets que no van a
 * poder abrirse: es un fallo de compilación, no del teléfono, y quien lo lea
 * puede contarlo tal cual.
 */
function SinWalletConnect(): React.ReactElement {
  return (
    <div className="mt-4 flex gap-2.5 rounded-xl bg-sand px-3.5 py-3">
      <Icono nombre="info" tamano={16} color="#948DAE" className="mt-px shrink-0" />
      <p className="text-[12px] leading-[1.55] text-ink-3">
        Esta versión se compiló sin WalletConnect, así que no hay forma de abrir una wallet desde
        aquí. Hace falta compilar el APK con <span className="font-mono">VITE_WALLETCONNECT_PROJECT_ID</span>.
      </p>
    </div>
  );
}
