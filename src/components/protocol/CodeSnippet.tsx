import { useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { cn } from '@/lib/utils';

gsap.registerPlugin(ScrollTrigger);

const REDUCED = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Token {
  text: string;
  cls: string;
}

/**
 * Mini-resaltador Solidity con tinte cálido (protocolo.md S4):
 * keywords honey, strings olive, tipos honey-soft, comentarios coal-mute italic.
 */
const TOKEN_RE =
  /(\/\*[\s\S]*?\*\/)|("[^"\n]*")|\b(function|external|internal|public|private|view|pure|payable|calldata|memory|returns|onlyEscrow)\b|\b(string|uint256|uint8|uint|bytes32|address|bool)\b/g;

function tokenize(line: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const m of line.matchAll(TOKEN_RE)) {
    const idx = m.index;
    if (idx > last) tokens.push({ text: line.slice(last, idx), cls: 'text-coal-text/90' });
    const [full, comment, str, keyword, type] = m;
    if (comment) tokens.push({ text: full, cls: 'italic text-coal-mute' });
    else if (str) tokens.push({ text: full, cls: 'text-olive' });
    else if (keyword) tokens.push({ text: full, cls: 'text-honey' });
    else if (type) tokens.push({ text: full, cls: 'text-honey-soft' });
    last = idx + full.length;
  }
  if (last < line.length) tokens.push({ text: line.slice(last), cls: 'text-coal-text/90' });
  return tokens;
}

export interface CodeSnippetProps {
  code: string;
  className?: string;
}

/**
 * Bloque de código mono sobre coal-2 con hairline. Al entrar en viewport:
 * reveal de líneas (stagger) y borde honey izquierdo que se dibuja (scaleY).
 */
export default function CodeSnippet({ code, className }: CodeSnippetProps) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el || REDUCED()) return;
      const tl = gsap.timeline({
        scrollTrigger: { trigger: el, start: 'top 85%', once: true },
      });
      tl.fromTo(
        el.querySelector('.snippet-bar'),
        { scaleY: 0 },
        { scaleY: 1, duration: 0.7, ease: 'power3.out', transformOrigin: 'top center' },
      ).fromTo(
        el.querySelectorAll('.snippet-line'),
        { opacity: 0, y: 10 },
        { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out', stagger: 0.08 },
        '-=0.45',
      );
    },
    { scope: ref },
  );

  const lines = code.split('\n');

  return (
    <div
      ref={ref}
      className={cn('relative overflow-hidden rounded-xl border border-coal-line bg-coal-2', className)}
    >
      <span className="snippet-bar absolute inset-y-0 left-0 w-[2px] bg-honey" aria-hidden />
      <pre className="overflow-x-auto p-5 pl-6 font-mono text-[0.8125rem] leading-[1.75]">
        <code>
          {lines.map((line, i) => (
            <span key={i} className="snippet-line block whitespace-pre">
              {tokenize(line).map((t, j) => (
                <span key={j} className={t.cls}>
                  {t.text}
                </span>
              ))}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
