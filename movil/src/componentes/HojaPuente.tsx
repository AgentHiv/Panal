import { useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { Address } from 'viem';
import { isAddressEqual } from 'viem';
import { x402Currency } from '@panal/sdk';
import { NATIVE_CURRENCY, PANAL_TOKEN_ADDRESS } from '@/contracts/config';
import Icono from '~/componentes/Icono';
import { Boton, Fila, Nota, Tarjeta } from '~/componentes/Hoja';
import { useFicha } from '~/lib/agentes';
import { PROVEEDOR } from '~/lib/conector';
import { monto, troceada } from '~/lib/formato';
import { listar } from '~/lib/llavero';
import {
  aprobarPropuesta,
  arrancarPuente,
  describir,
  firmarPeticion,
  olvidarAviso,
  rechazarPeticion,
  rechazarPropuesta,
  usePuente,
} from '~/lib/puente';
import type { EstadoPuente, Peticion, PeticionPuente } from '~/lib/puente';
import { useSesion } from '~/lib/sesion';
import { useTextos } from '~/i18n/idiomas';
import type { Textos } from '~/i18n/idiomas';

/**
 * La app como wallet de panal.lat: conectar, y cada firma que pida la web.
 *
 * Va encima de todo y sin cerrar tocando fuera: lo que se decide aquí lo está
 * esperando la web en el navegador, y una hoja que se va sin contestar deja la
 * web colgada. Las dos salidas son explícitas, aceptar o rechazar, y las dos
 * contestan a la web y devuelven al navegador.
 *
 * Con el llavero cerrado no se enseña: primero el PIN (la pantalla de siempre)
 * y después esto. Lo que llegue mientras tanto espera en la cola.
 */
export default function HojaPuente({ esperandoPin }: { esperandoPin: boolean }): React.ReactElement | null {
  const T = useTextos();
  const p = usePuente();
  const sesion = useSesion();

  useEffect(() => {
    arrancarPuente();
  }, []);

  if (!p.disponible) return null;

  const pendiente = p.propuesta ?? p.peticion;
  if (pendiente) {
    if (esperandoPin) return null;
    const activa = sesion.abierta && sesion.wallet ? (sesion.wallet.direccion as Address) : null;
    if (!activa) {
      return (
        <Capa titulo={p.propuesta ? T.puente.conectarTitulo : T.puente.firmarTitulo}>
          <Nota tono="miel">{T.puente.sinLlavero}</Nota>
          <div className="mt-5">
            <Boton variante="secundario" onClick={() => void (p.propuesta ? rechazarPropuesta() : rechazarPeticion())}>
              {T.puente.rechazar}
            </Boton>
          </div>
        </Capa>
      );
    }
    if (p.propuesta) return <Conectar estado={p} activa={activa} nombre={sesion.wallet?.nombre ?? ''} />;
    if (p.peticion) return <Firmar estado={p} peticion={p.peticion} activa={activa} />;
  }

  if (p.aviso) {
    return (
      <Capa titulo={T.puente.conectarTitulo}>
        <p className="mt-2 text-[13.5px] leading-[1.55] text-ink-2">{textoDelAviso(T, p.aviso)}</p>
        <div className="mt-5">
          <Boton variante="secundario" onClick={olvidarAviso}>
            {T.puente.entendido}
          </Boton>
        </div>
      </Capa>
    );
  }
  return null;
}

function textoDelAviso(T: Textos, a: NonNullable<EstadoPuente['aviso']>): string {
  switch (a.tipo) {
    case 'otraWeb':
    case 'falsa':
    case 'estafa':
      return T.puente.avisos[a.tipo](a.origen);
    case 'caducado':
    case 'sinRed':
      return T.puente.avisos[a.tipo];
    case 'rechazada':
      return T.puente.avisos.rechazada(a.detalle ?? '');
  }
}

/** La hoja, por encima de todo (incluidas las barras), sin cerrar al tocar fuera. */
function Capa({ titulo, children }: { titulo: string; children: ReactNode }): React.ReactElement {
  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end bg-[rgba(12,10,18,.72)]">
      <div className="grow" />
      <div className="aparecer con-barra-abajo max-h-[88%] overflow-y-auto rounded-t-[22px] border-t border-line bg-cream px-5 pt-2.5 shadow-hoja">
        <div className="mx-auto mb-[18px] h-1 w-[38px] rounded-full bg-line" />
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-honey-line bg-honey-soft">
            <Icono nombre="eslabon" tamano={17} color="#E29A2E" grosor={1.9} />
          </span>
          <h2 className="font-display text-[21px] font-semibold -tracking-[0.015em]">{titulo}</h2>
        </div>
        {children}
      </div>
    </div>
  );
}

function Conectar({
  estado,
  activa,
  nombre,
}: {
  estado: EstadoPuente;
  activa: Address;
  nombre: string;
}): React.ReactElement {
  const T = useTextos();
  const propuesta = estado.propuesta!;
  return (
    <Capa titulo={T.puente.conectarTitulo}>
      <p className="mt-2 text-[13.5px] leading-[1.55] text-ink-2">{T.puente.conectarTexto}</p>
      <Tarjeta>
        <Fila
          etiqueta={T.puente.web}
          pie={propuesta.comprobado ? T.puente.comprobada : undefined}
          valor={new URL(propuesta.origen).host}
        />
        <Fila etiqueta={T.puente.wallet} pie={troceada(activa)} valor={nombre} />
      </Tarjeta>
      {!propuesta.comprobado && <Nota tono="miel">{T.puente.sinComprobar}</Nota>}
      <div className="mt-5 flex flex-col gap-1.5">
        <Boton disabled={estado.ocupado} onClick={() => void aprobarPropuesta(activa)}>
          {T.puente.conectar}
        </Boton>
        <button
          type="button"
          disabled={estado.ocupado}
          onClick={() => void rechazarPropuesta()}
          className="pulsable tocable w-full rounded-full py-3 text-[14px] font-medium text-ink-3"
        >
          {T.puente.noConectar}
        </button>
      </div>
    </Capa>
  );
}

function Firmar({
  estado,
  peticion,
  activa,
}: {
  estado: EstadoPuente;
  peticion: PeticionPuente;
  activa: Address;
}): React.ReactElement {
  const T = useTextos();
  const d = useMemo(() => describir(peticion.metodo, peticion.params, peticion.cuenta), [peticion]);
  const otra = !isAddressEqual(activa, peticion.cuenta);
  const nombreDeLaOtra =
    listar().find((w) => isAddressEqual(w.direccion as Address, peticion.cuenta))?.nombre ??
    `${peticion.cuenta.slice(0, 6)}…${peticion.cuenta.slice(-4)}`;
  const esEnvio = peticion.metodo === 'eth_sendTransaction';

  return (
    <Capa titulo={T.puente.firmarTitulo}>
      <p className="mt-2 text-[13.5px] leading-[1.55] text-ink-2">{T.puente.firmarTexto}</p>
      <Detalle d={d} />
      {d.tipo === 'pagoMon' && <Nota tono="miel">{T.puente.avisoPagoMon}</Nota>}
      {otra && <Nota tono="miel">{T.puente.otraWallet(nombreDeLaOtra)}</Nota>}
      {estado.enCola > 0 && <p className="mt-3 text-[12px] text-ink-3">{T.puente.enCola(estado.enCola)}</p>}
      <div className="mt-5 flex flex-col gap-1.5">
        {!otra && d.tipo !== 'bloqueada' && (
          <Boton
            disabled={estado.ocupado}
            onClick={() => void firmarPeticion((a) => PROVEEDOR.request(a), activa)}
          >
            {estado.ocupado ? T.comun.abriendo : esEnvio ? T.puente.enviar : T.puente.firmar}
          </Boton>
        )}
        <button
          type="button"
          disabled={estado.ocupado}
          onClick={() => void rechazarPeticion()}
          className="pulsable tocable w-full rounded-full py-3 text-[14px] font-medium text-ink-3"
        >
          {T.puente.rechazar}
        </button>
      </div>
    </Capa>
  );
}

/** Moneda de un importe: símbolo y decimales, o la dirección si no es de las de Panal. */
function moneda(direccion: Address): { simbolo: string; decimales: number } {
  const c = x402Currency(direccion);
  return c ? { simbolo: c.symbol, decimales: c.decimals } : { simbolo: `${direccion.slice(0, 6)}…`, decimales: 18 };
}

function Detalle({ d }: { d: Peticion }): React.ReactElement | null {
  const T = useTextos();
  const filas: ReactNode[] = [];
  const que = (texto: string) => <Fila key="que" etiqueta={T.puente.que} valor={<span className="font-sans text-[13.5px]">{texto}</span>} />;
  const importe = (wei: bigint, m: Address) => {
    const { simbolo, decimales } = moneda(m);
    return <Fila key="importe" etiqueta={T.puente.importe} valor={`${monto(wei, decimales)} ${simbolo}`} destacada />;
  };

  switch (d.tipo) {
    case 'mensaje':
      return (
        <>
          <Tarjeta>{que(T.puente.tipos.mensaje)}</Tarjeta>
          <pre className="mt-3 max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-xl bg-sand px-3.5 py-3 font-mono text-[11.5px] leading-[1.5] text-ink-2">
            {d.texto}
          </pre>
        </>
      );
    case 'permit':
      filas.push(que(T.puente.tipos.permit), <Agente key="a" direccion={d.a} />, importe(d.importe, d.token));
      filas.push(<Fila key="c" etiqueta="" valor={<span className="text-[12px] text-ink-3">{T.puente.caduca(Math.max(1, Math.round(d.caduca / 60_000)))}</span>} />);
      break;
    case 'pagoMon':
      filas.push(que(T.puente.tipos.pagoMon), <Agente key="a" direccion={d.a} />, importe(d.importe, NATIVE_CURRENCY));
      break;
    case 'encargo':
      filas.push(que(T.puente.tipos.encargo), <Agente key="a" direccion={d.agente} />, importe(d.importe, d.moneda));
      break;
    case 'aprobar':
      filas.push(
        que(d.para === 'escrow' ? T.puente.tipos.aprobarEscrow : T.puente.tipos.aprobarTablon),
        importe(d.importe, PANAL_TOKEN_ADDRESS),
      );
      break;
    case 'escrow':
      filas.push(que(T.puente.tipos.escrow(d.funcion)));
      break;
    case 'tablon':
      filas.push(que(T.puente.tipos.tablon(d.funcion)));
      if (d.agente) filas.push(<Agente key="a" direccion={d.agente} />);
      if (d.importe !== undefined && d.importe > 0n) {
        filas.push(importe(d.importe, d.moneda ?? NATIVE_CURRENCY));
      }
      break;
    case 'registro':
      filas.push(que(T.puente.tipos.registro(d.funcion)));
      break;
    case 'red':
    case 'bloqueada':
      return null;
  }
  return <Tarjeta>{filas}</Tarjeta>;
}

/** El nombre del agente si está registrado; si no, la dirección y un aviso. */
function Agente({ direccion }: { direccion: Address }): React.ReactElement {
  const T = useTextos();
  const { data } = useFicha(direccion);
  const registrado = data?.registrado === true;
  return (
    <Fila
      etiqueta={T.puente.para}
      pie={registrado ? troceada(direccion) : data ? T.puente.noEsAgente : troceada(direccion)}
      valor={<span className={registrado ? 'font-sans text-[13.5px]' : 'text-terra'}>{registrado ? data.nombre : `${direccion.slice(0, 6)}…${direccion.slice(-4)}`}</span>}
    />
  );
}
