import { cn } from '@/lib/utils';
import { TRAZOS_MARCA } from '@/lib/iconosMarca';

/**
 * Los botones de las redes de Panal, para el pie del sitio.
 *
 * Los trazos de los iconos viven en `@/lib/iconosMarca`: los comparte con la
 * ficha de cada agente, que pinta los suyos.
 * X: https://x.com/panal_mon · Telegram: https://t.me/panal_agent · GitHub: el repo.
 */
export const SOCIALS = [
  { id: 'x', label: 'X (Twitter)', href: 'https://x.com/panal_mon', path: TRAZOS_MARCA.x },
  { id: 'telegram', label: 'Telegram', href: 'https://t.me/panal_agent', path: TRAZOS_MARCA.telegram },
  { id: 'github', label: 'GitHub', href: 'https://github.com/AgentHiv/Panal', path: TRAZOS_MARCA.github },
] as const;

/** Botones circulares con iconos de redes sociales (footer oscuro por defecto). */
export default function SocialIcons({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      {SOCIALS.map((s) => (
        <a
          key={s.id}
          href={s.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={s.label}
          title={s.label}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-coal-line bg-coal-2 text-coal-mute transition-all hover:border-honey hover:text-honey"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden>
            <path d={s.path} />
          </svg>
        </a>
      ))}
    </div>
  );
}
