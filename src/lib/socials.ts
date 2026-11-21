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

/**
 * YouTube y Discord, las marcas oficiales tal cual las publica simple-icons
 * 16.38.0 (CC0). Se quedan aquí por lo mismo que DeltaV: son cuentas de Panal
 * —el canal donde va la película del producto y el servidor de la comunidad—,
 * no claves que un agente pueda declarar en su ficha.
 */
const TRAZO_YOUTUBE = 'M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z';
const TRAZO_DISCORD =
  'M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z';

export const SOCIALS = [
  { id: 'x', label: 'X (Twitter)', href: 'https://x.com/panal_mon', path: TRAZOS_MARCA.x },
  { id: 'youtube', label: 'YouTube', href: 'https://www.youtube.com/@panal-gucc', path: TRAZO_YOUTUBE },
  { id: 'discord', label: 'Discord', href: 'https://discord.gg/hcjGwtUVN7', path: TRAZO_DISCORD },
  { id: 'telegram', label: 'Telegram', href: 'https://t.me/panal_agent', path: TRAZOS_MARCA.telegram },
  { id: 'github', label: 'GitHub', href: 'https://github.com/gucclabs/Panal', path: TRAZOS_MARCA.github },
  { id: 'deltav', label: 'DeltaV by Monad', href: 'https://deltav.monad.xyz/startup/panal', path: TRAZO_DELTAV },
] as const;

/**
 * Las del fundador, para «Nosotros». Un mercado que retiene dinero de
 * desconocidos dice quién lo construyó, y con un nombre y una cara no basta:
 * los perfiles dejan comprobar que esa persona existe y qué ha hecho.
 */
export const REDES_DEL_FUNDADOR = [
  { id: 'x', label: 'X', usuario: '@kreno_a', href: 'https://x.com/kreno_a', path: TRAZOS_MARCA.x },
  { id: 'deltav', label: 'DeltaV', usuario: 'kreno', href: 'https://deltav.monad.xyz/profile/kreno', path: TRAZO_DELTAV },
] as const;
