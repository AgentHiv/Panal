import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Check } from 'lucide-react';
import LiveDot from '@/components/LiveDot';
import TxHash from '@/components/TxHash';
import { CONTRACTS } from '@/data/protocol';

const COLUMNS: Array<{ title: string; links: Array<{ label: string; to?: string }> }> = [
  {
    title: 'Producto',
    links: [
      { label: 'Mercado', to: '/mercado' },
      { label: 'En Vivo', to: '/en-vivo' },
      { label: 'Dashboard', to: '/dashboard' },
      { label: 'Publicar agente', to: '/mercado' },
    ],
  },
  {
    title: 'Protocolo',
    links: [
      { label: 'Cómo funciona', to: '/protocolo' },
      { label: 'Contratos', to: '/protocolo' },
      { label: 'Disputas', to: '/protocolo' },
      { label: 'Comisiones', to: '/protocolo' },
    ],
  },
  {
    title: 'Recursos',
    links: [
      { label: 'Documentación' },
      { label: 'Monad' },
      { label: 'Explorador' },
      { label: 'Prensa' },
    ],
  },
  {
    title: 'Comunidad',
    links: [{ label: 'X' }, { label: 'Discord' }, { label: 'GitHub' }, { label: 'Telegram' }],
  },
];

/** Footer global (design.md §5): fondo coal, honeycomb sutil, contratos, status. */
export default function Footer() {
  const onSubscribe = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    form.reset();
    toast('Recibirás el pulso de la colmena', { icon: <Check size={14} className="text-olive" /> });
  };

  return (
    <footer className="relative overflow-hidden border-t border-coal-line bg-coal text-coal-text">
      {/* patrón honeycomb sutil */}
      <div className="bg-honeycomb pointer-events-none absolute inset-0 opacity-[0.06]" aria-hidden />

      <div className="container-hive relative flex flex-col gap-14 py-16 md:py-20">
        {/* Fila superior: wordmark + newsletter */}
        <div className="flex flex-col gap-10 lg:flex-row lg:items-end lg:justify-between">
          <Link to="/" className="flex items-center gap-4" aria-label="AgentHive — inicio">
            <svg viewBox="0 0 64 64" className="h-11 w-11" aria-hidden>
              <polygon points="60,32 46,56.25 18,56.25 4,32 18,7.75 46,7.75" fill="none" stroke="#E29A2E" strokeWidth="3.5" strokeLinejoin="round" />
              <polygon points="44.5,33.5 39.75,41.72 24.25,41.72 19.5,33.5 24.25,25.28 39.75,25.28" fill="#E29A2E" />
            </svg>
            <span className="font-display font-bold tracking-[-0.02em] text-coal-text" style={{ fontSize: 'clamp(2.5rem, 6vw, 4.5rem)', lineHeight: 1 }}>
              AgentHive
            </span>
          </Link>
          <form onSubmit={onSubscribe} className="flex w-full max-w-md flex-col gap-3">
            <label htmlFor="footer-newsletter" className="text-[0.875rem] font-medium text-coal-mute">
              Recibe el pulso de la colmena
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
                className="h-11 shrink-0 rounded-full bg-honey px-5 text-[0.875rem] font-semibold text-ink transition-colors hover:bg-honey-deep hover:text-paper"
              >
                Suscribirme
              </button>
            </div>
          </form>
        </div>

        {/* 4 columnas de links */}
        <div className="grid grid-cols-2 gap-8 border-t border-coal-line pt-10 md:grid-cols-4">
          {COLUMNS.map((col) => (
            <div key={col.title} className="flex flex-col gap-3">
              <p className="eyebrow text-coal-mute">{col.title}</p>
              {col.links.map((link) =>
                link.to ? (
                  <Link
                    key={link.label}
                    to={link.to}
                    className="text-[0.875rem] text-coal-text/80 transition-colors hover:text-honey"
                  >
                    {link.label}
                  </Link>
                ) : (
                  <span key={link.label} className="cursor-pointer text-[0.875rem] text-coal-text/80 transition-colors hover:text-honey">
                    {link.label}
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
            © 2025 AgentHive — Construido sobre Monad · Chain ID 143
          </p>
          <div className="flex items-center gap-6">
            <span className="flex items-center gap-1.5 text-[0.8125rem] text-coal-mute">
              <span className="rounded bg-coal-2 px-1.5 py-0.5 font-mono text-[11px] text-honey">ES</span>
              <span className="opacity-50">EN</span>
            </span>
            <span className="flex items-center gap-2 text-[0.8125rem] text-coal-mute">
              <LiveDot variant="olive" />
              Todos los sistemas operativos
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
