import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import type { Address } from 'viem';
import { useWallet } from '@/hooks/useWallet';
import { useAhora } from '@/hooks/useAhora';
import { panalEscrowV2Abi } from '@/contracts/abis';
import {
  NATIVE_CURRENCY,
  PANAL_ESCROW_V2_ADDRESS,
  PANAL_TOKEN_ADDRESS,
  currencySymbol,
} from '@/contracts/config';
import Icono from '~/componentes/Icono';
import type { NombreIcono } from '~/componentes/Icono';
import { useFicha, usePendiente, useTareasDe } from '~/lib/agentes';
import { DISPUTA_MS, cuantasUrgentes, revisar } from '~/lib/guardia';
import type { Fila, Motivo } from '~/lib/guardia';
import { monto } from '~/lib/formato';

/**
 * Guardia · lo que tu agente tiene sin cerrar.
 *
 * Todo sale de la CADENA y no del servidor del agente, y es a propósito: sirve
 * precisamente cuando lo que ha fallado es tu servidor y su propio vigilante
 * cree que va todo bien. Esta semana pasó de verdad.
 *
 * Y hay un solo botón, «Cobrar». No es un descuido: entregar lo firma el agente
 * con su clave y el resultado está en su disco; una disputa la decide el
 * árbitro. Un botón «Entregar ahora» prometería algo que esta pantalla no puede
 * cumplir.
 */
const PINTA: Record<Motivo, { titulo: string; color: string; icono: NombreIcono }> = {
  'sin-entregar': { titulo: 'Abierta y sin entregar', color: '#C9653B', icono: 'reloj' },
  'sin-cobrar': { titulo: 'Ganado y sin cobrar', color: '#E29A2E', icono: 'cartera' },
  'sin-aprobar': { titulo: 'Entregada, esperando al cliente', color: '#92A268', icono: 'check' },
  disputa: { titulo: 'En disputa', color: '#B7A8FC', icono: 'info' },
};

export default function Guardia(): React.ReactElement {
  const { direccion } = useParams();
  const navegar = useNavigate();
  const { address, connected } = useWallet();
  const dir = (direccion ?? '').toLowerCase();

  const { data: ficha } = useFicha(dir);
  const { data: pendiente, refetch: releerPendiente } = usePendiente(dir);
  const { data: tareas = [], isLoading } = useTareasDe(dir);
  const [soloUrgentes, setSoloUrgentes] = useState(false);

  const mando = connected && address?.toLowerCase() === dir;
  // Un `Date.now()` en el render se congela: un plazo que vence mientras
  // alguien mira la pantalla seguiría diciendo «quedan 2 h» para siempre.
  const ahora = useAhora() * 1000;

  const filas = useMemo(
    () => revisar(tareas, pendiente ?? { panal: 0n, mon: 0n }, currencySymbol),
    [tareas, pendiente],
  );

  const urgentes = cuantasUrgentes(filas);
  const lista = soloUrgentes ? filas.filter((f) => f.urgente) : filas;

  return (
    <div className="flex min-h-0 grow flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3">
        <button
          type="button"
          onClick={() => navegar(-1)}
          className="pulsable tocable -ml-1 flex h-9 w-9 items-center justify-center"
          aria-label="Volver"
        >
          <Icono nombre="atras" tamano={19} color="#F2EFFA" />
        </button>
        <div className="min-w-0 grow">
          <h1 className="font-display text-[19px] font-semibold -tracking-[0.015em]">Guardia</h1>
          <p className="truncate text-[11.5px] text-ink-3">
            {ficha?.nombre ?? 'Lo que tiene sin cerrar'}
          </p>
        </div>
        {urgentes > 0 && (
          <span className="shrink-0 rounded-full border border-terra/40 bg-terra/10 px-2.5 py-1 text-[11px] text-terra">
            {urgentes} sin cerrar
          </span>
        )}
      </header>

      <div className="flex min-h-0 grow flex-col gap-3 overflow-y-auto px-5 py-4">
        {filas.length > 1 && (
          <div className="flex shrink-0 gap-2">
            {[
              [false, `Todo · ${filas.length}`],
              [true, `Corre prisa · ${urgentes}`],
            ].map(([valor, texto]) => (
              <button
                key={String(valor)}
                type="button"
                onClick={() => setSoloUrgentes(valor as boolean)}
                className={`rounded-full border px-3.5 py-1.5 text-[12.5px] ${
                  soloUrgentes === valor
                    ? 'border-honey bg-honey-soft text-honey'
                    : 'border-line text-ink-3'
                }`}
              >
                {texto as string}
              </button>
            ))}
          </div>
        )}

        {isLoading && filas.length === 0 && (
          <p className="shrink-0 px-1 text-[12.5px] text-ink-3">Leyendo la cadena…</p>
        )}

        {!isLoading && filas.length === 0 && (
          <div className="flex grow flex-col items-center justify-center px-6 pb-10">
            <Icono nombre="escudo" tamano={40} color="#342E4A" grosor={1.5} />
            <p className="mt-4 text-center font-display text-[17px] font-semibold">
              No hay nada sin cerrar
            </p>
            <p className="mt-2 max-w-[270px] text-pretty text-center text-[12.5px] leading-[1.55] text-ink-2">
              Ni encargos abiertos, ni entregas esperando, ni dinero dentro del depósito.
            </p>
          </div>
        )}

        {lista.map((f) => (
          <FilaGuardia
            key={f.clave}
            fila={f}
            ahora={ahora}
            mando={mando}
            onCobrado={() => void releerPendiente()}
          />
        ))}

        {filas.length > 0 && (
          <p className="mt-1 shrink-0 px-1 text-[11.5px] leading-[1.55] text-ink-3">
            Todo esto sale de la cadena, no de tu servidor. Es a propósito: sirve precisamente
            cuando lo que ha fallado es tu servidor y su propio vigilante cree que va todo bien.
          </p>
        )}
      </div>
    </div>
  );
}

function FilaGuardia({
  fila,
  ahora,
  mando,
  onCobrado,
}: {
  fila: Fila;
  ahora: number;
  mando: boolean;
  onCobrado: () => void;
}): React.ReactElement {
  const p = PINTA[fila.motivo];
  const { writeContract, data: hash, isPending } = useWriteContract();
  const recibo = useWaitForTransactionReceipt({ hash });
  const trabajando = isPending || recibo.isLoading;

  useEffect(() => {
    if (recibo.isSuccess) onCobrado();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recibo.isSuccess]);

  const vencida = fila.vence !== null && fila.vence < ahora;

  return (
    <div
      className="shrink-0 rounded-[14px] border p-3.5"
      style={{ borderColor: `${p.color}55`, background: `${p.color}12` }}
    >
      <div className="flex items-center gap-2">
        <Icono nombre={p.icono} tamano={15} color={p.color} grosor={2.1} />
        <p className="grow text-[13px] font-semibold" style={{ color: p.color }}>
          {p.titulo}
        </p>
        {fila.ref && (
          <span className="shrink-0 font-mono text-[12px]" style={{ color: p.color }}>
            {fila.ref}
          </span>
        )}
      </div>

      <p className="mt-2 text-[12.5px] leading-[1.55] text-ink-2">{explicar(fila, vencida)}</p>

      {fila.vence !== null && (
        <p className={`mt-2 font-mono text-[12px] ${vencida ? 'text-terra' : 'text-ink-3'}`}>
          {vencida ? 'el plazo venció ' : 'quedan '}
          {queda(fila.vence, ahora)}
        </p>
      )}

      {fila.motivo === 'sin-cobrar' && mando && (
        <button
          type="button"
          onClick={() =>
            writeContract({
              address: PANAL_ESCROW_V2_ADDRESS,
              abi: panalEscrowV2Abi,
              functionName: 'withdraw',
              args: [
                (fila.simbolo === '$PANAL' ? PANAL_TOKEN_ADDRESS : NATIVE_CURRENCY) as Address,
              ],
            })
          }
          disabled={trabajando}
          className="pulsable tocable mt-3 w-full rounded-full bg-monad py-2.5 text-[14px] font-semibold text-white shadow-monad disabled:opacity-50"
        >
          {trabajando ? 'Firmando…' : `Cobrar ${monto(fila.importe)} ${fila.simbolo}`}
        </button>
      )}

      {fila.motivo === 'sin-entregar' && (
        <p className="mt-2.5 border-t pt-2.5 text-[11.5px] leading-[1.5] text-ink-3" style={{ borderColor: `${p.color}33` }}>
          Desde aquí no se puede entregar: eso lo firma tu agente con su clave, y el resultado está
          en tu servidor. Lo que da esta pantalla es enterarte a tiempo.
        </p>
      )}

      {fila.motivo === 'disputa' && (
        <p className="mt-2.5 border-t pt-2.5 text-[11.5px] leading-[1.5] text-ink-3" style={{ borderColor: `${p.color}33` }}>
          Si el árbitro no resuelve en {Math.round(DISPUTA_MS / 86_400_000)} días, el pago vuelve
          entero al cliente y lo puede reclamar cualquiera.
        </p>
      )}
    </div>
  );
}

/**
 * Siempre «el depósito de X», nunca «los X».
 *
 * Con 1 MON salía «los 1 MON». El artículo tendría que concordar con un número
 * que no se sabe al escribir la frase, y meter una regla de plural para eso es
 * más código del que vale: nombrar el depósito lo esquiva y además es lo que
 * es — el dinero está dentro del escrow, no en manos de nadie.
 */
function explicar(f: Fila, vencida: boolean): string {
  const deposito = `el depósito de ${monto(f.importe)} ${f.simbolo}`;
  switch (f.motivo) {
    case 'sin-entregar':
      return vencida
        ? `El plazo pasó y no hay nada anclado. El cliente puede recuperar ${deposito} cuando quiera, y entonces no cobras.`
        : `Tu agente todavía no ha anclado nada. Si nadie entrega antes del plazo, el cliente recupera ${deposito} y tú no cobras.`;
    case 'sin-cobrar':
      // La cantidad va en el texto y no solo en el botón: siguiendo un agente
      // que no es tuyo no hay botón, y sin ella la fila no decía nada.
      return `Hay ${monto(f.importe)} ${f.simbolo} liquidados y todavía dentro del depósito. No caducan, pero tampoco salen solos.`;
    case 'sin-aprobar':
      return `Ya está anclada. Si el cliente no la aprueba ni la disputa, se libera sola y cobras ${deposito}.`;
    case 'disputa':
      return `El cliente la abrió. ${mayus(deposito)} está congelado: ni tú ni él cobráis hasta que el árbitro decida.`;
  }
}

const mayus = (s: string): string => s[0]!.toUpperCase() + s.slice(1);

/** «21 h», «2 d 6 h». Sin segundos: aquí nadie mira los segundos. */
function queda(vence: number, ahora: number): string {
  const ms = Math.abs(vence - ahora);
  const horas = Math.floor(ms / 3_600_000);
  if (horas < 48) return `${horas} h`;
  const dias = Math.floor(horas / 24);
  const resto = horas % 24;
  return resto ? `${dias} d ${resto} h` : `${dias} d`;
}
