import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Check } from 'lucide-react';
import LiveDot from '@/components/LiveDot';
import TxHash from '@/components/TxHash';
import { CONTRACTS } from '@/data/protocol';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import SocialIcons, { SOCIALS } from '@/components/SocialIcons';
import { Hexagon } from 'lucide-react';
import { EXPLORER_ADDRESS, IS_MAINNET, PANAL_TOKEN_ADDRESS } from '@/contracts/config';
import { APK_RELEASES_URL } from '@/data/protocol';

const COLUMNS: Array<{ title: string; links: Array<{ label: string; to?: string; href?: string }> }> = [
  {
    title: 'footer.product',
    links: [
      { label: 'nav.market', to: '/mercado' },
      { label: 'nav.tablon', to: '/tablon' },
      { label: 'nav.live', to: '/en-vivo' },
      { label: 'nav.dashboard', to: '/dashboard' },
      { label: 'footer.publishAgent', to: '/crear-agente' },
      // Externo: el APK vive en las releases de GitHub, no en este sitio.
      { label: 'footer.downloadApk', href: APK_RELEASES_URL },
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
  const onSubscribe = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    form.reset();
    toast(t('footer.subscribedToast'), { icon: <Check size={14} className="text-olive" /> });
  };

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
              <svg viewBox="0 0 64 64" className="h-11 w-11" aria-hidden>
                <polygon points="60,32 46,56.25 18,56.25 4,32 18,7.75 46,7.75" fill="none" stroke="#E29A2E" strokeWidth="3.5" strokeLinejoin="round" />
                <polygon points="44.5,33.5 39.75,41.72 24.25,41.72 19.5,33.5 24.25,25.28 39.75,25.28" fill="#E29A2E" />
              </svg>
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
          <form onSubmit={onSubscribe} className="flex w-full max-w-md flex-col gap-3">
            <label htmlFor="footer-newsletter" className="text-[0.875rem] font-medium text-coal-mute">
              {t('footer.newsletter')}
            </label>
            <div className="flex gap-2">
              <input
                id="footer-newsletter"
                type="email"
                required
                placeholder="tu@correo.eth"
                className="h-11 w-full rounded-full border border-coal-line bg-coal-2 px-5 text-[0.875rem] text-coal-text placeholder:text-coal-mute/60 focus:border-honey focus:outline-none"
              />
              <button
                type="submit"
                className="h-11 shrink-0 rounded-full bg-honey px-5 text-[0.875rem] font-semibold text-[#1B1814] transition-colors hover:bg-honey-deep"
              >
                {t('footer.subscribe')}
              </button>
            </div>
          </form>
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
            <span className="flex items-center gap-2 text-[0.8125rem] text-coal-mute">
              <LiveDot variant="olive" />
              {t('footer.systemsOk')}
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
