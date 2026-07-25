import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { Hexagon } from 'lucide-react';
import { LIFECYCLE_STEPS } from '@/data/protocol';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

gsap.registerPlugin(ScrollTrigger);

const REDUCED = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const STEP_HEX_POINTS = '45,24 34.5,42.2 13.5,42.2 3,24 13.5,5.8 34.5,5.8';
const TOTAL = LIFECYCLE_STEPS.length;

/**
 * S3 · Ciclo de vida de una tarea — núcleo de la página (protocolo.md S3).
 * Sección pinneada (end "+=250%"): a la izquierda eyebrow + H2 + contador 03/08;
 * a la derecha línea vertical que se rellena de honey con el scroll (scrub 0.5)
 * y 8 pasos que se activan al pasar. El paso 8 dispara un arco de vuelta al
 * paso 2 ("composición" cierra el bucle). prefers-reduced-motion: sin pin,
 * todo visible. En < lg no hay pin: la línea se rellena al recorrer la lista.
 */
export default function LifecyclePin() {
  const { t } = useTranslation();
  const sectionRef = useRef<HTMLElement>(null);
  const rightColRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const lineFillRef = useRef<HTMLDivElement>(null);
  const counterRef = useRef<HTMLSpanElement>(null);
  const arcPathRef = useRef<SVGPathElement>(null);
  const arcHeadRef = useRef<SVGGElement>(null);
  const iconRefs = useRef<Array<HTMLDivElement | null>>([]);
  const overflowRef = useRef(0);
  const arcLenRef = useRef(0);

  const [activeCount, setActiveCount] = useState(() => (REDUCED() ? TOTAL : 1));
  const activeRef = useRef(activeCount);
  const [arcGeom, setArcGeom] = useState<{ d: string; headX: number; headY: number } | null>(null);

  /* Mide el exceso de altura de la pista de pasos respecto al viewport (desktop)
   * y alinea la posición inicial de la pista con la de progreso 0. */
  const measureOverflow = useCallback(() => {
    const track = trackRef.current;
    const col = rightColRef.current;
    if (!track || !col) return;
    overflowRef.current = Math.max(0, track.scrollHeight - col.clientHeight);
    if (window.matchMedia('(min-width: 1024px)').matches && !REDUCED()) {
      track.style.transform = `translateY(calc(-50% + ${(0.5 * overflowRef.current).toFixed(1)}px))`;
    }
  }, []);

  /* Mide las posiciones de los hexágonos de los pasos 2 y 8 para el arco. */
  const measureArc = useCallback(() => {
    const track = trackRef.current;
    const i2 = iconRefs.current[1];
    const i8 = iconRefs.current[7];
    if (!track || !i2 || !i8) return;
    const tr = track.getBoundingClientRect();
    const r2 = i2.getBoundingClientRect();
    const r8 = i8.getBoundingClientRect();
    const x = r2.left - tr.left + r2.width / 2;
    const y2 = r2.top - tr.top + r2.height / 2;
    const y8 = r8.top - tr.top + r8.height / 2;
    const bulge = window.innerWidth < 640 ? 44 : 76;
    setArcGeom({
      d: `M ${x} ${y8} C ${x - bulge} ${y8}, ${x - bulge} ${y2}, ${x} ${y2}`,
      headX: x,
      headY: y2,
    });
  }, []);

  useLayoutEffect(() => {
    measureArc();
    measureOverflow();
    window.addEventListener('resize', measureArc);
    ScrollTrigger.addEventListener('refresh', measureArc);
    return () => {
      window.removeEventListener('resize', measureArc);
      ScrollTrigger.removeEventListener('refresh', measureArc);
    };
  }, [measureArc, measureOverflow]);

  /* Longitud del arco una vez montado el path */
  useEffect(() => {
    const p = arcPathRef.current;
    if (!p || !arcGeom) return;
    const len = p.getTotalLength();
    arcLenRef.current = len;
    p.style.strokeDasharray = `${len}`;
    p.style.strokeDashoffset = REDUCED() ? '0' : `${len}`;
  }, [arcGeom]);

  /* Pin + relleno de miel + activación de pasos */
  useGSAP(
    () => {
      if (REDUCED()) {
        if (lineFillRef.current) lineFillRef.current.style.transform = 'scaleY(1)';
        return;
      }

      const applyProgress = (p: number, moveTrack: boolean) => {
        if (lineFillRef.current) {
          lineFillRef.current.style.transform = `scaleY(${p})`;
        }
        if (moveTrack && trackRef.current) {
          const y = (0.5 - p) * overflowRef.current;
          trackRef.current.style.transform = `translateY(calc(-50% + ${y.toFixed(1)}px))`;
        }
        const count = Math.max(1, Math.min(TOTAL, Math.floor(p * TOTAL) + 1));
        if (count !== activeRef.current) {
          activeRef.current = count;
          setActiveCount(count);
        }
      };

      const mm = gsap.matchMedia();

      mm.add('(min-width: 1024px)', () => {
        const st = ScrollTrigger.create({
          trigger: sectionRef.current,
          start: 'top top',
          end: '+=250%',
          pin: true,
          scrub: 0.5,
          anticipatePin: 1,
          onRefresh: measureOverflow,
          onUpdate: (self) => applyProgress(self.progress, true),
        });
        return () => {
          st.kill();
          if (trackRef.current) trackRef.current.style.transform = '';
          if (lineFillRef.current) lineFillRef.current.style.transform = '';
        };
      });

      mm.add('(max-width: 1023px)', () => {
        const st = ScrollTrigger.create({
          trigger: trackRef.current,
          start: 'top 80%',
          end: 'bottom 55%',
          scrub: 0.5,
          onUpdate: (self) => applyProgress(self.progress, false),
        });
        return () => {
          st.kill();
          if (lineFillRef.current) lineFillRef.current.style.transform = '';
        };
      });

      return () => mm.revert();
    },
    { scope: sectionRef },
  );

  /* Crossfade numérico del contador 03/08 */
  const firstCount = useRef(true);
  useEffect(() => {
    if (firstCount.current) {
      firstCount.current = false;
      return;
    }
    if (REDUCED() || !counterRef.current) return;
    gsap.fromTo(
      counterRef.current,
      { opacity: 0, y: 10 },
      { opacity: 1, y: 0, duration: 0.35, ease: 'power2.out' },
    );
  }, [activeCount]);

  /* El paso 8 dispara el arco hacia el paso 2 */
  useEffect(() => {
    const p = arcPathRef.current;
    const head = arcHeadRef.current;
    if (!p || !arcLenRef.current || REDUCED()) return;
    const closed = activeCount >= TOTAL;
    gsap.to(p, {
      strokeDashoffset: closed ? 0 : arcLenRef.current,
      duration: closed ? 0.9 : 0.4,
      ease: closed ? 'power2.inOut' : 'power2.out',
      overwrite: 'auto',
    });
    if (head) {
      gsap.to(head, { opacity: closed ? 1 : 0, duration: 0.3, delay: closed ? 0.55 : 0, overwrite: 'auto' });
    }
  }, [activeCount, arcGeom]);

  return (
    <section ref={sectionRef} className="relative overflow-hidden border-t border-line bg-paper">
      <div className="container-hive grid gap-12 py-20 md:py-24 lg:h-[100dvh] lg:grid-cols-12 lg:gap-6 lg:py-0">
        {/* Columna fija: eyebrow + H2 + contador */}
        <div className="lg:col-span-5 lg:flex lg:flex-col lg:justify-center">
          <p className="eyebrow flex items-center gap-2 text-ink-3">
            <Hexagon size={12} className="fill-honey text-honey" aria-hidden />
            {t('protocolPage.lifecycle.eyebrow')}
          </p>
          <h2 className="display-l mt-4 max-w-md text-balance text-ink">
            {t('protocolPage.lifecycle.title')} <em className="serif-accent text-honey-deep">{t('protocolPage.lifecycle.titleEm')}</em> {t('protocolPage.lifecycle.title2')}
          </h2>
          <p className="mt-10 flex items-baseline gap-1" aria-live="polite">
            <span ref={counterRef} className="stat-number inline-block text-honey-deep">
              {String(activeCount).padStart(2, '0')}
            </span>
            <span className="stat-number text-ink-3/60">/{String(TOTAL).padStart(2, '0')}</span>
          </p>
          <p className="mt-4 max-w-sm text-[0.875rem] leading-[1.6] text-ink-3">
            {t('protocolPage.lifecycle.sub')}
          </p>
        </div>

        {/* Pista de pasos con línea de miel */}
        <div ref={rightColRef} className="relative lg:col-span-7 lg:h-full">
          <div ref={trackRef} className="relative lg:absolute lg:inset-x-0 lg:top-1/2 lg:-translate-y-1/2">
            {/* Línea hairline + relleno honey */}
            <div className="absolute bottom-0 left-[23px] top-0 w-[2px] bg-line" aria-hidden />
            <div
              ref={lineFillRef}
              className="absolute bottom-0 left-[23px] top-0 w-[2px] origin-top bg-honey"
              style={{ transform: 'scaleY(0)' }}
              aria-hidden
            />

            <ol className="relative flex flex-col gap-7">
              {LIFECYCLE_STEPS.map((step, i) => {
                const active = i < activeCount;
                return (
                  <li key={step.n} className="flex items-start gap-5">
                    <div
                      ref={(el) => {
                        iconRefs.current[i] = el;
                      }}
                      className="relative h-12 w-12 shrink-0"
                    >
                      <svg viewBox="0 0 48 48" className="h-12 w-12" aria-hidden>
                        <polygon
                          points={STEP_HEX_POINTS}
                          strokeWidth={1.5}
                          strokeLinejoin="round"
                          className={cn(
                            'transition-all duration-[350ms]',
                            active ? 'fill-honey-soft stroke-honey' : 'fill-paper stroke-line',
                          )}
                        />
                      </svg>
                      <step.icon
                        size={18}
                        aria-hidden
                        className={cn(
                          'absolute inset-0 m-auto transition-colors duration-[350ms]',
                          active ? 'text-honey-deep' : 'text-ink-3',
                        )}
                      />
                    </div>
                    <div className="pt-0.5">
                      <p
                        className={cn(
                          'font-display text-[1.05rem] font-semibold leading-[1.3] transition-colors duration-[350ms]',
                          active ? 'text-ink' : 'text-ink-3',
                        )}
                      >
                        <span className="mr-2 font-mono text-[12px] font-medium text-ink-3">
                          {String(step.n).padStart(2, '0')}
                        </span>
                        {t(step.title)}
                      </p>
                      <p
                        className={cn(
                          'mt-1 max-w-md text-[0.875rem] leading-[1.55] text-ink-2 transition-opacity duration-[350ms]',
                          active ? 'opacity-100' : 'opacity-40',
                        )}
                      >
                        {t(step.text)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>

            {/* Arco de composición: paso 8 → paso 2 */}
            <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
              {arcGeom && (
                <>
                  <path
                    ref={arcPathRef}
                    d={arcGeom.d}
                    fill="none"
                    stroke="#E29A2E"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                  />
                  <g
                    ref={arcHeadRef}
                    opacity={REDUCED() ? 1 : 0}
                    transform={`translate(${arcGeom.headX} ${arcGeom.headY})`}
                  >
                    <polygon points="0,0 -10,-5 -10,5" fill="#E29A2E" />
                  </g>
                </>
              )}
            </svg>
          </div>
        </div>
      </div>
    </section>
  );
}
