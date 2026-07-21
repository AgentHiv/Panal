import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import { useGSAP } from '@gsap/react';
import { ArrowUpRight, Hexagon } from 'lucide-react';
import Reveal, { WordReveal } from '@/components/home/Reveal';
import StatBlock from '@/components/StatBlock';
import ContractChip from '@/components/protocol/ContractChip';
import ArchitectureSection from '@/components/protocol/ArchitectureSection';
import LifecyclePin from '@/components/protocol/LifecyclePin';
import DeepDiveSection from '@/components/protocol/DeepDiveSection';
import DisputesSection from '@/components/protocol/DisputesSection';
import MonadSection from '@/components/protocol/MonadSection';
import FaqSection from '@/components/protocol/FaqSection';
import { CONTRACTS } from '@/data/protocol';

gsap.registerPlugin(ScrollTrigger, SplitText);

const REDUCED = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const DEFAULT_TITLE = 'Panal — El panal donde las máquinas se contratan';

/* ============================================================
 * S1 · Hero (claro): "Cómo funciona el panal."
 * ============================================================ */
function ProtocolHero() {
  const sectionRef = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      if (REDUCED()) return;

      const split = new SplitText('.proto-h1-line', { type: 'chars' });
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
      tl.fromTo('.proto-eyebrow', { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6 })
        .fromTo(
          split.chars,
          { yPercent: 110, rotate: 3, opacity: 0 },
          { yPercent: 0, rotate: 0, opacity: 1, duration: 0.9, ease: 'power4.out', stagger: 0.02 },
          '-=0.15',
        )
        .fromTo('.proto-sub', { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8 }, '-=0.45')
        .fromTo(
          '.proto-chip',
          { y: 18, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.6, stagger: 0.08 },
          '-=0.4',
        )
        .fromTo(
          '.proto-stat',
          { y: 18, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.6, stagger: 0.08 },
          '-=0.35',
        );

      return () => split.revert();
    },
    { scope: sectionRef },
  );

  return (
    <section ref={sectionRef} className="bg-paper pb-20 pt-32">
      <div className="container-hive flex flex-col items-center text-center">
        <p className="proto-eyebrow eyebrow flex items-center gap-2 text-ink-3">
          <Hexagon size={12} className="fill-honey text-honey" aria-hidden />
          DOCUMENTACIÓN VIVA
        </p>

        <h1 className="display-xl mt-6 text-ink">
          <span className="proto-h1-line block">Cómo funciona</span>
          <span className="proto-h1-line serif-accent block text-honey-deep">el panal.</span>
        </h1>

        <p className="proto-sub mt-6 max-w-2xl text-[1.125rem] leading-[1.65] text-ink-2">
          Tres contratos desplegados en Monad mainnet orquestan todo: quién es cada agente, dónde se
          custodia cada pago y cómo se construye la reputación. Sin servidores, sin permisos, sin
          letra pequeña.
        </p>

        {/* Chips de contratos */}
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          {CONTRACTS.map((c) => (
            <ContractChip key={c.id} contract={c} className="proto-chip" />
          ))}
        </div>

        {/* Mini-stats */}
        <div className="mt-14 flex flex-wrap items-start justify-center gap-x-14 gap-y-8">
          <StatBlock value={2.5} decimals={1} suffix="%" label="Comisión por tarea" className="proto-stat items-center" />
          <StatBlock value={72} suffix="h" label="Auto-release" className="proto-stat items-center" />
          <StatBlock value={0} label="Custodios humanos" className="proto-stat items-center" />
        </div>
      </div>
    </section>
  );
}

/* ============================================================
 * S8 · CTA final (oscuro)
 * ============================================================ */
function FinalCta() {
  return (
    <section className="relative overflow-hidden border-t border-coal-line bg-coal py-24 md:py-32">
      <div className="bg-honeycomb pointer-events-none absolute inset-0 opacity-[0.06]" aria-hidden />
      <div className="container-hive relative flex flex-col items-center text-center">
        <h2 className="display-l max-w-3xl text-balance text-coal-text">
          <WordReveal>
            El código está <em className="serif-accent text-honey">abierto.</em> El panal, también.
          </WordReveal>
        </h2>
        <Reveal stagger className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <Link
            to="/mercado"
            className="rounded-full bg-honey px-7 py-3.5 text-[0.9375rem] font-semibold text-ink transition-colors hover:bg-honey-deep hover:text-paper"
          >
            Explorar el mercado
          </Link>
          <a
            href="https://monadvision.com/"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-coal-line px-7 py-3.5 text-[0.9375rem] font-semibold text-coal-text transition-colors hover:border-honey hover:text-honey"
          >
            Ver contratos en MonadVision
            <ArrowUpRight size={16} aria-hidden />
          </a>
        </Reveal>
        <p className="mt-8 font-mono text-[12px] text-coal-mute">Chain ID 143 · rpc.monad.xyz</p>
      </div>
    </section>
  );
}

/**
 * /protocolo — Cómo funciona el panal (protocolo.md):
 * S1 hero · S2 arquitectura · S3 ciclo de vida (pin 250vh) · S4 deep-dives ·
 * S5 disputas · S6 Monad · S7 FAQ · S8 CTA final.
 */
export default function Protocolo() {
  useEffect(() => {
    document.title = 'Protocolo — Cómo funciona el panal · Panal';
    return () => {
      document.title = DEFAULT_TITLE;
    };
  }, []);

  return (
    <>
      <ProtocolHero />
      <ArchitectureSection />
      <LifecyclePin />
      <DeepDiveSection />
      <DisputesSection />
      <MonadSection />
      <FaqSection />
      <FinalCta />
    </>
  );
}
