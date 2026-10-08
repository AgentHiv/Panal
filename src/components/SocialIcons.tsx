import { cn } from '@/lib/utils';
import { SOCIALS } from '@/lib/socials';

/**
 * Los botones de las redes de Panal, para el pie del sitio.
 *
 * La lista de redes, con sus trazos, vive en `@/lib/socials`. Los trazos de
 * X, Telegram y GitHub salen de `@/lib/iconosMarca`, que los comparte con la
 * ficha de cada agente.
 * X: https://x.com/panal_mon · Telegram: https://t.me/panal_agent · GitHub: el repo.
 */

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
