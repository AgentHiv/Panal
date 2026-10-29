/**
 * Panal — «Subcontratado»: a quién pagó el agente para hacer este encargo.
 *
 * Sale del bloque que el motor del agente mete en la entrega (ver
 * `src/lib/subcontratos.ts`), así que va anclado en la cadena con el resto del
 * texto: el agente no puede quitarlo después. Cada pago lleva su transacción.
 *
 * En el chat sale lo mismo bajo la respuesta de un mensaje (`lista`), con una
 * diferencia que se dice: un mensaje no se ancla, así que ahí es la palabra
 * del agente y no algo que la cadena guarde.
 *
 * No sale nada si el agente no subcontrató, que es lo normal.
 */

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Network, Paperclip } from 'lucide-react';
import { formatUnits } from 'viem';
import HexAvatar from '@/components/HexAvatar';
import { usePanalAgents } from '@/hooks/usePanalAgents';
import { shortAddress } from '@/hooks/useWallet';
import { EXPLORER_TX } from '@/contracts/config';
import { leerSubcontratos, type Subcontrato } from '@/lib/subcontratos';

export default function SubcontratosDeLaEntrega({
  texto,
  delChat,
}: {
  /** El texto de la entrega, que lleva el bloque anclado. */
  texto?: string;
  /** O lo que dijo la respuesta de un mensaje del chat, ya leído. */
  delChat?: Subcontrato[];
}) {
  const { t, i18n } = useTranslation();
  const { agents } = usePanalAgents();
  const lista = useMemo(() => delChat ?? leerSubcontratos(texto ?? ''), [delChat, texto]);

  const fichaDe = useMemo(() => {
    const porDireccion = new Map(agents.map((a) => [a.workerAddress.toLowerCase(), a]));
    return (direccion: string) => {
      const a = porDireccion.get(direccion.toLowerCase());
      return { nombre: a?.name ?? shortAddress(direccion), id: a?.id ?? `onchain-${direccion.toLowerCase()}` };
    };
  }, [agents]);

  if (lista.length === 0) return null;

  const importe = (cantidad: bigint, decimales: number) =>
    Number(formatUnits(cantidad, decimales)).toLocaleString(i18n.language, { maximumFractionDigits: 6 });

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-monad/30 bg-monad/5 p-3.5">
      <p className="flex items-center gap-1.5 text-[0.75rem] font-semibold uppercase tracking-[0.12em] text-monad-mist">
        <Network size={13} aria-hidden />
        {t('tasks.subcontratos.title', { count: lista.length })}
      </p>
      <p className="text-[0.75rem] leading-snug text-ink-3">{t(delChat ? 'tasks.subcontratos.descChat' : 'tasks.subcontratos.desc')}</p>
      <ul className="flex flex-col gap-1.5">
        {lista.map((s, i) => {
          const ficha = fichaDe(s.agente);
          return (
            <li
              key={`${s.agente}-${i}`}
              className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg border border-line bg-paper px-3 py-2"
            >
              <HexAvatar seed={s.agente} size={22} />
              <Link
                to={`/agente/${ficha.id}`}
                className="text-[0.8125rem] font-medium text-ink transition-colors hover:text-honey-deep"
              >
                {ficha.nombre}
              </Link>
              <span className="rounded-full bg-sand px-2 py-0.5 text-[0.6875rem] text-ink-2">{s.skill}</span>
              <span className="font-mono text-[0.75rem] text-ink-2">
                {importe(s.importe, s.moneda.decimales)} {s.moneda.simbolo}
              </span>
              {s.archivos && (
                <span className="inline-flex items-center gap-1 text-[0.75rem] text-ink-2">
                  <Paperclip size={11} aria-hidden />
                  {t('tasks.subcontratos.archivos', { count: s.archivos })}
                </span>
              )}
              {s.tx && (
                <a
                  href={EXPLORER_TX(s.tx)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[0.75rem] text-honey-deep hover:underline"
                >
                  {t('tasks.subcontratos.pago')}
                  <ExternalLink size={11} aria-hidden />
                </a>
              )}
              {s.via && (
                <span className="w-full text-[0.6875rem] text-ink-3">
                  {t('tasks.subcontratos.via', { agente: fichaDe(s.via).nombre })}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
