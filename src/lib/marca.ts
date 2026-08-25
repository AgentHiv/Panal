/**
 * Panal — la marca de un agente: su logo y sus enlaces.
 *
 * Un agente ya podía decir cómo se llama, qué hace y dónde vive su bot. Lo que
 * no podía era PARECERSE A SÍ MISMO: quien lo construyó tiene una web, un
 * GitHub y una cuenta donde publica, y nada de eso llegaba al mercado. Un
 * cliente que está a punto de pagarle a un desconocido no tenía dónde mirar.
 *
 * Se guarda donde ya vive el resto de la ficha: en el `metadataURI` del
 * registro, como tokens `clave:valor` separados por «·».
 *
 *     Lint · Revisa contratos · solidity, auditoría · bot:https://bot.lint.dev
 *          · logo:https://lint.dev/logo.png · github:lintlabs/lint · x:lintlabs
 *
 * POR QUÉ AHÍ Y NO EN `/agent.json`. La tarjeta que sirve el agente sería más
 * cómoda —cambiarla es gratis— pero solo existe mientras su servidor conteste,
 * y el mercado enseña agentes cuyo bot está caído. El registro no se cae, lo
 * escribe el dueño de la wallet y ya se lee entero en cada carga: el logo sale
 * sin una petición más. Se paga en gas al cambiarlo, que es raro.
 *
 * TODO ES OPCIONAL, y esa es la regla de arriba abajo: un agente sin logo no
 * es un agente peor pintado, es el que había hasta ahora. Cada creador pone lo
 * que quiere y deja vacío lo demás.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * UN TOKEN SOLO CUENTA SI SU VALOR VALE, y eso no es celo: la descripción es
 * texto libre y alguien va a escribir «web: la mejor del mercado» dentro de
 * ella. Si bastara con ver dos puntos, esa descripción desaparecería de la
 * ficha y saldría como un enlace roto. Exigiendo un `https://` de verdad o un
 * usuario con forma de usuario, la frase se queda donde estaba. Es la misma
 * disciplina que ya tenía `bot:` en `botEndpoint.ts`.
 *
 * Este archivo lo comparten la web y la app (el alias `@` apunta aquí). El
 * indexador (`bot/src/indexer.ts`) y el SDK (`sdk/src/types.ts`) reimplementan
 * la LECTURA porque no dependen de este paquete; si cambias el formato,
 * cámbialo en los tres, o un token nuevo acabará saliendo como una skill.
 * ─────────────────────────────────────────────────────────────────────────
 */

export type ClaveMarca = 'logo' | 'web' | 'github' | 'x' | 'telegram';

/** El orden en que se escriben y en que se pintan. */
export const CLAVES_MARCA: readonly ClaveMarca[] = ['logo', 'web', 'github', 'x', 'telegram'];

/** Los enlaces de un agente. Cadena vacía = no lo puso. */
export type Marca = Record<ClaveMarca, string>;

export const MARCA_VACIA: Marca = { logo: '', web: '', github: '', x: '', telegram: '' };

/**
 * Tope por valor.
 *
 * No lo pide el contrato —`metadataURI` es un `string` sin límite— sino el
 * bolsillo: cada byte se paga al escribir la ficha, y una URL de 400
 * caracteres no es una URL, es un error de copiar y pegar.
 */
export const MAX_VALOR = 120;

/**
 * Una URL https, y solo https.
 *
 * `http://` no vale por lo mismo que en `bot:`: panal.lat es https y el
 * navegador bloquea el contenido mixto, así que un logo en http no se vería —
 * pero tampoco daría error. Sería un hueco sin explicación.
 */
function esHttps(valor: string): boolean {
  try {
    const u = new URL(valor);
    return u.protocol === 'https:' && u.hostname.includes('.');
  } catch {
    return false;
  }
}

/** Un usuario suelto: `panal`, `panal_labs`, `Panal-Labs`. */
const USUARIO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,38}$/;
/** GitHub admite además `usuario/repo`: mucha gente enseña el repo, no el perfil. */
const USUARIO_REPO = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;
/** Telegram tiene grupos privados, y su enlace es `+AbC…` en vez de un nombre. */
const INVITACION = /^\+[A-Za-z0-9_-]{5,64}$/;

/** El dominio del que se puede recortar un usuario pegado como URL entera. */
const DOMINIOS: Partial<Record<ClaveMarca, RegExp>> = {
  github: /^(www\.)?github\.com$/i,
  x: /^(www\.)?(x|twitter)\.com$/i,
  telegram: /^(www\.)?(t\.me|telegram\.me)$/i,
};

/**
 * Deja el valor como se va a guardar, o vacío si no sirve.
 *
 * PERDONA LO QUE LA GENTE HACE DE VERDAD: nadie se sabe de memoria si aquí va
 * el usuario o el enlace, así que se aceptan las tres formas —`@panal`,
 * `panal` y `https://x.com/panal`— y las tres se guardan igual. Rechazar el
 * enlace entero sería rechazar lo que da el botón «copiar» de la propia red.
 */
export function normalizarMarca(clave: ClaveMarca, crudo: string): string {
  const valor = crudo.trim().slice(0, MAX_VALOR);
  if (!valor) return '';
  // Un espacio o un «·» POR DENTRO invalida, no se borra. Borrarlos convertiría
  // «dos palabras» en el usuario `dospalabras`, que existe y no es el suyo: el
  // enlace quedaría guardado, llevando a otra persona, sin un solo aviso. Y el
  // «·» separa los segmentos de la ficha, así que uno colado la partiría en dos.
  if (/[·\s]/.test(valor)) return '';

  if (clave === 'logo' || clave === 'web') return esHttps(valor) ? valor : '';

  // Un enlace pegado entero: se le quita el envoltorio y queda el usuario.
  let usuario = valor.replace(/^@/, '');
  const dominio = DOMINIOS[clave];
  if (dominio && /^https?:\/\//i.test(usuario)) {
    try {
      const u = new URL(usuario);
      if (!dominio.test(u.hostname)) return '';
      usuario = u.pathname.replace(/^\/+|\/+$/g, '');
    } catch {
      return '';
    }
  }
  usuario = usuario.replace(/^@/, '');
  if (!usuario) return '';

  if (clave === 'github') return USUARIO.test(usuario) || USUARIO_REPO.test(usuario) ? usuario : '';
  if (clave === 'telegram') return USUARIO.test(usuario) || INVITACION.test(usuario) ? usuario : '';
  return USUARIO.test(usuario) ? usuario : '';
}

/** ¿Este segmento de la ficha es un token de marca? Lo usan los lectores. */
export function esTokenDeMarca(segmento: string): boolean {
  return partirToken(segmento) !== null;
}

/** `github:panal/lint` → `['github', 'panal/lint']`, o null si no cuadra. */
function partirToken(segmento: string): [ClaveMarca, string] | null {
  const dosPuntos = segmento.indexOf(':');
  if (dosPuntos <= 0) return null;
  const clave = segmento.slice(0, dosPuntos).trim().toLowerCase() as ClaveMarca;
  if (!CLAVES_MARCA.includes(clave)) return null;
  const valor = normalizarMarca(clave, segmento.slice(dosPuntos + 1));
  return valor ? [clave, valor] : null;
}

/**
 * Lee la marca de una ficha. NUNCA lanza.
 *
 * Un agente puede haberse registrado con cualquier cadena —las nueve de
 * mainnet son anteriores a que esto existiera— y un mercado que se rompe por
 * una ficha rara no sirve de nada. Lo que no cuadra, sencillamente no está.
 */
export function leerMarca(metadataURI: string | null | undefined): Marca {
  const marca: Marca = { ...MARCA_VACIA };
  if (!metadataURI) return marca;
  for (const segmento of metadataURI.split('·')) {
    const token = partirToken(segmento.trim());
    // El primero manda: una ficha con dos `logo:` no puede quedar a merced del
    // orden en que se lean.
    if (token && !marca[token[0]]) marca[token[0]] = token[1];
  }
  return marca;
}

/** Los tokens listos para pegar a la ficha, en orden y sin los vacíos. */
export function tokensDeMarca(marca: Partial<Marca>): string[] {
  const tokens: string[] = [];
  for (const clave of CLAVES_MARCA) {
    const valor = normalizarMarca(clave, marca[clave] ?? '');
    if (valor) tokens.push(`${clave}:${valor}`);
  }
  return tokens;
}

/** ¿Hay algo que enseñar? */
export function hayMarca(marca: Marca): boolean {
  return CLAVES_MARCA.some((c) => marca[c] !== '');
}

/** A dónde lleva el enlace. El logo no lleva a ninguna parte: es una imagen. */
export function enlaceDe(clave: ClaveMarca, valor: string): string {
  if (!valor) return '';
  switch (clave) {
    case 'web':
      return valor;
    case 'github':
      return `https://github.com/${valor}`;
    case 'x':
      return `https://x.com/${valor}`;
    case 'telegram':
      return `https://t.me/${valor}`;
    default:
      return '';
  }
}

/** Cómo se nombra el enlace: el dominio de una web, el usuario de una red. */
export function rotuloDe(clave: ClaveMarca, valor: string): string {
  if (clave === 'web') {
    try {
      return new URL(valor).hostname.replace(/^www\./, '');
    } catch {
      return valor;
    }
  }
  return valor;
}

/**
 * Los enlaces que sí están, listos para pintar una fila de iconos.
 *
 * El logo se queda fuera por tipo, no por casualidad: no es un enlace, es una
 * imagen, y quien pinte esta lista no tiene que acordarse de saltárselo.
 */
export function enlacesDe(
  marca: Marca,
): { clave: Exclude<ClaveMarca, 'logo'>; url: string; rotulo: string }[] {
  return CLAVES_MARCA.filter((c): c is Exclude<ClaveMarca, 'logo'> => c !== 'logo' && marca[c] !== '').map((clave) => ({
    clave,
    url: enlaceDe(clave, marca[clave]),
    rotulo: rotuloDe(clave, marca[clave]),
  }));
}
