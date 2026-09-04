import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight, CheckCircle2, Hexagon, Store } from 'lucide-react';
import { ESPERA_2027, MESES_RUTA, PASOS_PLAY, ROADMAP_URL } from '@/data/hoja-de-ruta';
import { useIndexStats } from '@/lib/indexer';

/* ============================================================
 * S1 · Portada
 * ============================================================ */
function Portada() {
  const { t } = useTranslation();

  return (
    <section className="border-b border-line bg-cream pt-32 pb-20 md:pt-40 md:pb-24">
      <div className="container-hive">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
          className="max-w-3xl"
        >
          <p className="eyebrow text-honey-deep">{t('hoja.eyebrow')}</p>
          <h1 className="display-xl mt-4 text-ink">
            {t('hoja.title')} <em className="serif-accent text-honey-deep">{t('hoja.titleEm')}</em>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-[1.6] text-ink-2">{t('hoja.sub')}</p>
          <p className="mt-4 max-w-2xl leading-[1.65] text-ink-2">{t('hoja.intro')}</p>

          <a
            href={ROADMAP_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-8 inline-flex items-center gap-1.5 text-[0.9375rem] font-medium text-honey-deep hover:underline"
          >
            {t('hoja.verRepo')}
            <ArrowUpRight size={16} strokeWidth={2} aria-hidden />
          </a>
        </motion.div>
      </div>
    </section>
  );
}

/* ============================================================
 * S2 · Los números de hoy
 *
 * Se leen del indexador al abrir la página en vez de ir escritos aquí. Una
 * hoja de ruta que arranca de una cifra a mano envejece el día que alguien
 * contrata a alguien, y esta empieza justamente diciendo que el mercado está
 * vacío: si eso deja de ser verdad, tiene que verse solo.
 * ============================================================ */
function Hoy() {
  const { t } = useTranslation();
  const { stats, loading } = useIndexStats();

  const diasACero = stats ? stats.daily30.filter((d) => d.events === 0).length : null;

  const cifras: Array<{ valor: number | null; etiqueta: string }> = [
    { valor: stats?.totals.agents ?? null, etiqueta: 'hoja.hoy.agentes' },
    { valor: stats?.totals.tasks ?? null, etiqueta: 'hoja.hoy.encargos' },
    { valor: stats?.totals.completed ?? null, etiqueta: 'hoja.hoy.completados' },
    { valor: diasACero, etiqueta: 'hoja.hoy.diasACero' },
  ];

  return (
    <section className="border-b border-line bg-paper py-20 md:py-24">
      <div className="container-hive">
        <p className="eyebrow text-honey-deep">{t('hoja.hoy.eyebrow')}</p>
        <h2 className="display-l mt-4 max-w-2xl text-ink">{t('hoja.hoy.title')}</h2>

        <dl className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {cifras.map((c) => (
            <div key={c.etiqueta} className="flex flex-col gap-1 bg-cream p-6">
              <dd className="font-mono text-3xl font-medium tabular-nums tracking-tight text-ink">
                {c.valor === null ? (loading ? '·' : '—') : c.valor}
              </dd>
              <dt className="text-[0.875rem] text-ink-3">{t(c.etiqueta)}</dt>
            </div>
          ))}
        </dl>

        <p className="mt-5 max-w-2xl text-[0.875rem] leading-[1.6] text-ink-3">
          {stats === null && !loading ? t('hoja.hoy.sinDatos') : t('hoja.hoy.fuente')}
        </p>
      </div>
    </section>
  );
}

/* ============================================================
 * S3 · El diagnóstico
 *
 * Va antes que el plan y no después: los cuatro meses solo se entienden si
 * primero se acepta de qué son la respuesta.
 * ============================================================ */
function Diagnostico() {
  const { t } = useTranslation();

  return (
    <section className="border-b border-line bg-cream py-20 md:py-24">
      <div className="container-hive">
        <div className="max-w-3xl border-l-2 border-terra pl-6 md:pl-8">
          <h2 className="display-m text-ink">{t('hoja.diagnostico.title')}</h2>
          <p className="mt-6 max-w-2xl leading-[1.65] text-ink-2">{t('hoja.diagnostico.p1')}</p>
          <p className="mt-4 max-w-2xl leading-[1.65] text-ink-2">{t('hoja.diagnostico.p2')}</p>
        </div>
      </div>
    </section>
  );
}

/* ============================================================
 * S4 · Los cuatro meses
 * ============================================================ */
function Meses() {
  const { t } = useTranslation();

  return (
    <section className="border-t border-coal-line bg-coal py-24 text-coal-text md:py-28">
      <div className="container-hive">
        <p className="eyebrow text-honey">{t('hoja.meses.eyebrow')}</p>
        <h2 className="display-l mt-4 max-w-2xl text-coal-text">{t('hoja.meses.title')}</h2>

        {/* La regla que hace presentable el 1 de enero. Va aquí arriba porque
            se aplica a los cuatro meses, no a uno. */}
        <div className="mt-10 max-w-2xl rounded-xl border border-honey/30 bg-honey/[0.06] p-6">
          <p className="font-semibold text-coal-text">{t('hoja.regla.title')}</p>
          <p className="mt-2 leading-[1.6] text-coal-text/75">{t('hoja.regla.text')}</p>
        </div>

        <ol className="mt-16 flex flex-col gap-16">
          {MESES_RUTA.map((m) => (
            <motion.li
              key={m.clave}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-10%' }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
              className="grid gap-6 md:grid-cols-[10rem_1fr] md:gap-10"
            >
              <div className="min-w-0">
                <h3 className="flex items-center gap-2.5 text-xl font-semibold text-coal-text">
                  <Hexagon size={12} className="shrink-0 fill-honey text-honey" aria-hidden />
                  {t(m.nombre)}
                </h3>
                <p className="mt-1 pl-[22px] font-mono text-[0.8125rem] text-coal-mute">{t(m.tema)}</p>
              </div>

              <div className="min-w-0">
                <p className="serif-accent max-w-xl text-[1.375rem] leading-[1.4] text-coal-text">{t(m.tesis)}</p>

                <div className="mt-8 grid gap-x-10 gap-y-7 sm:grid-cols-2">
                  {m.puntos.map((p) => (
                    <div key={p.titulo} className="min-w-0">
                      <p className="font-semibold text-coal-text">{t(p.titulo)}</p>
                      <p className="mt-1.5 leading-[1.6] text-coal-text/70">{t(p.texto)}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-8 flex max-w-2xl items-start gap-3 rounded-xl border border-coal-line bg-coal-2 p-5">
                  <CheckCircle2 size={17} className="mt-[3px] shrink-0 text-olive" strokeWidth={1.9} aria-hidden />
                  <p className="leading-[1.6] text-coal-text/85">
                    <span className="font-semibold text-coal-text">{t('hoja.meses.check')} </span>
                    {t(m.check)}
                  </p>
                </div>
              </div>
            </motion.li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ============================================================
 * S5 · Google Play, en paralelo
 * ============================================================ */
function Play() {
  const { t } = useTranslation();

  return (
    <section className="border-t border-line bg-cream py-24 md:py-28">
      <div className="container-hive">
        <div className="rounded-2xl border border-dashed border-line p-7 md:p-9">
          <h2 className="flex items-center gap-2.5 text-xl font-semibold text-ink">
            <Store size={19} className="shrink-0 text-honey-deep" strokeWidth={1.9} aria-hidden />
            {t('hoja.play.title')}
          </h2>
          <p className="mt-3 max-w-2xl leading-[1.65] text-ink-2">{t('hoja.play.text')}</p>

          <ol className="mt-8 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
            {PASOS_PLAY.map((p) => (
              <li key={p.titulo} className="min-w-0">
                <p className="font-semibold text-ink">{t(p.titulo)}</p>
                <p className="mt-1 font-mono text-[0.8125rem] text-terra">{t(p.cuando)}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

/* ============================================================
 * S6 · El 1 de enero, y lo que se queda para 2027
 * ============================================================ */
function Enero() {
  const { t } = useTranslation();

  return (
    <section className="border-t border-line bg-paper py-24 md:py-28">
      <div className="container-hive">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="rounded-2xl border border-honey/50 bg-honey/[0.07] p-8 md:p-10"
        >
          <p className="eyebrow text-honey-deep">{t('hoja.enero.eyebrow')}</p>
          <h2 className="display-l mt-4 max-w-2xl text-ink">{t('hoja.enero.title')}</h2>
          <p className="mt-5 max-w-2xl leading-[1.65] text-ink-2">{t('hoja.enero.text')}</p>
        </motion.div>

        <div className="mt-16 grid gap-x-12 gap-y-10 md:grid-cols-2">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-ink">{t('hoja.apuesta.title')}</h3>
            <p className="mt-3 leading-[1.65] text-ink-2">{t('hoja.apuesta.text')}</p>
          </div>

          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-ink">{t('hoja.espera.title')}</h3>
            <ul className="mt-3 flex flex-col gap-3">
              {ESPERA_2027.map((clave) => (
                <li key={clave} className="flex items-start gap-2.5 leading-[1.6] text-ink-2">
                  <Hexagon size={11} className="mt-[7px] shrink-0 text-ink-3" aria-hidden />
                  <span className="min-w-0">{t(clave)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * La hoja de ruta, tal y como está en `ROADMAP.md`.
 *
 * La página no decide el plan: lo enseña. Lo que se discute y se corrige es el
 * archivo del repositorio, y el enlace de la portada lleva ahí a propósito.
 */
export default function HojaDeRuta() {
  const { t } = useTranslation();

  useEffect(() => {
    const previo = document.title;
    document.title = t('hoja.metaTitle');
    return () => {
      document.title = previo;
    };
  }, [t]);

  return (
    <>
      <Portada />
      <Hoy />
      <Diagnostico />
      <Meses />
      <Play />
      <Enero />
    </>
  );
}
