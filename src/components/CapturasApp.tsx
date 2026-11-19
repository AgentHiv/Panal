import { cn } from '@/lib/utils';

/**
 * El marco de teléfono para las capturas de la app (`lib/capturasApp.ts`).
 */

/** Las capturas miden 540 × 1140. */
const PROPORCION = '540 / 1140';

/**
 * Un teléfono con una captura dentro: marco oscuro, esquinas redondeadas y la
 * sombra justa para que despegue del fondo, claro u oscuro.
 */
export function Telefono({
  src,
  alt,
  className,
  brillo = false,
}: {
  src: string;
  alt: string;
  className?: string;
  /** Un halo de miel detrás, para el teléfono que manda en un grupo. */
  brillo?: boolean;
}) {
  return (
    <div
      className={cn(
        'relative rounded-[2.1rem] border border-white/10 bg-[#0B0A10] p-[0.45rem] shadow-[0_30px_60px_-25px_rgba(0,0,0,0.7),0_12px_24px_-12px_rgba(0,0,0,0.5)]',
        brillo && 'ring-1 ring-honey/30',
        className,
      )}
    >
      {brillo && (
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-10 -z-10 rounded-full bg-honey/20 blur-3xl"
        />
      )}
      <img
        src={src}
        alt={alt}
        width={540}
        height={1140}
        loading="lazy"
        decoding="async"
        className="block w-full rounded-[1.7rem] bg-[#121019]"
        style={{ aspectRatio: PROPORCION }}
      />
    </div>
  );
}
