import { useRef } from 'react';
import * as AccordionPrimitive from '@radix-ui/react-accordion';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { Plus } from 'lucide-react';
import { WordReveal } from '@/components/home/Reveal';
import SectionHeader from '@/components/SectionHeader';
import { FAQ_ITEMS } from '@/data/protocol';

gsap.registerPlugin(ScrollTrigger);

const REDUCED = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * S7 · FAQ (claro): contenedor estrecho, acordeón Radix con hairlines.
 * Apertura con height animado (.3s) e icono Plus que rota 45°. Items entran
 * con stagger .06.
 */
export default function FaqSection() {
  const listRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const el = listRef.current;
      if (!el || REDUCED()) return;
      gsap.fromTo(
        Array.from(el.children),
        { opacity: 0, y: 20 },
        {
          opacity: 1,
          y: 0,
          duration: 0.6,
          ease: 'power3.out',
          stagger: 0.06,
          scrollTrigger: { trigger: el, start: 'top 82%', once: true },
        },
      );
    },
    { scope: listRef },
  );

  return (
    <section className="border-t border-line bg-paper py-24 md:py-32">
      <div className="mx-auto max-w-3xl px-6">
        <SectionHeader
          align="center"
          eyebrow="FAQ"
          title={
            <WordReveal>
              Preguntas <em className="serif-accent text-honey-deep">frecuentes.</em>
            </WordReveal>
          }
        />

        <AccordionPrimitive.Root
          ref={listRef}
          type="single"
          collapsible
          className="mt-12 border-t border-line"
        >
            {FAQ_ITEMS.map((item, i) => (
              <AccordionPrimitive.Item key={item.q} value={`faq-${i}`} className="border-b border-line">
                <AccordionPrimitive.Header className="flex">
                  <AccordionPrimitive.Trigger className="group flex flex-1 items-center justify-between gap-4 py-5 text-left text-[1rem] font-medium text-ink transition-colors hover:text-honey-deep">
                    <span>{item.q}</span>
                    <Plus
                      size={18}
                      aria-hidden
                      className="shrink-0 text-ink-3 transition-transform duration-300 group-data-[state=open]:rotate-45 group-data-[state=open]:text-honey-deep"
                    />
                  </AccordionPrimitive.Trigger>
                </AccordionPrimitive.Header>
                <AccordionPrimitive.Content className="overflow-hidden data-[state=closed]:animate-[accordion-up_0.3s_ease-out] data-[state=open]:animate-[accordion-down_0.3s_ease-out]">
                  <p className="pb-5 pr-8 text-[0.9375rem] leading-[1.65] text-ink-2">{item.a}</p>
                </AccordionPrimitive.Content>
              </AccordionPrimitive.Item>
            ))}
        </AccordionPrimitive.Root>
      </div>
    </section>
  );
}
