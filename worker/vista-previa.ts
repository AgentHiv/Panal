/**
 * Lo que ve quien pega el enlace de un agente en X, Telegram, Discord o
 * WhatsApp: el título, la descripción y la imagen de SU ficha, no los de la
 * portada.
 *
 * panal.lat es una SPA: el HTML es el mismo para todas las rutas y lo demás lo
 * pinta JavaScript, que quien genera la vista previa no ejecuta. Así que el
 * Worker (`index.ts`) reescribe las etiquetas de `index.html` en
 * `/agente/onchain-0x…` con los datos del indexador, que también dibuja la
 * imagen (`bot/src/vista-previa.ts`).
 *
 * Aquí solo hay funciones puras, para poder probarlas en Node sin el runtime
 * de Cloudflare (`scripts/test-vista-previa-web.ts`).
 */

export const SITIO = 'https://panal.lat';
export const API = 'https://api.panal.lat';

/** Lo que devuelve `GET /index/agent?address=` del indexador, lo que se usa. */
export interface RespuestaDelIndice {
  agent: {
    address: string;
    name: string;
    description: string;
    idiomas?: Record<string, string>;
    pricePerTask: string;
    coin: string;
    active: boolean;
    stats: {
      completed: number;
      avgRating: number | null;
      ratingCount: number;
      /** Clientes distintos y la nota contando a cada uno una vez. Un indexador anterior no los trae. */
      clients?: number;
      clientRating?: number | null;
    } | null;
  };
  preview?: { image?: string | null };
}

export interface Meta {
  titulo: string;
  descripcion: string;
  url: string;
  /** URL absoluta de la imagen, o null para dejar la de la portada. */
  imagen: string | null;
  alt: string;
}

/** La dirección de un agente a partir del id de su ficha: `onchain-0x…`. */
export function direccionDeId(id: string): string | null {
  const m = /^onchain-(0x[0-9a-fA-F]{40})$/.exec(id);
  return m ? m[1]!.toLowerCase() : null;
}

/** 18 decimales, como MON y $PANAL: 1 → «1», 0.05 → «0.05», seis como mucho. */
export function cantidad(wei: string): string {
  let n: bigint;
  try {
    n = BigInt(wei);
  } catch {
    return '?';
  }
  if (n < 0n) return '?';
  const base = 10n ** 18n;
  const entera = (n / base).toString();
  const decimales = (n % base).toString().padStart(18, '0').slice(0, 6).replace(/0+$/, '');
  if (entera === '0' && !decimales && n > 0n) return '<0.000001';
  return decimales ? `${entera}.${decimales}` : entera;
}

const unaLinea = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** Corta en la última palabra que quepa en `max` letras, con «…». */
function recortar(s: string, max: number): string {
  if (s.length <= max) return s;
  const corte = s.slice(0, max - 1);
  const espacio = corte.lastIndexOf(' ');
  return `${(espacio > max * 0.6 ? corte.slice(0, espacio) : corte).replace(/[\s,.;:–—-]+$/, '')}…`;
}

export function metaDeAgente(datos: RespuestaDelIndice, id: string): Meta {
  const a = datos.agent;
  const direccion = a.address.toLowerCase();
  const nombre = unaLinea(a.name ?? '') || `${direccion.slice(0, 6)}…${direccion.slice(-4)}`;
  const queHace = recortar(unaLinea(a.idiomas?.en || a.description || ''), 200);

  const st = a.stats;
  const cifras = [
    `${cantidad(a.pricePerTask)} ${a.coin || 'MON'} per task`,
    // La nota que cuenta a cada cliente una vez, y de cuántos: veinte reseñas
    // de la misma wallet son una opinión, no veinte.
    st && st.ratingCount > 0 && st.clients && st.clientRating !== undefined && st.clientRating !== null
      ? `★ ${st.clientRating.toFixed(1)} from ${st.clients} ${st.clients === 1 ? 'client' : 'clients'}`
      : st && st.ratingCount > 0 && st.avgRating !== null
        ? `★ ${st.avgRating.toFixed(1)} (${st.ratingCount} ${st.ratingCount === 1 ? 'rating' : 'ratings'})`
        : 'no ratings yet',
    `${st?.completed ?? 0} ${st?.completed === 1 ? 'job' : 'jobs'} completed`,
  ].join(' · ');

  const imagen = datos.preview?.image;
  return {
    titulo: `${nombre} — Panal`,
    descripcion: [a.active ? null : 'Paused', queHace, cifras].filter(Boolean).join(' · '),
    url: `${SITIO}/agente/${encodeURIComponent(id)}`,
    imagen: imagen && imagen.startsWith('/index/preview/') ? `${API}${imagen}` : null,
    alt: `${nombre} on Panal`,
  };
}

const attr = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Las etiquetas que se cambian. Todas existen en `index.html`; si alguna
 * desaparece de allí, la prueba lo dice en vez de que la vista previa salga a
 * medias sin que nadie se entere.
 */
export const ETIQUETAS = [
  'title',
  'description',
  'og:title',
  'og:description',
  'og:url',
  'og:image',
  'canonical',
  'twitter:title',
  'twitter:description',
  'twitter:image',
] as const;

/**
 * Pone la meta de un agente en el HTML de la SPA. Devuelve también qué
 * etiquetas encontró, para que la prueba pueda exigir todas.
 */
export function reescribirHtml(html: string, meta: Meta): { html: string; cambiadas: string[] } {
  const cambiadas: string[] = [];
  const valores: Record<string, string | null> = {
    description: meta.descripcion,
    'og:title': meta.titulo,
    'og:description': meta.descripcion,
    'og:url': meta.url,
    'og:image': meta.imagen,
    'twitter:title': meta.titulo,
    'twitter:description': meta.descripcion,
    'twitter:image': meta.imagen,
  };

  let out = html.replace(/<title>[^<]*<\/title>/, () => {
    cambiadas.push('title');
    return `<title>${attr(meta.titulo)}</title>`;
  });
  out = out.replace(/<meta\s+(property|name)="([^"]+)"\s+content="[^"]*"\s*\/?>/g, (entera, tipo: string, clave: string) => {
    const valor = valores[clave];
    if (valor === undefined) return entera;
    cambiadas.push(clave);
    if (valor === null) return entera;
    return `<meta ${tipo}="${clave}" content="${attr(valor)}" />`;
  });
  out = out.replace(/<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/, () => {
    cambiadas.push('canonical');
    return `<link rel="canonical" href="${attr(meta.url)}" />`;
  });

  // Las medidas y el texto alternativo de la imagen, que la portada no lleva.
  if (meta.imagen) {
    const extra = [
      '<meta property="og:image:width" content="1200" />',
      '<meta property="og:image:height" content="630" />',
      '<meta property="og:image:type" content="image/png" />',
      `<meta property="og:image:alt" content="${attr(meta.alt)}" />`,
      `<meta name="twitter:image:alt" content="${attr(meta.alt)}" />`,
    ].join('\n    ');
    out = out.replace('</head>', `    ${extra}\n  </head>`);
  }
  return { html: out, cambiadas };
}
