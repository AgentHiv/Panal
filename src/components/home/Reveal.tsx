import { useRef } from 'react';
import type { ReactNode } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import { useGSAP } from '@gsap/react';
import { cn } from '@/lib/utils';

gsap.registerPlugin(ScrollTrigger, SplitText);

const REDUCED = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface RevealProps {
  children: ReactNode;
  className?: string;
  /** retardo extra en segundos */
  delay?: number;
  y?: number;
  /** anima los hijos directos con stagger 0.08–0.12 */
  stagger?: boolean;
  as?: 'div' | 'section' | 'span';
}

/**
 * Reveal por defecto (design.md §4): opacity 0→1, y 36→0, 0.9s, power3.out,
 * start "top 82%", una sola vez. Con `stagger` anima los hijos directos.
 */
export default function Reveal({ children, className, delay = 0, y = 36, stagger = false, as = 'div' }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el || REDUCED()) return;
      const targets = stagger ? Array.from(el.children) : el;
      gsap.fromTo(
        targets,
        { opacity: 0, y },
        {
          opacity: 1,
          y: 0,
          duration: 0.9,
          ease: 'power3.out',
          delay,
          stagger: stagger ? 0.1 : 0,
          scrollTrigger: { trigger: el, start: 'top 82%', once: true },
        },
      );
    },
    { scope: ref },
  );

  const Tag = as as 'div';
  return (
    <Tag ref={ref} className={cn(className)}>
      {children}
    </Tag>
  );
}

export interface WordRevealProps {
  children: ReactNode;
  className?: string;
  /** 'words' para H2 de sección; 'chars' solo para H1 de héroe */
  mode?: 'words' | 'chars';
  delay?: number;
}

/** Tipografía cinética: word-level en H2 (char-level solo en héroes), una sola vez. */
export function WordReveal({ children, className, mode = 'words', delay = 0 }: WordRevealProps) {
  const ref = useRef<HTMLSpanElement>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el || REDUCED()) return;
      const split = new SplitText(el, { type: mode === 'chars' ? 'chars' : 'words' });
      const parts = mode === 'chars' ? split.chars : split.words;
      gsap.fromTo(
        parts,
        { opacity: 0, y: mode === 'chars' ? 26 : 18, rotate: mode === 'chars' ? 4 : 0 },
        {
          opacity: 1,
          y: 0,
          rotate: 0,
          duration: mode === 'chars' ? 0.9 : 0.7,
          ease: 'power4.out',
          stagger: mode === 'chars' ? 0.018 : 0.05,
          delay,
          scrollTrigger: { trigger: el, start: 'top 85%', once: true },
        },
      );
      return () => split.revert();
    },
    { scope: ref },
  );

  return (
    <span ref={ref} className={cn('inline-block', className)}>
      {children}
    </span>
  );
}
