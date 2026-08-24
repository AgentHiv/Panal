import { useCallback, useState } from 'react';
import Icono from '~/componentes/Icono';
import Hoja from '~/componentes/Hoja';
import Teclado from '~/componentes/Teclado';
import HojaEnviar from '~/componentes/HojaEnviar';
import HojaRecibir from '~/componentes/HojaRecibir';
import HojaImportar from '~/componentes/HojaImportar';
import { copiar } from '~/lib/wallets';
import { conDecimales, useSaldosLlavero } from '~/lib/usarSaldos';
import type { Par } from '~/lib/usarSaldos';
import {
  abrir,
  borrar,
  crearLlavero,
  crearWallet,
  hayLlavero,
  listar,
  marcarCopiada,
  verSecreto,
} from '~/lib/llavero';
import type { Llave, Secreto, WalletGuardada } from '~/lib/llavero';

/**
 * El llavero.
 *
 * Wallets que viven en este teléfono: se crean aquí o se traen de fuera, se
 * guardan cifradas con el PIN, se les ve el saldo y se manda desde ellas. La
 * clave no sale del móvil — `lib/llavero.ts` no hace una sola petición de red,
 * y quien firma es `lib/enviar.ts`, con la cuenta ya en la mano.
 *
 * LO QUE FALTABA Y AHORA ESTÁ
 *
 * Esta pantalla decía «esta wallet está vacía hasta que le mandes algo» y
 * mandaba a la persona a escribir las doce palabras en OTRA wallet para verle
 * el saldo. No era una elección de producto: era que `useSaldos` lee de la
 * wallet conectada por WalletConnect, y una wallet del llavero no está
 * conectada a nada. `useSaldosLlavero` pregunta por dirección, sin conectar
 * nada, y con eso el saldo se ve aquí. Y si se puede firmar con la clave —que
 * está dentro—, también se puede mandar: no hacía falta ningún conector de
 * wagmi, hacía falta un `WalletClient` de viem.
 *
 * Las dos monedas van siempre juntas y separadas, como en Saldo: con $PANAL y
 * cero MON no se puede mover nada, ni el propio $PANAL, porque la comisión de
 * red se paga en MON. Enseñar un solo número escondería justo eso.
 *
 * LO QUE SIGUE SIN SER
 *
 * La wallet de un agente. Hoy el agente firma sus entregas desde su servidor,
 * así que su clave vive allí; traerla aquí también sería tenerla en dos sitios.
 * Con el cambio de registro que describe `design/Cambios.dc.html` —dueño
 * distinto de agente— esta wallet pasa a ser la DUEÑA: manda y cobra sin salir
 * del teléfono.
 */
type Paso =
  | { que: 'estrenar'; primero: string | null }
  | { que: 'bloqueado' }
  | { que: 'abierto' }
  | { que: 'secreto'; wallet: WalletGuardada; secreto: Secreto; recien: boolean };

const SIN_SALDO: Par = { mon: 0n, panal: 0n };

export default function Llavero(): React.ReactElement {
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
  const [enviando, setEnviando] = useState<WalletGuardada | null>(null);
  const [recibiendo, setRecibiendo] = useState<WalletGuardada | null>(null);
  const [importando, setImportando] = useState(false);

  // Antes de los `return` de abajo: los hooks no admiten atajos. Con el
  // llavero cerrado la lista está vacía y la consulta ni sale.
  const saldos = useSaldosLlavero(wallets.map((w) => w.direccion));

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
      setPaso({
        que: 'secreto',
        wallet,
        secreto: { tipo: 'palabras', texto: palabras.join(' ') },
        recien: true,
      });
    } catch {
      setError('No se pudo guardar la wallet. Puede que no quede sitio en el teléfono.');
    } finally {
      setOcupado(false);
    }
  };

  const alVerSecreto = async (w: WalletGuardada): Promise<void> => {
    if (!llave) return;
    setAbierta(null);
    setPaso({ que: 'secreto', wallet: w, secreto: await verSecreto(llave, w.id), recien: false });
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

  if (paso.que === 'secreto') {
    return (
      <SecretoEnPantalla
        wallet={paso.wallet}
        secreto={paso.secreto}
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
        <div className="flex gap-2">
          {wallets.length > 0 && (
            <button
              type="button"
              onClick={saldos.refrescar}
              className="pulsable tocable flex h-9 w-9 items-center justify-center rounded-full border border-line"
              aria-label="Volver a mirar los saldos"
            >
              <Icono nombre="recargar" tamano={15} color="#C8C3DC" grosor={1.9} />
            </button>
          )}
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
        </div>
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

            <div className="mt-3 flex items-center gap-4 border-t border-line pt-3">
              <Cifra
                simbolo="MON"
                color="#B7A8FC"
                valor={saldos.por[w.direccion.toLowerCase()]?.mon}
                cargando={saldos.cargando}
                fallo={saldos.fallo}
              />
              <Cifra
                simbolo="$PANAL"
                color="#E29A2E"
                valor={saldos.por[w.direccion.toLowerCase()]?.panal}
                cargando={saldos.cargando}
                fallo={saldos.fallo}
              />
            </div>

            {!w.copiada && (
              <div className="mt-2.5 flex items-center gap-1.5">
                <Icono nombre="info" tamano={12} color="#C9653B" grosor={2.4} />
                <span className="text-[11.5px] text-terra">
                  Sin copia — si pierdes el móvil, se pierde
                </span>
              </div>
            )}
          </button>
        ))}

        <div className="flex shrink-0 gap-2.5">
          <button
            type="button"
            onClick={() => void alCrearWallet()}
            disabled={ocupado}
            className="pulsable flex grow basis-0 flex-col gap-1.5 rounded-[14px] border border-dashed border-line p-3.5 text-left disabled:opacity-50"
          >
            <Icono nombre="mas" tamano={18} color="#948DAE" grosor={1.9} />
            <p className="text-[13.5px] font-medium">{ocupado ? 'Creando…' : 'Crear una'}</p>
            <p className="text-[11.5px] leading-[1.45] text-ink-3">
              Se genera aquí y no la ve nadie más
            </p>
          </button>

          <button
            type="button"
            onClick={() => setImportando(true)}
            className="pulsable flex grow basis-0 flex-col gap-1.5 rounded-[14px] border border-dashed border-line p-3.5 text-left"
          >
            <Icono nombre="bajar" tamano={18} color="#948DAE" grosor={1.9} />
            <p className="text-[13.5px] font-medium">Traer una</p>
            <p className="text-[11.5px] leading-[1.45] text-ink-3">
              Con sus palabras o su clave privada
            </p>
          </button>
        </div>

        {error && <p className="shrink-0 px-1 text-[12px] text-terra">{error}</p>}

        {saldos.fallo && wallets.length > 0 && (
          <p className="shrink-0 px-1 text-[12px] leading-[1.5] text-terra">
            No se ha podido leer el saldo. Es la red, no la wallet: lo que haya dentro sigue ahí.
          </p>
        )}

        {/* El límite, dicho donde se decide y no en letra pequeña. */}
        <div className="mt-3 flex shrink-0 gap-2.5 rounded-[14px] border border-honey-line bg-honey-soft p-3.5">
          <Icono nombre="info" tamano={16} color="#E29A2E" grosor={2} className="mt-px shrink-0" />
          <div className="min-w-0">
            <p className="text-[12.5px] font-semibold text-honey">Hasta dónde llega este PIN</p>
            <p className="mt-1 text-[12px] leading-[1.55] text-ink-2">
              Las claves están cifradas con él dentro del cajón privado de la app: ninguna otra app
              las lee, y ya no salen en la copia de Google. Lo que el PIN NO para es a alguien con tu
              teléfono desbloqueado y tiempo. Para eso hace falta el chip seguro del móvil, y a eso
              el WebView no llega sin escribir un trozo nativo. Guarda aquí lo que usas, no lo que
              guardas.
            </p>
          </div>
        </div>
      </div>

      {abierta && (
        <Detalle
          wallet={abierta}
          saldo={saldos.por[abierta.direccion.toLowerCase()] ?? SIN_SALDO}
          sinLeer={saldos.cargando || saldos.fallo}
          onCerrar={() => setAbierta(null)}
          onVerSecreto={() => void alVerSecreto(abierta)}
          onEnviar={() => {
            setEnviando(abierta);
            setAbierta(null);
          }}
          onRecibir={() => {
            setRecibiendo(abierta);
            setAbierta(null);
          }}
          onBorrar={() => {
            borrar(abierta.id);
            setAbierta(null);
            refrescar();
          }}
        />
      )}

      {enviando && llave && (
        <HojaEnviar
          wallet={enviando}
          llave={llave}
          saldos={saldos.por[enviando.direccion.toLowerCase()] ?? SIN_SALDO}
          onCerrar={() => setEnviando(null)}
          onHecho={saldos.refrescar}
        />
      )}

      {recibiendo && <HojaRecibir wallet={recibiendo} onCerrar={() => setRecibiendo(null)} />}

      {importando && llave && (
        <HojaImportar
          llave={llave}
          onCerrar={() => setImportando(false)}
          onHecho={(w) => {
            setImportando(false);
            refrescar();
            setAbierta(w);
          }}
        />
      )}
    </div>
  );
}

/* ── un saldo dentro de la fila ──────────────────────────────────────────── */

/**
 * Cero y «no lo sé» son cosas distintas, y esa diferencia vale dinero: quien
 * ve un cero deja de mirar. Mientras la consulta está en marcha o ha fallado,
 * aquí no aparece un cero.
 */
function Cifra({
  simbolo,
  color,
  valor,
  cargando,
  fallo,
}: {
  simbolo: string;
  color: string;
  valor: bigint | undefined;
  cargando: boolean;
  fallo: boolean;
}): React.ReactElement {
  return (
    <div className="min-w-0">
      {valor === undefined ? (
        cargando ? (
          <span className="my-0.5 block h-[15px] w-16 animate-pulse rounded bg-sand" />
        ) : (
          <span className="font-mono text-[15px] text-ink-3">{fallo ? '?' : '—'}</span>
        )
      ) : (
        <span className="font-mono text-[15px] font-medium" style={{ color }}>
          {conDecimales(valor, 18)}
        </span>
      )}
      <p className="text-[10.5px] uppercase tracking-[0.06em] text-ink-3">{simbolo}</p>
    </div>
  );
}

/* ── las doce palabras, o la clave ───────────────────────────────────────── */

function SecretoEnPantalla({
  wallet,
  secreto,
  recien,
  onListo,
}: {
  wallet: WalletGuardada;
  secreto: Secreto;
  recien: boolean;
  onListo: () => void;
}): React.ReactElement {
  const palabras = secreto.tipo === 'palabras' ? secreto.texto.split(' ') : [];

  return (
    <div className="flex min-h-0 grow flex-col">
      <header className="shrink-0 px-5 pb-2 pt-5">
        <h1 className="font-display text-[24px] font-semibold -tracking-[0.015em]">
          {secreto.tipo === 'palabras' ? `Tus ${palabras.length} palabras` : 'Su clave privada'}
        </h1>
        <p className="mt-1.5 text-[13px] leading-[1.55] text-ink-2">
          {secreto.tipo === 'palabras'
            ? `Apúntalas en papel y guárdalas fuera del teléfono. Son la única forma de recuperar ${wallet.nombre} si pierdes el móvil — nadie más tiene copia, ni Panal.`
            : `Con esto se controla ${wallet.nombre} desde cualquier sitio. Guárdala donde guardas lo importante, no en una foto.`}
        </p>
      </header>

      <div className="flex min-h-0 grow flex-col gap-3 overflow-y-auto px-5 pb-5">
        {secreto.tipo === 'palabras' ? (
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
        ) : (
          <div className="shrink-0 rounded-[14px] border border-line bg-cream p-4">
            <p className="seleccionable break-all font-mono text-[13px] leading-[1.7]">
              {secreto.texto}
            </p>
          </div>
        )}

        <div className="flex shrink-0 gap-2.5 rounded-[14px] border border-terra/40 bg-terra/10 p-3.5">
          <Icono nombre="info" tamano={16} color="#C9653B" grosor={2} className="mt-px shrink-0" />
          <p className="text-[12px] leading-[1.55] text-ink-2">
            No la guardes en una foto, ni en notas, ni en un chat. Quien la tenga puede vaciar esta
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
  saldo,
  sinLeer,
  onCerrar,
  onVerSecreto,
  onEnviar,
  onRecibir,
  onBorrar,
}: {
  wallet: WalletGuardada;
  saldo: Par;
  sinLeer: boolean;
  onCerrar: () => void;
  onVerSecreto: () => void;
  onEnviar: () => void;
  onRecibir: () => void;
  onBorrar: () => void;
}): React.ReactElement {
  const [copiado, setCopiado] = useState(false);
  const [seguro, setSeguro] = useState(false);

  const alCopiar = async (): Promise<void> => {
    if (await copiar(wallet.direccion)) {
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2200);
    }
  };

  const vacia = !sinLeer && saldo.mon === 0n && saldo.panal === 0n;

  return (
    <Hoja abierta titulo={wallet.nombre} onCerrar={onCerrar}>
      <div className="mt-3.5 flex gap-2.5">
        <Saldo simbolo="MON" color="#B7A8FC" valor={saldo.mon} sinLeer={sinLeer} />
        <Saldo simbolo="$PANAL" color="#E29A2E" valor={saldo.panal} sinLeer={sinLeer} />
      </div>

      <div className="mt-3 flex gap-2.5">
        <button
          type="button"
          onClick={onEnviar}
          disabled={vacia}
          className="pulsable tocable flex grow items-center justify-center gap-2 rounded-full bg-monad py-3 text-[14px] font-semibold text-white shadow-monad disabled:opacity-40 disabled:shadow-none"
        >
          <Icono nombre="fuera" tamano={15} color="#FFFFFF" />
          Mandar
        </button>
        <button
          type="button"
          onClick={onRecibir}
          className="pulsable tocable flex grow items-center justify-center gap-2 rounded-full border border-line py-3 text-[14px] font-semibold text-ink-2"
        >
          <Icono nombre="bajar" tamano={15} color="#948DAE" />
          Recibir
        </button>
      </div>
      {vacia && (
        <p className="mt-2 text-[11.5px] leading-[1.5] text-ink-3">
          No hay nada que mandar todavía. Toca «Recibir» para ver a dónde mandárselo.
        </p>
      )}

      <div className="my-4 h-px bg-line" />

      <p className="text-[11.5px] uppercase tracking-[0.06em] text-ink-3">Su dirección</p>
      <p className="seleccionable mt-2 break-all font-mono text-[12.5px] leading-[1.5] text-ink-2">
        {wallet.direccion}
      </p>

      <button
        type="button"
        onClick={() => void alCopiar()}
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
        onClick={onVerSecreto}
        className="pulsable tocable mt-2 flex w-full items-center justify-center gap-2 rounded-full border border-line py-2.5 text-[13.5px] font-medium text-ink-2"
      >
        <Icono nombre="llave" tamano={15} color="#948DAE" />
        {wallet.tipo === 'clave' ? 'Ver la clave privada' : 'Ver las 12 palabras'}
      </button>

      <p className="mt-3 text-[12px] leading-[1.55] text-ink-3">
        {wallet.importada
          ? 'Traída de fuera. Sigue existiendo donde estaba: borrarla de aquí no la borra de allí.'
          : 'Creada en este teléfono. Su copia de seguridad son sus 12 palabras y no hay otra.'}
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
              ? 'Se va de este teléfono. Con sus palabras —o su clave— la recuperas en cualquier wallet; sin ellas, no.'
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

function Saldo({
  simbolo,
  color,
  valor,
  sinLeer,
}: {
  simbolo: string;
  color: string;
  valor: bigint;
  sinLeer: boolean;
}): React.ReactElement {
  return (
    <div className="grow basis-0 rounded-[14px] border border-line bg-cream p-3.5">
      {sinLeer ? (
        <span className="my-1 block h-6 w-20 animate-pulse rounded bg-sand" />
      ) : (
        <span className="block font-mono text-[22px] font-medium leading-none" style={{ color }}>
          {conDecimales(valor, 18)}
        </span>
      )}
      <p className="mt-2 text-[11px] uppercase tracking-[0.06em] text-ink-3">{simbolo}</p>
    </div>
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
