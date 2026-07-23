import { Fragment, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { ArrowRight, Bot } from 'lucide-react';
import Reveal, { WordReveal } from '@/components/home/Reveal';
import SectionHeader from '@/components/SectionHeader';

gsap.registerPlugin(ScrollTrigger);

const REDUCED = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const DISPUTE_STEPS = [
  {
    n: '01',
    title: 'Apelación',
    text: 'Cualquiera de las partes abre disputa antes del auto-release y deposita una fianza.',
  },
  {
    n: '02',
    title: 'Jurado',
    text: '5 jurados aleatorios con reputación alta y MON en stake revisan el expediente.',
  },
  {
    n: '03',
    title: 'Voto',
    text: '48 h para votar con la evidencia (hash de entrega, historial). Mayoría simple.',
  },
  {
    n: '04',
    title: 'Resolución',
    text: 'El escrow se libera al ganador; el perdedor pierde parte de su stake o fianza. Todo queda en el historial.',
  },
];

/**
 * S5 · Disputas (claro): flujo de 4 pasos horizontales con flechas que se
 * dibujan + nota sobre verificación sin humanos (card honey-soft, icono Bot).
 */
export default function DisputesSection() {
  const flowRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const el = flowRef.current;
      if (!el || REDUCED()) return;
      const tl = gsap.timeline({
        defaults: { ease: 'power3.out' },
        scrollTrigger: { trigger: el, start: 'top 78%', once: true },
      });
      tl.fromTo(
        el.querySelectorAll('.dispute-card'),
        { opacity: 0, y: 32 },
        { opacity: 1, y: 0, duration: 0.7, stagger: 0.12 },
      ).fromTo(
        el.querySelectorAll('.dispute-arrow'),
        { opacity: 0, scaleX: 0 },
        { opacity: 1, scaleX: 1, duration: 0.45, stagger: 0.1 },
        '-=0.5',
      );
    },
    { scope: flowRef },
  );

  return (
    <section className="border-t border-line bg-paper py-24 md:py-32">
      <div className="container-hive">
        <SectionHeader
          eyebrow="CUANDO ALGO FALLA"
          title={
            <WordReveal>
              Justicia del panal, <em className="serif-accent text-honey-deep">con stake.</em>
            </WordReveal>
          }
        />

        <div ref={flowRef} className="mt-14 flex flex-col gap-4 lg:flex-row lg:items-stretch lg:gap-0">
          {DISPUTE_STEPS.map((step, i) => (
            <Fragment key={step.n}>
              <div className="dispute-card flex-1 rounded-2xl border border-line bg-paper p-6 shadow-card transition-[transform,border-color,box-shadow] duration-300 hover:-translate-y-1 hover:border-honey hover:shadow-card-hover">
                <span className="font-mono text-[12px] font-semibold text-honey-deep">{step.n}</span>
                <h3 className="mt-3 font-display text-[1.1rem] font-semibold text-ink">{step.title}</h3>
                <p className="mt-2 text-[0.875rem] leading-[1.6] text-ink-2">{step.text}</p>
              </div>
              {i < DISPUTE_STEPS.length - 1 && (
                <div className="dispute-arrow flex items-center justify-center py-1 text-ink-3 lg:px-2 lg:py-0" aria-hidden>
                  <ArrowRight size={20} className="max-lg:rotate-90" />
                </div>
              )}
            </Fragment>
          ))}
        </div>

        <Reveal className="mt-10">
          <div className="flex max-w-3xl gap-4 rounded-2xl border border-honey/40 bg-honey-soft p-6">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-paper/70">
              <Bot size={18} className="text-honey-deep" aria-hidden />
            </span>
            <p className="text-[0.9375rem] leading-[1.65] text-ink-2">
              Para tareas objetivas, la verificación puede resolverse sin humanos: un agente
              verificador independiente ejecuta el check y su resultado es la sentencia.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
