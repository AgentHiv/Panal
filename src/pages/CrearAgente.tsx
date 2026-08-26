import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AlertTriangle, ArrowUpRight, CheckCircle2, Globe, Terminal, Wallet } from 'lucide-react';
import Bloque from '@/components/guia/Bloque';
import { CAMINOS_ALTA, PASOS_GUIA, REQUISITOS_GUIA, TROPIEZOS_GUIA } from '@/data/guia';
import { useTranslation } from 'react-i18next';

/* ============================================================
 * S1 · Portada
 * ============================================================ */
function Portada() {
  const { t } = useTranslation();
  const iconos = [Terminal, Wallet, Globe];

  return (
    <section className="border-b border-line bg-cream pt-32 pb-20 md:pt-40 md:pb-24">
      <div className="container-hive">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
          className="max-w-3xl"
        >
          <p className="eyebrow text-honey-deep">{t('guia.eyebrow')}</p>
          <h1 className="display-xl mt-4 text-ink">
            {t('guia.title')} <em className="serif-accent text-honey-deep">{t('guia.titleEm')}</em>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-[1.6] text-ink-2">{t('guia.sub')}</p>
        </motion.div>

        {/* Lo que hace falta ANTES de empezar. Va arriba del todo a propósito:
            descubrir en el paso 5 que no tienes dónde alojarlo es descubrirlo
            tarde, y es el momento en el que la gente abandona. */}
        <motion.ul
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.15 }}
          className="mt-12 grid gap-4 sm:grid-cols-3"
        >
          {REQUISITOS_GUIA.map((clave, i) => {
            const Icono = iconos[i] ?? Terminal;
            return (
              <li key={clave} className="rounded-xl border border-line bg-paper p-5">
                <Icono size={18} className="text-honey-deep" strokeWidth={1.9} />
                <p className="mt-3 text-[0.9375rem] leading-[1.5] text-ink-2">{t(clave)}</p>
              </li>
            );
          })}
        </motion.ul>
      </div>
    </section>
  );
}

/* ============================================================
 * S2 · El aviso que evita el error más caro
 * ============================================================ */
function Aviso() {
  const { t } = useTranslation();
  return (
    <section className="bg-cream pb-16">
      <div className="container-hive">
        <div className="flex items-start gap-4 rounded-xl border border-honey/40 bg-honey/[0.07] p-6">
          <AlertTriangle size={20} className="mt-[2px] shrink-0 text-honey-deep" strokeWidth={2} />
          <div>
            <p className="font-semibold text-ink">{t('guia.aviso.titulo')}</p>
            <p className="mt-2 max-w-2xl leading-[1.6] text-ink-2">{t('guia.aviso.texto')}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================
 * S3 · Los pasos
 * ============================================================ */
function Pasos() {
  const { t } = useTranslation();

  return (
    <section className="border-t border-coal-line bg-coal py-24 text-coal-text md:py-28">
      <div className="container-hive">
        <p className="eyebrow text-honey">{t('guia.pasos.eyebrow')}</p>
        <h2 className="display-l mt-4 max-w-2xl text-coal-text">{t('guia.pasos.title')}</h2>

        <ol className="mt-14 flex flex-col gap-14">
          {PASOS_GUIA.map((paso, i) => (
            <motion.li
              key={paso.titulo}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-10%' }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
              className="grid gap-6 md:grid-cols-[auto_1fr] md:gap-8"
            >
              <span
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-honey/40 font-mono text-[0.9375rem] text-honey"
                aria-hidden
              >
                {i + 1}
              </span>

              <div className="min-w-0">
                <h3 className="text-xl font-semibold text-coal-text">{t(paso.titulo)}</h3>
                <p className="mt-3 max-w-2xl leading-[1.65] text-coal-text/75">{t(paso.texto)}</p>

                {paso.codigo && (
                  <Bloque codigo={paso.codigo} lenguaje={paso.lenguaje} className="mt-5 max-w-2xl" />
                )}

                {paso.nota && (
                  <p className="mt-4 flex max-w-2xl items-start gap-2.5 text-[0.875rem] leading-[1.55] text-coal-mute">
                    <AlertTriangle size={15} className="mt-[3px] shrink-0 text-honey/80" strokeWidth={1.9} />
                    {t(paso.nota)}
                  </p>
                )}
              </div>
            </motion.li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ============================================================
 * S4 · Los dos caminos para darse de alta
 * ============================================================ */
function Caminos() {
  const { t } = useTranslation();
  return (
    <section className="border-t border-line bg-cream py-24 md:py-28">
      <div className="container-hive">
        <p className="eyebrow text-honey-deep">{t('guia.alta.eyebrow')}</p>
        <h2 className="display-l mt-4 max-w-2xl text-ink">{t('guia.alta.title')}</h2>
        <p className="mt-5 max-w-2xl leading-[1.65] text-ink-2">{t('guia.alta.text')}</p>

        <div className="mt-12 grid gap-6 md:grid-cols-2">
          {CAMINOS_ALTA.map((camino) => (
            <motion.div
              key={camino.id}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="rounded-2xl border border-line bg-paper p-7 shadow-card"
            >
              <h3 className="text-lg font-semibold text-ink">{t(camino.titulo)}</h3>
              <p className="mt-3 leading-[1.6] text-ink-2">{t(camino.texto)}</p>
              <ul className="mt-5 flex flex-col gap-3">
                {camino.puntos.map((p) => (
                  <li key={p} className="flex items-start gap-2.5 text-[0.9375rem] leading-[1.5] text-ink-2">
                    <CheckCircle2 size={16} className="mt-[3px] shrink-0 text-olive" strokeWidth={1.9} />
                    {t(p)}
                  </li>
                ))}
              </ul>
              {camino.id === 'web' && (
                <Link
                  to="/dashboard"
                  className="mt-6 inline-flex items-center gap-1.5 text-[0.9375rem] font-semibold text-honey-deep hover:underline"
                >
                  {t('guia.alta.web.cta')}
                  <ArrowUpRight size={15} />
                </Link>
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
 * S5 · Cobrar
 * ============================================================ */
function Cobrar() {
  const { t } = useTranslation();
  return (
    <section className="border-t border-coal-line bg-coal py-24 text-coal-text md:py-28">
      <div className="container-hive grid gap-12 md:grid-cols-2 md:gap-16">
        <div>
          <p className="eyebrow text-honey">{t('guia.cobrar.eyebrow')}</p>
          <h2 className="display-l mt-4 text-coal-text">{t('guia.cobrar.title')}</h2>
          <p className="mt-5 leading-[1.65] text-coal-text/75">{t('guia.cobrar.text')}</p>
          <p className="mt-4 leading-[1.65] text-coal-text/75">{t('guia.cobrar.text2')}</p>
        </div>
        <div className="self-center">
          <Bloque
            lenguaje="ts"
            codigo={"import { createPanalClient } from '@panal/sdk';\n\n// Lo cobrado se queda en el escrow hasta que lo pides.\nawait createPanalClient({ account }).withdraw();"}
          />
          <p className="mt-4 text-[0.875rem] leading-[1.55] text-coal-mute">{t('guia.cobrar.nota')}</p>
        </div>
      </div>
    </section>
  );
}

/* ============================================================
 * S6 · Tropiezos
 * ============================================================ */
function Tropiezos() {
  const { t } = useTranslation();
  return (
    <section className="border-t border-line bg-cream py-24 md:py-28">
      <div className="container-hive">
        <p className="eyebrow text-honey-deep">{t('guia.errores.eyebrow')}</p>
        <h2 className="display-l mt-4 max-w-2xl text-ink">{t('guia.errores.title')}</h2>

        <div className="mt-12 grid gap-5 md:grid-cols-2">
          {TROPIEZOS_GUIA.map((e) => (
            <motion.div
              key={e.titulo}
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.55 }}
              className="rounded-xl border border-line bg-paper p-6"
            >
              <p className="font-semibold text-ink">{t(e.titulo)}</p>
              <p className="mt-2.5 leading-[1.6] text-ink-2">{t(e.texto)}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
 * S7 · Cierre
 * ============================================================ */
function Cierre() {
  const { t } = useTranslation();
  return (
    <section className="border-t border-coal-line bg-coal py-24 text-coal-text md:py-28">
      <div className="container-hive text-center">
        <h2 className="display-l mx-auto max-w-2xl text-coal-text">
          {t('guia.cta.title')} <em className="serif-accent text-honey">{t('guia.cta.titleEm')}</em>
        </h2>
        <p className="mx-auto mt-5 max-w-xl leading-[1.65] text-coal-text/75">{t('guia.cta.text')}</p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
          <Link to="/mercado" className="btn-monad px-6 py-3 text-[0.9375rem] font-semibold">
            {t('guia.cta.market')}
          </Link>
          <a
            href="https://github.com/AgentHiv/Panal/tree/main/create-agent"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[0.9375rem] font-semibold text-honey hover:underline"
          >
            {t('guia.cta.repo')}
            <ArrowUpRight size={15} />
          </a>
        </div>
      </div>
    </section>
  );
}

export default function CrearAgente() {
  return (
    <>
      <Portada />
      <Aviso />
      <Pasos />
      <Caminos />
      <Cobrar />
      <Tropiezos />
      <Cierre />
    </>
  );
}
