import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { BadgeCheck, X } from 'lucide-react';
import HexAvatar from '@/components/HexAvatar';
import { AGENTS, CATEGORY_LABELS, formatInt, formatMon } from '@/data/agents';
import type { LiveEvent } from '@/data/events';
import { EVENT_META } from './meta';
import type { StreamEntry } from './useLiveStream';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

/* ------------------------------------------------------------------ */
/* Modelo                                                              */
/* ------------------------------------------------------------------ */

interface NodeSpec {
  key: string;
  name: string;
  category: string;
  volume24h: number;
  tasks24h: number;
  agentId?: string;
  verified?: boolean;
  top3?: boolean;
  r: number;
}

interface SwarmNode extends NodeSpec {
  isEscrow?: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  bornDelay: number;
  glowUntil: number;
  highlight: boolean;
}

interface Arc {
  a: SwarmNode;
  b: SwarmNode;
  start: number;
  dur: number;
  color: string;
}

interface Pulse {
  node: SwarmNode;
  start: number;
  color: string;
}

const MAX_ARCS = 6; // cola de arcos simultáneos (en-vivo.md S2c)

/** Nombres sintéticos para llegar a ~40 nodos (agents.ts solo trae 12). */
const SYNTH_NAMES = [
  'SentimentHive', 'PixelForge', 'LexisBot', 'QuantSage', 'EchoScribe', 'VaultWarden',
  'NexusMiner', 'ChainScribe', 'OraclePrime', 'DataMiel', 'HiveSentry', 'TokenScribe',
  'BlockBard', 'GasGolfer', 'MEVWatcher', 'DeepIndex', 'SignetBot', 'PolyGlotAI',
  'NFTScout', 'ZKProver', 'VaultScout', 'LedgerLark', 'SubnetSage', 'TensorTarea',
  'BitBrio', 'CifraSol', 'NeuroNectar', 'PanaLab',
];
const SYNTH_CATS = [
  'categories.datos',
  'categories.texto',
  'categories.defi',
  'categories.codigo',
  'categories.vision',
  'categories.creativo',
  'categories.legal',
];

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** ~40 agentes top: 12 reales de agents.ts + 28 sintéticos deterministas. */
function buildSpecs(): NodeSpec[] {
  const rng = mulberry32(20251220);
  const maxV = Math.max(...AGENTS.map((a) => a.volume24h));
  const top3Names = new Set(
    [...AGENTS].sort((x, y) => y.volume24h - x.volume24h).slice(0, 3).map((a) => a.name),
  );
  const reals: NodeSpec[] = AGENTS.map((a) => ({
    key: a.id,
    name: a.name,
    category: CATEGORY_LABELS[a.category],
    volume24h: a.volume24h,
    tasks24h: Math.max(3, Math.round(a.volume24h / a.pricePerTask)),
    agentId: a.id,
    verified: a.verified,
    r: 0,
  }));
  const synth: NodeSpec[] = SYNTH_NAMES.map((name, i) => {
    const v = 0.6 + rng() * 5.4;
    return {
      key: `synth-${i}`,
      name,
      category: SYNTH_CATS[i % SYNTH_CATS.length],
      volume24h: v,
      tasks24h: 5 + Math.floor(rng() * 380),
      r: 0,
    };
  });
  return [...reals, ...synth].map((s) => ({
    ...s,
    top3: top3Names.has(s.name),
    r: 5.5 + Math.sqrt(s.volume24h / maxV) * 10.5, // tamaño ∝ volumen 24h
  }));
}

/** Espiral de ángulo áureo alrededor del centro + nodo PanalEscrow central. */
function layoutNodes(specs: NodeSpec[], w: number, h: number): SwarmNode[] {
  const rng = mulberry32(77);
  const cx = w / 2;
  const cy = h / 2;
  const minDim = Math.min(w, h);
  const nodes: SwarmNode[] = specs.map((s, i) => {
    const angle = i * 2.399963;
    const rad = 26 + Math.sqrt(i / specs.length) * minDim * 0.4;
    return {
      ...s,
      x: cx + Math.cos(angle) * rad + (rng() - 0.5) * 36,
      y: cy + Math.sin(angle) * rad * 0.86 + (rng() - 0.5) * 36,
      vx: 0,
      vy: 0,
      bornDelay: rng() * 750,
      glowUntil: 0,
      highlight: false,
    };
  });
  nodes.push({
    key: 'escrow',
    name: 'PanalEscrow',
    category: 'Escrow',
    volume24h: 0,
    tasks24h: 0,
    isEscrow: true,
    x: cx,
    y: cy,
    vx: 0,
    vy: 0,
    r: 13,
    bornDelay: 200,
    glowUntil: 0,
    highlight: false,
  });
  return nodes;
}

/* ------------------------------------------------------------------ */
/* Dibujo                                                              */
/* ------------------------------------------------------------------ */

function hexPath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 3) * k;
    const px = x + r * Math.cos(a);
    const py = y + r * Math.sin(a);
    if (k === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

interface Pt {
  x: number;
  y: number;
}

function arcControl(a: Pt, b: Pt, side: number): Pt {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy) || 1;
  const off = Math.min(90, d * 0.25) * side;
  return { x: mx - (dy / d) * off, y: my + (dx / d) * off };
}

function quadPoint(a: Pt, c: Pt, b: Pt, t: number): Pt {
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
  };
}

/** Arco curvo con dash animado (900ms) + paquete viajando por la curva. */
function drawArc(ctx: CanvasRenderingContext2D, arc: Arc, p: number) {
  const side = arc.a.key < arc.b.key ? 1 : -1;
  const c = arcControl(arc.a, arc.b, side);
  ctx.save();
  ctx.strokeStyle = arc.color;
  ctx.globalAlpha = (1 - p) * 0.85;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([7, 7]);
  ctx.lineDashOffset = -p * 36;
  ctx.beginPath();
  ctx.moveTo(arc.a.x, arc.a.y);
  ctx.quadraticCurveTo(c.x, c.y, arc.b.x, arc.b.y);
  ctx.stroke();
  ctx.setLineDash([]);
  const pt = quadPoint(arc.a, c, arc.b, p);
  ctx.globalAlpha = (1 - p) * 0.95;
  ctx.fillStyle = arc.color;
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, 2.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Arco persistente mientras se pasa el cursor por un evento del stream. */
function drawHoverArc(ctx: CanvasRenderingContext2D, a: SwarmNode, b: SwarmNode, color: string, now: number) {
  const side = a.key < b.key ? 1 : -1;
  const c = arcControl(a, b, side);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 5]);
  ctx.lineDashOffset = -((now / 40) % 20);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.quadraticCurveTo(c.x, c.y, b.x, b.y);
  ctx.stroke();
  ctx.restore();
}

function drawPulse(ctx: CanvasRenderingContext2D, pulse: Pulse, p: number) {
  ctx.save();
  ctx.strokeStyle = pulse.color;
  ctx.globalAlpha = (1 - p) * 0.6;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(pulse.node.x, pulse.node.y, pulse.node.r + p * 34, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawNode(
  ctx: CanvasRenderingContext2D,
  n: SwarmNode,
  now: number,
  startTs: number,
  reduced: boolean,
  hovered: boolean,
) {
  const t0 = startTs + n.bornDelay;
  let s = reduced ? 1 : Math.min(1, Math.max(0, (now - t0) / 450));
  s = 1 - Math.pow(1 - s, 3);
  if (s <= 0) return;
  const rr = n.r * s;
  const glow = now < n.glowUntil ? (n.glowUntil - now) / 1200 : 0;

  ctx.save();
  if (glow > 0) {
    ctx.shadowColor = 'rgba(226,154,46,0.9)';
    ctx.shadowBlur = 20 * glow;
  }
  hexPath(ctx, n.x, n.y, rr);
  if (n.isEscrow) {
    ctx.fillStyle = 'rgba(226,154,46,0.14)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(226,154,46,0.85)';
  } else if (n.top3) {
    ctx.fillStyle = 'rgba(247,232,204,0.92)'; // honey-soft
    ctx.fill();
    ctx.strokeStyle = 'rgba(226,154,46,0.9)';
  } else {
    ctx.fillStyle = 'rgba(139,131,117,0.10)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(139,131,117,0.75)'; // base #8B8375
  }
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  if (n.isEscrow) {
    hexPath(ctx, n.x, n.y, rr * 0.45);
    ctx.fillStyle = 'rgba(226,154,46,0.9)';
    ctx.fill();
  }

  if (n.highlight || hovered) {
    ctx.save();
    ctx.strokeStyle = '#E29A2E';
    ctx.globalAlpha = reduced ? 0.9 : 0.55 + 0.35 * Math.sin(now / 160);
    ctx.lineWidth = 1.5;
    hexPath(ctx, n.x, n.y, rr + 4.5);
    ctx.stroke();
    ctx.restore();
  }
}

/* ------------------------------------------------------------------ */
/* Física: deriva orgánica lenta (repulsión + atracción al centro)     */
/* ------------------------------------------------------------------ */

function stepPhysics(nodes: SwarmNode[], w: number, h: number, dt: number, now: number) {
  const cx = w / 2;
  const cy = h / 2;
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > 21025 || d2 < 1) continue; // cutoff 145px
      const d = Math.sqrt(d2);
      const f = (2600 / d2) * dt;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      a.vx -= fx;
      a.vy -= fy;
      b.vx += fx;
      b.vy += fy;
    }
  }
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const k = n.isEscrow ? 0.02 : 0.0016;
    n.vx += (cx - n.x) * k * dt;
    n.vy += (cy - n.y) * k * dt;
    if (!n.isEscrow) {
      n.vx += Math.sin(now * 0.00023 + i * 2.17) * 0.012 * dt;
      n.vy += Math.cos(now * 0.00019 + i * 1.31) * 0.012 * dt;
    }
    n.vx *= 0.92;
    n.vy *= 0.92;
    n.x += n.vx * dt;
    n.y += n.vy * dt;
    const m = n.r + 14;
    if (n.x < m) {
      n.x = m;
      n.vx = Math.abs(n.vx) * 0.5;
    } else if (n.x > w - m) {
      n.x = w - m;
      n.vx = -Math.abs(n.vx) * 0.5;
    }
    if (n.y < m) {
      n.y = m;
      n.vy = Math.abs(n.vy) * 0.5;
    } else if (n.y > h - m) {
      n.y = h - m;
      n.vy = -Math.abs(n.vy) * 0.5;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Contador de bloque (400ms, guiño a Monad)                           */
/* ------------------------------------------------------------------ */

function BlockTicker() {
  const [block, setBlock] = useState(41_283_117);
  const [reduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const id = window.setInterval(() => setBlock((b) => b + 1), 400);
    return () => window.clearInterval(id);
  }, []);
  return (
    <span className="relative inline-flex overflow-hidden rounded px-1 font-mono text-[11px] text-coal-mute">
      {!reduced && (
        <motion.span
          key={block}
          className="absolute inset-0 bg-honey/20"
          initial={{ opacity: 0.8 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
          aria-hidden
        />
      )}
      <span className="relative">Bloque #{formatInt(block)}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Componente principal                                                */
/* ------------------------------------------------------------------ */

export interface SwarmCanvasProps {
  /** último evento del feed — dispara arco + pulso + brillo */
  latest: StreamEntry | null;
  /** evento bajo el cursor en el stream — halo honey + arco persistente */
  hoverEvent: LiveEvent | null;
  className?: string;
}

export default function SwarmCanvas({ latest, hoverEvent, className }: SwarmCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [hoverTip, setHoverTip] = useState<{ x: number; y: number; node: SwarmNode } | null>(null);
  const [selected, setSelected] = useState<SwarmNode | null>(null);
  const [reduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  const specs = useMemo(() => buildSpecs(), []);

  const nodesRef = useRef<SwarmNode[] | null>(null);
  const byNameRef = useRef<Map<string, SwarmNode>>(new Map());
  const prevSizeRef = useRef<{ w: number; h: number } | null>(null);
  const arcsRef = useRef<Arc[]>([]);
  const pulsesRef = useRef<Pulse[]>([]);
  const hoverArcRef = useRef<{ a: SwarmNode; b: SwarmNode | null; color: string } | null>(null);
  const hoverNodeRef = useRef<SwarmNode | null>(null);
  const visibleRef = useRef(true);
  const startRef = useRef(0);
  const drawOnceRef = useRef<() => void>(() => {});

  /* Tamaño del lienzo vía ResizeObserver */
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      if (r.width > 0 && r.height > 0) setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  /* Bucle principal: física + dibujo. Pausa fuera de viewport (IntersectionObserver). */
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !size) return;
    const { w, h } = size;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (!nodesRef.current) {
      startRef.current = performance.now();
      nodesRef.current = layoutNodes(specs, w, h);
      const map = new Map<string, SwarmNode>();
      nodesRef.current.forEach((n) => map.set(n.name, n));
      byNameRef.current = map;
    } else {
      const prev = prevSizeRef.current;
      if (prev && (prev.w !== w || prev.h !== h)) {
        const sx = w / prev.w;
        const sy = h / prev.h;
        nodesRef.current.forEach((n) => {
          n.x *= sx;
          n.y *= sy;
        });
      }
    }
    prevSizeRef.current = { w, h };

    const draw = (now: number) => {
      const nodes = nodesRef.current;
      if (!nodes) return;
      ctx.clearRect(0, 0, w, h);

      const arcs = arcsRef.current;
      for (let i = arcs.length - 1; i >= 0; i--) {
        const p = (now - arcs[i].start) / arcs[i].dur;
        if (p >= 1) {
          arcs.splice(i, 1);
          continue;
        }
        drawArc(ctx, arcs[i], p);
      }

      const ha = hoverArcRef.current;
      if (ha && ha.b && ha.a !== ha.b) drawHoverArc(ctx, ha.a, ha.b, ha.color, now);

      const pulses = pulsesRef.current;
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = (now - pulses[i].start) / 600;
        if (p >= 1) {
          pulses.splice(i, 1);
          continue;
        }
        drawPulse(ctx, pulses[i], p);
      }

      for (const n of nodes) drawNode(ctx, n, now, startRef.current, reduced, hoverNodeRef.current === n);
    };
    drawOnceRef.current = () => draw(performance.now());

    // prefers-reduced-motion: canvas estático (arcos solo en hover, vía efectos)
    if (reduced) {
      draw(performance.now());
      return;
    }

    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(2.5, (now - last) / 16.67);
      last = now;
      if (visibleRef.current && !document.hidden) {
        stepPhysics(nodesRef.current ?? [], w, h, dt, now);
        draw(now);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const io = new IntersectionObserver(
      (entries) => {
        visibleRef.current = entries[0].isIntersecting;
      },
      { threshold: 0.05 },
    );
    io.observe(wrap);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, [size, reduced, specs]);

  /* Nuevo evento del feed → arco (máx. 6, cola) + pulso en origen + brillo en destino */
  useEffect(() => {
    if (!latest || reduced) return;
    const map = byNameRef.current;
    const a = map.get(latest.ev.from) ?? null;
    const b = latest.ev.to ? map.get(latest.ev.to) ?? null : null;
    const now = performance.now();
    const color = EVENT_META[latest.ev.type].hex;
    if (a && b && a !== b) {
      const arcs = arcsRef.current;
      if (arcs.length >= MAX_ARCS) arcs.shift();
      arcs.push({ a, b, start: now, dur: 900, color });
    }
    if (a) {
      const pulses = pulsesRef.current;
      if (pulses.length > 8) pulses.shift();
      pulses.push({ node: a, start: now, color });
    }
    const target = b ?? a;
    if (target) target.glowUntil = now + 1200;
  }, [latest, reduced]);

  /* Hover en el stream → halo honey en los nodos implicados + arco entre ellos */
  useEffect(() => {
    const nodes = nodesRef.current;
    if (nodes) nodes.forEach((n) => (n.highlight = false));
    if (!hoverEvent) {
      hoverArcRef.current = null;
      if (reduced) drawOnceRef.current();
      return;
    }
    const map = byNameRef.current;
    const a = map.get(hoverEvent.from) ?? null;
    const b = hoverEvent.to ? map.get(hoverEvent.to) ?? null : null;
    if (a) a.highlight = true;
    if (b) b.highlight = true;
    hoverArcRef.current = a ? { a, b, color: EVENT_META[hoverEvent.type].hex } : null;
    if (reduced) drawOnceRef.current();
  }, [hoverEvent, reduced]);

  /* Hover / click sobre nodos */
  const pickNode = (mx: number, my: number): SwarmNode | null => {
    const nodes = nodesRef.current;
    if (!nodes) return null;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const dx = mx - n.x;
      const dy = my - n.y;
      if (dx * dx + dy * dy <= (n.r + 7) * (n.r + 7)) return n;
    }
    return null;
  };

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const n = pickNode(mx, my);
    hoverNodeRef.current = n;
    e.currentTarget.style.cursor = n ? 'pointer' : 'default';
    setHoverTip(n ? { x: mx, y: my, node: n } : null);
    if (reduced) drawOnceRef.current();
  };

  const onLeave = () => {
    hoverNodeRef.current = null;
    setHoverTip(null);
    if (reduced) drawOnceRef.current();
  };

  const onClickCanvas = () => {
    setSelected(hoverNodeRef.current);
  };

  const { t } = useTranslation();
  const catLabel = (cat: string) => (cat.includes('.') ? t(cat) : cat);
  const cta = selected?.isEscrow
    ? { to: '/protocolo', label: t('swarm.viewProtocol') }
    : selected?.agentId
      ? { to: `/agente/${selected.agentId}`, label: t('swarm.viewAgent') }
      : { to: '/mercado', label: t('home.hero.ctaMarket') };

  return (
    <motion.div
      ref={wrapRef}
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 1 }}
      className={cn('relative h-full w-full overflow-hidden', className)}
    >
      {/* Fondo: vignette radial coal-2 → coal + retícula hexagonal */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{ background: 'radial-gradient(ellipse 90% 80% at 50% 45%, #221D17 0%, #161310 72%)' }}
      />
      <div aria-hidden className="bg-honeycomb absolute inset-0 opacity-[0.05]" />

      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        onClick={onClickCanvas}
        role="img"
        aria-label={t('swarm.canvasAria')}
      />

      {/* Tooltip de nodo */}
      {hoverTip && !selected && (
        <div
          className="pointer-events-none absolute z-10 w-[180px] rounded-lg border border-coal-line bg-coal-2/95 px-3 py-2 backdrop-blur-sm"
          style={{
            left: Math.min(hoverTip.x + 14, (size?.w ?? 400) - 190),
            top: Math.max(hoverTip.y - 12, 8),
          }}
        >
          <p className="truncate text-[0.8125rem] font-semibold text-coal-text">{hoverTip.node.name}</p>
          <p className="text-[11px] text-coal-mute">{catLabel(hoverTip.node.category)}</p>
          {!hoverTip.node.isEscrow && (
            <p className="mt-1 font-mono text-[11px] text-honey">
              {formatMon(hoverTip.node.volume24h, 2)} MON <span className="text-coal-mute">24h</span>
              {' · '}
              {formatInt(hoverTip.node.tasks24h)} <span className="text-coal-mute">{t('swarm.tasks')}</span>
            </p>
          )}
        </div>
      )}

      {/* Drawer de mini-perfil al hacer click en un nodo */}
      <AnimatePresence>
        {selected && (
          <motion.aside
            key={selected.key}
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 16 }}
            transition={{ duration: 0.22 }}
            className="absolute right-3 top-3 z-10 w-60 rounded-xl border border-coal-line bg-coal-2/95 p-4 backdrop-blur"
          >
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="absolute right-2.5 top-2.5 grid h-7 w-7 place-items-center rounded-full text-coal-mute transition-colors hover:text-coal-text"
              aria-label={t('swarm.closeAria')}
            >
              <X size={14} />
            </button>
            <div className="flex items-center gap-3">
              <HexAvatar seed={selected.name} size={40} />
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 truncate font-semibold text-coal-text">
                  {selected.name}
                  {selected.verified && <BadgeCheck size={13} className="shrink-0 text-olive" aria-label={t('common.verified')} />}
                </p>
                <p className="text-[11px] text-coal-mute">{catLabel(selected.category)}</p>
              </div>
            </div>
            {selected.isEscrow ? (
              <p className="mt-3 text-[0.8125rem] leading-snug text-coal-mute">
                {t('swarm.escrowNote')}
              </p>
            ) : (
              <dl className="mt-3 space-y-1.5 font-mono text-[11px]">
                <div className="flex justify-between gap-2">
                  <dt className="text-coal-mute">{t('swarm.volume24h')}</dt>
                  <dd className="text-honey">{formatMon(selected.volume24h, 2)} MON</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-coal-mute">{t('swarm.tasks24h')}</dt>
                  <dd className="text-coal-text">{formatInt(selected.tasks24h)}</dd>
                </div>
              </dl>
            )}
            <Link
              to={cta.to}
              className="mt-4 block rounded-full bg-honey px-4 py-2 text-center text-[0.8125rem] font-semibold text-ink transition-colors hover:bg-honey-deep hover:text-paper"
            >
              {cta.label}
            </Link>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Leyenda + contador de bloque */}
      <div className="pointer-events-none absolute bottom-3 left-4 flex items-center gap-3 text-[11px] text-coal-mute">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#E29A2E' }} />
          {t('home.live.legendHiring')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#6E7B4E' }} />
          {t('live.events.pago').toLowerCase()}
        </span>
        <span className="hidden sm:inline">{t('home.live.legendSize')}</span>
      </div>
      <div className="absolute bottom-3 right-4">
        <BlockTicker />
      </div>
    </motion.div>
  );
}
