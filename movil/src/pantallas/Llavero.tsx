import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icono from '~/componentes/Icono';
import Hoja from '~/componentes/Hoja';
import Teclado from '~/componentes/Teclado';
import { copiar } from '~/lib/wallets';
import {
  abrir,
  borrar,
  crearLlavero,
  crearWallet,
  hayLlavero,
  listar,
  marcarCopiada,
  verPalabras,
} from '~/lib/llavero';
import type { Llave, WalletGuardada } from '~/lib/llavero';

/**
 * El llavero.
 *
 * Crear wallets en el teléfono, verlas y guardarlas. La clave se cifra con el
 * PIN y no sale de aquí — `lib/llavero.ts` no hace una sola petición de red.
 *
 * Lo que esta pantalla NO hace, y conviene tenerlo claro antes de leerla: una
 * wallet creada aquí todavía no puede firmar dentro de la app. La app entra por
 * WalletConnect, y para usar una clave local haría falta un conector propio de
 * wagmi. Es lo siguiente, y va aparte: guardar una clave y firmar con ella son
 * dos problemas distintos, y mezclarlos en la misma pantalla habría dejado los
 * dos a medias.
 *
 * Tampoco es —todavía— la wallet de un agente. Hoy el agente firma sus propias
 * entregas desde su servidor, así que su clave vive allí; crearla también aquí
 * sería tener la misma clave en dos sitios, que es peor que tenerla en uno. Con
 * el cambio de registro que describe `design/Cambios.dc.html` —dueño distinto
 * de agente— esta wallet pasa a ser la DUEÑA: manda y cobra sin salir del
 * teléfono. Las dos piezas se necesitan.
 */
type Paso =
  | { que: 'estrenar'; primero: string | null }
  | { que: 'bloqueado' }
  | { que: 'abierto' }
  | { que: 'palabras'; wallet: WalletGuardada; palabras: string[]; recien: boolean };

export default function Llavero(): React.ReactElement {
  const navegar = useNavigate();
  // El primer paso se decide leyendo el disco, y eso se puede hacer aquí
  // mismo: no hace falta pintar un estado «cargando» que dure un fotograma.
  const [paso, setPaso] = useState<Paso>(() =>
    hayLlavero() ? { que: 'bloqueado' } : { que: 'estrenar', primero: null },
  );
  const [llave, setLlave] = useState<Llave | null>(null);
  const [wallets, setWallets] = useState<WalletGuardada[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [abierta, setAbierta] = useState<WalletGuardada | null>(null);

  const refrescar = useCallback(() => setWallets(listar()), []);

  /** Estrenar el llavero: el mismo teclado dos veces, y tienen que coincidir. */
  const alEstrenar = async (pin: string): Promise<void> => {
    const estado = paso as { que: 'estrenar'; primero: string | null };
    if (estado.primero === null) {
      setError(null);
      setPaso({ que: 'estrenar', primero: pin });
      return;
    }
    if (estado.primero !== pin) {
      setError('No coinciden. Vuelve a empezar.');
      setPaso({ que: 'estrenar', primero: null });
      return;
    }
    setOcupado(true);
    try {
      setLlave(await crearLlavero(pin));
      setError(null);
      refrescar();
      setPaso({ que: 'abierto' });
    } catch {
      setError('No se pudo crear el llavero en este teléfono.');
      setPaso({ que: 'estrenar', primero: null });
    } finally {
      setOcupado(false);
    }
  };

  const alAbrir = async (pin: string): Promise<void> => {
    setOcupado(true);
    // Un respiro antes de derivar: PBKDF2 bloquea el hilo medio segundo en un
    // teléfono, y sin esto React no llega a pintar el sexto punto.
    await new Promise((r) => setTimeout(r, 30));
    const k = await abrir(pin);
    setOcupado(false);
    if (!k) {
      setError('Ese PIN no es');
      return;
    }
    setLlave(k);
    setError(null);
    refrescar();
    setPaso({ que: 'abierto' });
  };

  const alCrearWallet = async (): Promise<void> => {
    if (!llave) return;
    setOcupado(true);
    try {
      const n = listar().length + 1;
      const { wallet, palabras } = await crearWallet(llave, `Wallet ${n}`);
      refrescar();
      setPaso({ que: 'palabras', wallet, palabras, recien: true });
    } catch {
      setError('No se pudo guardar la wallet. Puede que no quede sitio en el teléfono.');
    } finally {
      setOcupado(false);
    }
  };

  const alVerPalabras = async (w: WalletGuardada): Promise<void> => {
    if (!llave) return;
    setAbierta(null);
    setPaso({ que: 'palabras', wallet: w, palabras: await verPalabras(llave, w.id), recien: false });
  };

  if (paso.que === 'estrenar') {
    return (
      <Teclado
        titulo={paso.primero === null ? 'Pon un PIN' : 'Otra vez, para confirmar'}
        explicacion={
          paso.primero === null
            ? 'Seis dígitos. Cifran las wallets que crees aquí, y no hay forma de recuperarlo: si se te olvida, se pierden.'
            : 'Repite los mismos seis dígitos.'
        }
        onCompleto={alEstrenar}
        error={error}
        ocupado={ocupado}
      />
    );
  }

  if (paso.que === 'bloqueado') {
    return (
      <Teclado
        titulo="Tu llavero"
        explicacion="Las wallets que guardas en este teléfono. Nada sale de aquí."
        onCompleto={alAbrir}
        error={error}
        ocupado={ocupado}
      />
    );
  }

  if (paso.que === 'palabras') {
    return (
      <Palabras
        wallet={paso.wallet}
        palabras={paso.palabras}
        recien={paso.recien}
        onListo={() => {
          if (paso.recien) marcarCopiada(paso.wallet.id);
          refrescar();
          setPaso({ que: 'abierto' });
        }}
      />
    );
  }

  return (
    <div className="relative flex min-h-0 grow flex-col">
      <header className="flex shrink-0 items-end justify-between px-5 pb-3 pt-5">
        <div>
          <h1 className="font-display text-[26px] font-semibold -tracking-[0.015em]">Tu llavero</h1>
          <p className="mt-0.5 text-[12.5px] text-ink-3">
            {wallets.length === 0
              ? 'Vacío, de momento'
              : `${wallets.length} ${wallets.length === 1 ? 'wallet' : 'wallets'} en este teléfono`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            // Cerrar es tirar la clave descifrada. Lo guardado sigue cifrado.
            setLlave(null);
            setError(null);
            setPaso({ que: 'bloqueado' });
          }}
          className="pulsable tocable flex h-9 w-9 items-center justify-center rounded-full border border-line"
          aria-label="Bloquear el llavero"
        >
          <Icono nombre="candado" tamano={15} color="#C8C3DC" grosor={1.9} />
        </button>
      </header>

      <div className="flex min-h-0 grow flex-col gap-2.5 overflow-y-auto px-5 pb-5">
        {wallets.map((w) => (
          <button
            key={w.id}
            type="button"
            onClick={() => setAbierta(w)}
            className="pulsable shrink-0 rounded-[14px] border border-line bg-cream p-3.5 text-left"
          >
            <div className="flex items-center gap-3">
              <Hexagono texto={w.nombre.slice(0, 1).toUpperCase()} tono={tonoDe(w.id)} />
              <div className="min-w-0 grow">
                <p className="truncate text-[14.5px] font-semibold">{w.nombre}</p>
                <p className="mt-0.5 font-mono text-[11px] text-ink-3">{corta(w.direccion)}</p>
              </div>
              <Icono nombre="atras" tamano={15} color="#948DAE" className="rotate-180" />
            </div>
            <div className="mt-3 flex items-center gap-1.5 border-t border-line pt-3">
              <Icono
                nombre={w.copiada ? 'check' : 'info'}
                tamano={12}
                color={w.copiada ? '#92A268' : '#C9653B'}
                grosor={2.4}
              />
              <span className={`text-[11.5px] ${w.copiada ? 'text-olive' : 'text-terra'}`}>
                {w.copiada
                  ? 'Copia apuntada · 12 palabras'
                  : 'Sin copia — si pierdes el móvil, se pierde'}
              </span>
            </div>
          </button>
        ))}

        <button
          type="button"
          onClick={alCrearWallet}
          disabled={ocupado}
          className="pulsable flex shrink-0 items-center gap-3 rounded-[14px] border border-dashed border-line p-3.5 text-left disabled:opacity-50"
        >
          <Icono nombre="mas" tamano={18} color="#948DAE" grosor={1.9} />
          <div className="min-w-0 grow">
            <p className="text-[13.5px] font-medium">
              {ocupado ? 'Creando…' : 'Crear una wallet'}
            </p>
            <p className="mt-0.5 text-[11.5px] leading-[1.45] text-ink-3">
              Se genera aquí y no la ve nadie más
            </p>
          </div>
        </button>

        {error && <p className="shrink-0 px-1 text-[12px] text-terra">{error}</p>}

        {/* El límite, dicho donde se decide y no en letra pequeña. */}
        <div className="mt-3 flex shrink-0 gap-2.5 rounded-[14px] border border-honey-line bg-honey-soft p-3.5">
          <Icono nombre="info" tamano={16} color="#E29A2E" grosor={2} className="mt-px shrink-0" />
          <div className="min-w-0">
            <p className="text-[12.5px] font-semibold text-honey">Hasta dónde llega este PIN</p>
            <p className="mt-1 text-[12px] leading-[1.55] text-ink-2">
              Las claves están cifradas con él dentro del cajón privado de la app: ninguna otra app
              las lee, y ya no salen en la copia de Google. Lo que el PIN NO para es a alguien con tu
              teléfono desbloqueado y tiempo. Para eso hace falta el chip seguro del móvil, y a eso
              el WebView no llega sin escribir un trozo nativo.
            </p>
          </div>
        </div>

        <div className="shrink-0 rounded-[14px] border border-line p-3.5">
          <p className="text-[12.5px] font-semibold">Para qué sirve hoy</p>
          <p className="mt-1 text-[12px] leading-[1.55] text-ink-2">
            Para tener una dirección tuya, generada aquí, y su copia en papel. Firmar dentro de la
            app todavía va por WalletConnect: usar esta clave para firmar es la pieza siguiente.
          </p>
        </div>
      </div>

      {abierta && (
        <Detalle
          wallet={abierta}
          onCerrar={() => setAbierta(null)}
          onVerPalabras={() => void alVerPalabras(abierta)}
          onBorrar={() => {
            borrar(abierta.id);
            setAbierta(null);
            refrescar();
          }}
          onIrAlSaldo={() => navegar('/saldo')}
        />
      )}
    </div>
  );
}

/* ── las doce palabras ───────────────────────────────────────────────────── */

function Palabras({
  wallet,
  palabras,
  recien,
  onListo,
}: {
  wallet: WalletGuardada;
  palabras: string[];
  recien: boolean;
  onListo: () => void;
}): React.ReactElement {
  return (
    <div className="flex min-h-0 grow flex-col">
      <header className="shrink-0 px-5 pb-2 pt-5">
        <h1 className="font-display text-[24px] font-semibold -tracking-[0.015em]">
          Tus 12 palabras
        </h1>
        <p className="mt-1.5 text-[13px] leading-[1.55] text-ink-2">
          Apúntalas en papel y guárdalas fuera del teléfono. Son la única forma de recuperar{' '}
          {wallet.nombre} si pierdes el móvil — nadie más tiene copia, ni Panal.
        </p>
      </header>

      <div className="flex min-h-0 grow flex-col gap-3 overflow-y-auto px-5 pb-5">
        <div className="grid shrink-0 grid-cols-2 gap-x-2.5 gap-y-1.5">
          {palabras.map((p, i) => (
            <div
              key={p + i}
              className="flex items-baseline gap-2 rounded-[11px] border border-line bg-cream px-3 py-2.5"
            >
              <span className="w-4 shrink-0 text-right font-mono text-[11px] text-ink-3">
                {i + 1}
              </span>
              {/* Seleccionable pero sin botón de copiar: mandarlas al
                  portapapeles las deja donde puede leerlas cualquier cosa. */}
              <span className="seleccionable text-[14px] font-medium">{p}</span>
            </div>
          ))}
        </div>

        <div className="flex shrink-0 gap-2.5 rounded-[14px] border border-terra/40 bg-terra/10 p-3.5">
          <Icono nombre="info" tamano={16} color="#C9653B" grosor={2} className="mt-px shrink-0" />
          <p className="text-[12px] leading-[1.55] text-ink-2">
            No las guardes en una foto, ni en notas, ni en un chat. Quien las tenga puede vaciar esta
            wallet desde cualquier sitio, sin el teléfono y sin el PIN.
          </p>
        </div>

        <button
          type="button"
          onClick={onListo}
          className="pulsable tocable mt-1 shrink-0 rounded-full bg-monad py-3.5 text-[15px] font-semibold text-white shadow-monad"
        >
          {recien ? 'Ya las tengo apuntadas' : 'Listo'}
        </button>
      </div>
    </div>
  );
}

/* ── una wallet, de cerca ────────────────────────────────────────────────── */

function Detalle({
  wallet,
  onCerrar,
  onVerPalabras,
  onBorrar,
  onIrAlSaldo,
}: {
  wallet: WalletGuardada;
  onCerrar: () => void;
  onVerPalabras: () => void;
  onBorrar: () => void;
  onIrAlSaldo: () => void;
}): React.ReactElement {
  const [copiado, setCopiado] = useState(false);
  const [seguro, setSeguro] = useState(false);

  const alCopiar = async (): Promise<void> => {
    if (await copiar(wallet.direccion)) {
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2200);
    }
  };

  return (
    <Hoja abierta titulo={wallet.nombre} onCerrar={onCerrar}>
      <p className="text-[11.5px] uppercase tracking-[0.06em] text-ink-3">Su dirección</p>
      <p className="seleccionable mt-2 break-all font-mono text-[12.5px] leading-[1.5] text-ink-2">
        {wallet.direccion}
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

      <button
        type="button"
        onClick={onVerPalabras}
        className="pulsable tocable mt-2 flex w-full items-center justify-center gap-2 rounded-full border border-line py-2.5 text-[13.5px] font-medium text-ink-2"
      >
        <Icono nombre="llave" tamano={15} color="#948DAE" />
        Ver las 12 palabras
      </button>

      <p className="mt-3 text-[12px] leading-[1.55] text-ink-3">
        Esta wallet está vacía hasta que le mandes algo. Para verle el saldo, cámbiate a ella en tu
        wallet de siempre —con las 12 palabras— y{' '}
        <button type="button" onClick={onIrAlSaldo} className="text-honey underline">
          conéctala en Saldo
        </button>
        .
      </p>

      <div className="my-4 h-px bg-line" />

      {!seguro ? (
        <button
          type="button"
          onClick={() => setSeguro(true)}
          className="pulsable tocable flex w-full items-center justify-center gap-2 rounded-full py-2.5 text-[13.5px] font-medium text-terra"
        >
          <Icono nombre="papelera" tamano={15} color="#C9653B" />
          Borrar del teléfono
        </button>
      ) : (
        <div className="rounded-[14px] border border-terra/40 bg-terra/10 p-3.5">
          <p className="text-[13px] font-semibold text-terra">
            {wallet.copiada ? '¿Seguro?' : 'No has apuntado sus 12 palabras'}
          </p>
          <p className="mt-1 text-[12px] leading-[1.55] text-ink-2">
            {wallet.copiada
              ? 'Se va de este teléfono. Con las 12 palabras la recuperas en cualquier wallet; sin ellas, no.'
              : 'Si la borras ahora, lo que haya dentro no lo recupera nadie. Ni tú, ni Panal.'}
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setSeguro(false)}
              className="pulsable tocable grow rounded-full border border-line py-2.5 text-[13.5px] font-medium text-ink-2"
            >
              Ahora no
            </button>
            <button
              type="button"
              onClick={onBorrar}
              className="pulsable tocable grow rounded-full bg-terra py-2.5 text-[13.5px] font-semibold text-white"
            >
              Borrar
            </button>
          </div>
        </div>
      )}
    </Hoja>
  );
}

/* ── adornos ─────────────────────────────────────────────────────────────── */

const TONOS = ['#E29A2E', '#836EF9', '#92A268', '#C9653B', '#B7A8FC'];

/** Un color estable por wallet: el mismo id da siempre el mismo tono. */
function tonoDe(id: string): string {
  let suma = 0;
  for (const c of id) suma = (suma + c.charCodeAt(0)) % 997;
  return TONOS[suma % TONOS.length];
}

function corta(dir: string): string {
  return `${dir.slice(0, 6)}…${dir.slice(-4)}`;
}

function Hexagono({ texto, tono }: { texto: string; tono: string }): React.ReactElement {
  return (
    <span className="relative flex h-[34px] w-[34px] shrink-0 items-center justify-center">
      <svg width="34" height="34" viewBox="0 0 40 40" className="absolute inset-0" aria-hidden>
        <polygon
          points="20,2 36,11 36,29 20,38 4,29 4,11"
          fill="#232035"
          stroke={tono}
          strokeWidth="1.3"
        />
      </svg>
      <span className="relative font-display text-[13px] font-bold" style={{ color: tono }}>
        {texto}
      </span>
    </span>
  );
}
