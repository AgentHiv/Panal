import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight, Download, ShieldCheck, Smartphone } from 'lucide-react';
import {
  APK_FIRMA_SHA256,
  APK_RELEASES_URL,
  APK_URL,
  leerManifiestoApk,
  tamanoLegible,
  type ManifiestoApk,
} from '@/data/descarga';

/**
 * Panal para Android (/app).
 *
 * POR QUÉ ESTA PÁGINA ENSEÑA UN CHECKSUM Y UNA HUELLA
 *
 * Porque esto no se baja de Play Store. Es una app que guarda claves privadas y
 * mueve dinero, y se instala activando «orígenes desconocidos» — el mismo gesto
 * con el que se instala cualquier APK de cualquier sitio. Quien lo hace no
 * tiene a Google comprobando nada por él, así que hay que darle con qué
 * comprobarlo: el SHA-256 del archivo y la huella de la clave que lo firma.
 *
 * Los dos sirven para cosas distintas y hacen falta los dos. El checksum dice
 * que el archivo llegó entero y sin tocar. La huella dice quién lo firmó, y es
 * la que de verdad protege: Android exige que una actualización venga firmada
 * con la MISMA clave que la instalada, así que una copia falsa no puede
 * instalarse encima de la de verdad.
 */

/* ============================================================
 * S1 · Portada y el botón
 * ============================================================ */
function Portada({ manifiesto, cargando }: { manifiesto: ManifiestoApk | null; cargando: boolean }) {
  const { t, i18n } = useTranslation();

  const detalle = manifiesto
    ? `${t('descargar.version', { version: manifiesto.version })} · ${tamanoLegible(manifiesto.bytes, i18n.language)}`
    : cargando
      ? t('descargar.leyendo')
      : t('descargar.sinDatos');

  return (
    <section className="border-b border-line bg-cream pt-32 pb-20 md:pt-40 md:pb-24">
      <div className="container-hive">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
          className="max-w-3xl"
        >
          <p className="eyebrow text-honey-deep">{t('descargar.eyebrow')}</p>
          <h1 className="display-xl mt-4 text-ink">
            {t('descargar.title')}{' '}
            <em className="serif-accent text-honey-deep">{t('descargar.titleEm')}</em>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-[1.6] text-ink-2">{t('descargar.sub')}</p>

          <div className="mt-9 flex flex-wrap items-center gap-x-5 gap-y-3">
            {/* `download` para que el navegador lo guarde en vez de intentar
                abrirlo, y sin `target="_blank"`: en Android abrir una pestaña
                nueva para un archivo deja una en blanco detrás. */}
            <a
              href={APK_URL}
              download
              className="inline-flex items-center gap-2.5 rounded-full bg-honey-deep px-7 py-3.5 font-medium text-cream transition-opacity hover:opacity-90"
            >
              <Download size={18} strokeWidth={2} aria-hidden />
              {t('descargar.boton')}
            </a>
            <span className="text-[0.9375rem] text-ink-3">{detalle}</span>
          </div>

          {/* La única forma honesta de decir «solo Android»: antes de que
              alguien con un iPhone se descargue 4 MB que no le sirven. */}
          <p className="mt-5 flex items-center gap-2 text-[0.9375rem] text-ink-3">
            <Smartphone size={15} strokeWidth={2} aria-hidden />
            {t('descargar.soloAndroid')}
          </p>
        </motion.div>
      </div>
    </section>
  );
}

/* ============================================================
 * S2 · Cómo se instala
 * ============================================================ */
function Instalar() {
  const { t } = useTranslation();
  const pasos = [1, 2, 3] as const;

  return (
    <section className="border-b border-line py-20 md:py-24">
      <div className="container-hive max-w-3xl">
        <h2 className="display-md text-ink">{t('descargar.comoTitulo')}</h2>
        <ol className="mt-8 space-y-6">
          {pasos.map((n) => (
            <li key={n} className="flex gap-4">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line text-[0.8125rem] font-semibold text-honey-deep">
                {n}
              </span>
              <div>
                <p className="font-medium text-ink">{t(`descargar.paso${n}`)}</p>
                <p className="mt-1 leading-[1.65] text-ink-2">{t(`descargar.paso${n}Pie`)}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-8 leading-[1.65] text-ink-2">{t('descargar.noSeActualiza')}</p>
      </div>
    </section>
  );
}

/* ============================================================
 * S3 · Comprobar que es el nuestro
 * ============================================================ */
function Comprobar({ manifiesto }: { manifiesto: ManifiestoApk | null }) {
  const { t } = useTranslation();

  return (
    <section className="border-b border-line bg-cream py-20 md:py-24">
      <div className="container-hive max-w-3xl">
        <h2 className="display-md flex items-center gap-3 text-ink">
          <ShieldCheck size={26} strokeWidth={1.75} className="text-honey-deep" aria-hidden />
          {t('descargar.comprobarTitulo')}
        </h2>
        <p className="mt-5 leading-[1.65] text-ink-2">{t('descargar.comprobarTexto')}</p>

        <dl className="mt-8 space-y-6">
          <div>
            <dt className="text-[0.8125rem] font-semibold uppercase tracking-[0.08em] text-ink-3">
              {t('descargar.checksum')}
            </dt>
            {/* `break-all`: son 64 caracteres sin un espacio donde partir, y sin
                esto desbordan el ancho en un móvil. */}
            <dd className="mt-2 break-all font-mono text-[0.875rem] leading-[1.7] text-ink">
              {manifiesto ? manifiesto.sha256 : t('descargar.sinDatos')}
            </dd>
            <dd className="mt-2 text-[0.9375rem] leading-[1.6] text-ink-2">
              {t('descargar.checksumComo')}
            </dd>
          </div>

          <div>
            <dt className="text-[0.8125rem] font-semibold uppercase tracking-[0.08em] text-ink-3">
              {t('descargar.firma')}
            </dt>
            <dd className="mt-2 break-all font-mono text-[0.875rem] leading-[1.7] text-ink">
              {APK_FIRMA_SHA256}
            </dd>
            <dd className="mt-2 text-[0.9375rem] leading-[1.6] text-ink-2">
              {t('descargar.firmaComo')}
            </dd>
          </div>
        </dl>

        <a
          href={APK_RELEASES_URL}
          target="_blank"
          rel="noreferrer"
          className="mt-9 inline-flex items-center gap-1.5 text-[0.9375rem] font-medium text-honey-deep hover:underline"
        >
          {t('descargar.enGithub')}
          <ArrowUpRight size={16} strokeWidth={2} aria-hidden />
        </a>
        <p className="mt-2 max-w-2xl text-[0.9375rem] leading-[1.6] text-ink-3">
          {t('descargar.enGithubPie')}
        </p>
      </div>
    </section>
  );
}

export default function Descargar() {
  const { t } = useTranslation();
  const [manifiesto, setManifiesto] = useState<ManifiestoApk | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    document.title = t('descargar.metaTitle');
  }, [t]);

  useEffect(() => {
    // `AbortController` para no escribir el estado de un componente que ya no
    // está: en esta página se entra y se sale rápido —se viene a pulsar un
    // botón— y la petición puede llegar después.
    const corta = new AbortController();
    void leerManifiestoApk(corta.signal).then((m) => {
      if (corta.signal.aborted) return;
      setManifiesto(m);
      setCargando(false);
    });
    return () => corta.abort();
  }, []);

  return (
    <>
      <Portada manifiesto={manifiesto} cargando={cargando} />
      <Instalar />
      <Comprobar manifiesto={manifiesto} />
    </>
  );
}
