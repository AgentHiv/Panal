import { useEffect, useRef } from 'react';

/**
 * Canvas 2D ligero del home (home.md S5): ~40 nodos hexagonales conectados con
 * deriva orgánica lenta; cada ~2.5s un arco honey recorre el canvas (dash animado)
 * + pulso expansivo en el nodo origen. Pausa fuera de viewport.
 */

interface Node {
  bx: number;
  by: number;
  r: number;
  top: boolean;
  phase: number;
}

interface Arc {
  a: number;
  b: number;
  t0: number;
}

function hexPath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  for (let k = 0; k < 6; k++) {
    const a = Math.PI / 6 + (k * Math.PI) / 3;
    const px = x + r * Math.cos(a);
    const py = y + r * Math.sin(a);
    if (k === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

export default function MiniSwarm({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let w = 0;
    let h = 0;
    let dpr = 1;
    let raf = 0;
    let inView = true;
    let lastArc = 0;

    // ~40 nodos pseudo-aleatorios deterministas
    let seed = 7;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    const nodes: Node[] = Array.from({ length: 40 }, (_, i) => {
      const a = rand() * Math.PI * 2;
      const rr = Math.sqrt(rand());
      return {
        bx: 0.5 + Math.cos(a) * rr * 0.42,
        by: 0.5 + Math.sin(a) * rr * 0.4,
        r: i < 3 ? 10 + rand() * 4 : 3.5 + rand() * 5,
        top: i < 3,
        phase: rand() * Math.PI * 2,
      };
    });
    // aristas por proximidad
    const edges: Array<[number, number]> = [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i].bx - nodes[j].bx;
        const dy = nodes[i].by - nodes[j].by;
        if (Math.hypot(dx, dy) < 0.22) edges.push([i, j]);
      }
    }
    const arcs: Arc[] = [];

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const nodePos = (n: Node, time: number): [number, number] => {
      const dx = Math.sin(time * 0.4 + n.phase) * 6 + Math.sin(time * 0.17 + n.phase * 2) * 4;
      const dy = Math.cos(time * 0.33 + n.phase * 1.3) * 6;
      return [n.bx * w + dx, n.by * h + dy];
    };

    const draw = (nowMs: number) => {
      const time = nowMs / 1000;
      ctx.clearRect(0, 0, w, h);

      // aristas
      ctx.strokeStyle = 'rgba(58,51,42,0.55)';
      ctx.lineWidth = 1;
      for (const [i, j] of edges) {
        const [x1, y1] = nodePos(nodes[i], time);
        const [x2, y2] = nodePos(nodes[j], time);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }

      // nodos hexagonales
      nodes.forEach((n) => {
        const [x, y] = nodePos(n, time);
        hexPath(ctx, x, y, n.r);
        if (n.top) {
          ctx.fillStyle = 'rgba(247,232,204,0.9)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(226,154,46,0.8)';
        } else {
          ctx.fillStyle = 'rgba(139,131,117,0.35)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(139,131,117,0.5)';
        }
        ctx.lineWidth = 1;
        ctx.stroke();
      });

      // arcos animados (máx. 6 simultáneos)
      if (!reduced && time - lastArc > 2.5 && arcs.length < 6) {
        lastArc = time;
        const a = Math.floor(Math.random() * nodes.length);
        let b = Math.floor(Math.random() * nodes.length);
        if (b === a) b = (b + 7) % nodes.length;
        arcs.push({ a, b, t0: time });
      }
      for (let i = arcs.length - 1; i >= 0; i--) {
        const arc = arcs[i];
        const t = (time - arc.t0) / 0.9;
        if (t > 1.4) {
          arcs.splice(i, 1);
          continue;
        }
        const [x1, y1] = nodePos(nodes[arc.a], time);
        const [x2, y2] = nodePos(nodes[arc.b], time);
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2 - Math.hypot(x2 - x1, y2 - y1) * 0.22;
        const tt = Math.min(1, t);
        // tramo parcial de la curva (efecto dash)
        const steps = 26;
        const from = Math.max(0, tt - 0.35);
        ctx.beginPath();
        for (let s = 0; s <= steps; s++) {
          const u = from + (tt - from) * (s / steps);
          const ix = (1 - u) * (1 - u) * x1 + 2 * (1 - u) * u * mx + u * u * x2;
          const iy = (1 - u) * (1 - u) * y1 + 2 * (1 - u) * u * my + u * u * y2;
          if (s === 0) ctx.moveTo(ix, iy);
          else ctx.lineTo(ix, iy);
        }
        ctx.strokeStyle = 'rgba(226,154,46,0.85)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // pulso en origen
        if (t < 0.6) {
          const pr = 6 + t * 46;
          ctx.beginPath();
          ctx.arc(x1, y1, pr, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(226,154,46,${0.5 * (1 - t / 0.6)})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      if (!reduced && inView) raf = requestAnimationFrame(draw);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const io = new IntersectionObserver(
      (entries) => {
        inView = entries[0].isIntersecting;
        if (inView) {
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(draw);
        }
      },
      { threshold: 0.05 },
    );
    io.observe(canvas);
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: '100%', height: '100%', display: 'block' }}
      aria-hidden
    />
  );
}
