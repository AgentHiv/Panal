import { cn } from '@/lib/utils';
import { TRAZOS_MARCA } from '@/lib/iconosMarca';

/**
 * Los botones de las redes de Panal, para el pie del sitio.
 *
 * Los trazos de los iconos viven en `@/lib/iconosMarca`: los comparte con la
 * ficha de cada agente, que pinta los suyos.
 * X: https://x.com/panal_mon · Telegram: https://t.me/panal_agent · GitHub: el repo.
 */

/**
 * La delta de DeltaV, el directorio de proyectos de Monad donde está Panal.
 *
 * El trazo se queda aquí y NO en `iconosMarca`: aquel es el vocabulario de
 * marcas que un agente puede declarar en su ficha (`web:`, `x:`, `github:`,
 * `telegram:`), y meter DeltaV ahí sería inventarse un token del protocolo
 * para una cuenta que es solo de Panal.
 *
 * Dibujado a partir de su propia marca —deltav.monad.xyz no publica ningún
 * archivo de logo, solo el favicon de 32 px—, monocromo como los otros tres:
 * en el pie todos heredan el color y se ponen ámbar al pasar por encima.
 */
const TRAZO_DELTAV = 'M12 0 24 24H0Z M12 9.4 5.2 24h3.2l1.7-4.5h6.8Z';

export const SOCIALS = [
  { id: 'x', label: 'X (Twitter)', href: 'https://x.com/panal_mon', path: TRAZOS_MARCA.x },
  { id: 'telegram', label: 'Telegram', href: 'https://t.me/panal_agent', path: TRAZOS_MARCA.telegram },
  { id: 'github', label: 'GitHub', href: 'https://github.com/AgentHiv/Panal', path: TRAZOS_MARCA.github },
  { id: 'deltav', label: 'DeltaV by Monad', href: 'https://deltav.monad.xyz/startup/panal', path: TRAZO_DELTAV },
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
