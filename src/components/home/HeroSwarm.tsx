import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * El fondo del hero: el logo de Panal hecho de partículas.
 *
 * Antes era una nube de 2.500 puntos con forma de hexágono genérico. Ahora es
 * la marca: el hexágono exterior blanco y, dentro, el de miel desplazado a la
 * derecha y abajo, en las proporciones exactas de `public/logo.svg`.
 *
 *   - Al cargar, las partículas llegan dispersas y se ordenan en el logo.
 *   - El núcleo de miel respira, y alrededor un panal de celdas se enciende en
 *     ondas que salen del logo —cada onda, una transacción que se confirma—,
 *     acompañadas de anillos hexagonales que se abren y se apagan.
 *   - Siete abejas de luz recorren el borde con su estela.
 *   - El cursor aparta las partículas y el conjunto se inclina hacia él.
 *
 * Con `prefers-reduced-motion` se pinta el logo ya formado y quieto. Fuera de
 * la pantalla no se dibuja nada (IntersectionObserver), y el dpr va con tope.
 */

const IS_MOBILE = typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;
const REDUCED =
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── geometría del logo, en unidades del mundo (cámara en z=10, fov 50) ── */

/** Centro y radio del hexágono exterior. A la derecha: el texto va a la izquierda. */
const LX = IS_MOBILE ? -0.35 : 2.75;
const LY = IS_MOBILE ? 1.9 : 0.05;
const R = IS_MOBILE ? 1.35 : 2.35;
/** El de miel: 37,5 % del exterior, desplazado como en logo.svg (allí la y crece hacia abajo). */
const IX = LX + 0.089 * R;
const IY = LY - 0.054 * R;
const IR = 0.375 * R;
/** El grosor del trazo exterior, también el del logo. */
const BANDA = 0.125 * R;

const N_BORDE = IS_MOBILE ? 1600 : 3400;
const N_NUCLEO = IS_MOBILE ? 700 : 1400;
const N_PANAL = IS_MOBILE ? 1300 : 3000;
const N_POLVO = IS_MOBILE ? 250 : 600;
const ABEJAS = 7;
const ESTELA = 18;

/** Cada cuánto sale una onda del logo, en segundos. */
const ONDA_S = 3.6;

const C = {
  blanco: new THREE.Color('#F2EFFA'),
  niebla: new THREE.Color('#B7A8FC'),
  miel: new THREE.Color('#E29A2E'),
  mielClara: new THREE.Color('#FFD68C'),
  caliente: new THREE.Color('#FFF3D6'),
  monad: new THREE.Color('#836EF9'),
  ocaso: new THREE.Color('#4A2FC7'),
  mielOscura: new THREE.Color('#8B6B2E'),
};

/* ── hexágonos «flat-top»: vértice a la derecha, como el logo ── */

function vertices(cx: number, cy: number, r: number): [number, number][] {
  return Array.from({ length: 6 }, (_, k) => {
    const a = (Math.PI / 3) * k;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
}

/** Un punto del perímetro: `u` va de 0 a 6, un lado por unidad. */
function enPerimetro(v: [number, number][], u: number): [number, number] {
  const k = Math.floor(((u % 6) + 6) % 6);
  const f = u - Math.floor(u);
  const [x1, y1] = v[k];
  const [x2, y2] = v[(k + 1) % 6];
  return [x1 + (x2 - x1) * f, y1 + (y2 - y1) * f];
}

function dentro(px: number, py: number, cx: number, cy: number, r: number): boolean {
  const dx = Math.abs(px - cx);
  const dy = Math.abs(py - cy);
  return dy <= (r * Math.sqrt(3)) / 2 && Math.sqrt(3) * dx + dy <= Math.sqrt(3) * r;
}

/* ── los grupos de partículas ── */

interface Grupo {
  n: number;
  /** Dónde va cada partícula. */
  base: Float32Array;
  /** De dónde sale al cargar. */
  desde: Float32Array;
  /** Color de base; el de cada fotograma sale de aquí. */
  color: Float32Array;
  fase: Float32Array;
  /** Distancia al centro del logo (para las ondas del panal). */
  dist: Float32Array;
}

function grupo(n: number, colocar: (i: number) => [number, number, number, THREE.Color, number]): Grupo {
  const g: Grupo = {
    n,
    base: new Float32Array(n * 3),
    desde: new Float32Array(n * 3),
    color: new Float32Array(n * 3),
    fase: new Float32Array(n),
    dist: new Float32Array(n),
  };
  for (let i = 0; i < n; i++) {
    const [x, y, z, col, brillo] = colocar(i);
    g.base.set([x, y, z], i * 3);
    // Salen de una esfera amplia y se ordenan en el logo.
    const a = Math.random() * Math.PI * 2;
    const b = Math.acos(2 * Math.random() - 1);
    const rr = 5 + Math.random() * 6;
    g.desde.set([LX + rr * Math.sin(b) * Math.cos(a), LY + rr * Math.sin(b) * Math.sin(a), rr * Math.cos(b)], i * 3);
    g.color.set([col.r * brillo, col.g * brillo, col.b * brillo], i * 3);
    g.fase[i] = Math.random() * Math.PI * 2;
    g.dist[i] = Math.hypot(x - LX, y - LY);
  }
  return g;
}

function crearGrupos() {
  const exterior = vertices(LX, LY, R);

  // El trazo exterior: una banda del grosor del logo, con los bordes suaves.
  const borde = grupo(N_BORDE, () => {
    const [x, y] = enPerimetro(exterior, Math.random() * 6);
    const dx = x - LX;
    const dy = y - LY;
    const len = Math.hypot(dx, dy) || 1;
    const off = ((Math.random() + Math.random()) / 2 - 0.5) * BANDA;
    const col = Math.random() < 0.82 ? C.blanco : C.niebla;
    return [x + (dx / len) * off, y + (dy / len) * off, (Math.random() - 0.5) * 0.35, col, 0.6 + Math.random() * 0.4];
  });

  // El núcleo de miel, relleno, más caliente hacia el centro.
  const nucleo = grupo(N_NUCLEO, () => {
    let x = 0;
    let y = 0;
    do {
      x = IX + (Math.random() * 2 - 1) * IR;
      y = IY + (Math.random() * 2 - 1) * IR;
    } while (!dentro(x, y, IX, IY, IR));
    const d = Math.hypot(x - IX, y - IY) / IR;
    const col = d < 0.35 ? C.caliente : d < 0.7 ? C.mielClara : C.miel;
    return [x, y, (Math.random() - 0.5) * 0.25, col, 0.7 + Math.random() * 0.3];
  });

  // El panal de alrededor: celdas de la misma forma, del anillo del logo hacia fuera.
  const celda = R * 0.42;
  const centros: [number, number][] = [];
  const dxc = 1.5 * celda;
  const dyc = Math.sqrt(3) * celda;
  for (let i = -12; i <= 12; i++) {
    for (let j = -12; j <= 12; j++) {
      const x = LX + i * dxc;
      const y = LY + j * dyc + (i % 2 ? dyc / 2 : 0);
      const d = Math.hypot(x - LX, y - LY);
      if (d > R * 1.22 && d < R * 3.4) centros.push([x, y]);
    }
  }
  const panal = grupo(N_PANAL, () => {
    const [cx, cy] = centros[Math.floor(Math.random() * centros.length)];
    const [x, y] = enPerimetro(vertices(cx, cy, celda * 0.94), Math.random() * 6);
    const r = Math.random();
    const col = r < 0.25 ? C.ocaso : r < 0.65 ? C.monad : r < 0.8 ? C.niebla : C.miel;
    return [x + (Math.random() - 0.5) * 0.03, y + (Math.random() - 0.5) * 0.03, -0.4 + (Math.random() - 0.5) * 0.5, col, 1];
  });

  // Polvo de fondo, muy tenue, para dar profundidad.
  const polvo = grupo(N_POLVO, () => {
    const col = Math.random() < 0.6 ? C.niebla : C.mielClara;
    return [LX + (Math.random() - 0.5) * 20, LY + (Math.random() - 0.5) * 12, -2 - Math.random() * 3, col, 0.25 + Math.random() * 0.35];
  });

  // Las líneas de las celdas: cada lado, un segmento, con su distancia al
  // logo para que las ondas lo enciendan al pasar.
  const lineas = new Float32Array(centros.length * 6 * 2 * 3);
  const distLinea = new Float32Array(centros.length * 6 * 2);
  centros.forEach(([cx, cy], c) => {
    const v = vertices(cx, cy, celda * 0.94);
    for (let k = 0; k < 6; k++) {
      const [x1, y1] = v[k];
      const [x2, y2] = v[(k + 1) % 6];
      const i = (c * 6 + k) * 2;
      lineas.set([x1, y1, -0.45, x2, y2, -0.45], i * 3);
      distLinea[i] = Math.hypot(x1 - LX, y1 - LY);
      distLinea[i + 1] = Math.hypot(x2 - LX, y2 - LY);
    }
  });

  return { borde, nucleo, panal, polvo, exterior, lineas, distLinea };
}

/** Dónde empieza cada abeja, a qué velocidad va y en qué sentido. */
function crearAbejas() {
  return Array.from({ length: ABEJAS }, (_, a) => ({
    u0: (a * 6) / ABEJAS + Math.random() * 0.3,
    vel: 0.32 + Math.random() * 0.22,
    sentido: a % 3 === 2 ? -1 : 1,
  }));
}

function sprite(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

function geometria(g: Grupo): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(REDUCED ? g.base : g.desde), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.color), 3));
  return geo;
}

function Logo() {
  const raiz = useRef<THREE.Group>(null);
  const grupos = useMemo(() => crearGrupos(), []);
  const tex = useMemo(() => sprite(), []);
  const geos = useMemo(
    () => ({
      borde: geometria(grupos.borde),
      nucleo: geometria(grupos.nucleo),
      panal: geometria(grupos.panal),
      polvo: geometria(grupos.polvo),
    }),
    [grupos],
  );
  // Las abejas: una cabeza y su estela por cada una.
  const geoAbejas = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ABEJAS * ESTELA * 3), 3));
    const col = new Float32Array(ABEJAS * ESTELA * 3);
    for (let a = 0; a < ABEJAS; a++) {
      for (let j = 0; j < ESTELA; j++) {
        const k = Math.pow(1 - j / ESTELA, 1.6);
        const c = j === 0 ? C.caliente : C.mielClara;
        col.set([c.r * k, c.g * k, c.b * k], (a * ESTELA + j) * 3);
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return geo;
  }, []);
  const geoLineas = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(grupos.lineas, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(grupos.lineas.length), 3));
    return geo;
  }, [grupos]);
  // Los anillos que se abren con cada onda.
  const geoAnillo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const v = vertices(0, 0, R);
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v.flatMap(([x, y]) => [x, y, 0])), 3));
    return geo;
  }, []);
  const anillos = useRef<(THREE.LineLoop | null)[]>([]);
  const haloMiel = useRef<THREE.Sprite>(null);
  const haloMonad = useRef<THREE.Sprite>(null);
  const abejas = useMemo(() => crearAbejas(), []);
  const desp = useRef({
    borde: new Float32Array(N_BORDE * 3),
    nucleo: new Float32Array(N_NUCLEO * 3),
    panal: new Float32Array(N_PANAL * 3),
  });
  const inicio = useRef<number | null>(null);

  useEffect(
    () => () => {
      Object.values(geos).forEach((g) => g.dispose());
      geoAbejas.dispose();
      geoAnillo.dispose();
      geoLineas.dispose();
      tex.dispose();
    },
    [geos, geoAbejas, geoAnillo, geoLineas, tex],
  );

  useFrame(({ camera, pointer, clock, size }) => {
    if (inicio.current === null) inicio.current = clock.elapsedTime;
    const t = REDUCED ? 100 : clock.elapsedTime - inicio.current;
    const mov = REDUCED ? 0 : 1;
    const cam = camera as THREE.PerspectiveCamera;

    // El cursor en coordenadas del mundo (plano z = 0).
    const vh = 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * cam.position.z;
    const vw = vh * (size.width / size.height);
    const mx = REDUCED ? 999 : (pointer.x * vw) / 2;
    const my = REDUCED ? 999 : (pointer.y * vh) / 2;

    // Inclinación suave hacia el cursor: da profundidad sin marear.
    if (raiz.current && !REDUCED) {
      raiz.current.rotation.y += (pointer.x * 0.16 - raiz.current.rotation.y) * 0.04;
      raiz.current.rotation.x += (-pointer.y * 0.1 - raiz.current.rotation.x) * 0.04;
    }

    const respira = 1 + 0.035 * Math.sin(t * 1.7) * mov;
    // Los halos se encienden cuando el logo ya está formado, y laten con él.
    const encendido = Math.min(1, Math.max(0, (t - 1.6) / 1.4));
    if (haloMiel.current) {
      (haloMiel.current.material as THREE.SpriteMaterial).opacity = encendido * (0.42 + 0.12 * Math.sin(t * 1.7) * mov);
    }
    if (haloMonad.current) {
      (haloMonad.current.material as THREE.SpriteMaterial).opacity = encendido * 0.22;
    }

    const mover = (
      g: Grupo,
      geo: THREE.BufferGeometry,
      d: Float32Array | null,
      retraso: number,
      deriva: number,
      escala?: { cx: number; cy: number; s: number },
    ) => {
      const p = easeInOut(Math.min(1, Math.max(0, (t - retraso) / 2.4)));
      const pos = (geo.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
      for (let i = 0; i < g.n; i++) {
        const i3 = i * 3;
        let bx = g.base[i3];
        let by = g.base[i3 + 1];
        if (escala) {
          bx = escala.cx + (bx - escala.cx) * escala.s;
          by = escala.cy + (by - escala.cy) * escala.s;
        }
        const f = g.fase[i];
        bx += (Math.sin(t * 0.5 + f) * 0.05 + Math.sin(t * 0.23 + f * 2) * 0.03) * deriva * mov;
        by += Math.cos(t * 0.42 + f * 1.3) * 0.05 * deriva * mov;
        let x = g.desde[i3] + (bx - g.desde[i3]) * p;
        let y = g.desde[i3 + 1] + (by - g.desde[i3 + 1]) * p;
        const z = g.desde[i3 + 2] + (g.base[i3 + 2] - g.desde[i3 + 2]) * p;
        if (d) {
          // El cursor las aparta y vuelven con un muelle.
          const dx = x + d[i3] - mx;
          const dy = y + d[i3 + 1] - my;
          const dist = Math.hypot(dx, dy);
          if (dist < 1.3 && dist > 0.0001) {
            const fza = (1.3 - dist) * (1.3 - dist) * 0.14;
            d[i3] += (dx / dist) * fza;
            d[i3 + 1] += (dy / dist) * fza;
          }
          d[i3] *= 0.94;
          d[i3 + 1] *= 0.94;
          x += d[i3];
          y += d[i3 + 1];
        }
        pos[i3] = x;
        pos[i3 + 1] = y;
        pos[i3 + 2] = z;
      }
      (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    };

    mover(grupos.polvo, geos.polvo, null, 0, 3, undefined);
    mover(grupos.panal, geos.panal, desp.current.panal, 0, 0.6);
    mover(grupos.borde, geos.borde, desp.current.borde, 0.25, 0.35, { cx: LX, cy: LY, s: 1 + (respira - 1) * 0.3 });
    mover(grupos.nucleo, geos.nucleo, desp.current.nucleo, 0.5, 0.25, { cx: IX, cy: IY, s: respira });

    // Las ondas del panal: cada celda se enciende cuando la onda pasa por ella.
    {
      const g = grupos.panal;
      const col = (geos.panal.getAttribute('color') as THREE.BufferAttribute).array as Float32Array;
      const fase = (t % ONDA_S) / ONDA_S;
      const onda = R * 1.15 + fase * R * 2.5;
      const onda2 = R * 1.15 + (((t + ONDA_S / 2) % ONDA_S) / ONDA_S) * R * 2.5;
      for (let i = 0; i < g.n; i++) {
        const d = g.dist[i];
        const a = (d - onda) / 0.32;
        const b = (d - onda2) / 0.32;
        const brillo = REDUCED ? 0.7 : 0.6 + 2 * Math.exp(-a * a) + 0.8 * Math.exp(-b * b);
        const i3 = i * 3;
        col[i3] = g.color[i3] * brillo;
        col[i3 + 1] = g.color[i3 + 1] * brillo;
        col[i3 + 2] = g.color[i3 + 2] * brillo;
      }
      (geos.panal.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;

      // Las líneas de las celdas: apagadas en púrpura, y en miel donde pasa la onda.
      const lc = (geoLineas.getAttribute('color') as THREE.BufferAttribute).array as Float32Array;
      const aparece = Math.min(1, Math.max(0, (t - 0.8) / 1.6));
      for (let i = 0; i < grupos.distLinea.length; i++) {
        const d = grupos.distLinea[i];
        const a = (d - onda) / 0.38;
        const b = (d - onda2) / 0.38;
        const ola = REDUCED ? 0 : Math.exp(-a * a) + 0.45 * Math.exp(-b * b);
        // Más tenue cuanto más lejos del logo: el panal se funde con el fondo.
        const lejos = Math.max(0, 1 - (d - R * 1.2) / (R * 2.4));
        const base = 0.16 * lejos * aparece;
        const i3 = i * 3;
        lc[i3] = (C.ocaso.r * base + C.miel.r * ola * 0.85 * lejos) * aparece;
        lc[i3 + 1] = (C.ocaso.g * base + C.miel.g * ola * 0.85 * lejos) * aparece;
        lc[i3 + 2] = (C.ocaso.b * base * 1.6 + C.miel.b * ola * 0.85 * lejos) * aparece;
      }
      (geoLineas.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    }

    // Los anillos: se abren desde el logo y se apagan.
    anillos.current.forEach((anillo, k) => {
      if (!anillo) return;
      const p = (((t + k * (ONDA_S / 2)) % ONDA_S) / ONDA_S) * mov;
      const s = 1 + p * 1.7;
      anillo.scale.set(s, s, 1);
      (anillo.material as THREE.LineBasicMaterial).opacity = REDUCED || t < 2.6 ? 0 : 0.42 * (1 - p);
    });

    // Las abejas recorren el borde, unas en un sentido y otras en el otro.
    {
      const pos = (geoAbejas.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
      const visible = Math.min(1, Math.max(0, (t - 2.2) / 1.2));
      abejas.forEach((ab, a) => {
        for (let j = 0; j < ESTELA; j++) {
          const u = ab.u0 + ab.sentido * (ab.vel * t - j * 0.028) * mov;
          const [x, y] = enPerimetro(grupos.exterior, u);
          const i3 = (a * ESTELA + j) * 3;
          // Fuera de la vista hasta que el logo se ha formado.
          pos[i3] = visible > 0 ? x : 999;
          pos[i3 + 1] = y + Math.sin(t * 3 + a) * 0.02;
          pos[i3 + 2] = 0.15;
        }
      });
      (geoAbejas.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }
  });

  const material = (tam: number, opacidad = 0.95) => (
    <pointsMaterial
      size={tam}
      map={tex}
      vertexColors
      transparent
      opacity={opacidad}
      depthWrite={false}
      blending={THREE.AdditiveBlending}
      sizeAttenuation
    />
  );

  return (
    <group ref={raiz}>
      <points geometry={geos.polvo}>{material(0.032, 0.8)}</points>
      <lineSegments geometry={geoLineas}>
        <lineBasicMaterial vertexColors transparent opacity={0.95} depthWrite={false} blending={THREE.AdditiveBlending} />
      </lineSegments>
      <points geometry={geos.panal}>{material(0.05)}</points>
      {[0, 1].map((k) => (
        <lineLoop
          key={k}
          ref={(el) => {
            anillos.current[k] = el;
          }}
          geometry={geoAnillo}
          position={[LX, LY, -0.1]}
        >
          <lineBasicMaterial color="#E29A2E" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} />
        </lineLoop>
      ))}
      <sprite ref={haloMonad} position={[LX, LY, -0.6]} scale={[R * 4.6, R * 4.6, 1]}>
        <spriteMaterial map={tex} color="#836EF9" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>
      <sprite ref={haloMiel} position={[IX, IY, -0.2]} scale={[IR * 5.2, IR * 5.2, 1]}>
        <spriteMaterial map={tex} color="#E29A2E" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>
      <points geometry={geos.borde}>{material(0.068)}</points>
      <points geometry={geos.nucleo}>{material(0.092)}</points>
      <points geometry={geoAbejas}>{material(0.15, 1)}</points>
    </group>
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
    const io = new IntersectionObserver((entries) => setInView(entries[0].isIntersecting), { threshold: 0.05 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  if (!supported) return null;

  return (
    <div ref={wrapRef} className="absolute inset-0" aria-hidden>
      <Canvas
        dpr={IS_MOBILE ? [1, 1.5] : [1, 1.75]}
        camera={{ position: [0, 0, 10], fov: 50 }}
        // Con movimiento reducido basta un fotograma: el logo ya formado.
        frameloop={REDUCED ? 'demand' : inView ? 'always' : 'never'}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        onCreated={onReady}
      >
        <Logo />
      </Canvas>
    </div>
  );
}
