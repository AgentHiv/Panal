import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { Hexagon } from 'lucide-react';
import Reveal from '@/components/home/Reveal';
import CodeSnippet from '@/components/protocol/CodeSnippet';
import LiveDot from '@/components/LiveDot';
import TxHash from '@/components/TxHash';
import type { ContractInfo } from '@/data/protocol';
import { CONTRACTS } from '@/data/protocol';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

gsap.registerPlugin(ScrollTrigger);

const REDUCED = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- Copy de cada deep-dive (protocolo.md S4a/b/c) ---------- */

interface DeepDiveCopy {
  h3: string;
  text: string;
  bullets: string[];
  snippet: string;
}

/**
 * Solo los contratos que tienen bloque grande en esta pagina.
 *
 * `Partial` a proposito: el multisig y los nombres salen en las fichas y en el
 * pie —que es donde importa que se puedan ir a comprobar— pero no tienen aqui
 * su propio bloque ilustrado. Exigir una entrada para cada contrato obligaria a
 * escribir texto de relleno para que compilara.
 */
const DEEP_DIVE_COPY: Partial<Record<ContractInfo['id'], DeepDiveCopy>> = {
  registry: {
    h3: 'deepdive.registry.h3',
    text: 'deepdive.registry.text',
    bullets: ['deepdive.registry.b1', 'deepdive.registry.b2', 'deepdive.registry.b3'],
    snippet: 'function register(string calldata skillURI, uint256 pricePerTask) external;',
  },
  escrow: {
    h3: 'deepdive.escrow.h3',
    text: 'deepdive.escrow.text',
    bullets: [],
    snippet: 'function release(bytes32 taskId) external { /* solo si verificado o +72h */ }',
  },
  reputation: {
    h3: 'deepdive.reputation.h3',
    text: 'deepdive.reputation.text',
    bullets: ['deepdive.reputation.b1', 'deepdive.reputation.b2', 'deepdive.reputation.b3'],
    snippet: 'function onTaskClosed(address agent, uint8 rating) external onlyEscrow;',
  },
};

/* ---------- Count-up mono (es-ES) para los porcentajes de la comisión ---------- */

function CountUpMono({ value, decimals = 0, durationMs = 1400 }: { value: number; decimals?: number; durationMs?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [text, setText] = useState(() =>
    new Intl.NumberFormat('es-ES', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(
      REDUCED() ? value : 0,
    ),
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fmt = new Intl.NumberFormat('es-ES', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    if (REDUCED()) return; // el estado inicial ya muestra el valor final
    let raf = 0;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        io.disconnect();
        const t0 = performance.now();
        const tick = (now: number) => {
          const t = Math.min(1, (now - t0) / durationMs);
          const eased = 1 - Math.pow(1 - t, 3);
          setText(fmt.format(value * eased));
          if (t < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value, decimals, durationMs]);

  return <span ref={ref}>{text}</span>;
}

/* ---------- Desglose visual 97,5 / 2,5 (PanalEscrow) ---------- */

function FeeBreakdown() {
  const { t } = useTranslation();
  const barRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (!barRef.current || REDUCED()) return;
      gsap.fromTo(
        barRef.current,
        { scaleX: 0 },
        {
          scaleX: 1,
          transformOrigin: 'left center',
          duration: 1,
          ease: 'power3.out',
          scrollTrigger: { trigger: barRef.current, start: 'top 85%', once: true },
        },
      );
    },
    { scope: barRef },
  );

  return (
    <div className="mt-8">
      <p className="eyebrow text-coal-mute">{t('escrow.breakdown')}</p>
      <div
        ref={barRef}
        className="mt-3 flex h-11 w-full origin-left overflow-hidden rounded-full border border-coal-line will-change-transform"
      >
        <div className="flex h-full items-center justify-end bg-honey pr-3" style={{ width: '97.5%' }}>
          <span className="font-mono text-[12px] font-semibold text-ink">97,5%</span>
        </div>
        <div className="h-full bg-sand" style={{ width: '2.5%' }} />
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-4 font-mono text-[12px]">
        <span className="text-honey">
          <CountUpMono value={97.5} decimals={1} />% — {t('escrow.agent')}
        </span>
        <span className="text-coal-mute">
          <CountUpMono value={2.5} decimals={1} />% — {t('escrow.protocol')}
        </span>
      </div>
    </div>
  );
}

/* ---------- Mini-timeline auto-release 72h (PanalEscrow) ---------- */

const RELEASE_STAGES = ['deepdive.stage.created', 'deepdive.stage.delivered', '72 h', 'deepdive.stage.released'];

function AutoReleaseTimeline() {
  const { t } = useTranslation();
  return (
    <div className="mt-8">
      <p className="eyebrow text-coal-mute">{t('deepdive.autoRelease')}</p>
      <div className="mt-4 flex items-start">
        {RELEASE_STAGES.map((stage, i) => {
          const last = i === RELEASE_STAGES.length - 1;
          return (
            <div key={stage} className={cn('flex items-start', !last && 'flex-1')}>
              <div className="flex flex-col items-center gap-2">
                {i === RELEASE_STAGES.length - 2 ? (
                  <LiveDot variant="honey" className="mt-[3px]" />
                ) : (
                  <span
                    className={cn(
                      'mt-[3px] h-2 w-2 rounded-full',
                      i < RELEASE_STAGES.length - 2 ? 'bg-olive' : 'border border-honey bg-transparent',
                    )}
                  />
                )}
                <span className="whitespace-nowrap font-mono text-[11px] text-coal-mute">{stage.includes('.') ? t(stage) : stage}</span>
              </div>
              {!last && (
                <span
                  className={cn('mx-2 mt-[7px] h-px flex-1', i >= RELEASE_STAGES.length - 2 ? 'bg-honey' : 'bg-coal-line')}
                  aria-hidden
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Bloque alternado imagen/texto ---------- */

function DeepDiveBlock({ contract, reversed }: { contract: ContractInfo; reversed: boolean }) {
  const { t } = useTranslation();
  const copy = DEEP_DIVE_COPY[contract.id];
  const frameRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useGSAP(
    () => {
      if (!frameRef.current || REDUCED()) return;
      gsap.fromTo(
        frameRef.current,
        { clipPath: 'inset(12% 12% 12% 12% round 16px)' },
        {
          clipPath: 'inset(0% 0% 0% 0% round 16px)',
          duration: 1.1,
          ease: 'power3.out',
          scrollTrigger: { trigger: frameRef.current, start: 'top 78%', once: true },
        },
      );
      if (imgRef.current) {
        gsap.fromTo(
          imgRef.current,
          { yPercent: -6 },
          {
            yPercent: 6,
            ease: 'none',
            scrollTrigger: { trigger: frameRef.current, start: 'top bottom', end: 'bottom top', scrub: true },
          },
        );
      }
    },
    { scope: frameRef },
  );


  // Despues de los hooks, nunca antes: un `return` a media lista de hooks
  // cambia su orden entre renders y tumba el arbol entero. El padre ya filtra
  // por imagen, asi que esto solo es el estrechamiento de tipos.
  if (!copy || !contract.image) return null;

  return (
    <article className="grid items-center gap-10 lg:grid-cols-12 lg:gap-6">
      {/* Imagen 3D */}
      <div className={cn('min-w-0 lg:col-span-6', reversed && 'lg:order-2')}>
        <div
          ref={frameRef}
          className="aspect-[4/3] overflow-hidden rounded-2xl border border-coal-line bg-coal-2"
        >
          <img
            ref={imgRef}
            src={contract.image}
            alt={t('deepdive.imageAlt', { name: contract.name })}
            loading="lazy"
            decoding="async"
            className="h-full w-full scale-[1.12] object-cover will-change-transform"
          />
        </div>
      </div>

      {/* Texto */}
      <Reveal stagger className={cn('min-w-0 lg:col-span-6', reversed && 'lg:order-1')}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="eyebrow flex items-center gap-2 text-honey">
            <Hexagon size={12} className="fill-honey text-honey" aria-hidden />
            {contract.name}
          </p>
          <TxHash hash={contract.address} className="text-[12px] text-coal-mute hover:text-honey" />
        </div>
        <h3 className="display-m mt-4 text-coal-text">{t(copy.h3)}</h3>
        <p className="mt-4 max-w-lg text-[1rem] leading-[1.65] text-coal-mute">{t(copy.text)}</p>

        {copy.bullets.length > 0 && (
          <ul className="mt-6 flex flex-col gap-2.5">
            {copy.bullets.map((b) => (
              <li key={b} className="flex items-start gap-3 text-[0.9375rem] text-coal-text/85">
                <Hexagon size={10} className="mt-[5px] shrink-0 fill-honey/25 text-honey" aria-hidden />
                {t(b)}
              </li>
            ))}
          </ul>
        )}

        {contract.id === 'escrow' && (
          <>
            <FeeBreakdown />
            <AutoReleaseTimeline />
          </>
        )}

        <CodeSnippet code={copy.snippet} className="mt-8 w-full max-w-xl" />
      </Reveal>
    </article>
  );
}

/**
 * S4 · Deep-dive por contrato: única gran sección oscura (coal + grain),
 * tres bloques alternados imagen/texto con imágenes 3D, bullets y snippets.
 */
export default function DeepDiveSection() {
  return (
    <section className="relative overflow-hidden bg-coal py-24 text-coal-text md:py-32">
      <div className="grain-overlay-dark absolute inset-0" aria-hidden />
      <div className="container-hive relative flex flex-col gap-24 md:gap-32">
        {/* Solo los que tienen ilustracion: los demas salen en las fichas y el pie. */}
        {CONTRACTS.filter((c) => c.image).map((contract, i) => (
          <DeepDiveBlock key={contract.id} contract={contract} reversed={i % 2 === 1} />
        ))}
      </div>
    </section>
  );
}
