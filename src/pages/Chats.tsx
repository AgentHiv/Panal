/**
 * Panal — la bandeja de conversaciones.
 *
 * Es lo que convierte el chat en algo a lo que se vuelve. Sin ella el
 * historial existe pero sólo se alcanza entrando por la ficha del agente, que
 * es como tener correo y ninguna lista de correos.
 *
 * UNA CONVERSACIÓN SON LAS DOS COSAS: lo que le has hablado y lo que le has
 * encargado. Durante un tiempo aquí sólo salía el chat, así que quien
 * contrataba a un agente por el escrow —firmando y bloqueando el pago— veía
 * esta pantalla vacía; y con los agentes que sólo aceptan encargos, siempre.
 * Los encargos se leen de la CADENA, no de aquí: por eso aparecen en
 * cualquier navegador donde conectes la misma wallet.
 *
 * Los hilos son de QUIEN LOS TUVO: se piden por la dirección conectada, así
 * que cambiar de wallet cambia la bandeja entera. En Panal la wallet es la
 * cuenta, y eso tiene que notarse aquí más que en ninguna otra pantalla.
 */

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { formatUnits } from 'viem';
import { Loader2, MessageCircle, Wallet } from 'lucide-react';
import HexAvatar from '@/components/HexAvatar';
import { listarHilos } from '@/lib/historial';
import {
  encargosDelCliente,
  fusionarBandeja,
  type ResumenConversacion,
} from '@/lib/conversaciones';
import { getTaskBrief } from '@/lib/taskBriefs';
import { usePanalAgents, isOnchainAgent } from '@/hooks/usePanalAgents';
import { useMyTasks } from '@/hooks/useMyTasks';
import { useWallet } from '@/hooks/useWallet';
import { currencySymbol } from '@/contracts/config';

/** Hace un `hace 3 h` a partir de un epoch, sin traer una librería de fechas. */
function haceCuanto(cuando: number, t: (k: string, o?: Record<string, unknown>) => string): string {
  const seg = Math.max(0, Math.round((Date.now() - cuando) / 1000));
  if (seg < 60) return t('chat.inbox.now');
  const min = Math.round(seg / 60);
  if (min < 60) return t('chat.inbox.minutes', { n: min });
  const horas = Math.round(min / 60);
  if (horas < 24) return t('chat.inbox.hours', { n: horas });
  return t('chat.inbox.days', { n: Math.round(horas / 24) });
}

export default function Chats() {
  const { t } = useTranslation();
  const { address, connected, connecting, connect } = useWallet();
  const { agents, loading: cargandoAgentes } = usePanalAgents();
  const { tasks, loading: cargandoTareas } = useMyTasks();

  const conversaciones = useMemo(() => {
    if (!address) return [];
    // Las dos mitades: el chat de este navegador y los encargos de la cadena.
    const encargos = encargosDelCliente(tasks, currencySymbol, getTaskBrief);
    return fusionarBandeja(listarHilos(address), encargos).map((c) => {
      // El hilo guarda la DIRECCIÓN del agente; el nombre y la ruta salen del
      // catálogo. Un agente que se dio de baja del mercado deja su conversación
      // huérfana, y en ese caso se enseña igual con su dirección: lo que se
      // habló sigue siendo del cliente aunque el agente ya no esté.
      const agente = agents.find(
        (a) => isOnchainAgent(a) && a.workerAddress.toLowerCase() === c.agente,
      );
      return { ...c, nombre: agente?.name ?? null, ruta: agente ? `/chat/${agente.id}` : null };
    });
  }, [address, agents, tasks]);

  // Al recargar, wagmi tarda un instante en recuperar la sesión. Enseñar
  // «conecta tu wallet» en ese hueco es decirle a alguien que no tiene cuenta
  // justo cuando está entrando en la suya.
  if (!connected && connecting) {
    return (
      <div className="container-hive flex min-h-[60vh] items-center justify-center py-24">
        <Loader2 className="size-6 animate-spin text-ink-3" aria-hidden />
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="container-hive flex min-h-[60vh] max-w-lg flex-col items-center justify-center gap-5 py-24 text-center">
        <Wallet className="size-8 text-ink-3" aria-hidden />
        <div className="space-y-2">
          <h1 className="display-m text-ink">{t('chat.inbox.title')}</h1>
          <p className="text-[0.9375rem] leading-relaxed text-ink-2">{t('chat.inbox.connect')}</p>
        </div>
        <button type="button" onClick={connect} className="btn-monad inline-flex px-6 py-3 text-[0.9375rem] font-semibold">
          {t('nav.connect')}
        </button>
      </div>
    );
  }

  // Los encargos tardan en llegar (indexador + lecturas del escrow). Decir
  // "no has hablado con nadie" mientras se leen sería mentir durante un
  // segundo justo a quien acaba de contratar.
  const cargando = cargandoTareas || cargandoAgentes;

  return (
    <div className="container-hive max-w-2xl py-8">
      <h1 className="display-m mb-6 text-ink">{t('chat.inbox.title')}</h1>

      {conversaciones.length === 0 ? (
        cargando ? (
          <div className="flex justify-center py-20">
            <Loader2 className="size-6 animate-spin text-ink-3" aria-hidden />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-line bg-cream px-6 py-14 text-center">
            <MessageCircle className="size-7 text-ink-3" aria-hidden />
            <p className="max-w-sm text-[0.9375rem] leading-relaxed text-ink-2">{t('chat.inbox.empty')}</p>
            <Link
              to="/mercado"
              className="rounded-full border border-line px-5 py-2.5 text-[0.875rem] font-medium text-ink-2 transition-colors hover:border-honey hover:text-ink"
            >
              {t('chat.inbox.browse')}
            </Link>
          </div>
        )
      ) : (
        <ul className="flex flex-col gap-1.5">
          {conversaciones.map((c) => (
            <li key={c.agente}>
              <Fila conversacion={c} nombre={c.nombre} ruta={c.ruta} />
            </li>
          ))}
        </ul>
      )}

      <p className="mt-6 px-1 text-[0.6875rem] leading-relaxed text-ink-3">{t('chat.inbox.whereItLives')}</p>
    </div>
  );
}

function Fila({
  conversacion: c,
  nombre,
  ruta,
}: {
  conversacion: ResumenConversacion;
  nombre: string | null;
  ruta: string | null;
}) {
  const { t } = useTranslation();

  /** El adelanto: la última línea, venga del chat o del escrow. */
  const adelanto =
    c.adelanto.clase === 'mensaje'
      ? `${c.adelanto.mensaje.de === 'yo' ? `${t('chat.inbox.you')}: ` : ''}${c.adelanto.mensaje.texto}`
      : `${t('chat.order.title', { id: c.adelanto.encargo.id })} · ${
          c.adelanto.encargo.brief ??
          `${formatUnits(BigInt(c.adelanto.encargo.importe), 18)} ${c.adelanto.encargo.simbolo}`
        }`;

  const fila = (
    <div className="flex items-start gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-cream">
      <HexAvatar seed={c.agente} size={42} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="truncate text-[0.9375rem] font-semibold text-ink">
            {nombre ?? `${c.agente.slice(0, 6)}…${c.agente.slice(-4)}`}
          </p>
          <span className="shrink-0 font-mono text-[0.6875rem] text-ink-3">
            {haceCuanto(c.cuando, t)}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-[0.8125rem] leading-relaxed text-ink-2">{adelanto}</p>
          {/* Un encargo sin cerrar espera algo de ti: aprobarlo, o su plazo. */}
          {c.abiertos > 0 && (
            <span className="shrink-0 rounded-full bg-honey/15 px-2 py-0.5 text-[0.6875rem] font-medium text-honey">
              {t('chat.inbox.pending', { n: c.abiertos })}
            </span>
          )}
        </div>
        {!ruta && <p className="mt-1.5 text-[0.6875rem] text-ink-3">{t('chat.inbox.gone')}</p>}
      </div>
    </div>
  );

  return ruta ? (
    <Link to={ruta} className="block">
      {fila}
    </Link>
  ) : (
    // Sin ficha en el mercado no hay a dónde llevar, pero la conversación se
    // sigue viendo: es del cliente, no del agente.
    <div className="cursor-default opacity-70">{fila}</div>
  );
}
