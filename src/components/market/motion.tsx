import { motion } from 'framer-motion';
import { Fragment, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Micro-utilidades de animación para /mercado y /agente/:id.
 * Solo Framer Motion en estas páginas (aislamiento de librerías, react-dev.md):
 * los reveals se hacen con whileInView + variants, una sola vez.
 */

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

export interface FadeUpProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
  /** duración en segundos */
  duration?: number;
}

/** Reveal por defecto (design.md §4): opacity 0→1, y→0, una sola vez al entrar en viewport. */
export function FadeUp({ children, className, delay = 0, y = 36, duration = 0.9 }: FadeUpProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -12% 0px' }}
      transition={{ duration, delay, ease: EASE }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export interface WordSegment {
  text: string;
  /** palabra serif italic en honey-deep (claro) u honey (oscuro) — design.md §2 */
  accent?: boolean;
}

export interface WordRevealProps {
  segments: WordSegment[];
  className?: string;
  accentClassName?: string;
  /** 'words' para H2 de sección; 'chars' solo para titulares cortos */
  mode?: 'words' | 'chars';
  delay?: number;
}

/** Tipografía cinética (design.md §4): word-level en H2, char-level en titulares cortos. */
export function WordReveal({ segments, className, accentClassName, mode = 'words', delay = 0 }: WordRevealProps) {
  const parts: Array<{ key: string; text: string; accent: boolean }> = [];
  for (const seg of segments) {
    const tokens = mode === 'chars' ? seg.text.split('') : seg.text.split(' ').filter(Boolean);
    for (const t of tokens) {
      parts.push({ key: `${parts.length}-${t}`, text: t, accent: Boolean(seg.accent) });
    }
  }
  return (
    <motion.span
      className={cn('inline-block', className)}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: '0px 0px -10% 0px' }}
      transition={{ staggerChildren: mode === 'chars' ? 0.018 : 0.05, delayChildren: delay }}
      aria-label={segments.map((s) => s.text).join(' ')}
    >
      {parts.map((p, i) => (
        /*
         * El espacio va FUERA del `inline-block`, y no es un detalle de estilo.
         *
         * Una línea solo se puede partir donde hay un espacio ENTRE cajas. Con
         * el espacio metido dentro de cada palabra, el titular entero se
         * convierte en un bloque sin un solo sitio por donde partirlo: en vez
         * de bajar a la línea siguiente, se sale del contenedor. En español no
         * se veía —«Explora el panal.» cabe de sobra— y aparecía en cuanto el
         * idioma alargaba el texto o la ventana se estrechaba.
         *
         * Con el espacio de hermano vuelve a haber por dónde partir, y donde
         * ya cabía se sigue viendo exactamente igual.
         */
        <Fragment key={p.key}>
          <motion.span
            className={cn(
              'inline-block will-change-transform',
              p.accent && (accentClassName ?? 'serif-accent text-honey-deep'),
            )}
            variants={{
              hidden: { opacity: 0, y: mode === 'chars' ? 26 : 18, rotate: mode === 'chars' ? 4 : 0 },
              show: { opacity: 1, y: 0, rotate: 0, transition: { duration: mode === 'chars' ? 0.9 : 0.7, ease: EASE } },
            }}
          >
            {p.text}
          </motion.span>
          {mode === 'words' && i < parts.length - 1 ? ' ' : ''}
        </Fragment>
      ))}
    </motion.span>
  );
}
