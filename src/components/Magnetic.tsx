/**
 * Panal — Envoltorio "magnetic" para CTAs principales (design.md §4, con gusto).
 * Desplaza el contenido unos píxeles hacia el cursor (máx. ~6 px, solo
 * transform/opacity). Activo únicamente con puntero fino y sin
 * prefers-reduced-motion; en móvil/táctil renderiza los hijos tal cual.
 */

import { useRef } from 'react';
import type { ReactNode } from 'react';
import { motion, useMotionValue, useSpring } from 'framer-motion';
import { cn } from '@/lib/utils';

const ENABLED =
  typeof window !== 'undefined' &&
  window.matchMedia('(pointer: fine)').matches &&
  !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const MAX_OFFSET = 6;

export interface MagneticProps {
  children: ReactNode;
  className?: string;
}

export default function Magnetic({ children, className }: MagneticProps) {
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 220, damping: 16, mass: 0.4 });
  const sy = useSpring(y, { stiffness: 220, damping: 16, mass: 0.4 });

  if (!ENABLED) return <div className={className}>{children}</div>;

  const onPointerMove = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const k = MAX_OFFSET / Math.max(r.width, r.height);
    x.set(dx * k * 2);
    y.set(dy * k * 2);
  };
  const onPointerLeave = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <motion.div
      ref={ref}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      style={{ x: sx, y: sy }}
      className={cn('inline-block will-change-transform', className)}
    >
      {children}
    </motion.div>
  );
}
