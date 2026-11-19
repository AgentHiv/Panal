import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useWallet } from '@/hooks/useWallet';
import { activeChain } from '@/contracts/config';
import { useSaldos } from '~/lib/usarSaldos';
import { useSesion } from '~/lib/sesion';
import { useCambio } from '~/lib/cambio';
import { copiar } from '~/lib/wallets';
import Icono from '~/componentes/Icono';
import HojaRecibir from '~/componentes/HojaRecibir';
import Menu from '~/componentes/Menu';
import { useTextos } from '~/i18n/idiomas';
import type { Textos } from '~/i18n/idiomas';
import { usePendiente } from '~/lib/agentes';
import { monto } from '~/lib/formato';
import Dolares from '~/componentes/Dolares';

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
  // Lo aprobado que espera en el escrow. Es la misma lectura que el panel del
  // agente, con su caché: mirar aquí no añade consultas.
  const { data: pendiente } = usePendiente(connected ? (address ?? undefined) : undefined);
  const { panal, mon, cargando } = useSaldos();
  const sesion = useSesion();
  const { cambiar } = useCambio();
  const T = useTextos();
  const [copiado, setCopiado] = useState(false);
  const [recibiendo, setRecibiendo] = useState(false);
  const navegar = useNavigate();

  const alCopiar = async (): Promise<void> => {
    if (!address) return;
    if (await copiar(address)) {
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2200);
    }
  };

  return (
    <div className="flex min-h-0 grow flex-col">
      <header className="flex shrink-0 items-center justify-between px-5 pb-3 pt-5">
        <h1 className="font-display text-[26px] font-semibold -tracking-[0.015em]">
          {T.saldo.titulo}
        </h1>
        <Menu />
      </header>

      {!connected ? (
        <SinWallet conectando={connecting} onConectar={connect} T={T} />
      ) : (
        <div className="flex min-h-0 grow flex-col gap-3 overflow-y-auto px-5 pb-5">
          {wrongNetwork && (
            <div className="shrink-0 rounded-[14px] border border-terra/40 bg-terra/10 p-3.5">
              <div className="flex items-center gap-2">
                <Icono nombre="info" tamano={16} color="#C9653B" />
                <p className="text-[13px] font-semibold text-terra">{T.saldo.otraRedTitulo}</p>
              </div>
              <p className="mt-1.5 text-[12px] leading-[1.5] text-ink-2">
                {T.saldo.otraRedTexto(activeChain.name)}
              </p>
              <button
                type="button"
                onClick={switchToMonad}
                className="pulsable tocable mt-3 w-full rounded-full bg-terra py-2.5 text-[14px] font-semibold text-white"
              >
                {T.barraRed.cambiar(activeChain.name)}
              </button>
            </div>
          )}

          {/* La tarjeta del saldo: lo que hay, de quién es y los dos botones que
              se buscan al entrar. Las dos monedas juntas pero cada una con su
              cifra: no se suman, porque no se gastan en lo mismo (abajo). */}
          <TarjetaSaldo
            nombre={sesion.wallet?.nombre ?? null}
            direccion={addressShort}
            firmaAqui={sesion.abierta}
            panal={panal ?? null}
            mon={mon ?? null}
            cargando={cargando}
            T={T}
          >
          {/* Mandar y recibir, que es lo primero que se busca en una cartera.
              Estaban SOLO dentro del llavero, una pantalla más adentro, así que
              desde aquí —donde se mira el saldo— no había forma de mover nada.

              Recibir se abre aquí mismo: no firma nada, solo enseña la
              dirección, y eso vale igual para una wallet del llavero que para
              una conectada por fuera.

              Enviar manda al llavero con `?hacer=enviar`. Firmar exige la llave
              descifrada y esa solo existe allí, tras el PIN; duplicar el
              desbloqueo en esta pantalla sería duplicar la parte delicada. Con
              una wallet de fuera no sale: mandar desde ella se hace en su app,
              que es la que tiene su clave. */}
              {sesion.wallet && (
                <button
                  type="button"
                  onClick={() => navegar('/llavero?hacer=enviar')}
                  className="pulsable tocable flex grow items-center justify-center gap-2 rounded-full bg-monad py-3 text-[14px] font-semibold text-white shadow-monad"
                >
                  <Icono nombre="fuera" tamano={16} color="#fff" />
                  {T.saldo.enviar}
                </button>
              )}
              <button
                type="button"
                onClick={() => setRecibiendo(true)}
                className="pulsable tocable flex grow items-center justify-center gap-2 rounded-full border border-honey py-3 text-[14px] font-semibold text-honey"
              >
                <Icono nombre="mas" tamano={16} color="#E29A2E" />
                {T.saldo.recibir}
              </button>
          </TarjetaSaldo>

          <div className="shrink-0 rounded-[16px] border border-line p-3.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
              {T.saldo.paraQueSirve}
            </p>
            <Uso simbolo="$PANAL" color="#E29A2E" texto={T.saldo.panalParaQue} pie={T.saldo.panalPie} />
            <div className="my-3 h-px bg-line" />
            <Uso simbolo="MON" color="#B7A8FC" texto={T.saldo.monParaQue} pie={T.saldo.monPie} />
          </div>

          {/* La dirección va abajo y entera: es para recibir, no para mirarla. */}
          <div className="shrink-0 rounded-[14px] border border-line p-3.5">
            {/* Solo «tu dirección»: el nombre de la wallet y quién firma ya los
                dice la tarjeta de arriba, y aquí repetidos competían con lo
                único que esta tarjeta tiene que dar, que es la dirección entera. */}
            <p className="text-[11.5px] uppercase tracking-[0.06em] text-ink-3">{T.comun.tuDireccion}</p>
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
              {copiado ? T.comun.copiada : T.comun.copiarDireccion}
            </button>
            {/* Cambiar de wallet, donde se mira cuál hay. Antes esto solo se
                podía hacer desconectando, y desconectar no es lo que se quiere
                cuando lo que se busca es pagar con otra. */}
            <button
              type="button"
              onClick={() => cambiar()}
              className="pulsable tocable mt-2 flex w-full items-center justify-center gap-2 rounded-full border border-line py-2.5 text-[13.5px] font-medium text-ink-2"
            >
              <Icono nombre="recargar" tamano={15} color="#948DAE" />
              {T.saldo.cambiarWallet}
            </button>
            <p className="mt-2.5 text-[11.5px] leading-[1.5] text-ink-3">
              {T.saldo.dondeSeCompra}
            </p>
          </div>

          {/* LO APROBADO QUE NO ESTÁ EN ESTE SALDO. Es el sitio donde alguien que
              acaba de cobrar un encargo mira, no ve el dinero y cree que no le
              han pagado: el escrow ACREDITA, no envía. Por eso se dice aquí, con
              la cantidad, y lleva al panel, donde retirarlo es un botón. Solo
              sale si hay algo esperando. */}
          {address && pendiente && (pendiente.mon > 0n || pendiente.panal > 0n) && (
            <Link
              to={`/panel/${address.toLowerCase()}`}
              className="pulsable flex shrink-0 items-center gap-3 rounded-[14px] border border-honey-line bg-honey-soft p-3.5"
            >
              <Icono nombre="cartera" tamano={18} color="#E29A2E" className="shrink-0" />
              <div className="min-w-0 grow">
                <p className="text-[13.5px] font-medium">
                  {T.saldo.enEscrow(
                    [
                      pendiente.mon > 0n ? `${monto(pendiente.mon)} MON` : null,
                      pendiente.panal > 0n ? `${monto(pendiente.panal)} $PANAL` : null,
                    ]
                      .filter(Boolean)
                      .join(' · '),
                  )}
                </p>
                <p className="mt-0.5 text-[11.5px] leading-[1.45] text-ink-2">{T.saldo.enEscrowPie}</p>
              </div>
              <Icono nombre="atras" tamano={15} color="#948DAE" className="rotate-180" />
            </Link>
          )}

          {/* El llavero cuelga de aquí y no de una pestaña propia: es otra
              forma de tener una wallet, así que vive donde se mira la que hay. */}
          <Link
            to="/llavero"
            className="pulsable flex shrink-0 items-center gap-3 rounded-[14px] border border-line p-3.5"
          >
            <Icono nombre="llave" tamano={18} color="#E29A2E" className="shrink-0" />
            <div className="min-w-0 grow">
              <p className="text-[13.5px] font-medium">{T.saldo.llavero}</p>
              <p className="mt-0.5 text-[11.5px] leading-[1.45] text-ink-3">{T.saldo.llaveroPie}</p>
            </div>
            <Icono nombre="atras" tamano={15} color="#948DAE" className="rotate-180" />
          </Link>

          {/* Y los agentes, por lo mismo que el llavero: administrar uno es
              conectar SU wallet, así que vive donde se mira la que hay. */}
          <Link
            to="/agentes"
            className="pulsable flex shrink-0 items-center gap-3 rounded-[14px] border border-line p-3.5"
          >
            <Icono nombre="hexagono" tamano={18} color="#B7A8FC" className="shrink-0" />
            <div className="min-w-0 grow">
              <p className="text-[13.5px] font-medium">{T.saldo.agentes}</p>
              <p className="mt-0.5 text-[11.5px] leading-[1.45] text-ink-3">{T.saldo.agentesPie}</p>
            </div>
            <Icono nombre="atras" tamano={15} color="#948DAE" className="rotate-180" />
          </Link>

          <button
            type="button"
            onClick={disconnect}
            className="pulsable tocable mt-1 shrink-0 rounded-full py-3 text-center text-[13.5px] font-medium text-ink-3"
          >
            {T.saldo.desconectar(addressShort ?? '')}
          </button>
        </div>
      )}

      {recibiendo && address && (
        <HojaRecibir
          wallet={{
            direccion: address,
            // El nombre que se le puso si es del llavero; si viene de fuera, la
            // dirección corta, que es como la llama su propia app.
            nombre: sesion.wallet?.nombre ?? `${address.slice(0, 6)}…${address.slice(-4)}`,
          }}
          onCerrar={() => setRecibiendo(false)}
          T={T}
        />
      )}
    </div>
  );
}

interface Cantidad {
  texto: string;
  valor: bigint;
}

function TarjetaSaldo({
  nombre,
  direccion,
  firmaAqui,
  panal,
  mon,
  cargando,
  T,
  children,
}: {
  nombre: string | null;
  direccion: string | null;
  firmaAqui: boolean;
  panal: Cantidad | null;
  mon: Cantidad | null;
  cargando: boolean;
  T: Textos;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      className="relative shrink-0 overflow-hidden rounded-[22px] border border-honey-line/70 p-[18px]"
      style={{
        background:
          'radial-gradient(130% 90% at 100% 0%, rgba(131,110,249,.30) 0%, rgba(131,110,249,0) 55%), radial-gradient(120% 90% at 0% 100%, rgba(226,154,46,.20) 0%, rgba(226,154,46,0) 60%), #1A1726',
      }}
    >
      <PanalDeFondo />

      <div className="relative flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <svg width="18" height="18" viewBox="0 0 40 40" className="shrink-0" aria-hidden>
            <polygon points="20,2 36,11 36,29 20,38 4,29 4,11" fill="#E29A2E" />
          </svg>
          {/* Sin `uppercase`: un nombre lo escribe una persona, y «Nómina»
              convertido en «NÓMINA» ya no es el que puso. */}
          <p className="truncate text-[14px] font-semibold">{nombre ?? T.comun.tuDireccion}</p>
        </div>
        {/* Cuál de las dos está firmando. No es un detalle: decide si al
            aprobar algo se abre otra app o no se abre nada. */}
        <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-black/25 px-2.5 py-1 text-[10.5px] text-ink-2">
          <Icono nombre={firmaAqui ? 'llave' : 'eslabon'} tamano={11} color={firmaAqui ? '#E29A2E' : '#948DAE'} />
          {firmaAqui ? T.menu.firmaAqui : T.menu.firmaFuera}
        </span>
      </div>
      {direccion && <p className="relative mt-1 pl-[26px] font-mono text-[11.5px] text-ink-3">{direccion}</p>}

      <div className="relative mt-5 grid grid-cols-2 gap-2.5">
        <Cifra simbolo="$PANAL" color="#E29A2E" cantidad={panal} cargando={cargando} />
        <Cifra simbolo="MON" color="#B7A8FC" cantidad={mon} cargando={cargando} />
      </div>

      <div className="relative mt-4 flex gap-2.5">{children}</div>
    </div>
  );
}

function Cifra({
  simbolo,
  color,
  cantidad,
  cargando,
}: {
  simbolo: string;
  color: string;
  cantidad: Cantidad | null;
  cargando: boolean;
}): React.ReactElement {
  const texto = cantidad?.texto ?? null;
  return (
    <div className="min-w-0 rounded-[14px] bg-black/25 px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[11.5px] font-semibold" style={{ color }}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} aria-hidden />
        {simbolo}
      </p>
      {cargando && texto === null ? (
        <span className="mt-1.5 block h-6 w-16 animate-pulse rounded bg-sand" />
      ) : (
        // Las cifras largas bajan de tamaño en vez de cortarse: en media
        // tarjeta, «1.234.567,8» a 24 px no cabe, y un saldo cortado miente.
        <p
          className={`mt-1.5 truncate font-mono font-medium leading-none ${
            (texto ?? '').length > 9 ? 'text-[18px]' : 'text-[24px]'
          }`}
          style={{ color }}
        >
          {texto ?? '—'}
        </p>
      )}
      {cantidad && cantidad.valor > 0n ? (
        <Dolares wei={cantidad.valor} simbolo={simbolo} className="mt-1.5 block truncate" />
      ) : (
        <span className="mt-1.5 block h-[15px]" aria-hidden />
      )}
    </div>
  );
}

/** Para qué sirve cada moneda, en una línea y su letra pequeña. */
function Uso({
  simbolo,
  color,
  texto,
  pie,
}: {
  simbolo: string;
  color: string;
  texto: string;
  pie: string;
}): React.ReactElement {
  return (
    <div className="mt-2.5 flex gap-3">
      <span
        className="mt-0.5 shrink-0 self-start rounded-full px-2 py-0.5 font-mono text-[10.5px] font-semibold"
        style={{ color, backgroundColor: `${color}1F` }}
      >
        {simbolo}
      </span>
      <div className="min-w-0">
        <p className="text-[13px] leading-[1.5] text-ink-2">{texto}</p>
        <p className="mt-0.5 text-[11.5px] leading-[1.5] text-ink-3">{pie}</p>
      </div>
    </div>
  );
}

/** Un panal apenas marcado en la esquina de la tarjeta: la marca, sin ruido. */
function PanalDeFondo(): React.ReactElement {
  const celdas: [number, number][] = [
    [0, 0],
    [32, 0],
    [64, 0],
    [16, 27],
    [48, 27],
    [80, 27],
    [32, 54],
    [64, 54],
    [48, -27],
    [80, -27],
  ];
  return (
    <svg
      viewBox="-20 -50 120 130"
      className="pointer-events-none absolute -right-10 -top-10 h-[150px] w-[140px]"
      fill="none"
      aria-hidden
    >
      <g stroke="rgba(226,154,46,.09)" strokeWidth="1.1">
        {celdas.map(([x, y]) => (
          <polygon key={`${x},${y}`} points="0,-18 16,-9 16,9 0,18 -16,9 -16,-9" transform={`translate(${x},${y})`} />
        ))}
      </g>
    </svg>
  );
}

/** Sin wallet no hay saldo que enseñar, así que la pantalla es la puerta. */
function SinWallet({
  conectando,
  onConectar,
  T,
}: {
  conectando: boolean;
  onConectar: () => void;
  T: Textos;
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
        {T.saldo.conectaTitulo}
      </h2>
      <p className="mt-2 max-w-[280px] text-pretty text-center text-[13.5px] leading-[1.55] text-ink-2">
        {T.saldo.conectaTexto}
      </p>

      <button
        type="button"
        onClick={onConectar}
        disabled={conectando}
        className="pulsable mt-7 flex h-[52px] w-full max-w-[300px] items-center justify-center gap-2 rounded-full bg-monad text-[15px] font-semibold text-white shadow-monad disabled:opacity-60"
      >
        {conectando ? T.comun.conectando : T.comun.conectarWallet}
      </button>
    </div>
  );
}
