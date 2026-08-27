import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { formatEther } from 'viem';
import type { Nivel } from '@panal/sdk';
import type { Agent } from '@/data/agents';
import { formatMon } from '@/data/agents';
import { currencySymbol } from '@/contracts/config';
import { isOnchainAgent } from '@/hooks/usePanalAgents';
import { useNiveles } from '@/hooks/useNiveles';

export interface ServicesTabProps {
  agent: Agent;
  /** Contratar. Con un nivel, se bloquea SU precio; sin él, el del registro. */
  onHire: (nivel?: Nivel) => void;
}

/** Una tarjeta de la pestaña. Todo lo de aquí sale de la cadena o de la tarjeta. */
interface Tarjeta {
  clave: string;
  nombre: string;
  descripcion: string;
  precio: string;
  simbolo: string;
  /** El pie del tamaño que admite, si el nivel lo dice. */
  tope?: string;
  /** Contratar, o irse al chat. Una de las dos, nunca las dos. */
  contratar?: () => void;
  chat?: string;
}

/**
 * Tab Servicios: lo que este agente vende.
 *
 * ANTES SE INVENTABA. Había tres tarjetas fijas —estándar, prioritaria y un
 * pack de diez— con precios calculados multiplicando el precio base por 1,5 y
 * por 9. Las tres llamaban al mismo botón y contrataban lo mismo al precio
 * base, así que dos de los tres precios que se enseñaban no se cobraban nunca
 * y dos de los tres servicios no existían.
 *
 * La regla ahora es que aquí no se calcula ningún precio. Se enseña lo que el
 * agente declara en su tarjeta y lo que ya está en la cadena, y nada más.
 */
export default function ServicesTab({ agent, onHire }: ServicesTabProps) {
  const { t } = useTranslation();
  const { niveles, cobro } = useNiveles(agent);
  const simbolo = isOnchainAgent(agent) ? currencySymbol(agent.currency) : 'MON';

  const tarjetas: Tarjeta[] =
    niveles.length > 0
      ? // Los vende él: se enseñan tal cual, con su precio y su tamaño.
        niveles.map((n, i) => ({
          clave: `${n.wei}-${i}`,
          nombre: n.name ?? t('detail.services.escrow.name'),
          descripcion: n.description ?? t('detail.services.escrow.desc'),
          precio: formatMon(Number(formatEther(n.wei))),
          simbolo,
          ...(n.maxBriefChars
            ? { tope: t('detail.services.upTo', { n: n.maxBriefChars.toLocaleString() }) }
            : {}),
          contratar: () => onHire(n),
        }))
      : // No los vende: queda lo que sí se le puede comprar hoy.
        [
          {
            clave: 'escrow',
            nombre: t('detail.services.escrow.name'),
            descripcion: t('detail.services.escrow.desc'),
            precio: formatMon(agent.pricePerTask),
            simbolo,
            contratar: () => onHire(),
          },
          // El precio por mensaje sólo si cobra por llamada. Estaba en su
          // tarjeta desde siempre y no se enseñaba en ninguna parte de la
          // ficha: había que entrar al chat para descubrirlo.
          ...(cobro
            ? [
                {
                  clave: 'x402',
                  nombre: t('detail.services.ask.name'),
                  descripcion: t('detail.services.ask.desc'),
                  precio: formatMon(Number(formatEther(cobro.amount))),
                  simbolo: cobro.simbolo,
                  chat: `/chat/${agent.id}`,
                },
              ]
            : []),
        ];

  return (
    <div className="flex flex-col gap-4">
      {tarjetas.map((c, i) => (
        <motion.article
          key={c.clave}
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: i * 0.06, duration: 0.45, ease: 'easeOut' }}
          whileHover={{ y: -2 }}
          className="flex flex-col gap-4 rounded-2xl border border-line bg-paper p-5 transition-[border-color,box-shadow] duration-200 hover:border-honey hover:shadow-card sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0">
            <h3 className="font-display text-[1.05rem] font-semibold tracking-[-0.01em] text-ink">{c.nombre}</h3>
            <p className="mt-1.5 text-[0.875rem] leading-[1.5] text-ink-2">{c.descripcion}</p>
            {c.tope && <p className="mt-1.5 font-mono text-[0.75rem] text-ink-3">{c.tope}</p>}
          </div>
          <div className="flex shrink-0 items-center justify-between gap-4 sm:flex-col sm:items-end sm:justify-center">
            <span className="font-mono text-[0.9375rem] font-semibold text-ink">
              {c.precio} {c.simbolo}
            </span>
            {c.chat ? (
              <Link
                to={c.chat}
                className="rounded-full border border-line px-4 py-2 text-[0.8125rem] font-medium text-ink-2 transition-colors duration-200 hover:border-honey hover:bg-honey hover:text-ink"
              >
                {t('detail.services.openChat')}
              </Link>
            ) : (
              <button
                type="button"
                onClick={c.contratar}
                className="rounded-full border border-line px-4 py-2 text-[0.8125rem] font-medium text-ink-2 transition-colors duration-200 hover:border-honey hover:bg-honey hover:text-ink"
              >
                {t('detail.hireService')}
              </button>
            )}
          </div>
        </motion.article>
      ))}
      <p className="mt-2 text-[0.8125rem] text-ink-3">{t('detail.servicesNote')}</p>
    </div>
  );
}
