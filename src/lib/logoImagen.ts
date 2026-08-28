/**
 * Panal — convertir la imagen que elige una persona en el logo que va a la cadena.
 *
 * El formulario de alta pedía una URL https, y esa petición esconde un
 * requisito que mucha gente no cumple: tener un sitio donde dejar un archivo.
 * Quien se registra desde el navegador tiene el logo en su ordenador, no en un
 * dominio. Aquí se cierra ese hueco: se elige el archivo y se guarda la imagen
 * dentro de la propia ficha (`logo:data:image/webp;base64,…`).
 *
 * Lo que hace este archivo, y por qué cada paso:
 *
 *   1. ACEPTA SVG PERO NO LO GUARDA. Un SVG es un documento con `<script>`
 *      dentro, y la ficha la pinta cualquier cliente, no solo un `<img>`. Se
 *      rasteriza aquí y a la cadena va una imagen inerte. Ver `marca.ts`.
 *   2. RECORTA A CUADRADO. El avatar es un hexágono; una foto apaisada metida
 *      ahí sale deformada. Se recorta por el centro, como haría `object-fit:
 *      cover`, que es lo que la gente espera al ver la miniatura.
 *   3. BAJA HASTA QUE CABE. El tope no es estético: cada carácter se paga al
 *      escribir la ficha y se vuelve a leer en cada carga del mercado. Se
 *      prueban tamaños y calidades de mayor a menor y se coge el primero que
 *      entra en `MAX_LOGO_DATA`.
 *
 * No hay red por medio: todo pasa en el navegador de quien se registra. La
 * imagen no se sube a ningún sitio porque no hay ningún sitio al que subirla,
 * y esa es justamente la gracia.
 */

import { MAX_LOGO_DATA, bytesDeLogo, esLogoIncrustado } from '@/lib/marca';

/** Lo que se le pasa al `accept` del input. GIF entra porque el mercado lo pinta. */
export const LOGO_ACEPTA = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';

/** Nada de esto se decodifica: un archivo enorme cuelga la pestaña antes de fallar. */
const MAX_ARCHIVO = 8 * 1024 * 1024;

/** Lo que puede salir mal, para que la interfaz lo diga en el idioma que toca. */
export type FalloDeLogo = 'tipo' | 'grande' | 'ilegible' | 'noCabe';

export class ErrorDeLogo extends Error {
  readonly codigo: FalloDeLogo;
  constructor(codigo: FalloDeLogo) {
    super(codigo);
    this.name = 'ErrorDeLogo';
    this.codigo = codigo;
  }
}

export interface LogoListo {
  /** `data:image/webp;base64,…`, ya validado con las mismas reglas que la cadena. */
  uri: string;
  /** Peso de la imagen resultante, para poder enseñarlo. */
  bytes: number;
  /** Lado en píxeles al que hizo falta bajar. */
  lado: number;
}

/**
 * La escalera de intentos, de mejor a peor.
 *
 * 128 px es el tamaño grande del avatar (`HexAvatar`), así que es donde se
 * empieza; 64 es el pequeño y por debajo se nota. La calidad baja antes que el
 * tamaño porque un WebP a 0,6 sigue viéndose bien y medio tamaño no.
 */
const INTENTOS: { lado: number; calidad: number }[] = [
  { lado: 128, calidad: 0.85 },
  { lado: 128, calidad: 0.7 },
  { lado: 128, calidad: 0.55 },
  { lado: 96, calidad: 0.7 },
  { lado: 96, calidad: 0.5 },
  { lado: 64, calidad: 0.7 },
  { lado: 64, calidad: 0.5 },
];

/**
 * Un SVG sin `width`/`height` mide cero, y un `<img>` que mide cero se dibuja
 * como nada: la miniatura salía en blanco sin un solo error. Se le ponen las
 * medidas —del `viewBox` si lo trae— y se vuelve a serializar.
 *
 * Se parsea con `DOMParser`, que NO ejecuta nada, y el resultado no toca el
 * documento en ningún momento: se convierte en un blob que solo va a mirar un
 * `<img>`, donde los scripts de un SVG están desactivados por el navegador.
 */
function svgConMedidas(texto: string): Blob {
  const doc = new DOMParser().parseFromString(texto, 'image/svg+xml');
  const svg = doc.documentElement;
  if (svg.nodeName !== 'svg' || doc.querySelector('parsererror')) throw new ErrorDeLogo('ilegible');
  const caja = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  const anchoCaja = caja.length === 4 && caja[2] > 0 ? caja[2] : 256;
  const altoCaja = caja.length === 4 && caja[3] > 0 ? caja[3] : 256;
  if (!svg.getAttribute('width')) svg.setAttribute('width', String(anchoCaja));
  if (!svg.getAttribute('height')) svg.setAttribute('height', String(altoCaja));
  return new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' });
}

/** Carga el archivo en un `<img>` ya decodificado, o falla. */
async function cargar(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'sync';
    img.src = url;
    await new Promise<void>((ok, mal) => {
      img.onload = () => ok();
      img.onerror = () => mal(new ErrorDeLogo('ilegible'));
    });
    if (!img.naturalWidth || !img.naturalHeight) throw new ErrorDeLogo('ilegible');
    return img;
  } finally {
    // Se revoca en cuanto está decodificada: el `<img>` ya tiene los píxeles y
    // dejar el blob vivo es memoria retenida por cada intento del usuario.
    URL.revokeObjectURL(url);
  }
}

/**
 * Elige el archivo de alguien y devuelve el logo listo para guardar.
 *
 * Lanza `ErrorDeLogo` con el motivo. Nunca devuelve algo que la cadena vaya a
 * rechazar: lo último que hace es pasar el resultado por la misma validación
 * que corre al leer la ficha.
 */
export async function prepararLogo(archivo: File): Promise<LogoListo> {
  if (!archivo.type.startsWith('image/')) throw new ErrorDeLogo('tipo');
  if (archivo.size > MAX_ARCHIVO) throw new ErrorDeLogo('grande');

  const esSvg = archivo.type === 'image/svg+xml';
  const fuente = esSvg ? svgConMedidas(await archivo.text()) : archivo;
  const img = await cargar(fuente);

  const lienzo = document.createElement('canvas');
  const ctx = lienzo.getContext('2d');
  if (!ctx) throw new ErrorDeLogo('ilegible');

  // ¿Sabe el navegador escribir WebP? Safari viejo devuelve un PNG sin avisar,
  // así que no se pregunta: se mira lo que ha devuelto.
  lienzo.width = lienzo.height = 1;
  const tipo = lienzo.toDataURL('image/webp').startsWith('data:image/webp')
    ? 'image/webp'
    : 'image/png';

  for (const { lado, calidad } of INTENTOS) {
    lienzo.width = lienzo.height = lado;
    ctx.clearRect(0, 0, lado, lado);
    // Recorte centrado: se toma el cuadrado más grande que cabe en el original.
    const corte = Math.min(img.naturalWidth, img.naturalHeight);
    ctx.drawImage(
      img,
      (img.naturalWidth - corte) / 2,
      (img.naturalHeight - corte) / 2,
      corte,
      corte,
      0,
      0,
      lado,
      lado,
    );
    // El PNG no tiene mando de calidad, así que ahí solo baja el tamaño: repetir
    // el mismo lado dos veces daría el mismo resultado, y se salta.
    const uri = lienzo.toDataURL(tipo, tipo === 'image/webp' ? calidad : undefined);
    if (uri.length <= MAX_LOGO_DATA && esLogoIncrustado(uri)) {
      return { uri, bytes: bytesDeLogo(uri), lado };
    }
  }
  throw new ErrorDeLogo('noCabe');
}
