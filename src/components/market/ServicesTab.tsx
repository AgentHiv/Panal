import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { formatEther } from 'viem';
import type { Nivel } from '@panal/sdk';
import type { Agent } from '@/data/agents';
import { formatMon } from '@/data/agents';
import { currencySymbol } from '@/contracts/config';
import { canalDe, isOnchainAgent } from '@/hooks/usePanalAgents';
import { useNiveles } from '@/hooks/useNiveles';
import { Skeleton } from '@/components/ui/skeleton';

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
  /** El precio es el bueno, el texto aún no ha llegado. Ver `textoPendiente`. */
  pendiente?: boolean;
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
  const { niveles, cobro, cargando, textoPendiente } = useNiveles(agent);
  const simbolo = isOnchainAgent(agent) ? currencySymbol(agent.currency) : 'MON';
  /**
   * Sin `bot:<url>` no hay a quién mandarle el encargo ni de dónde bajarse la
   * entrega. Los precios se siguen enseñando —son verdad, están en la cadena—
   * pero no se puede pulsar ninguno.
   */
  const sinCanal = canalDe(agent) === 'ninguno';

  /**
   * Mientras no se sabe nada, un hueco. NO el encargo suelto.
   *
   * Antes de la primera lectura no se sabe si este agente vende un tamaño o
   * tres, y lo que se pintaba entretanto era el encargo suelto: su nombre, su
   * precio del registro y un botón de contratar. Un segundo después eso
   * desaparecía y en su sitio salían tres tarjetas distintas. Eso es lo que
   * parpadeaba.
   *
   * Y no era solo un parpadeo: durante ese segundo había un botón para comprar
   * a un precio que no es ninguno de los que el agente vende. Es el mismo fallo
   * que esta pestaña tenía cuando se inventaba los precios, en pequeño. Un
   * hueco dice «todavía no lo sé», que es la verdad.
   *
   * Dura lo que tarda la CADENA, no la tarjeta: quien tiene niveles escritos
   * los enseña en cuanto se leen, con el texto en hueco. Ver `textoPendiente`.
   */
  if (cargando) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <div
          className="flex flex-col gap-4 rounded-2xl border border-line bg-paper p-5 sm:flex-row sm:items-center sm:justify-between"
          aria-hidden
        >
          <div className="min-w-0 flex-1 space-y-2.5">
            <Skeleton className="h-4 w-40 bg-sand" />
            <Skeleton className="h-3 w-64 max-w-full bg-sand" />
          </div>
          <Skeleton className="h-9 w-28 shrink-0 rounded-full bg-sand" />
        </div>
        <p className="mt-2 text-[0.8125rem] text-ink-3">{t('detail.servicesNote')}</p>
      </div>
    );
  }

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
          pendiente: textoPendiente,
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
          <div className="min-w-0 flex-1">
            {c.pendiente ? (
              // El hueco del texto mientras llega la tarjeta. El precio, que es
              // lo que se bloquea, ya está puesto: no espera a nadie.
              <div className="space-y-2.5 py-1" aria-hidden>
                <Skeleton className="h-4 w-40 bg-sand" />
                <Skeleton className="h-3 w-64 max-w-full bg-sand" />
              </div>
            ) : (
              <>
                <h3 className="font-display text-[1.05rem] font-semibold tracking-[-0.01em] text-ink">{c.nombre}</h3>
                <p className="mt-1.5 text-[0.875rem] leading-[1.5] text-ink-2">{c.descripcion}</p>
                {c.tope && <p className="mt-1.5 font-mono text-[0.75rem] text-ink-3">{c.tope}</p>}
              </>
            )}
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
                disabled={sinCanal}
                className="rounded-full border border-line px-4 py-2 text-[0.8125rem] font-medium text-ink-2 transition-colors duration-200 hover:border-honey hover:bg-honey hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line disabled:hover:bg-transparent disabled:hover:text-ink-2"
              >
                {t('detail.hireService')}
              </button>
            )}
          </div>
        </motion.article>
      ))}
      <p className="mt-2 text-[0.8125rem] text-ink-3">
        {sinCanal ? t('detail.sinCanal') : t('detail.servicesNote')}
      </p>
    </div>
  );
}
