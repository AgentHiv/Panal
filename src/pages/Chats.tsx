/**
 * Panal — la bandeja de conversaciones.
 *
 * Es lo que convierte el chat en algo a lo que se vuelve. Sin ella el
 * historial existe pero sólo se alcanza entrando por la ficha del agente, que
 * es como tener correo y ninguna lista de correos.
 *
 * Los hilos son de QUIEN LOS TUVO: se piden por la dirección conectada, así
 * que cambiar de wallet cambia la bandeja entera. En Panal la wallet es la
 * cuenta, y eso tiene que notarse aquí más que en ninguna otra pantalla.
 */

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MessageCircle, Wallet } from 'lucide-react';
import HexAvatar from '@/components/HexAvatar';
import { listarHilos } from '@/lib/historial';
import { useTopAgents } from '@/hooks/useTopAgents';
import { isOnchainAgent } from '@/hooks/usePanalAgents';
import { useWallet } from '@/hooks/useWallet';

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
  const { address, connected, connect } = useWallet();
  const { top: agentes } = useTopAgents();

  const hilos = useMemo(() => {
    if (!address) return [];
    // El hilo guarda la DIRECCIÓN del agente; el nombre y la ruta salen del
    // catálogo. Un agente que se dio de baja del mercado deja su conversación
    // huérfana, y en ese caso se enseña igual con su dirección: lo que se
    // habló sigue siendo del cliente aunque el agente ya no esté.
    return listarHilos(address).map((h) => {
      const agente = agentes.find(
        (a) => isOnchainAgent(a) && a.workerAddress.toLowerCase() === h.agente.toLowerCase(),
      );
      return { ...h, nombre: agente?.name ?? null, ruta: agente ? `/chat/${agente.id}` : null };
    });
  }, [address, agentes]);

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

  return (
    <div className="container-hive max-w-2xl py-8">
      <h1 className="display-m mb-6 text-ink">{t('chat.inbox.title')}</h1>

      {hilos.length === 0 ? (
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
      ) : (
        <ul className="flex flex-col gap-1.5">
          {hilos.map((h) => {
            const fila = (
              <div className="flex items-start gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-cream">
                <HexAvatar seed={h.agente} size={42} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="truncate text-[0.9375rem] font-semibold text-ink">
                      {h.nombre ?? `${h.agente.slice(0, 6)}…${h.agente.slice(-4)}`}
                    </p>
                    <span className="shrink-0 font-mono text-[0.6875rem] text-ink-3">
                      {haceCuanto(h.ultimo.cuando, t)}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-[0.8125rem] leading-relaxed text-ink-2">
                    {h.ultimo.de === 'yo' ? `${t('chat.inbox.you')}: ` : ''}
                    {h.ultimo.texto}
                  </p>
                  {!h.ruta && (
                    <p className="mt-1.5 text-[0.6875rem] text-ink-3">{t('chat.inbox.gone')}</p>
                  )}
                </div>
              </div>
            );

            return (
              <li key={h.agente}>
                {h.ruta ? (
                  <Link to={h.ruta} className="block">
                    {fila}
                  </Link>
                ) : (
                  // Sin ficha en el mercado no hay a dónde llevar, pero la
                  // conversación se sigue viendo: es del cliente, no del agente.
                  <div className="cursor-default opacity-70">{fila}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-6 px-1 text-[0.6875rem] leading-relaxed text-ink-3">{t('chat.localHistory')}</p>
    </div>
  );
}
