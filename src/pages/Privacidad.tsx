import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * La política de privacidad de Panal.
 *
 * La pide Google Play antes de cualquier prueba cerrada, como URL pública, y
 * la pide también el sentido común: un mercado que mueve dinero de
 * desconocidos tiene que decir qué ve y qué guarda.
 *
 * TODO LO QUE DICE ESTÁ COMPROBADO EN EL CÓDIGO (2026-10-06), y si algo de esto
 * cambia, esta página cambia con ello:
 *   - la web no carga analítica ni rastreadores (index.html), y lo que guarda
 *     —encargos, conversaciones, historial, idioma— vive en el `localStorage`
 *     del navegador (src/lib/taskBriefs.ts, conversaciones.ts, historial.ts…);
 *   - la app crea las wallets en el teléfono y las guarda cifradas ahí
 *     (movil/src/lib/llavero.ts); sus avisos son notificaciones LOCALES;
 *   - el buzón guarda en claro encargos y entregas, y los borra a los 30 días
 *     (bot/src/buzon-store.ts, RETENCION_DIAS);
 *   - los agentes de Panal mandan el encargo a un proveedor de IA externo
 *     (DeepSeek) y recuerdan los últimos turnos de una conversación x402
 *     (template/src/memoria.ts);
 *   - Caddy registra los accesos a los agentes y al buzón, y rota el registro
 *     a los 90 días (su `roll_keep_for` por defecto).
 *
 * El formulario de «newsletter» del pie no envía nada a ningún sitio, así que
 * aquí no aparece como dato recogido.
 */

const SECCIONES = ['quien', 'noHacemos', 'cadena', 'dispositivo', 'wallet', 'encargos', 'buzon', 'agentes', 'registros', 'terceros', 'derechos', 'menores', 'cambios'] as const;

/** Dónde se escribe para todo lo de privacidad. */
const CONTACTO_PRIVACIDAD = 'privacy@panal.lat';

export default function Privacidad() {
  const { t } = useTranslation();

  useEffect(() => {
    const previo = document.title;
    document.title = t('privacidad.metaTitle');
    return () => {
      document.title = previo;
    };
  }, [t]);

  return (
    <article className="bg-cream pt-32 pb-24 md:pt-40 md:pb-32">
      <div className="container-hive max-w-3xl">
        <p className="eyebrow text-honey-deep">{t('privacidad.eyebrow')}</p>
        <h1 className="display-l mt-4 text-ink">{t('privacidad.title')}</h1>
        <p className="mt-4 text-[0.9375rem] text-ink-3">{t('privacidad.actualizado')}</p>
        <p className="mt-8 text-lg leading-[1.65] text-ink-2">{t('privacidad.intro')}</p>

        {SECCIONES.map((s) => (
          <section key={s} className="mt-12">
            <h2 className="text-xl font-semibold text-ink">{t(`privacidad.${s}.titulo`)}</h2>
            {t(`privacidad.${s}.texto`, { contacto: CONTACTO_PRIVACIDAD })
              .split('\n\n')
              .map((parrafo, i) => (
                <p key={i} className="mt-4 leading-[1.7] text-ink-2">
                  {parrafo}
                </p>
              ))}
          </section>
        ))}

        <section className="mt-12 rounded-2xl border border-line bg-paper p-6 md:p-8">
          <h2 className="text-xl font-semibold text-ink">{t('privacidad.contacto.titulo')}</h2>
          <p className="mt-4 leading-[1.7] text-ink-2">{t('privacidad.contacto.texto')}</p>
          <a
            href={`mailto:${CONTACTO_PRIVACIDAD}`}
            className="mt-4 inline-block font-mono text-[0.9375rem] font-semibold text-honey-deep hover:underline"
          >
            {CONTACTO_PRIVACIDAD}
          </a>
        </section>
      </div>
    </article>
  );
}
