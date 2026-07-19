import { useEffect, useRef, useState } from 'react';

/**
 * Cursor personalizado (design.md §4): punto honey 8px + anillo 32px con lerp 0.15.
 * Solo lg+ y puntero fino; sobre interactivos el anillo escala a 1.6 y cambia a honey.
 * mix-blend-difference en el anillo para adaptarse a secciones claras y oscuras.
 */
export default function Cursor() {
  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const [enabled] = useState(
    () =>
      window.matchMedia('(pointer: fine)').matches &&
      window.matchMedia('(min-width: 1024px)').matches &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    if (!enabled) return;
    document.documentElement.classList.add('has-custom-cursor');

    let raf = 0;
    const target = { x: -100, y: -100 };
    const ring = { x: -100, y: -100 };
    let hovering = false;

    const onMove = (e: MouseEvent) => {
      target.x = e.clientX;
      target.y = e.clientY;
    };

    const onOver = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      hovering = !!el?.closest('a, button, [role="button"], input, textarea, select, label, [data-cursor]');
    };

    const loop = () => {
      ring.x += (target.x - ring.x) * 0.15;
      ring.y += (target.y - ring.y) * 0.15;
      if (dotRef.current) {
        dotRef.current.style.transform = `translate3d(${target.x - 4}px, ${target.y - 4}px, 0)`;
      }
      if (ringRef.current) {
        const s = hovering ? 1.6 : 1;
        ringRef.current.style.transform = `translate3d(${ring.x - 16}px, ${ring.y - 16}px, 0) scale(${s})`;
        ringRef.current.style.borderColor = hovering ? 'rgba(226,154,46,0.9)' : '';
      }
      raf = requestAnimationFrame(loop);
    };

    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('mouseover', onOver, { passive: true });
    raf = requestAnimationFrame(loop);

    return () => {
      document.documentElement.classList.remove('has-custom-cursor');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseover', onOver);
      cancelAnimationFrame(raf);
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <>
      <div
        ref={dotRef}
        className="pointer-events-none fixed left-0 top-0 z-[100] h-2 w-2 rounded-full bg-honey"
        aria-hidden
      />
      <div
        ref={ringRef}
        className="pointer-events-none fixed left-0 top-0 z-[100] h-8 w-8 rounded-full border border-ink-3/50 mix-blend-difference transition-[border-color] duration-200"
        aria-hidden
      />
    </>
  );
}
