import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { usePanalAgents } from '@/hooks/usePanalAgents';
import type { OnchainAgent } from '@/hooks/usePanalAgents';
import { currencySymbol } from '@/contracts/config';
import { formatMon } from '@/data/agents';
import { useAhora } from '@/hooks/useAhora';
import { useAgente } from '~/lib/agente';
import Hexagono from '~/componentes/Hexagono';
import { dinero } from '~/lib/formato';

/**
 * La ficha del agente.
 *
 * LO PRIMERO ES LA VERIFICACIÓN, y no por costumbre: el nombre no es único en
 * el registro, así que un suplantador con el mismo nombre y la misma
 * descripción cuesta una transacción. Lo único que es de alguien es su
 * dominio. Elegir sin mirar esto es el fallo que más caro sale.
 *
 * Y son TRES estados, no dos: verificado, no verificado y sin comprobar. Un
 * `unchecked` tratado como bueno es exactamente el error que la distinción
 * existe para evitar.
 *
 * LO QUE NO SE ENSEÑA: el «% de éxito». No se mide en ninguna parte —se asigna
 * 100 fijo en usePanalAgents— así que todos los agentes saldrían perfectos y el
 * número no significaría nada delante de alguien que va a pagar.
 */
export default function Agente(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const direccion = (id ?? '').toLowerCase();
  const navegar = useNavigate();
  const { agents, loading } = usePanalAgents();
  const { data: datos } = useAgente(direccion);

  const agente = useMemo(
    () =>
      agents.find(
        (a) => 'workerAddress' in a && a.workerAddress.toLowerCase() === direccion,
      ) as OnchainAgent | undefined,
    [agents, direccion],
  );

  return (
    <div className="flex min-h-0 grow flex-col">
      <header className="con-barra-arriba flex shrink-0 items-center px-3 pt-3">
        <button
          type="button"
          onClick={() => navegar(-1)}
          aria-label="Volver"
          className="pulsable flex h-11 w-11 items-center justify-center"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#C8C3DC"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
      </header>

      <div className="flex min-h-0 grow flex-col gap-3.5 overflow-y-auto px-[18px] pb-4">
        <div className="flex items-center gap-3.5">
          <Hexagono
            semilla={direccion}
            inicial={(agente?.name ?? datos?.nombre ?? 'A').slice(0, 1)}
            tamano={64}
          />
          <div className="min-w-0">
            <h1 className="truncate font-display text-[24px] font-semibold -tracking-[0.02em]">
              {agente?.name ?? datos?.nombre ?? '…'}
            </h1>
            <p className="seleccionable mt-1 font-mono text-[12px] text-ink-3">
              {`${direccion.slice(0, 6)}…${direccion.slice(-4)}`}
            </p>
          </div>
        </div>

        {agente && <Verificacion agente={agente} />}
        {agente && <OrigenDelNombre agente={agente} />}

        {agente && (
          <div className="flex divide-x divide-line overflow-hidden rounded-[14px] border border-line">
            <Dato valor={String(agente.tasksCompleted)} pie="tareas completadas" />
            <Dato
              valor={agente.reviews > 0 ? agente.rating.toFixed(1) : '—'}
              pie={agente.reviews > 0 ? `${agente.reviews} valoraciones` : 'sin valoraciones'}
              color={agente.reviews > 0 ? 'text-honey' : 'text-ink-3'}
            />
            <Dato
              valor={formatMon(agente.totalEarned, 0)}
              pie={`${currencySymbol(agente.currency)} cobrados`}
            />
          </div>
        )}

        {agente?.tagline && (
          <p className="seleccionable text-[14px] leading-[1.55] text-ink-2">{agente.tagline}</p>
        )}

        <div className="divide-y divide-line overflow-hidden rounded-[14px] border border-line">
          <Precio
            titulo="Hablar"
            pie="respuesta al momento · sin disputa"
            valor={
              datos?.cobro
                ? `${dinero(datos.cobro.amount, 1)} ${datos.cobro.simbolo}`
                : 'no disponible'
            }
            color={datos?.cobro ? 'text-honey' : 'text-ink-3'}
          />
          <Precio
            titulo="Encargar un trabajo"
            pie="plazo · entrega anclada · disputa"
            valor={
              agente
                ? `${formatMon(agente.pricePerTask, 0)} ${currencySymbol(agente.currency)}`
                : '…'
            }
            color="text-monad-mist"
          />
        </div>

        {loading && !agente && (
          <p className="pt-4 text-center text-[13px] text-ink-3">Buscándolo en la cadena…</p>
        )}
      </div>

      <div className="con-barra-abajo flex shrink-0 gap-2.5 border-t border-line bg-noche px-[18px] pt-3">
        <button
          type="button"
          onClick={() => navegar(`/chat/${direccion}`)}
          disabled={!datos?.cobro}
          className="pulsable h-[52px] grow rounded-full border border-honey text-[15px] font-semibold text-honey disabled:opacity-40"
        >
          Hablar
        </button>
        <button
          type="button"
          onClick={() => navegar(`/chat/${direccion}?encargar=1`)}
          className="pulsable h-[52px] grow rounded-full bg-monad text-[15px] font-semibold text-white shadow-monad"
        >
          Encargar
        </button>
      </div>
    </div>
  );
}

function Verificacion({ agente }: { agente: OnchainAgent }): React.ReactElement {
  const caso = {
    verified: {
      color: 'text-olive',
      borde: 'border-olive/35',
      fondo: 'bg-olive/10',
      titulo: 'Verificado',
      texto: 'Su dominio publica un agent.json que declara esta dirección. El nombre lo escribe cualquiera; el dominio no.',
    },
    unverified: {
      color: 'text-terra',
      borde: 'border-terra/40',
      fondo: 'bg-terra/10',
      titulo: 'No verificado',
      texto:
        agente.verificationReason ??
        'Se miró su dominio y no confirma esta dirección. Puede ser una suplantación.',
    },
    unchecked: {
      color: 'text-honey',
      borde: 'border-honey-line',
      fondo: 'bg-honey-soft',
      titulo: 'Sin comprobar',
      texto:
        'Nadie ha mirado todavía si algún dominio declara esta dirección. No es lo mismo que verificado: es que no se sabe.',
    },
  }[agente.verification];

  return (
    <div className={`rounded-[14px] border px-3.5 py-3 ${caso.borde} ${caso.fondo}`}>
      <p className={`text-[13.5px] font-semibold ${caso.color}`}>{caso.titulo}</p>
      <p className="mt-1.5 text-[12.5px] leading-[1.5] text-ink-2">{caso.texto}</p>
    </div>
  );
}

/**
 * De dónde salió el nombre.
 *
 * Un nombre comprado la semana pasada y uno reclamado hace un año valen lo
 * mismo como identificador y NO valen lo mismo como señal: en una venta lo
 * único que viaja es el nombre, y la reputación se queda con quien lo vendió.
 */
function OrigenDelNombre({ agente }: { agente: OnchainAgent }): React.ReactElement | null {
  // `useAhora` en vez de Date.now(): leer el reloj en el render da resultados
  // distintos en cada repintado y React no puede garantizar nada sobre eso.
  const ahora = useAhora(60_000);
  const n = agente.nombreOnchain;
  if (!n) return null;

  const dias = Math.floor((ahora - n.desdeTs) / 86_400);
  const comprado = n.origen === 'comprado' || n.origen === 'recibido';
  const reciente = comprado && dias <= 30;

  const texto = !n.origen
    ? `No se sabe cómo llegó a tener el nombre · hace ${dias} d`
    : `Nombre ${n.origen} hace ${dias} d`;

  return (
    <div className="flex items-start gap-2.5">
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke={reciente ? '#C9653B' : '#948DAE'}
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mt-0.5 shrink-0"
        aria-hidden
      >
        <path d="M4 8.5l8-4.5 8 4.5v7l-8 4.5-8-4.5z" />
      </svg>
      <div className="min-w-0">
        <p className={`text-[12.5px] font-medium ${reciente ? 'text-terra' : 'text-ink-3'}`}>
          {texto}
        </p>
        {reciente && (
          <p className="mt-1 text-[12px] leading-[1.5] text-ink-2">
            Los números de abajo son de esta dirección, no del nombre. La reputación no viaja en una
            venta: se queda con quien lo vendió.
          </p>
        )}
      </div>
    </div>
  );
}

function Dato({
  valor,
  pie,
  color = 'text-ink',
}: {
  valor: string;
  pie: string;
  color?: string;
}): React.ReactElement {
  return (
    <div className="grow px-3.5 py-3">
      <p className={`font-mono text-[19px] font-medium ${color}`}>{valor}</p>
      <p className="mt-0.5 text-[11px] text-ink-3">{pie}</p>
    </div>
  );
}

function Precio({
  titulo,
  pie,
  valor,
  color,
}: {
  titulo: string;
  pie: string;
  valor: string;
  color: string;
}): React.ReactElement {
  return (
    <div className="flex items-center gap-3 px-3.5 py-3">
      <div className="min-w-0 grow">
        <p className="text-[13.5px] font-medium">{titulo}</p>
        <p className="mt-0.5 text-[11.5px] text-ink-3">{pie}</p>
      </div>
      <p className={`shrink-0 font-mono text-[13.5px] ${color}`}>{valor}</p>
    </div>
  );
}
