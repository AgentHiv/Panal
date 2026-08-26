import { useCallback, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
  MAX_NOMBRE,
  abrir,
  borrar,
  crearLlavero,
  crearWallet,
  hayLlavero,
  listar,
  marcarCopiada,
  nombrePorDefecto,
  renombrar,
  verSecreto,
} from '~/lib/llavero';
import type { Llave, Secreto, WalletGuardada } from '~/lib/llavero';
import { abrirSesion, renombrarEnSesion, useSesion } from '~/lib/sesion';
import { useCambio } from '~/lib/cambio';
import { useSinCapturas } from '~/lib/pantalla';
import { useTextos } from '~/i18n/idiomas';
import type { Textos } from '~/i18n/idiomas';

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
 *
 * DE DÓNDE SE LLEGA AQUÍ LA PRIMERA VEZ
 *
 * De la bienvenida, con `?hacer=crear` o `?hacer=traer`. Esta pantalla ya sabía
 * hacer las dos cosas —poner el PIN, crear, importar—, así que la bienvenida no
 * las repite: manda aquí y dice cuál. Lo único que cambia con ese parámetro es
 * el final: en vez de quedarse en el llavero, se abre la sesión con la wallet
 * recién hecha y se entra en la app. Sin eso, quien acaba de crear su primera
 * wallet tendría que volver a teclear el PIN para poder usarla.
 */
type Paso =
  | { que: 'estrenar'; primero: string | null }
  | { que: 'bloqueado' }
  | { que: 'abierto' }
  | { que: 'secreto'; wallet: WalletGuardada; secreto: Secreto; recien: boolean };

const SIN_SALDO: Par = { mon: 0n, panal: 0n };

export default function Llavero(): React.ReactElement {
  const navegar = useNavigate();
  const [parametros] = useSearchParams();
  /** `crear` o `traer` si se llega desde la bienvenida; si no, nada. */
  const hacer = parametros.get('hacer');

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
  const T = useTextos();
  const sesion = useSesion();
  const { cambiar, soltar } = useCambio();

  /** Con cuál se está firmando ahora mismo, si es una de éstas. */
  const enUso = sesion.abierta ? (sesion.wallet?.id ?? null) : null;

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
      setError(T.llavero.pinNoCoinciden);
      setPaso({ que: 'estrenar', primero: null });
      return;
    }
    setOcupado(true);
    try {
      const k = await crearLlavero(pin);
      setLlave(k);
      setError(null);
      refrescar();
      setPaso({ que: 'abierto' });
      // Recién puesto el PIN, se sigue con lo que se eligió en la bienvenida
      // en vez de dejar a la persona delante de un llavero vacío.
      if (hacer === 'crear') await alCrearWallet(k);
      else if (hacer === 'traer') setImportando(true);
    } catch {
      setError(T.llavero.noSePudoCrear);
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
      setError(T.llavero.pinMalo);
      return;
    }
    setLlave(k);
    setError(null);
    refrescar();
    setPaso({ que: 'abierto' });
    // Con el llavero ya estrenado se llega aquí en vez de a `alEstrenar`: si
    // se venía de la bienvenida, el camino sigue igual.
    if (hacer === 'crear' && listar().length === 0) await alCrearWallet(k);
    else if (hacer === 'traer') setImportando(true);
  };

  /**
   * Termina el alta que empezó en la bienvenida: sesión abierta y a la app.
   *
   * Solo cuando se llegó con `?hacer=`. Entrando por el menú, crear una wallet
   * más no tiene por qué cambiar con cuál estás firmando.
   */
  const terminarAlta = async (w: WalletGuardada, k: Llave | null): Promise<void> => {
    if (!hacer || !k) return;
    await abrirSesion(k, w);
    // `replace` para que el botón de atrás no devuelva a la pantalla de alta,
    // que ya no tiene nada que hacer.
    navegar('/chats', { replace: true });
  };

  // La clave llega por parámetro porque al estrenar el llavero se encadena
  // desde `alEstrenar`, y allí `llave` todavía es el estado viejo.
  const alCrearWallet = async (k: Llave | null = llave): Promise<void> => {
    if (!k) return;
    setOcupado(true);
    try {
      const { wallet, palabras } = await crearWallet(k, nombrePorDefecto());
      refrescar();
      setPaso({
        que: 'secreto',
        wallet,
        secreto: { tipo: 'palabras', texto: palabras.join(' ') },
        recien: true,
      });
    } catch {
      setError(T.llavero.noSePudoGuardar);
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
        titulo={paso.primero === null ? T.llavero.pinTitulo : T.llavero.pinOtraVez}
        explicacion={paso.primero === null ? T.llavero.pinExplicacion : T.llavero.pinRepite}
        onCompleto={alEstrenar}
        error={error}
        ocupado={ocupado}
      />
    );
  }

  if (paso.que === 'bloqueado') {
    return (
      <Teclado
        titulo={T.llavero.bloqueadoTitulo}
        explicacion={T.llavero.bloqueadoExplicacion}
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
        T={T}
        onListo={() => {
          if (paso.recien) marcarCopiada(paso.wallet.id);
          refrescar();
          setPaso({ que: 'abierto' });
          void terminarAlta(paso.wallet, llave);
        }}
      />
    );
  }

  return (
    <div className="relative flex min-h-0 grow flex-col">
      <header className="flex shrink-0 items-end justify-between px-5 pb-3 pt-5">
        <div>
          <h1 className="font-display text-[26px] font-semibold -tracking-[0.015em]">
            {T.llavero.titulo}
          </h1>
          <p className="mt-0.5 text-[12.5px] text-ink-3">
            {wallets.length === 0 ? T.llavero.vacio : T.llavero.cuantas(wallets.length)}
          </p>
        </div>
        <div className="flex gap-2">
          {wallets.length > 0 && (
            <button
              type="button"
              onClick={saldos.refrescar}
              className="pulsable tocable flex h-9 w-9 items-center justify-center rounded-full border border-line"
              aria-label={T.llavero.refrescar}
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
            aria-label={T.llavero.bloquear}
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
              {/* Con cuál se está pagando, aquí y no solo dentro de la ficha:
                  es la pregunta que trae a esta pantalla a quien tiene más de
                  una, y abrir cuatro fichas para averiguarlo no es contestarla. */}
              {w.id === enUso && (
                <span className="shrink-0 rounded-full border border-honey-line bg-honey-soft px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-honey">
                  {T.hojaWallet.enUso}
                </span>
              )}
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
                <span className="text-[11.5px] text-terra">{T.llavero.sinCopia}</span>
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
            <p className="text-[13.5px] font-medium">
              {ocupado ? T.llavero.creando : T.llavero.crear}
            </p>
            <p className="text-[11.5px] leading-[1.45] text-ink-3">{T.llavero.crearPie}</p>
          </button>

          <button
            type="button"
            onClick={() => setImportando(true)}
            className="pulsable flex grow basis-0 flex-col gap-1.5 rounded-[14px] border border-dashed border-line p-3.5 text-left"
          >
            <Icono nombre="bajar" tamano={18} color="#948DAE" grosor={1.9} />
            <p className="text-[13.5px] font-medium">{T.llavero.traer}</p>
            <p className="text-[11.5px] leading-[1.45] text-ink-3">{T.llavero.traerPie}</p>
          </button>
        </div>

        {error && <p className="shrink-0 px-1 text-[12px] text-terra">{error}</p>}

        {saldos.fallo && wallets.length > 0 && (
          <p className="shrink-0 px-1 text-[12px] leading-[1.5] text-terra">
            {T.llavero.noSePudoLeer}
          </p>
        )}

        {/* El límite, dicho donde se decide y no en letra pequeña. */}
        <div className="mt-3 flex shrink-0 gap-2.5 rounded-[14px] border border-honey-line bg-honey-soft p-3.5">
          <Icono nombre="info" tamano={16} color="#E29A2E" grosor={2} className="mt-px shrink-0" />
          <div className="min-w-0">
            <p className="text-[12.5px] font-semibold text-honey">{T.llavero.hastaDonde}</p>
            <p className="mt-1 text-[12px] leading-[1.55] text-ink-2">{T.llavero.hastaDondeTexto}</p>
          </div>
        </div>
      </div>

      {abierta && (
        <Detalle
          wallet={abierta}
          saldo={saldos.por[abierta.direccion.toLowerCase()] ?? SIN_SALDO}
          sinLeer={saldos.cargando || saldos.fallo}
          enUso={abierta.id === enUso}
          onCerrar={() => setAbierta(null)}
          onVerSecreto={() => void alVerSecreto(abierta)}
          onUsar={() => {
            // La ficha se cierra antes: el PIN sale por encima de todo, y
            // dejarla debajo hace que al acabar reaparezca una hoja que habla
            // de la wallet que ya no es la de antes.
            setAbierta(null);
            cambiar(abierta);
          }}
          onRenombrar={(nombre) => {
            const puesto = renombrar(abierta.id, nombre);
            if (puesto === null) return;
            // Y en la sesión, si es la que firma: la guarda como copia, así
            // que sin esto el menú seguiría diciendo el nombre viejo.
            renombrarEnSesion(abierta.id, puesto);
            setAbierta({ ...abierta, nombre: puesto });
            refrescar();
          }}
          T={T}
          onEnviar={() => {
            setEnviando(abierta);
            setAbierta(null);
          }}
          onRecibir={() => {
            setRecibiendo(abierta);
            setAbierta(null);
          }}
          onBorrar={() => {
            // Si es la que está firmando, primero se suelta. Sin esto, su clave
            // descifrada se quedaba en memoria y wagmi seguía anunciando
            // conectada la dirección de una wallet que ya no existe: la app
            // podía firmar con algo que el llavero ya no puede volver a abrir.
            if (abierta.id === enUso) soltar();
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
          T={T}
        />
      )}

      {recibiendo && (
        <HojaRecibir wallet={recibiendo} onCerrar={() => setRecibiendo(null)} T={T} />
      )}

      {importando && llave && (
        <HojaImportar
          llave={llave}
          T={T}
          onCerrar={() => setImportando(false)}
          onHecho={(w) => {
            setImportando(false);
            refrescar();
            if (hacer) {
              void terminarAlta(w, llave);
              return;
            }
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
  T,
}: {
  wallet: WalletGuardada;
  secreto: Secreto;
  recien: boolean;
  onListo: () => void;
  T: Textos;
}): React.ReactElement {
  // Nada de capturas mientras esto esté delante: es la wallet entera, y una
  // captura acaba en la galería y de ahí en la nube. Se destapa solo al salir.
  useSinCapturas();

  const palabras = secreto.tipo === 'palabras' ? secreto.texto.split(' ') : [];

  return (
    <div className="flex min-h-0 grow flex-col">
      <header className="shrink-0 px-5 pb-2 pt-5">
        <h1 className="font-display text-[24px] font-semibold -tracking-[0.015em]">
          {secreto.tipo === 'palabras'
            ? T.llavero.palabrasTitulo(palabras.length)
            : T.llavero.claveTitulo}
        </h1>
        <p className="mt-1.5 text-[13px] leading-[1.55] text-ink-2">
          {secreto.tipo === 'palabras'
            ? T.llavero.palabrasTexto(wallet.nombre)
            : T.llavero.claveTexto(wallet.nombre)}
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
          <p className="text-[12px] leading-[1.55] text-ink-2">{T.llavero.peligro}</p>
        </div>

        <button
          type="button"
          onClick={onListo}
          className="pulsable tocable mt-1 shrink-0 rounded-full bg-monad py-3.5 text-[15px] font-semibold text-white shadow-monad"
        >
          {recien ? T.llavero.yaApuntadas : T.comun.listo}
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
  enUso,
  onCerrar,
  onVerSecreto,
  onUsar,
  onRenombrar,
  onEnviar,
  onRecibir,
  onBorrar,
  T,
}: {
  wallet: WalletGuardada;
  saldo: Par;
  sinLeer: boolean;
  /** Si es ésta la que firma ahora mismo. */
  enUso: boolean;
  onCerrar: () => void;
  onVerSecreto: () => void;
  onUsar: () => void;
  onRenombrar: (nombre: string) => void;
  onEnviar: () => void;
  onRecibir: () => void;
  onBorrar: () => void;
  T: Textos;
}): React.ReactElement {
  const [copiado, setCopiado] = useState(false);
  const [seguro, setSeguro] = useState(false);
  /** El nombre a medio escribir, o `null` si no se está renombrando. */
  const [borrador, setBorrador] = useState<string | null>(null);

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
          {T.llavero.mandar}
        </button>
        <button
          type="button"
          onClick={onRecibir}
          className="pulsable tocable flex grow items-center justify-center gap-2 rounded-full border border-line py-3 text-[14px] font-semibold text-ink-2"
        >
          <Icono nombre="bajar" tamano={15} color="#948DAE" />
          {T.llavero.recibir}
        </button>
      </div>
      {vacia && (
        <p className="mt-2 text-[11.5px] leading-[1.5] text-ink-3">
          {T.llavero.vaciaPie}
        </p>
      )}

      {/* Lo que faltaba: pasar a pagar con ésta.
          Antes esta pantalla solo servía para mirar y para mandar dinero, así
          que una wallet creada aquí se quedaba fuera de la app —no se podía
          hablar con un agente ni encargarle nada desde ella— y no había ni un
          sitio donde eso se pudiera cambiar. */}
      {enUso ? (
        <p className="mt-3 flex items-center justify-center gap-1.5 rounded-full border border-honey-line bg-honey-soft py-2.5 text-[13px] font-medium text-honey">
          <Icono nombre="check" tamano={15} color="#E29A2E" grosor={2.2} />
          {T.llavero.esLaQueUsas}
        </p>
      ) : (
        <>
          <button
            type="button"
            onClick={onUsar}
            className="pulsable tocable mt-3 flex w-full items-center justify-center gap-2 rounded-full border border-honey-line bg-honey-soft py-3 text-[14px] font-semibold text-honey"
          >
            <Icono nombre="llave" tamano={15} color="#E29A2E" grosor={2} />
            {T.llavero.usarEsta}
          </button>
          <p className="mt-2 text-[11.5px] leading-[1.5] text-ink-3">{T.llavero.usarEstaPie}</p>
        </>
      )}

      <div className="my-4 h-px bg-line" />

      <p className="text-[11.5px] uppercase tracking-[0.06em] text-ink-3">{T.comun.suDireccion}</p>
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
        {copiado ? T.comun.copiada : T.comun.copiarDireccion}
      </button>

      <button
        type="button"
        onClick={onVerSecreto}
        className="pulsable tocable mt-2 flex w-full items-center justify-center gap-2 rounded-full border border-line py-2.5 text-[13.5px] font-medium text-ink-2"
      >
        <Icono nombre="llave" tamano={15} color="#948DAE" />
        {wallet.tipo === 'clave' ? T.llavero.verClave : T.llavero.verPalabras}
      </button>

      {/* El nombre se podía poner al traer una wallet de fuera y nunca más.
          Las que nacen aquí se llamaban «Wallet 1» para siempre, que con una
          sola daba igual y con cuatro es la única forma de saber cuál es cuál
          antes de pagar. Se escribe donde se lee, sin salir de la ficha. */}
      {borrador === null ? (
        <button
          type="button"
          onClick={() => setBorrador(wallet.nombre)}
          className="pulsable tocable mt-2 flex w-full items-center justify-center gap-2 rounded-full border border-line py-2.5 text-[13.5px] font-medium text-ink-2"
        >
          <Icono nombre="lapiz" tamano={15} color="#948DAE" />
          {T.llavero.cambiarNombre}
        </button>
      ) : (
        <div className="mt-2 rounded-[14px] border border-line bg-cream p-3">
          <label className="block text-[11.5px] uppercase tracking-[0.06em] text-ink-3">
            {T.importar.comoLaLlamas}
          </label>
          <input
            value={borrador}
            onChange={(e) => setBorrador(e.target.value)}
            maxLength={MAX_NOMBRE}
            autoFocus
            placeholder={wallet.nombre}
            className="mt-2 w-full rounded-[12px] border border-line bg-paper px-3.5 py-2.5 text-[14px] outline-none placeholder:text-ink-3 focus:border-monad"
          />
          <div className="mt-2.5 flex gap-2">
            <button
              type="button"
              onClick={() => setBorrador(null)}
              className="pulsable tocable grow basis-0 rounded-full border border-line py-2.5 text-[13.5px] font-medium text-ink-2"
            >
              {T.comun.cancelar}
            </button>
            <button
              type="button"
              onClick={() => {
                onRenombrar(borrador);
                setBorrador(null);
              }}
              className="pulsable tocable grow basis-0 rounded-full bg-monad py-2.5 text-[13.5px] font-semibold text-white shadow-monad"
            >
              {T.comun.guardar}
            </button>
          </div>
        </div>
      )}

      <p className="mt-3 text-[12px] leading-[1.55] text-ink-3">
        {wallet.importada ? T.llavero.importada : T.llavero.creadaAqui}
      </p>

      <div className="my-4 h-px bg-line" />

      {!seguro ? (
        <button
          type="button"
          onClick={() => setSeguro(true)}
          className="pulsable tocable flex w-full items-center justify-center gap-2 rounded-full py-2.5 text-[13.5px] font-medium text-terra"
        >
          <Icono nombre="papelera" tamano={15} color="#C9653B" />
          {T.llavero.borrarDelTelefono}
        </button>
      ) : (
        <div className="rounded-[14px] border border-terra/40 bg-terra/10 p-3.5">
          <p className="text-[13px] font-semibold text-terra">
            {wallet.copiada ? T.llavero.seguro : T.llavero.sinApuntar}
          </p>
          <p className="mt-1 text-[12px] leading-[1.55] text-ink-2">
            {wallet.copiada ? T.llavero.seguroTexto : T.llavero.sinApuntarTexto}
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setSeguro(false)}
              className="pulsable tocable grow rounded-full border border-line py-2.5 text-[13.5px] font-medium text-ink-2"
            >
              {T.comun.ahoraNo}
            </button>
            <button
              type="button"
              onClick={onBorrar}
              className="pulsable tocable grow rounded-full bg-terra py-2.5 text-[13.5px] font-semibold text-white"
            >
              {T.comun.borrar}
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
