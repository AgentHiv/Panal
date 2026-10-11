import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * El fondo del hero: el logo de Panal.
 *
 * Una secuencia en tres tiempos:
 *
 *   1. ENTRADA. Miles de partículas llegan dispersas, como estrellas, y se
 *      ordenan en la silueta del logo: el hexágono exterior blanco y, dentro,
 *      el de miel desplazado a la derecha y abajo, en las proporciones exactas
 *      de `public/logo.svg`.
 *   2. IGNICIÓN. Cuando la silueta está completa, un destello y una onda de
 *      choque hexagonal; las partículas se apagan y en su sitio aparece el
 *      logo SÓLIDO, en 3D: el aro blanco con relieve y el núcleo de miel.
 *   3. EL LOGO. Flota y se inclina hacia el cursor; una luz le da la vuelta y
 *      va dejando brillos en el relieve; el núcleo late con su halo; y del
 *      logo salen anillos y ondas que encienden el panal de alrededor.
 *
 * Al terminar ya no queda ninguna partícula: solo el logo. Con
 * `prefers-reduced-motion` se pinta directamente el logo sólido, quieto.
 * Fuera de la pantalla no se dibuja nada (IntersectionObserver).
 */

const REDUCED =
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── el aparato: cuánto se puede dibujar ── */

/**
 * ¿Es un teléfono, una tableta o un equipo modesto?
 *
 * No se mira el ancho de la ventana: en «modo escritorio» el navegador del
 * móvil dice medir unos 980 px y se presenta como un ordenador, y con eso se
 * le servía la versión completa —miles de partículas más, antialiasing y
 * resolución alta— a una gráfica de teléfono. Lo que el modo escritorio no
 * cambia es que la pantalla se toca en vez de usarse con un ratón, y eso sí se
 * pregunta. Se suma la marca de móvil del navegador cuando la da, y los
 * equipos con pocos núcleos o poca memoria, que también agradecen la versión
 * ligera.
 */
function equipoModesto(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean }; deviceMemory?: number };
  const tactil = window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(hover: none)').matches;
  const movil = nav.userAgentData?.mobile === true || /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent);
  const pocoHierro = (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4;
  return tactil || movil || pocoHierro;
}

interface Potencia {
  borde: number;
  nucleo: number;
  panal: number;
  polvo: number;
  /** Resolución mínima y máxima del lienzo. */
  dpr: [number, number];
  antialias: boolean;
}

const POTENCIA: Potencia = equipoModesto()
  ? { borde: 1600, nucleo: 700, panal: 1300, polvo: 250, dpr: [1, 1.5], antialias: false }
  : { borde: 3400, nucleo: 1400, panal: 3000, polvo: 600, dpr: [1, 1.75], antialias: true };

/* ── la pantalla: dónde va el logo (cámara en z=10, fov 50) ── */

/**
 * Pantalla en vertical o estrecha: el logo va arriba, detrás del título.
 *
 * Por la FORMA de la pantalla y no por su ancho, por lo mismo: un teléfono en
 * modo escritorio mide 980 px de ancho pero sigue siendo más alto que ancho, y
 * con el logo colocado como en un ordenador se salía por la derecha.
 */
function enRetrato(): boolean {
  if (typeof window === 'undefined') return false;
  return window.innerWidth <= 768 || window.innerHeight > window.innerWidth;
}

interface Disposicion {
  /** Centro y radio del hexágono exterior. */
  lx: number;
  ly: number;
  r: number;
  /** El de miel: 37,5 % del exterior, desplazado como en logo.svg (allí la y crece hacia abajo). */
  ix: number;
  iy: number;
  ir: number;
  /** El grosor del trazo exterior, también el del logo. */
  banda: number;
  /**
   * En vertical el logo queda detrás del título: sólido y a plena luz se
   * comía las letras. Ahí se queda a media opacidad, como marca de agua.
   */
  opacidad: number;
}

function disposicion(retrato: boolean): Disposicion {
  // En horizontal, a la derecha: el texto va a la izquierda.
  const lx = retrato ? -0.35 : 3.05;
  const ly = retrato ? 1.9 : 0.05;
  const r = retrato ? 1.35 : 2.05;
  return {
    lx,
    ly,
    r,
    ix: lx + 0.089 * r,
    iy: ly - 0.054 * r,
    ir: 0.375 * r,
    banda: 0.125 * r,
    opacidad: retrato ? 0.45 : 1,
  };
}

/* ── la secuencia, en segundos ── */

/** Cuánto tardan las partículas en llegar a su sitio. */
const LLEGADA = 2.4;
/** Cuando la silueta está completa (el núcleo sale el último, a los 0,5 s). */
const IGNICION = 0.5 + LLEGADA;
/** Lo que dura el relevo de las partículas al logo sólido. */
const RELEVO = 0.9;
/** A partir de aquí las partículas ya no se calculan. */
const SIN_PARTICULAS = IGNICION + RELEVO + 0.2;
/** Cada cuánto sale una onda del logo. */
const ONDA_S = 3.6;

const C = {
  blanco: new THREE.Color('#F2EFFA'),
  niebla: new THREE.Color('#B7A8FC'),
  miel: new THREE.Color('#E29A2E'),
  mielClara: new THREE.Color('#FFD68C'),
  caliente: new THREE.Color('#FFF3D6'),
  monad: new THREE.Color('#836EF9'),
  ocaso: new THREE.Color('#4A2FC7'),
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

/** Un hexágono con las esquinas redondeadas, como el `stroke-linejoin="round"` del logo. */
function trazarHex(p: THREE.Path, r: number, redondeo: number): void {
  const v = vertices(0, 0, r);
  const f = Math.min(0.45, redondeo / r);
  for (let k = 0; k < 6; k++) {
    const [x0, y0] = v[(k + 5) % 6];
    const [x1, y1] = v[k];
    const [x2, y2] = v[(k + 1) % 6];
    const ax = x1 + (x0 - x1) * f;
    const ay = y1 + (y0 - y1) * f;
    if (k === 0) p.moveTo(ax, ay);
    else p.lineTo(ax, ay);
    p.quadraticCurveTo(x1, y1, x1 + (x2 - x1) * f, y1 + (y2 - y1) * f);
  }
  p.closePath();
}

/* ── las partículas de la entrada ── */

interface Grupo {
  n: number;
  base: Float32Array;
  desde: Float32Array;
  color: Float32Array;
  fase: Float32Array;
  dist: Float32Array;
}

function grupo(
  d: Disposicion,
  n: number,
  colocar: (i: number) => [number, number, number, THREE.Color, number],
): Grupo {
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
    const a = Math.random() * Math.PI * 2;
    const b = Math.acos(2 * Math.random() - 1);
    const rr = 5 + Math.random() * 6;
    g.desde.set([d.lx + rr * Math.sin(b) * Math.cos(a), d.ly + rr * Math.sin(b) * Math.sin(a), rr * Math.cos(b)], i * 3);
    g.color.set([col.r * brillo, col.g * brillo, col.b * brillo], i * 3);
    g.fase[i] = Math.random() * Math.PI * 2;
    g.dist[i] = Math.hypot(x - d.lx, y - d.ly);
  }
  return g;
}

function crearGrupos(d: Disposicion, pot: Potencia) {
  const exterior = vertices(d.lx, d.ly, d.r);

  const borde = grupo(d, pot.borde, () => {
    const [x, y] = enPerimetro(exterior, Math.random() * 6);
    const dx = x - d.lx;
    const dy = y - d.ly;
    const len = Math.hypot(dx, dy) || 1;
    const off = ((Math.random() + Math.random()) / 2 - 0.5) * d.banda;
    const col = Math.random() < 0.82 ? C.blanco : C.niebla;
    return [x + (dx / len) * off, y + (dy / len) * off, (Math.random() - 0.5) * 0.35, col, 0.6 + Math.random() * 0.4];
  });

  const nucleo = grupo(d, pot.nucleo, () => {
    let x = 0;
    let y = 0;
    do {
      x = d.ix + (Math.random() * 2 - 1) * d.ir;
      y = d.iy + (Math.random() * 2 - 1) * d.ir;
    } while (!dentro(x, y, d.ix, d.iy, d.ir));
    const rel = Math.hypot(x - d.ix, y - d.iy) / d.ir;
    const col = rel < 0.35 ? C.caliente : rel < 0.7 ? C.mielClara : C.miel;
    return [x, y, (Math.random() - 0.5) * 0.25, col, 0.7 + Math.random() * 0.3];
  });

  // El panal de alrededor: celdas de la misma forma, del logo hacia fuera.
  const celda = d.r * 0.42;
  const centros: [number, number][] = [];
  const dxc = 1.5 * celda;
  const dyc = Math.sqrt(3) * celda;
  for (let i = -12; i <= 12; i++) {
    for (let j = -12; j <= 12; j++) {
      const x = d.lx + i * dxc;
      const y = d.ly + j * dyc + (i % 2 ? dyc / 2 : 0);
      const dist = Math.hypot(x - d.lx, y - d.ly);
      if (dist > d.r * 1.22 && dist < d.r * 3.4) centros.push([x, y]);
    }
  }
  const panal = grupo(d, pot.panal, () => {
    const [cx, cy] = centros[Math.floor(Math.random() * centros.length)];
    const [x, y] = enPerimetro(vertices(cx, cy, celda * 0.94), Math.random() * 6);
    const r = Math.random();
    const col = r < 0.25 ? C.ocaso : r < 0.65 ? C.monad : r < 0.8 ? C.niebla : C.miel;
    return [x + (Math.random() - 0.5) * 0.03, y + (Math.random() - 0.5) * 0.03, -0.4 + (Math.random() - 0.5) * 0.5, col, 1];
  });

  const polvo = grupo(d, pot.polvo, () => {
    const col = Math.random() < 0.6 ? C.niebla : C.mielClara;
    return [d.lx + (Math.random() - 0.5) * 20, d.ly + (Math.random() - 0.5) * 12, -2 - Math.random() * 3, col, 0.25 + Math.random() * 0.35];
  });

  // Las líneas de las celdas, que se quedan al final: las ondas las encienden.
  const lineas = new Float32Array(centros.length * 6 * 2 * 3);
  const distLinea = new Float32Array(centros.length * 6 * 2);
  centros.forEach(([cx, cy], c) => {
    const v = vertices(cx, cy, celda * 0.94);
    for (let k = 0; k < 6; k++) {
      const [x1, y1] = v[k];
      const [x2, y2] = v[(k + 1) % 6];
      const i = (c * 6 + k) * 2;
      lineas.set([x1, y1, -0.45, x2, y2, -0.45], i * 3);
      distLinea[i] = Math.hypot(x1 - d.lx, y1 - d.ly);
      distLinea[i + 1] = Math.hypot(x2 - d.lx, y2 - d.ly);
    }
  });

  return { borde, nucleo, panal, polvo, lineas, distLinea };
}

/* ── el logo sólido ── */

function crearLogoSolido(d: Disposicion) {
  // El aro: el hexágono exterior menos el interior, con relieve y bisel.
  const aro = new THREE.Shape();
  trazarHex(aro, d.r + d.banda / 2, d.banda * 0.55);
  const hueco = new THREE.Path();
  trazarHex(hueco, d.r - d.banda / 2, d.banda * 0.2);
  aro.holes.push(hueco);
  const fondoAro = d.banda * 0.55;
  const geoAro = new THREE.ExtrudeGeometry(aro, {
    depth: fondoAro,
    bevelEnabled: true,
    bevelThickness: d.banda * 0.22,
    bevelSize: d.banda * 0.16,
    bevelSegments: 4,
    curveSegments: 6,
  });
  geoAro.translate(0, 0, -fondoAro / 2);

  // El núcleo de miel, también con relieve.
  const nucleo = new THREE.Shape();
  trazarHex(nucleo, d.ir, d.ir * 0.1);
  const fondoNucleo = d.banda * 0.8;
  const geoNucleo = new THREE.ExtrudeGeometry(nucleo, {
    depth: fondoNucleo,
    bevelEnabled: true,
    bevelThickness: d.banda * 0.25,
    bevelSize: d.banda * 0.18,
    bevelSegments: 5,
    curveSegments: 6,
  });
  geoNucleo.translate(0, 0, -fondoNucleo / 2);
  return { geoAro, geoNucleo };
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
const easeOutBack = (p: number) => 1 + 2.2 * Math.pow(p - 1, 3) + 1.2 * Math.pow(p - 1, 2);
const tramo = (t: number, desde: number, dura: number) => Math.min(1, Math.max(0, (t - desde) / dura));

function geometria(g: Grupo): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(g.desde), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.color), 3));
  return geo;
}

function Logo({ d, pot, entrada }: { d: Disposicion; pot: Potencia; entrada: boolean }) {
  const raiz = useRef<THREE.Group>(null);
  const grupos = useMemo(() => crearGrupos(d, pot), [d, pot]);
  const solido = useMemo(() => crearLogoSolido(d), [d]);
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
  const geoLineas = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(grupos.lineas, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(grupos.lineas.length), 3));
    return geo;
  }, [grupos]);
  const geoAnillo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const v = vertices(0, 0, d.r);
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v.flatMap(([x, y]) => [x, y, 0])), 3));
    return geo;
  }, [d]);

  // Lo que se anima por referencia.
  const particulas = useRef<THREE.Group>(null);
  const matsParticulas = useRef<THREE.PointsMaterial[]>([]);
  const logo = useRef<THREE.Group>(null);
  const matAro = useRef<THREE.MeshPhysicalMaterial>(null);
  const matNucleo = useRef<THREE.MeshPhysicalMaterial>(null);
  const nucleoMesh = useRef<THREE.Mesh>(null);
  const luzQueGira = useRef<THREE.PointLight>(null);
  const destello = useRef<THREE.Sprite>(null);
  const choque = useRef<THREE.LineLoop>(null);
  const anillos = useRef<(THREE.LineLoop | null)[]>([]);
  const haloMiel = useRef<THREE.Sprite>(null);
  const haloMonad = useRef<THREE.Sprite>(null);
  const desp = useRef({
    borde: new Float32Array(pot.borde * 3),
    nucleo: new Float32Array(pot.nucleo * 3),
    panal: new Float32Array(pot.panal * 3),
  });
  const inicio = useRef<number | null>(null);
  /** Lo que se va midiendo para bajar la resolución si el aparato no llega. */
  const ritmo = useRef({ tiempo: 0, fotogramas: 0, bajadas: 0 });

  useEffect(
    () => () => {
      Object.values(geos).forEach((g) => g.dispose());
      geoLineas.dispose();
      geoAnillo.dispose();
      solido.geoAro.dispose();
      solido.geoNucleo.dispose();
      tex.dispose();
    },
    [geos, geoLineas, geoAnillo, solido, tex],
  );

  useFrame((state, delta) => {
    const { camera, pointer, clock, size } = state;
    // Al girar el teléfono se rehace el logo en su sitio nuevo, pero sin repetir
    // la entrada: se empieza ya en el final.
    if (inicio.current === null) inicio.current = clock.elapsedTime - (entrada ? 0 : SIN_PARTICULAS + 0.5);

    /*
     * La red de seguridad: si va lento, menos resolución.
     *
     * Cada 90 fotogramas se mira la media. Por debajo de ~38 por segundo se
     * baja a resolución 1 y, si sigue sin llegar, a 0,75. Es lo que salva a un
     * aparato que la detección no ha sabido reconocer como modesto.
     */
    const rm = ritmo.current;
    if (!REDUCED && rm.bajadas < 2 && clock.elapsedTime - inicio.current > 1) {
      rm.tiempo += delta;
      rm.fotogramas++;
      if (rm.fotogramas >= 90) {
        if (rm.tiempo / rm.fotogramas > 1 / 38) {
          state.setDpr(rm.bajadas === 0 ? 1 : 0.75);
          rm.bajadas++;
        }
        rm.tiempo = 0;
        rm.fotogramas = 0;
      }
    }

    // Con movimiento reducido, directamente el final, quieto.
    const t = REDUCED ? SIN_PARTICULAS + 1 : clock.elapsedTime - inicio.current;
    const mov = REDUCED ? 0 : 1;
    const cam = camera as THREE.PerspectiveCamera;

    // Inclinación suave del conjunto hacia el cursor.
    if (raiz.current && !REDUCED) {
      raiz.current.rotation.y += (pointer.x * 0.12 - raiz.current.rotation.y) * 0.04;
      raiz.current.rotation.x += (-pointer.y * 0.08 - raiz.current.rotation.x) * 0.04;
    }

    /* ── 1 · las partículas, hasta que el logo sólido toma el relevo ── */

    const relevo = tramo(t, IGNICION, RELEVO);
    if (particulas.current) particulas.current.visible = t < SIN_PARTICULAS;
    if (t < SIN_PARTICULAS) {
      const vh = 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * cam.position.z;
      const vw = vh * (size.width / size.height);
      const mx = (pointer.x * vw) / 2;
      const my = (pointer.y * vh) / 2;
      // Se apagan mientras aparece el sólido.
      const apagado = 1 - easeInOut(relevo);
      matsParticulas.current.forEach((m) => {
        m.opacity = 0.95 * apagado;
      });

      const mover = (g: Grupo, geo: THREE.BufferGeometry, d: Float32Array | null, retraso: number, deriva: number) => {
        const p = easeInOut(tramo(t, retraso, LLEGADA));
        const pos = (geo.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
        for (let i = 0; i < g.n; i++) {
          const i3 = i * 3;
          const f = g.fase[i];
          const bx = g.base[i3] + (Math.sin(t * 0.5 + f) * 0.05 + Math.sin(t * 0.23 + f * 2) * 0.03) * deriva;
          const by = g.base[i3 + 1] + Math.cos(t * 0.42 + f * 1.3) * 0.05 * deriva;
          let x = g.desde[i3] + (bx - g.desde[i3]) * p;
          let y = g.desde[i3 + 1] + (by - g.desde[i3 + 1]) * p;
          if (d) {
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
          pos[i3 + 2] = g.desde[i3 + 2] + (g.base[i3 + 2] - g.desde[i3 + 2]) * p;
        }
        (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      };
      mover(grupos.polvo, geos.polvo, null, 0, 3);
      mover(grupos.panal, geos.panal, desp.current.panal, 0, 0.6);
      mover(grupos.borde, geos.borde, desp.current.borde, 0.25, 0.35);
      mover(grupos.nucleo, geos.nucleo, desp.current.nucleo, 0.5, 0.25);
    }

    /* ── 2 · la ignición: destello, onda de choque y el logo sólido ── */

    const aparece = REDUCED ? 1 : tramo(t, IGNICION - 0.05, RELEVO);
    if (logo.current) {
      logo.current.visible = aparece > 0;
      // Entra un poco más grande y se asienta con un rebote corto.
      const s = REDUCED ? 1 : 1.18 - 0.18 * easeOutBack(aparece);
      // Y después flota: un balanceo lento, en 3D, que deja ver el relieve.
      const flota = tramo(t, IGNICION + RELEVO, 1.5) * mov;
      logo.current.scale.setScalar(s);
      logo.current.rotation.y = Math.sin(t * 0.45) * 0.22 * flota;
      logo.current.rotation.x = Math.sin(t * 0.33 + 1) * 0.1 * flota;
      logo.current.position.y = d.ly + Math.sin(t * 0.8) * 0.05 * flota;
    }
    if (matAro.current) matAro.current.opacity = aparece * d.opacidad;
    if (matNucleo.current) {
      matNucleo.current.opacity = aparece * d.opacidad;
      // El núcleo late, más fuerte justo al encenderse.
      const late = 0.85 + 0.08 * Math.sin(t * 1.7) * mov;
      matNucleo.current.emissiveIntensity = late + 1.6 * Math.exp(-((t - IGNICION - 0.2) ** 2) / 0.08) * mov;
    }
    if (nucleoMesh.current) {
      nucleoMesh.current.scale.setScalar(1 + 0.03 * Math.sin(t * 1.7) * mov);
    }
    if (destello.current) {
      const p = tramo(t, IGNICION - 0.05, 0.9);
      const m = destello.current.material as THREE.SpriteMaterial;
      m.opacity = REDUCED || p <= 0 || p >= 1 ? 0 : Math.sin(Math.PI * Math.min(1, p * 1.4)) * 0.9;
      destello.current.scale.setScalar(d.r * (0.6 + 5 * easeInOut(p)));
    }
    if (choque.current) {
      const p = tramo(t, IGNICION, 1.1);
      choque.current.scale.setScalar(1 + 2.4 * (1 - Math.pow(1 - p, 3)));
      (choque.current.material as THREE.LineBasicMaterial).opacity = REDUCED || p >= 1 || p <= 0 ? 0 : 0.95 * (1 - p);
    }

    /* ── 3 · el logo vivo: la luz que gira, los halos, anillos y ondas ── */

    if (luzQueGira.current) {
      const a = t * 0.9;
      luzQueGira.current.position.set(d.lx + Math.cos(a) * d.r * 1.3, d.ly + Math.sin(a) * d.r * 1.05, 2.2);
      luzQueGira.current.intensity = 26 * aparece;
    }
    const encendido = tramo(t, IGNICION, 1.2);
    if (haloMiel.current) {
      (haloMiel.current.material as THREE.SpriteMaterial).opacity = encendido * (0.5 + 0.15 * Math.sin(t * 1.7) * mov);
    }
    if (haloMonad.current) {
      (haloMonad.current.material as THREE.SpriteMaterial).opacity = encendido * 0.26;
    }
    anillos.current.forEach((anillo, k) => {
      if (!anillo) return;
      const p = (((t + k * (ONDA_S / 2)) % ONDA_S) / ONDA_S) * mov;
      anillo.scale.setScalar(1 + p * 1.7);
      (anillo.material as THREE.LineBasicMaterial).opacity = REDUCED || t < IGNICION + 0.8 ? 0 : 0.42 * (1 - p);
    });
    {
      const fase = (t % ONDA_S) / ONDA_S;
      const onda = d.r * 1.15 + fase * d.r * 2.5;
      const onda2 = d.r * 1.15 + (((t + ONDA_S / 2) % ONDA_S) / ONDA_S) * d.r * 2.5;
      const lc = (geoLineas.getAttribute('color') as THREE.BufferAttribute).array as Float32Array;
      const aparecePanal = tramo(t, 0.8, 1.6);
      for (let i = 0; i < grupos.distLinea.length; i++) {
        const dist = grupos.distLinea[i];
        const a = (dist - onda) / 0.38;
        const b = (dist - onda2) / 0.38;
        const ola = REDUCED ? 0 : Math.exp(-a * a) + 0.45 * Math.exp(-b * b);
        const lejos = Math.max(0, 1 - (dist - d.r * 1.2) / (d.r * 2.4));
        const base = 0.16 * lejos * aparecePanal;
        const i3 = i * 3;
        lc[i3] = (C.ocaso.r * base + C.miel.r * ola * 0.85 * lejos) * aparecePanal;
        lc[i3 + 1] = (C.ocaso.g * base + C.miel.g * ola * 0.85 * lejos) * aparecePanal;
        lc[i3 + 2] = (C.ocaso.b * base * 1.6 + C.miel.b * ola * 0.85 * lejos) * aparecePanal;
      }
      (geoLineas.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;

      // Los puntos del panal, mientras existen, se encienden con las mismas ondas.
      if (t < SIN_PARTICULAS) {
        const g = grupos.panal;
        const col = (geos.panal.getAttribute('color') as THREE.BufferAttribute).array as Float32Array;
        for (let i = 0; i < g.n; i++) {
          const a = (g.dist[i] - onda) / 0.32;
          const brillo = 0.6 + 2 * Math.exp(-a * a);
          const i3 = i * 3;
          col[i3] = g.color[i3] * brillo;
          col[i3 + 1] = g.color[i3 + 1] * brillo;
          col[i3 + 2] = g.color[i3 + 2] * brillo;
        }
        (geos.panal.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
      }
    }
  });

  const material = (tam: number, opacidad = 0.95) => (
    <pointsMaterial
      ref={(m) => {
        if (m && !matsParticulas.current.includes(m)) matsParticulas.current.push(m);
      }}
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
      {/* Luces: las justas para que el relieve del logo se lea. */}
      <ambientLight intensity={0.6} />
      <directionalLight position={[d.lx - 4, d.ly + 5, 8]} intensity={1.4} color="#FFFFFF" />
      <pointLight position={[d.lx + 4, d.ly - 2, 3]} intensity={18} distance={12} decay={1} color="#836EF9" />
      <pointLight ref={luzQueGira} position={[d.lx, d.ly, 2.2]} intensity={0} distance={7} decay={1} color="#FFF3D6" />

      <sprite ref={haloMonad} position={[d.lx, d.ly, -0.8]} scale={[d.r * 4.6, d.r * 4.6, 1]}>
        <spriteMaterial map={tex} color="#836EF9" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>

      <lineSegments geometry={geoLineas}>
        <lineBasicMaterial vertexColors transparent opacity={0.95} depthWrite={false} blending={THREE.AdditiveBlending} />
      </lineSegments>
      {[0, 1].map((k) => (
        <lineLoop
          key={k}
          ref={(el) => {
            anillos.current[k] = el;
          }}
          geometry={geoAnillo}
          position={[d.lx, d.ly, -0.1]}
        >
          <lineBasicMaterial color="#E29A2E" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} />
        </lineLoop>
      ))}
      <lineLoop ref={choque} geometry={geoAnillo} position={[d.lx, d.ly, 0.2]}>
        <lineBasicMaterial color="#FFF3D6" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} />
      </lineLoop>

      <sprite ref={haloMiel} position={[d.ix, d.iy, -0.3]} scale={[d.ir * 5.4, d.ir * 5.4, 1]}>
        <spriteMaterial map={tex} color="#E29A2E" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>

      {/* Las partículas de la entrada. Desaparecen cuando llega el logo. */}
      <group ref={particulas}>
        <points geometry={geos.polvo}>{material(0.032, 0.8)}</points>
        <points geometry={geos.panal}>{material(0.05)}</points>
        <points geometry={geos.borde}>{material(0.068)}</points>
        <points geometry={geos.nucleo}>{material(0.092)}</points>
      </group>

      {/* El logo sólido. */}
      <group ref={logo} position={[d.lx, d.ly, 0]} visible={false}>
        <mesh geometry={solido.geoAro}>
          {/* Blanco con barniz: sin entorno que reflejar, el metal salía gris.
              El barniz es lo que deja el brillo de la luz que gira. */}
          <meshPhysicalMaterial
            ref={matAro}
            color="#F2EFFA"
            emissive="#F2EFFA"
            emissiveIntensity={0.32}
            metalness={0.05}
            roughness={0.32}
            clearcoat={1}
            clearcoatRoughness={0.12}
            transparent
            opacity={0}
          />
        </mesh>
        <mesh ref={nucleoMesh} geometry={solido.geoNucleo} position={[d.ix - d.lx, d.iy - d.ly, 0.05]}>
          <meshPhysicalMaterial
            ref={matNucleo}
            // Sin la curva de tono de la escena: con ella el miel, al brillar,
            // se lavaba hacia un beis. El color lo pone sobre todo su propia
            // luz (emissive), con una base oscura para que las luces de la
            // escena den relieve sin saturarlo hacia el amarillo.
            toneMapped={false}
            color="#8A5A1A"
            emissive="#E29A2E"
            emissiveIntensity={0.85}
            metalness={0.05}
            roughness={0.35}
            clearcoat={1}
            clearcoatRoughness={0.18}
            transparent
            opacity={0}
          />
        </mesh>
      </group>

      <sprite ref={destello} position={[d.ix, d.iy, 0.6]} scale={[d.r, d.r, 1]}>
        <spriteMaterial map={tex} color="#FFF3D6" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>
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
  const [retrato, setRetrato] = useState(enRetrato);
  /** Cuántas veces se ha recolocado: la primera hace la entrada, las demás no. */
  const [recolocado, setRecolocado] = useState(false);
  const d = useMemo(() => disposicion(retrato), [retrato]);
  /** La orientación vigente, para comparar sin depender del estado. */
  const vigente = useRef(retrato);

  // Girar el teléfono (o estrechar la ventana) cambia dónde va el logo.
  useEffect(() => {
    let raf = 0;
    const mirar = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const ahora = enRetrato();
        if (ahora === vigente.current) return;
        vigente.current = ahora;
        setRecolocado(true);
        setRetrato(ahora);
      });
    };
    window.addEventListener('resize', mirar);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', mirar);
    };
  }, []);

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
        dpr={POTENCIA.dpr}
        camera={{ position: [0, 0, 10], fov: 50 }}
        // Con movimiento reducido basta un fotograma: el logo ya formado.
        frameloop={REDUCED ? 'demand' : inView ? 'always' : 'never'}
        // Sin antialias en el aparato modesto: es de lo más caro y en una
        // pantalla de teléfono, con su densidad de píxeles, apenas se nota.
        gl={{ antialias: POTENCIA.antialias, alpha: true, powerPreference: 'high-performance' }}
        onCreated={onReady}
      >
        <Logo key={retrato ? 'vertical' : 'horizontal'} d={d} pot={POTENCIA} entrada={!recolocado} />
      </Canvas>
    </div>
  );
}
