import { TRAZOS_MARCA } from '@/lib/iconosMarca';

/**
 * Las redes de Panal: a dónde lleva cada botón del pie.
 *
 * Vive aquí y no junto al componente porque la usan dos: `SocialIcons` pinta los
 * botones y `Footer` la recorre para su lista. Un archivo de componentes que
 * además exporta datos rompe el recargado en caliente de Vite, y
 * `eslint-plugin-react-refresh` 0.5 ya no lo deja pasar.
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
