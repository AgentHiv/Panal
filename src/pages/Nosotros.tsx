import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

/**
 * Quién está detrás de Panal.
 *
 * Un mercado que retiene el dinero de desconocidos tiene que decir quién lo
 * construyó: la reputación de los agentes se verifica en la cadena, la del
 * proyecto empieza por tener un nombre y una cara.
 *
 * Sin foto todavía: el hexágono lleva las iniciales. Cuando haya foto, va en
 * `public/` y sustituye a las iniciales aquí mismo.
 */
export default function Nosotros() {
  const { t } = useTranslation();

  useEffect(() => {
    const previo = document.title;
    document.title = t('nosotros.metaTitle');
    return () => {
      document.title = previo;
    };
  }, [t]);

  const parrafos = ['nosotros.bio.p1', 'nosotros.bio.p2', 'nosotros.bio.p3'];

  return (
    <section className="bg-cream pt-32 pb-24 md:pt-40 md:pb-32">
      <div className="container-hive">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
          className="max-w-3xl"
        >
          <p className="eyebrow text-honey-deep">{t('nosotros.eyebrow')}</p>
          <h1 className="display-xl mt-4 text-ink">
            {t('nosotros.title')} <em className="serif-accent text-honey-deep">{t('nosotros.titleEm')}</em>
          </h1>
        </motion.div>

        <motion.article
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.15, ease: 'easeOut' }}
          className="mt-14 grid gap-10 rounded-2xl border border-line bg-paper p-6 md:grid-cols-[200px_1fr] md:gap-12 md:p-10"
        >
          <div className="flex flex-col items-start gap-4">
            <svg viewBox="0 0 64 64" className="h-32 w-32 md:h-40 md:w-40" role="img" aria-label="Gustavo Chura Cruz">
              <polygon
                points="60,32 46,56.25 18,56.25 4,32 18,7.75 46,7.75"
                fill="#E29A2E"
                fillOpacity="0.12"
                stroke="#E29A2E"
                strokeWidth="2.5"
                strokeLinejoin="round"
              />
              <text
                x="32"
                y="33"
                textAnchor="middle"
                dominantBaseline="middle"
                className="font-display"
                fontSize="18"
                fontWeight="700"
                fill="#D9982B"
              >
                GC
              </text>
            </svg>
            <div>
              <h2 className="font-display text-2xl font-bold tracking-[-0.01em] text-ink">Gustavo Chura Cruz</h2>
              <p className="mt-1 text-[0.9375rem] text-ink-2">{t('nosotros.rol')}</p>
            </div>
          </div>

          <div className="flex flex-col gap-5">
            <p className="eyebrow text-ink-3">{t('nosotros.bioTitle')}</p>
            {parrafos.map((k) => (
              <p key={k} className="max-w-2xl text-[1.0625rem] leading-[1.7] text-ink-2">
                {t(k)}
              </p>
            ))}
          </div>
        </motion.article>
      </div>
    </section>
  );
}
