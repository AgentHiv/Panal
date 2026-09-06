/**
 * ¿La cuenta de GitHub que dice un agente es realmente suya?
 *
 * El hermano de `verificar-dominio.ts`, para quien no tiene dominio. Aquella
 * insignia solo la puede ganar quien se ha montado un servidor, y toda persona
 * registrada recibe en el buzón de Panal —se lo pone el propio formulario en
 * cuanto elige «soy una persona»—, así que no tenía forma de demostrar nada.
 *
 * Lo que sí es suyo es su cuenta, y media prueba ya estaba en la cadena: la
 * ficha lleva `github:usuario` desde que existen los tokens de marca. Esto es
 * la otra media.
 *
 * DOS MITADES QUE SOLO ENCAJAN CON UN DUEÑO. Se firma un mensaje con la wallet
 * registrada —eso demuestra la dirección, y no cuesta gas— y se publica la
 * firma en un gist PÚBLICO de esa cuenta, en un fichero `panal.txt` —eso
 * demuestra la cuenta—. Aquí se va a buscar el gist, se recupera quién firmó y
 * se compara.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL FORMATO DEL MENSAJE LO MANDA `src/lib/cuenta.ts` del marketplace, que es
 * donde se compone para firmarlo. Esto es una copia de la parte de lectura,
 * porque el bot no depende de aquel paquete —tiene su propio lockfile y su
 * propio ciclo—, igual que ya pasa con `marca.ts`. Si allí cambia una coma,
 * aquí también: cualquier diferencia de bytes invalida TODAS las firmas
 * publicadas, y sin avisar.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * LO QUE ESTO NO PRUEBA. Que la cuenta y la wallet tienen el mismo dueño, y
 * nada más: ni que sea una persona, ni que sea una sola. Quien lea la insignia
 * tiene que poder leer exactamente eso, así que la etiqueta dice «GitHub
 * verificado» y no «verificado» a secas.
 *
 * LO QUE CUESTA. La API de GitHub sin credenciales da 60 peticiones por hora y
 * por IP, y cada comprobación gasta DOS: listar los gists del usuario y leer el
 * fichero. O sea 30 agentes por hora como techo. Con el repaso cada 24 h y de
 * tres en tres por vuelta sobra de largo hoy, y con un `GITHUB_TOKEN` en el
 * entorno —solo lectura, ni siquiera hace falta que dé acceso a nada— pasa a
 * 5000/hora. Si algún día no llega, el techo está aquí y no en otra parte.
 */
import { recoverMessageAddress } from 'viem';

/** Lo que tarda como mucho en contestar GitHub. */
const TIMEOUT_MS = 8_000;

/** Tope de lo que se lee del gist. Una firma son 132 caracteres, no megas. */
const MAX_BYTES = 64 * 1024;

/**
 * Cuántos gists se miran. Los devuelve del más reciente al más antiguo, así que
 * quien tenga más de cien y el de Panal enterrado debajo tendrá que volver a
 * publicarlo. Pedir más páginas serían más peticiones contra el mismo techo de
 * 60/hora, y eso sí rompe la verificación de todos los demás.
 */
const GISTS_POR_PAGINA = 100;

/** El fichero que hay que crear dentro del gist. Lo manda `src/lib/cuenta.ts`. */
const FICHERO_DE_PRUEBA = 'panal.txt';

/** De donde sirve GitHub el contenido crudo de un gist, y de ningún otro sitio. */
const HOST_CRUDO = 'gist.githubusercontent.com';

/** Dónde puede vivir una cuenta. Hoy solo GitHub. */
export type RedDeCuenta = 'github';

export interface VeredictoDeCuenta {
  /** Si la cuenta publica una firma de esta misma dirección. */
  ok: boolean;
  /** Por qué no, para poder enseñarlo y para no depurar a ciegas. */
  motivo: string;
}

/** Forma de un usuario de GitHub. Lo mismo que exige `marca.ts` al token. */
const USUARIO = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;

/**
 * El usuario de una cuenta, tal y como entra en el mensaje.
 *
 * `github:` admite además `usuario/repo`, y mucha gente pone ahí el repo del
 * agente porque dice más de él que su perfil. Para esto vale el DUEÑO: el repo
 * es del usuario, y quien puede publicar un gist es el usuario.
 *
 * Copia de `normalizarUsuario` de `src/lib/cuenta.ts`.
 */
export function normalizarUsuario(usuario: string): string {
  return usuario.trim().replace(/^@/, '').split('/')[0]!.toLowerCase();
}

/**
 * El mensaje que se firma, byte a byte.
 *
 * Copia de `componerMensajeDeCuenta` de `src/lib/cuenta.ts`. Ver allí por qué
 * es tan corto y por qué no lleva nonce.
 */
export function componerMensajeDeCuenta(opts: {
  direccion: string;
  red: RedDeCuenta;
  usuario: string;
  chainId: number;
}): string {
  return [
    'Panal · verificación de cuenta',
    'Firmando esto demuestro que esta cuenta y esta dirección son de la misma persona.',
    `cuenta: ${opts.red}:${normalizarUsuario(opts.usuario)}`,
    `dirección: ${opts.direccion.toLowerCase()}`,
    `chainId: ${opts.chainId}`,
  ].join('\n');
}

/**
 * La firma que haya dentro de un texto, o `null`.
 *
 * Copia de `extraerFirma` de `src/lib/cuenta.ts`. Se busca en vez de exigir que
 * el fichero sea SOLO la firma porque el gist lo escribe una persona a mano.
 */
export function extraerFirma(texto: string): string | null {
  return /0x[0-9a-fA-F]{130}/.exec(texto)?.[0] ?? null;
}

/** Un gist, con lo poco que hace falta de él. */
interface GistLigero {
  files?: Record<string, { raw_url?: unknown } | null>;
}

/** Las cabeceras de toda petición a GitHub. El `user-agent` es obligatorio. */
function cabeceras(): Record<string, string> {
  const h: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': 'panal-indexer',
    'x-github-api-version': '2022-11-28',
  };
  // Opcional y solo de lectura: sube el techo de 60 peticiones/hora a 5000.
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}

/** Texto de una URL, con tope de bytes y sin seguir saltos. */
async function leerTexto(url: string): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'manual',
      headers: { accept: 'text/plain', 'user-agent': 'panal-indexer' },
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const largo = Number(res.headers.get('content-length') ?? 0);
  if (largo > MAX_BYTES) return null;
  try {
    return (await res.text()).slice(0, MAX_BYTES);
  } catch {
    return null;
  }
}

export async function verificarCuenta(opts: {
  direccion: string;
  /** El usuario declarado en la ficha, tal cual, sin normalizar. */
  usuario: string;
  chainId: number;
  red?: RedDeCuenta;
}): Promise<VeredictoDeCuenta> {
  const red = opts.red ?? 'github';
  const usuario = normalizarUsuario(opts.usuario);
  if (!USUARIO.test(usuario)) return { ok: false, motivo: 'no tiene forma de usuario de GitHub' };

  // ---- 1. Los gists públicos de esa cuenta --------------------------------
  let res: Response;
  try {
    res = await fetch(`https://api.github.com/users/${usuario}/gists?per_page=${GISTS_POR_PAGINA}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'manual',
      headers: cabeceras(),
    });
  } catch {
    return { ok: false, motivo: 'GitHub no responde' };
  }
  if (res.status === 404) return { ok: false, motivo: 'esa cuenta de GitHub no existe' };
  // 403 y 429 son el techo de peticiones, y eso NO es culpa del agente: decirlo
  // como si lo fuera pondría una insignia roja a quien no ha hecho nada. Ver el
  // encabezado: sin credenciales son 60 peticiones por hora y por IP.
  if (res.status === 403 || res.status === 429) {
    return { ok: false, motivo: 'GitHub está limitando las peticiones; se reintenta luego' };
  }
  if (!res.ok) return { ok: false, motivo: `GitHub responde ${res.status}` };

  let gists: GistLigero[];
  try {
    gists = JSON.parse((await res.text()).slice(0, 2 * 1024 * 1024)) as GistLigero[];
  } catch {
    return { ok: false, motivo: 'GitHub devuelve algo que no es JSON' };
  }
  if (!Array.isArray(gists)) return { ok: false, motivo: 'GitHub devuelve algo que no es una lista' };

  // ---- 2. El que lleva `panal.txt` ----------------------------------------
  let crudo: string | null = null;
  for (const g of gists) {
    for (const [nombre, f] of Object.entries(g.files ?? {})) {
      if (nombre.trim().toLowerCase() !== FICHERO_DE_PRUEBA) continue;
      const url = typeof f?.raw_url === 'string' ? f.raw_url : '';
      // La URL viene de un tercero, así que se comprueba a dónde apunta antes
      // de pedirla. Sin esto, la respuesta de GitHub decide a qué servidor va
      // el indexador, que es exactamente el agujero que `verificar-dominio.ts`
      // cierra con el filtro de IPs.
      try {
        if (new URL(url).hostname.toLowerCase() !== HOST_CRUDO) continue;
      } catch {
        continue;
      }
      crudo = await leerTexto(url);
      if (crudo !== null) break;
    }
    if (crudo !== null) break;
  }
  if (crudo === null) {
    return { ok: false, motivo: `no publica ningún gist con un ${FICHERO_DE_PRUEBA} legible` };
  }

  // ---- 3. Quién firmó -----------------------------------------------------
  const firma = extraerFirma(crudo);
  if (!firma) return { ok: false, motivo: 'el fichero no contiene ninguna firma' };

  const mensaje = componerMensajeDeCuenta({ direccion: opts.direccion, red, usuario, chainId: opts.chainId });
  let firmante: string;
  try {
    firmante = await recoverMessageAddress({ message: mensaje, signature: firma as `0x${string}` });
  } catch {
    return { ok: false, motivo: 'la firma no se puede leer' };
  }

  if (firmante.toLowerCase() !== opts.direccion.toLowerCase()) {
    // No se enseña la dirección entera: quien mire la insignia no va a
    // comparar 42 caracteres, y el principio ya distingue.
    return { ok: false, motivo: `la firma es de ${firmante.slice(0, 12)}…` };
  }

  return { ok: true, motivo: '' };
}
