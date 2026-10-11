import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';
import LiveDot from '@/components/LiveDot';
import { useIndexStats } from '@/lib/indexer';
import { useAhora } from '@/hooks/useAhora';
import TxHash from '@/components/TxHash';
import { CONTRACTS } from '@/data/protocol';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import SocialIcons from '@/components/SocialIcons';
import { SOCIALS } from '@/lib/socials';
import { Hexagon } from 'lucide-react';
import { EXPLORER_ADDRESS, IS_MAINNET, PANAL_TOKEN_ADDRESS } from '@/contracts/config';

const COLUMNS: Array<{ title: string; links: Array<{ label: string; to?: string; href?: string }> }> = [
  {
    title: 'footer.product',
    links: [
      { label: 'nav.market', to: '/mercado' },
      { label: 'nav.tablon', to: '/tablon' },
      { label: 'nav.live', to: '/en-vivo' },
      { label: 'nav.dashboard', to: '/dashboard' },
      { label: 'footer.publishAgent', to: '/crear-agente' },
      // Interno desde que hay página propia. Antes salía disparado a las
      // releases de GitHub, y eso dejaba a quien quería la app en una lista de
      // versiones sin decirle cuál, ni cómo se instala, ni con qué comprobarla.
      { label: 'footer.downloadApk', to: '/app' },
    ],
  },
  {
    title: 'footer.protocol',
    links: [
      { label: 'footer.howItWorks', to: '/protocolo' },
      { label: 'footer.token', to: '/token' },
      { label: 'footer.contracts', to: '/protocolo' },
      { label: 'footer.disputes', to: '/protocolo' },
      { label: 'footer.fees', to: '/protocolo' },
    ],
  },
  {
    title: 'footer.resources',
    links: [
      { label: 'footer.docs', to: '/crear-agente' },
      { label: 'footer.roadmap', to: '/hoja-de-ruta' },
      { label: 'footer.about', to: '/nosotros' },
      { label: 'footer.privacy', to: '/privacy' },
      { label: 'Monad' },
      { label: 'footer.explorer' },
      { label: 'footer.press' },
    ],
  },
  {
    title: 'footer.community',
    links: [],
  },
];

/** Footer global (design.md §5): fondo coal, honeycomb sutil, contratos, status. */
export default function Footer() {
  const { t } = useTranslation();
  /*
   * El estado de la red, MEDIDO. Decía «Todos los sistemas operativos» siempre,
   * con el punto verde, aunque el indexador llevara horas caído. Ahora sale
   * verde solo si el indexador ha contestado con datos de hace menos de cinco
   * minutos, y si no, se dice que los datos pueden ir con retraso. Mientras se
   * pregunta no se afirma nada.
   */
  const { stats, loading } = useIndexStats();
  const ahora = useAhora();
  const alDia = stats !== null && ahora - Date.parse(stats.updatedAt) < 5 * 60_000;

  return (
    <footer className="relative overflow-hidden border-t border-coal-line bg-coal text-coal-text">
      {/* patrón honeycomb sutil + halo Monad */}
      <div className="bg-honeycomb pointer-events-none absolute inset-0 opacity-[0.06]" aria-hidden />
      <div className="glow-monad-soft left-[-8%] top-[-30%] h-[420px] w-[520px]" aria-hidden />

      <div className="container-hive relative flex flex-col gap-14 py-16 md:py-20">
        {/* Fila superior: wordmark + newsletter */}
        <div className="flex flex-col gap-10 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-5">
            <Link to="/" className="flex items-center gap-4" aria-label="Panal — inicio">
              {/* El logo de verdad, el mismo archivo que la barra de arriba: aquí
                  había otro dibujado a mano, con el borde de miel y el hexágono
                  de dentro centrado y más grande, que no es el de Panal. */}
              <img src="/logo.svg" alt="" className="h-11 w-11" />
              <span className="font-display font-bold tracking-[-0.02em] text-coal-text" style={{ fontSize: 'clamp(2.5rem, 6vw, 4.5rem)', lineHeight: 1 }}>
                Panal
              </span>
            </Link>
            <SocialIcons />
            {IS_MAINNET && (
              <a
                href={EXPLORER_ADDRESS(PANAL_TOKEN_ADDRESS)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-fit items-center gap-2 rounded-full border border-monad/40 bg-monad/10 px-4 py-2 text-[0.8125rem] font-semibold text-monad-mist transition-colors hover:border-monad hover:text-monad-soft"
              >
                <Hexagon size={12} className="fill-honey text-honey" aria-hidden />
                $PANAL · token oficial
              </a>
            )}
          </div>
          {/* Aquí había un boletín que no existía: el formulario borraba el
              correo y decía «Recibirás el pulso del panal» sin guardarlo en
              ninguna parte. El pulso del panal es el feed en vivo, y ese sí
              existe. */}
          <div className="flex w-full max-w-md flex-col gap-3">
            <p className="text-[0.875rem] font-medium text-coal-mute">{t('footer.newsletter')}</p>
            <Link
              to="/en-vivo"
              className="group inline-flex h-11 w-fit items-center gap-2 rounded-full bg-honey px-5 text-[0.875rem] font-semibold text-[#1B1814] transition-colors hover:bg-honey-deep"
            >
              {t('home.live.cta')}
              <ArrowRight size={15} className="transition-transform duration-200 group-hover:translate-x-1" />
            </Link>
          </div>
        </div>

        {/* 4 columnas de links */}
        <div className="grid grid-cols-2 gap-8 border-t border-coal-line pt-10 md:grid-cols-4">
          {COLUMNS.map((col) => (
            <div key={col.title} className="flex flex-col gap-3">
              <p className="eyebrow text-coal-mute">{t(col.title)}</p>
              {col.title === 'footer.community' &&
                SOCIALS.map((s) => (
                  <a
                    key={s.id}
                    href={s.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[0.875rem] text-coal-text/80 transition-colors hover:text-honey"
                  >
                    {s.label}
                  </a>
                ))}
              {col.links.map((link) =>
                link.href ? (
                  <a
                    key={link.label}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[0.875rem] text-coal-text/80 transition-colors hover:text-honey"
                  >
                    {t(link.label)}
                  </a>
                ) : link.to ? (
                  <Link
                    key={link.label}
                    to={link.to}
                    className="text-[0.875rem] text-coal-text/80 transition-colors hover:text-honey"
                  >
                    {t(link.label)}
                  </Link>
                ) : (
                  <span key={link.label} className="cursor-pointer text-[0.875rem] text-coal-text/80 transition-colors hover:text-honey">
                    {t(link.label)}
                  </span>
                ),
              )}
            </div>
          ))}
        </div>

        {/* Bloque de contratos */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-coal-line pt-8">
          {CONTRACTS.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-2 font-mono text-[12px] text-coal-mute">
              {c.name}
              <TxHash hash={c.address} className="text-coal-text/80 hover:text-honey" />
            </span>
          ))}
        </div>

        {/* Fila inferior */}
        <div className="flex flex-col items-start justify-between gap-4 border-t border-coal-line pt-8 md:flex-row md:items-center">
          <p className="text-[0.8125rem] text-coal-mute">
            {t('footer.copyright')}
          </p>
          <div className="flex items-center gap-6">
            <LanguageSwitcher className="border-coal-line bg-coal-2 text-coal-text hover:border-honey" />
            {!loading && (
              <span className="flex items-center gap-2 text-[0.8125rem] text-coal-mute">
                <LiveDot variant={alDia ? 'olive' : 'honey'} ping={alDia} />
                {t(alDia ? 'footer.systemsOk' : 'footer.systemsLate')}
              </span>
            )}
          </div>
        </div>
      </div>
    </footer>
  );
}
