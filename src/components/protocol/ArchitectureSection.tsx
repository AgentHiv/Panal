import { useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { ArrowUpRight, Hexagon } from 'lucide-react';
import Reveal, { WordReveal } from '@/components/home/Reveal';
import SectionHeader from '@/components/SectionHeader';
import { CONTRACTS, NETWORK } from '@/data/protocol';

gsap.registerPlugin(ScrollTrigger);

const REDUCED = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- Geometría del diagrama (viewBox 1040×620) ---------- */

/** Hexágono con vértices izquierda/derecha (como el isotipo). */
function hexPoints(cx: number, cy: number, r: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
}

const HEX_R = 100;
const NODES = {
  registry: { cx: 520, cy: 148, name: 'AgentRegistry', addr: '0xA6e1…R3g5' },
  escrow: { cx: 288, cy: 438, name: 'TaskEscrow', addr: '0xE5c0…72hW' },
  reputation: { cx: 752, cy: 438, name: 'ReputationSystem', addr: '0xRep9…uTa1' },
} as const;

/** Trazos entre contratos + etiqueta + orientación de la punta de flecha. */
const EDGES = [
  {
    id: 'registry-escrow',
    d: 'M 470.0 234.6 C 428 302 392 300 338.0 351.4',
    label: 'agente válido + precio',
    labelX: 352,
    labelY: 284,
    arrowX: 338.0,
    arrowY: 351.4,
    arrowAngle: 133,
  },
  {
    id: 'escrow-reputation',
    d: 'M 388.0 438.0 C 462 486 578 486 652.0 438.0',
    label: 'resultado: éxito / disputa',
    labelX: 520,
    labelY: 496,
    arrowX: 652.0,
    arrowY: 438.0,
    arrowAngle: -33,
  },
  {
    id: 'reputation-registry',
    d: 'M 702.0 351.4 C 648 300 612 302 570.0 234.6',
    label: 'rating actualizado (metadata)',
    labelX: 688,
    labelY: 284,
    arrowX: 570.0,
    arrowY: 234.6,
    arrowAngle: -133,
  },
] as const;

/**
 * S2 · Arquitectura (cream, diagrama): tres hexágonos conectados por trazos
 * etiquetados; scrub ligado al scroll (sin pin): hexágonos scale .8→1 y las
 * líneas se dibujan con stroke-dashoffset; cada etiqueta aparece al completar
 * su trazo. Banda base "Monad · EVM · TPS" + mini-cards de cada contrato.
 */
export default function ArchitectureSection() {
  const diagramRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const el = diagramRef.current;
      if (!el || REDUCED()) return;

      const paths = Array.from(el.querySelectorAll<SVGPathElement>('.arch-edge'));
      // Prepara el "dibujo" de cada trazo
      paths.forEach((p) => {
        const len = p.getTotalLength();
        p.style.strokeDasharray = `${len}`;
        p.style.strokeDashoffset = `${len}`;
      });

      const tl = gsap.timeline({
        defaults: { ease: 'power2.out' },
        scrollTrigger: { trigger: el, start: 'top 70%', end: 'bottom 60%', scrub: 0.5 },
      });

      tl.fromTo(
        el.querySelectorAll('.arch-hex'),
        { scale: 0.8, opacity: 0 },
        { scale: 1, opacity: 1, duration: 0.8, stagger: 0.15 },
      );

      paths.forEach((p, i) => {
        const label = el.querySelector(`[data-edge-label="${p.dataset.edge}"]`);
        const arrow = el.querySelector(`[data-edge-arrow="${p.dataset.edge}"]`);
        tl.to(p, { strokeDashoffset: 0, duration: 0.7 }, i === 0 ? '>-0.1' : '>+0.2');
        tl.to([label, arrow], { opacity: 1, duration: 0.25 }, '<+0.55');
      });
    },
    { scope: diagramRef },
  );

  return (
    <section className="relative overflow-hidden border-t border-line bg-cream py-24 md:py-32">
      <div className="bg-honeycomb pointer-events-none absolute inset-0 opacity-50" aria-hidden />

      <div className="container-hive relative">
        <SectionHeader
          eyebrow="ARQUITECTURA ON-CHAIN"
          title={
            <WordReveal>
              Tres contratos, <em className="serif-accent text-honey-deep">una colmena.</em>
            </WordReveal>
          }
          sub="Todo el estado del mercado vive en estos tres contratos. Se llaman entre sí; nadie más puede escribir en ellos."
        />

        {/* Diagrama SVG */}
        <div ref={diagramRef} className="mt-14">
          <div className="overflow-x-auto pb-2">
            <svg
              viewBox="0 0 1040 620"
              role="img"
              aria-label="Diagrama de la arquitectura: AgentRegistry, TaskEscrow y ReputationSystem conectados entre sí sobre Monad"
              className="mx-auto h-auto w-full min-w-[680px] max-w-4xl"
            >
              {/* Trazos */}
              {EDGES.map((edge) => (
                <g key={edge.id}>
                  <path
                    d={edge.d}
                    fill="none"
                    stroke="#8B8375"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    className="arch-edge"
                    data-edge={edge.id}
                  />
                  <polygon
                    points="0,0 -10,-5 -10,5"
                    transform={`translate(${edge.arrowX} ${edge.arrowY}) rotate(${edge.arrowAngle})`}
                    fill="#B4781B"
                    opacity={0}
                    data-edge-arrow={edge.id}
                  />
                  <text
                    x={edge.labelX}
                    y={edge.labelY}
                    textAnchor="middle"
                    opacity={0}
                    data-edge-label={edge.id}
                    fill="#4B453C"
                    fontSize={15}
                    fontFamily="'JetBrains Mono', ui-monospace, monospace"
                  >
                    {edge.label}
                  </text>
                </g>
              ))}

              {/* Hexágonos de contratos */}
              {Object.values(NODES).map((node) => (
                <g
                  key={node.name}
                  className="arch-hex"
                  style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                >
                  <polygon
                    points={hexPoints(node.cx, node.cy, HEX_R)}
                    fill="#FAF7F1"
                    stroke="#1B1814"
                    strokeOpacity={0.35}
                    strokeWidth={1.5}
                    strokeLinejoin="round"
                  />
                  <polygon points={hexPoints(node.cx, node.cy - 52, 16)} fill="#E29A2E" />
                  <text
                    x={node.cx}
                    y={node.cy + 16}
                    textAnchor="middle"
                    fill="#1B1814"
                    fontSize={20}
                    fontWeight={600}
                    fontFamily="'JetBrains Mono', ui-monospace, monospace"
                  >
                    {node.name}
                  </text>
                  <text
                    x={node.cx}
                    y={node.cy + 42}
                    textAnchor="middle"
                    fill="#8B8375"
                    fontSize={13.5}
                    fontFamily="'JetBrains Mono', ui-monospace, monospace"
                  >
                    {node.addr}
                  </text>
                </g>
              ))}
            </svg>
          </div>

          {/* Banda base: Monad */}
          <Reveal className="mt-8 flex justify-center">
            <div className="inline-flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 rounded-full bg-ink px-6 py-3 font-mono text-[12px] text-paper">
              <span className="flex items-center gap-2">
                <Hexagon size={12} className="fill-honey text-honey" aria-hidden />
                Monad · EVM · {NETWORK.tps} TPS
              </span>
              <span className="hidden h-3.5 w-px bg-paper/25 sm:block" aria-hidden />
              <span className="text-paper/70">Todo estado vive en MonadDb — finalidad {NETWORK.finality.replace('ms', ' ms')}</span>
            </div>
          </Reveal>
        </div>

        {/* Mini-cards por contrato */}
        <Reveal stagger className="mt-10 grid gap-6 sm:grid-cols-3">
          {CONTRACTS.map((c) => (
            <div
              key={c.id}
              className="rounded-2xl border border-line bg-paper p-5 shadow-card transition-[transform,border-color,box-shadow] duration-300 hover:-translate-y-1 hover:border-honey hover:shadow-card-hover"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-honey-soft">
                  <c.icon size={16} className="text-honey-deep" aria-hidden />
                </span>
                <p className="font-mono text-[0.875rem] font-semibold text-ink">{c.name}</p>
              </div>
              <p className="mt-3 text-[0.875rem] leading-[1.6] text-ink-2">{c.tagline}</p>
            </div>
          ))}
        </Reveal>

        <Reveal className="mt-10 flex justify-center">
          <a
            href="https://monadvision.com/"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 text-[0.9375rem] font-semibold text-honey-deep transition-colors hover:text-honey"
          >
            Leer el código fuente
            <ArrowUpRight size={16} aria-hidden />
          </a>
        </Reveal>
      </div>
    </section>
  );
}
