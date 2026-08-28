/**
 * Panal — los tokens de marca de la ficha de un agente, para el bot.
 *
 * Un agente puede publicar su logo y sus enlaces dentro del `metadataURI`, como
 * tokens `clave:valor` separados por «·»:
 *
 *     Lint · Revisa contratos · solidity · bot:https://… · logo:https://… · github:lintlabs
 *
 * Aquí solo hace falta RECONOCERLOS, y hace falta en dos sitios: el indexador,
 * que arma el catálogo del mercado, y `/agent.json`, que arma la tarjeta. Los
 * dos reparten posiciones —primer segmento el nombre, segundo la descripción,
 * tercero las skills— y un token que no se aparte corre las posiciones: el
 * `logo:https://…` de un agente acabaría anunciado como skill suya.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL FORMATO LO MANDA `src/lib/marca.ts` del marketplace. Esto es una copia de
 * la parte de lectura, porque el bot no depende de aquel paquete —tiene su
 * propio lockfile y su propio ciclo, igual que pasa con el manifiesto de
 * archivos. Si allí se admite un token nuevo, hay que admitirlo aquí, o los
 * agentes que lo usen saldrán con la ficha descuadrada en el catálogo.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** Las claves que reconoce el marketplace, en el orden en que se pintan. */
export const CLAVES_MARCA = ['logo', 'web', 'github', 'x', 'telegram'] as const;

export type ClaveMarca = (typeof CLAVES_MARCA)[number];

/**
 * Tope del logo incrustado, en caracteres, y los formatos que valen.
 *
 * SVG no está: es un documento con `<script>` dentro y esta cadena la pinta
 * cualquiera. Lo que llega a la cadena es siempre una imagen inerte.
 */
const MAX_LOGO_DATA = 5000;
const LOGO_INCRUSTADO = /^data:image\/(png|webp|jpeg|gif);base64,([A-Za-z0-9+/]+={0,2})$/;

function esLogoIncrustado(valor: string): boolean {
  if (valor.length > MAX_LOGO_DATA) return false;
  const b64 = LOGO_INCRUSTADO.exec(valor)?.[2];
  return b64 !== undefined && b64.length >= 64 && b64.length % 4 === 0;
}

/**
 * `github:panal/lint` → `['github', 'panal/lint']`, o null si no es marca.
 *
 * UN TOKEN SOLO CUENTA SI SU VALOR VALE. La descripción es texto libre, y
 * alguien va a escribir «web: la mejor del mercado» dentro de ella: si bastara
 * con ver dos puntos, esa descripción desaparecería de la ficha. Exigiendo un
 * `https://` de verdad o un usuario con forma de usuario, la frase se queda
 * donde estaba. Es lo mismo que ya hacía `bot:`.
 */
export function leerTokenDeMarca(segmento: string): [ClaveMarca, string] | null {
  const i = segmento.indexOf(':');
  if (i <= 0) return null;
  const clave = segmento.slice(0, i).trim().toLowerCase() as ClaveMarca;
  if (!(CLAVES_MARCA as readonly string[]).includes(clave)) return null;

  const entero = segmento.slice(i + 1).trim();
  // El logo puede traer la imagen DENTRO, en base64, en vez de una URL. Se mira
  // antes de recortar a 120: el recorte dejaría un `data:` a medias, que ocupa
  // y no se ve. El formato lo manda `src/lib/marca.ts` del marketplace.
  if (clave === 'logo' && entero.startsWith('data:')) {
    return esLogoIncrustado(entero) ? [clave, entero] : null;
  }
  const valor = entero.slice(0, 120);
  if (!valor) return null;
  // Un espacio o un «·» por dentro invalida en vez de borrarse: borrarlos
  // convertiría «dos palabras» en el usuario `dospalabras`, que es de otro.
  if (/[·\s]/.test(valor)) return null;

  if (clave === 'logo' || clave === 'web') {
    // https y solo https: panal.lat lo es, y el navegador bloquea el contenido
    // mixto, así que un logo en http no se vería y tampoco daría error.
    try {
      const u = new URL(valor);
      return u.protocol === 'https:' && u.hostname.includes('.') ? [clave, valor] : null;
    } catch {
      return null;
    }
  }

  const dominios: Record<string, RegExp> = {
    github: /^(www\.)?github\.com$/i,
    x: /^(www\.)?(x|twitter)\.com$/i,
    telegram: /^(www\.)?(t\.me|telegram\.me)$/i,
  };
  // Se perdona lo que la gente hace de verdad: `@panal`, `panal` y el enlace
  // entero que da el botón «copiar» de la propia red.
  let usuario = valor.replace(/^@/, '');
  if (/^https?:\/\//i.test(usuario)) {
    try {
      const u = new URL(usuario);
      if (!dominios[clave]!.test(u.hostname)) return null;
      usuario = u.pathname.replace(/^\/+|\/+$/g, '');
    } catch {
      return null;
    }
  }
  usuario = usuario.replace(/^@/, '');
  if (!usuario) return null;

  const simple = /^[A-Za-z0-9][A-Za-z0-9._-]{0,38}$/;
  if (clave === 'github') {
    // GitHub admite además `usuario/repo`: mucha gente enseña el repo del
    // agente, que dice más de él que el perfil de quien lo escribió.
    return simple.test(usuario) || /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/.test(usuario)
      ? [clave, usuario]
      : null;
  }
  if (clave === 'telegram') {
    // Los grupos privados no tienen nombre: su enlace es `+AbC…`.
    return simple.test(usuario) || /^\+[A-Za-z0-9_-]{5,64}$/.test(usuario) ? [clave, usuario] : null;
  }
  return simple.test(usuario) ? [clave, usuario] : null;
}

export function esTokenDeMarca(segmento: string): boolean {
  return leerTokenDeMarca(segmento) !== null;
}

/**
 * Todos los enlaces de una ficha. Nunca lanza: un agente puede haberse
 * registrado con cualquier cadena, y lo que no cuadre sencillamente no está.
 */
export function leerMarca(metadataURI: string | null | undefined): Record<string, string> {
  const marca: Record<string, string> = {};
  if (!metadataURI) return marca;
  for (const segmento of metadataURI.split('·')) {
    const token = leerTokenDeMarca(segmento.trim());
    // El primero manda: dos `logo:` en una ficha no pueden dejar el resultado
    // a merced del orden de lectura.
    if (token && !marca[token[0]]) marca[token[0]] = token[1];
  }
  return marca;
}
