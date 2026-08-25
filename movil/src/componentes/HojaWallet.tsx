import { useState } from 'react';
import { WALLETS, abrirFuera, copiar } from '~/lib/wallets';
import { recordarWallet } from '~/lib/regreso';
import Icono from '~/componentes/Icono';
import type { WalletGuardada } from '~/lib/llavero';
import { useTextos } from '~/i18n/idiomas';
import type { Textos } from '~/i18n/idiomas';

/**
 * La hoja de conectar la wallet.
 *
 * Es la única puerta de la app: sin esto no se puede hablar con un agente, ni
 * encargar, ni ver un saldo. Antes era un botón que no hacía nada.
 *
 * Sube desde abajo y no ocupa la pantalla entera a propósito: conectar no es
 * un trámite de registro, es un momento dentro de lo que estabas haciendo, y
 * al volver de la wallet quieres reconocer dónde estabas.
 *
 * AHORA HAY DOS FORMAS, Y NO SON IGUALES
 *
 * La del teléfono va primera porque es la que resuelve el problema por el que
 * se abre esta hoja: con ella, cada firma se aprueba aquí dentro y no hay que
 * salir a otra aplicación por cada mensaje de chat. La de fuera va segunda
 * porque es la que ya tiene la gente y donde está su dinero.
 *
 * Las dos van con su letra pequeña al lado. No es documentación: la diferencia
 * es de verdad y afecta a lo que puede pasar con el dinero. Una wallet de
 * fuera te enseña lo que firmas en su propia pantalla; la de aquí no, y quien
 * la elija tiene derecho a saberlo ANTES, no al leer una nota luego.
 *
 * Y LA DE FUERA NO SALE SIEMPRE (`conFuera`). Solo hace falta para administrar
 * un agente —el registro on-chain actúa sobre quien firma, así que hay que
 * firmar con la wallet del propio agente—, y ponerla delante de todo el mundo
 * hacía que la primera decisión de la app fuera entre dos caminos cuya
 * diferencia todavía no se puede entender. Donde no se ofrece, se dice dónde
 * está: una opción que desaparece sin explicación se busca durante un rato.
 */
export default function HojaWallet({
  abierta,
  uri,
  hayWalletConnect,
  conFuera,
  fallo,
  delTelefono,
  recordada,
  onElegirDelTelefono,
  onIrAlLlavero,
  onCerrar,
}: {
  abierta: boolean;
  uri: string | null;
  hayWalletConnect: boolean;
  /** Si aquí tiene sentido ofrecer una wallet de fuera (zona de agentes). */
  conFuera: boolean;
  fallo: string | null;
  /** Las wallets del llavero de este teléfono. */
  delTelefono: WalletGuardada[];
  /** Cuál se usó la última vez, para ponerla arriba. */
  recordada: string | null;
  onElegirDelTelefono: (w: WalletGuardada) => void;
  onIrAlLlavero: () => void;
  onCerrar: () => void;
}): React.ReactElement | null {
  const [copiado, setCopiado] = useState(false);
  const T = useTextos();

  if (!abierta) return null;

  const alCopiar = async (): Promise<void> => {
    if (!uri) return;
    const ok = await copiar(uri);
    setCopiado(ok);
    if (ok) window.setTimeout(() => setCopiado(false), 2200);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-[rgba(12,10,18,.72)]">
      <button type="button" aria-label={T.comun.cerrar} className="grow" onClick={onCerrar} />

      <div className="con-barra-abajo max-h-[92%] overflow-y-auto rounded-t-[22px] border-t border-line bg-cream px-5 pt-2.5 shadow-hoja">
        <div className="mx-auto mb-4 h-1 w-[38px] rounded-full bg-line" />

        <h2 className="font-display text-[21px] font-semibold -tracking-[0.015em]">
          {T.hojaWallet.titulo}
        </h2>
        <p className="mt-1.5 text-[13.5px] leading-[1.55] text-ink-2">
          {T.hojaWallet.entradilla}
        </p>

        <DelTelefono
          wallets={ordenar(delTelefono, recordada)}
          onElegir={onElegirDelTelefono}
          onCrear={onIrAlLlavero}
          T={T}
        />

        {!conFuera ? (
          <p className="mb-2 mt-5 rounded-xl bg-sand px-3.5 py-3 text-[11.5px] leading-[1.55] text-ink-3">
            {T.hojaWallet.fueraEnAgentes}
          </p>
        ) : (
          <>
        <div className="mt-5 flex items-center gap-3">
          <div className="h-px grow bg-line" />
          <span className="text-[11px] uppercase tracking-[0.06em] text-ink-3">
            {T.hojaWallet.oLaQueYaUsas}
          </span>
          <div className="h-px grow bg-line" />
        </div>
        <p className="mt-2 text-[11.5px] leading-[1.5] text-ink-3">
          {T.hojaWallet.fueraPie}
        </p>

        {!hayWalletConnect ? (
          <SinWalletConnect T={T} />
        ) : fallo ? (
          <Fallo texto={fallo} T={T} />
        ) : !uri ? (
          <Esperando T={T} />
        ) : (
          <>
            {/* Lo primero es lo genérico: Android saca el selector con TODAS
                las wallets que tenga instaladas. No hay que reconocer ninguna
                marca de una lista. */}
            <button
              type="button"
              onClick={() => {
                // Aquí elige Android, así que no sabemos cuál será. Se borra
                // lo apuntado antes para no acabar mandando a la wallet de la
                // sesión anterior.
                recordarWallet(null);
                abrirFuera(uri);
              }}
              className="pulsable mt-5 flex h-[54px] w-full items-center justify-center gap-2.5 rounded-full bg-monad text-[15px] font-semibold text-white shadow-monad"
            >
              <Icono nombre="fuera" tamano={18} color="#fff" grosor={2} />
              {T.hojaWallet.abrirMiWallet}
            </button>
            <p className="mt-2 text-center text-[11.5px] leading-[1.45] text-ink-3">
              {T.hojaWallet.abrirMiWalletPie}
            </p>

            <ul className="mt-4 overflow-hidden rounded-[14px] border border-line">
              {WALLETS.map((w, i) => (
                <li key={w.id}>
                  {i > 0 && <div className="h-px bg-line" />}
                  <button
                    type="button"
                    onClick={() => {
                      // Se apunta CUÁL para poder volver a ella cuando haya
                      // una firma esperando (`lib/regreso.ts`). Es el plan B:
                      // lo normal es que la wallet mande su propio enlace de
                      // vuelta en los metadatos de la sesión.
                      recordarWallet(w.base);
                      abrirFuera(w.enlace(uri));
                    }}
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
              {copiado ? T.hojaWallet.enlaceCopiado : T.hojaWallet.copiarEnlace}
            </button>
            <p className="mt-2 pb-1 text-center text-[11.5px] leading-[1.45] text-ink-3">
              {T.hojaWallet.copiarPie}
            </p>
          </>
        )}
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

function Esperando({ T }: { T: Textos }): React.ReactElement {
  return (
    <div className="flex flex-col items-center gap-3 py-10">
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-line border-t-monad" />
      <p className="text-[13px] text-ink-3">{T.hojaWallet.preparando}</p>
    </div>
  );
}

function Fallo({ texto, T }: { texto: string; T: Textos }): React.ReactElement {
  return (
    <div className="mt-4 flex gap-2.5 rounded-xl border border-terra/40 bg-terra/10 px-3.5 py-3">
      <Icono nombre="info" tamano={16} color="#C9653B" className="mt-px shrink-0" />
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-terra">{T.hojaWallet.noSePudo}</p>
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
function SinWalletConnect({ T }: { T: Textos }): React.ReactElement {
  return (
    <div className="mt-4 flex gap-2.5 rounded-xl bg-sand px-3.5 py-3">
      <Icono nombre="info" tamano={16} color="#948DAE" className="mt-px shrink-0" />
      <p className="text-[12px] leading-[1.55] text-ink-3">
        {T.hojaWallet.sinWalletConnect}{' '}
        <span className="font-mono">VITE_WALLETCONNECT_PROJECT_ID</span>.
      </p>
    </div>
  );
}

/* ── la wallet de este teléfono ──────────────────────────────────────────── */

/** La última usada arriba: es casi siempre la que se va a volver a usar. */
function ordenar(wallets: WalletGuardada[], recordada: string | null): WalletGuardada[] {
  if (!recordada) return wallets;
  const i = wallets.findIndex((w) => w.id === recordada);
  return i <= 0 ? wallets : [wallets[i], ...wallets.filter((_, j) => j !== i)];
}

function DelTelefono({
  wallets,
  onElegir,
  onCrear,
  T,
}: {
  wallets: WalletGuardada[];
  onElegir: (w: WalletGuardada) => void;
  onCrear: () => void;
  T: Textos;
}): React.ReactElement {
  if (wallets.length === 0) {
    return (
      <button
        type="button"
        onClick={onCrear}
        className="pulsable mt-5 flex w-full items-center gap-3 rounded-[14px] border border-dashed border-line p-3.5 text-left"
      >
        <Icono nombre="llave" tamano={18} color="#E29A2E" className="shrink-0" />
        <div className="min-w-0 grow">
          <p className="text-[13.5px] font-medium">{T.hojaWallet.crearAqui}</p>
          <p className="mt-0.5 text-[11.5px] leading-[1.45] text-ink-3">
            {T.hojaWallet.crearAquiPie}
          </p>
        </div>
        <Icono nombre="atras" tamano={15} color="#948DAE" className="rotate-180" />
      </button>
    );
  }

  return (
    <>
      <p className="mt-5 text-[11px] uppercase tracking-[0.06em] text-ink-3">
        {T.hojaWallet.deEsteTelefono}
      </p>
      <ul className="mt-2 overflow-hidden rounded-[14px] border border-line">
        {wallets.map((w, i) => (
          <li key={w.id}>
            {i > 0 && <div className="h-px bg-line" />}
            <button
              type="button"
              onClick={() => onElegir(w)}
              className="pulsable tocable flex w-full items-center gap-3 px-3.5 py-3"
            >
              <SelloHex color="#E29A2E" sigla={w.nombre.slice(0, 1).toUpperCase()} />
              <span className="min-w-0 grow text-left">
                <span className="block truncate text-[14px] font-medium">{w.nombre}</span>
                <span className="mt-0.5 block font-mono text-[11px] text-ink-3">
                  {w.direccion.slice(0, 6)}…{w.direccion.slice(-4)}
                </span>
              </span>
              <Icono nombre="candado" tamano={15} color="#948DAE" />
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11.5px] leading-[1.5] text-ink-3">{T.hojaWallet.dentroPie}</p>
    </>
  );
}
