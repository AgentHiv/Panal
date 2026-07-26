import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * Canvas 3D del hero (home.md S1): ~2.500 partículas miel/ámbar que se organizan
 * en una gran silueta hexagonal centro-derecha, con deriva orgánica y repulsión
 * radial suave al cursor (desplazamiento separado con decaimiento lerp).
 * pixelRatio cap 1.75, pausa fuera de viewport.
 */

const IS_MOBILE =
  typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;
const COUNT = IS_MOBILE ? 1200 : 2500;
const PALETTE = ['#E29A2E', '#F7E8CC', '#8B6B2E', '#FFD68C'];
const HEX_CX = 2.05;
const HEX_CY = 0.05;
const HEX_R = 2.45;

interface ParticleData {
  base: Float32Array;
  scatter: Float32Array;
  colors: Float32Array;
  phase: Float32Array;
}

function buildParticles(): ParticleData {
  const base = new Float32Array(COUNT * 3);
  const scatter = new Float32Array(COUNT * 3);
  const colors = new Float32Array(COUNT * 3);
  const phase = new Float32Array(COUNT);
  const color = new THREE.Color();

  const hexV = Array.from({ length: 6 }, (_, i) => {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    return [HEX_CX + HEX_R * Math.cos(a), HEX_CY + HEX_R * Math.sin(a)] as const;
  });

  for (let i = 0; i < COUNT; i++) {
    const u = Math.random();
    let x = 0;
    let y = 0;
    if (u < 0.58) {
      // anillo hexagonal denso (la silueta)
      const t = Math.random() * 6;
      const seg = Math.floor(t) % 6;
      const f = t - Math.floor(t);
      const [x1, y1] = hexV[seg];
      const [x2, y2] = hexV[(seg + 1) % 6];
      x = x1 + (x2 - x1) * f;
      y = y1 + (y2 - y1) * f;
      const dx = x - HEX_CX;
      const dy = y - HEX_CY;
      const len = Math.hypot(dx, dy) || 1;
      const spread = (Math.random() + Math.random() - 1) * 0.16;
      x += (dx / len) * spread;
      y += (dy / len) * spread;
    } else if (u < 0.7) {
      // clusters en los vértices
      const [vx, vy] = hexV[Math.floor(Math.random() * 6)];
      x = vx + (Math.random() - 0.5) * 0.24;
      y = vy + (Math.random() - 0.5) * 0.24;
    } else if (u < 0.88) {
      // relleno interior tenue
      const r = HEX_R * Math.sqrt(Math.random()) * 0.88;
      const a = Math.random() * Math.PI * 2;
      x = HEX_CX + r * Math.cos(a);
      y = HEX_CY + r * Math.sin(a);
    } else {
      // deriva dispersa alrededor
      const r = HEX_R * (1.15 + Math.random() * 0.9);
      const a = Math.random() * Math.PI * 2;
      x = HEX_CX + r * Math.cos(a) * 1.35;
      y = HEX_CY + r * Math.sin(a) * 1.1;
    }
    // deriva orgánica estática (ruido suave)
    x += Math.sin(y * 2.1 + 1.7) * 0.1;
    y += Math.sin(x * 1.9 + 0.4) * 0.1;

    base[i * 3] = x;
    base[i * 3 + 1] = y;
    base[i * 3 + 2] = (Math.random() - 0.5) * 0.6;

    // nacen dispersas (convergen en 2.2s al cargar)
    scatter[i * 3] = (Math.random() - 0.5) * 16;
    scatter[i * 3 + 1] = (Math.random() - 0.5) * 10;
    scatter[i * 3 + 2] = (Math.random() - 0.5) * 8;

    color.set(PALETTE[Math.floor(Math.random() * PALETTE.length)]);
    const dim = 0.55 + Math.random() * 0.45;
    colors[i * 3] = color.r * dim;
    colors[i * 3 + 1] = color.g * dim;
    colors[i * 3 + 2] = color.b * dim;

    phase[i] = Math.random() * Math.PI * 2;
  }
  return { base, scatter, colors, phase };
}

function makeSprite(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.65)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

function Swarm() {
  const pointsRef = useRef<THREE.Points>(null);
  const data = useMemo(() => buildParticles(), []);
  // desplazamiento por repulsión de cursor (scratch mutable, solo en useFrame)
  const dispRef = useRef(new Float32Array(COUNT * 3));
  const sprite = useMemo(() => makeSprite(), []);
  const mouse = useRef({ x: 999, y: 999 });
  const start = useRef<number | null>(null);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(data.scatter), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
    return geo;
  }, [data]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame(({ camera, pointer, clock, size }) => {
    const pts = pointsRef.current;
    if (!pts) return;
    if (start.current === null) start.current = clock.elapsedTime;
    const t = clock.elapsedTime - start.current;
    const cam = camera as THREE.PerspectiveCamera;

    // ratón en coordenadas de mundo (plano z=0)
    const vh = 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * cam.position.z;
    const vw = vh * (size.width / size.height);
    mouse.current.x = (pointer.x * vw) / 2;
    mouse.current.y = (pointer.y * vh) / 2;

    // convergencia 2.2s power2.inOut
    const p = Math.min(1, t / 2.2);
    const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;

    const pos = (geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    const { base, scatter, phase } = data;
    const disp = dispRef.current;
    const time = clock.elapsedTime;
    const mx = mouse.current.x;
    const my = mouse.current.y;
    const REPEL_R = 1.35;

    for (let i = 0; i < COUNT; i++) {
      const i3 = i * 3;
      // deriva orgánica (sin modificar la posición base)
      const ox = Math.sin(time * 0.5 + phase[i]) * 0.07 + Math.sin(time * 0.23 + phase[i] * 2.0) * 0.04;
      const oy = Math.cos(time * 0.42 + phase[i] * 1.3) * 0.07;
      const tx = base[i3] + ox;
      const ty = base[i3 + 1] + oy;

      // repulsión radial suave al cursor
      const px = scatter[i3] + (tx - scatter[i3]) * ease + disp[i3];
      const py = scatter[i3 + 1] + (ty - scatter[i3 + 1]) * ease + disp[i3 + 1];
      const dx = px - mx;
      const dy = py - my;
      const d = Math.hypot(dx, dy);
      if (d < REPEL_R && d > 0.0001) {
        const force = (REPEL_R - d) * (REPEL_R - d) * 0.16;
        disp[i3] += (dx / d) * force;
        disp[i3 + 1] += (dy / d) * force;
      }
      // retorno con muelle (decaimiento lerp)
      disp[i3] *= 0.95;
      disp[i3 + 1] *= 0.95;

      pos[i3] = px;
      pos[i3 + 1] = py;
      pos[i3 + 2] = base[i3 + 2];
    }
    (geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  });

  return (
    <points ref={pointsRef} geometry={geometry}>
      <pointsMaterial
        size={0.075}
        map={sprite}
        vertexColors
        transparent
        opacity={0.95}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        sizeAttenuation
      />
    </points>
  );
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

export default function HeroSwarm({ onReady }: { onReady?: () => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(true);
  const [supported] = useState(webglAvailable);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => setInView(entries[0].isIntersecting),
      { threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  if (!supported) return null;

  return (
    <div ref={wrapRef} className="absolute inset-0" aria-hidden>
      <Canvas
        dpr={IS_MOBILE ? [1, 1.5] : [1, 1.75]}
        camera={{ position: [0, 0, 10], fov: 50 }}
        frameloop={inView ? 'always' : 'never'}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        onCreated={onReady}
      >
        <Swarm />
      </Canvas>
    </div>
  );
}
