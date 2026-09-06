/**
 * Panal — la prueba de que una cuenta pública es de quien tiene la wallet.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ AGUJERO TAPA
 *
 * La única insignia que había era la del dominio: el indexador le pide
 * `/agent.json` al endpoint del agente y comprueba que declare su misma
 * dirección. Eso solo lo puede aprobar quien tiene un dominio, o sea quien se
 * ha montado un servidor. Toda persona registrada recibe en el buzón de Panal
 * —se lo pone el formulario en cuanto elige «soy una persona»— y `panal.lat`
 * no es suya, así que no había NADA que pudiera demostrar nunca.
 *
 * Lo que sí es suyo es su cuenta. Y media prueba ya estaba en la cadena: la
 * ficha lleva `github:usuario` desde que existen los tokens de marca. Faltaba
 * la otra media, que es esta: demostrar que ese usuario es el mismo que
 * controla la dirección.
 *
 * CÓMO
 *
 * Dos mitades que solo encajan si detrás hay una sola persona:
 *
 *   1. Se firma este mensaje con la wallet registrada. Eso demuestra la
 *      dirección, y no cuesta gas: es una firma, no una transacción.
 *   2. Se publica la firma en un gist PÚBLICO de esa cuenta, en un fichero
 *      llamado `panal.txt`. Eso demuestra la cuenta.
 *
 * El indexador va a buscar el gist, recupera quién firmó y lo compara con la
 * dirección registrada.
 *
 * POR QUÉ NO HACE FALTA UN NONCE. El mensaje ata las DOS cosas: la dirección y
 * el nombre de la cuenta. Copiar la firma de otro en tu propio gist no sirve de
 * nada, porque esa firma es sobre *su* dirección y *su* usuario, y el
 * verificador recompone el mensaje con los tuyos. Sin nonce, además, el
 * verificador no tiene que guardar estado: recompone el mensaje leyendo la
 * cadena y ya.
 *
 * LO QUE ESTO NO PRUEBA, dicho aquí para que nadie lo lea de más:
 *
 *   - No prueba que haya una persona. Prueba que la cuenta y la wallet son del
 *     mismo dueño, sea quien sea. Una empresa, un bot con cuenta de GitHub y
 *     una persona pasan exactamente igual.
 *   - No prueba unicidad. Nadie impide tener diez cuentas y diez wallets. Eso
 *     es otra insignia y otro problema (`ROADMAP.md`).
 *   - Y deja de valer si el gist desaparece, que es justo lo que se quiere:
 *     por eso se vuelve a mirar cada tanto y no una sola vez.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL FORMATO LO MANDA ESTE ARCHIVO. `bot/src/verificar-cuenta.ts` tiene una
 * copia de la parte de lectura, porque el bot no depende de este paquete
 * —tiene su propio lockfile y su propio ciclo—, igual que ya pasa con
 * `marca.ts`. Si aquí cambia una coma del mensaje, allí hay que cambiarla:
 * cualquier diferencia de bytes invalida TODAS las firmas publicadas.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** Dónde puede vivir una cuenta. Hoy solo GitHub; el formato admite más. */
export type RedDeCuenta = 'github';

/** El fichero que hay que crear dentro del gist. */
export const FICHERO_DE_PRUEBA = 'panal.txt';

/**
 * Lo que el indexador cuenta de la cuenta de un agente.
 *
 * Lo compone `bot/src/indexer.ts` y viaja en la ficha del catálogo. `ok` en
 * false NO es una acusación: casi siempre significa «todavía no ha publicado
 * la prueba», y por eso el mercado solo pinta algo cuando es true.
 */
export interface CuentaDeAgente {
  red: RedDeCuenta;
  /** El usuario, normalizado. */
  usuario: string;
  /** Lo que decía la ficha cuando se comprobó. */
  declarado: string;
  ok: boolean;
  /** Por qué no. Lo escribe el indexador, en castellano. */
  motivo?: string;
  /** Cuándo se comprobó (segundos). */
  ts: number;
}

/**
 * El mensaje que se firma, byte a byte.
 *
 * DELIBERADAMENTE CORTO. Lo recompone el verificador a partir de lo que hay en
 * la cadena, así que todo lo que no sea imprescindible es una ocasión más de
 * que las dos partes no coincidan y la firma no valga. La explicación de para
 * qué sirve esto va en la pantalla que lo enseña, no dentro de lo firmado —
 * salvo la segunda línea, que es fija y está ahí para que quien lo vea en el
 * aviso de su wallet sepa qué está firmando.
 *
 * La dirección va en minúsculas y el usuario también: GitHub no distingue
 * mayúsculas en los nombres, y `0xAB…` y `0xab…` son la misma dirección. Sin
 * normalizar, la misma persona firmaría un mensaje distinto según cómo tuviera
 * escrita su ficha ese día.
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
 * El usuario de una cuenta, tal y como entra en el mensaje.
 *
 * `github:` admite además `usuario/repo`, y mucha gente pone ahí el repo del
 * agente porque dice más de él que su perfil. Para esto vale el DUEÑO: el repo
 * es del usuario, y quien puede publicar un gist es el usuario.
 */
export function normalizarUsuario(usuario: string): string {
  return usuario.trim().replace(/^@/, '').split('/')[0]!.toLowerCase();
}

/**
 * La firma que haya dentro de un texto, o `null`.
 *
 * Se busca en vez de exigir que el fichero sea SOLO la firma porque el gist lo
 * escribe una persona a mano: va a pegar el mensaje encima, o una explicación,
 * o un salto de línea de más. Una firma de una EOA son 65 bytes —r, s y v— o
 * sea 130 caracteres hexadecimales, y eso no aparece por accidente en un texto.
 */
export function extraerFirma(texto: string): string | null {
  return /0x[0-9a-fA-F]{130}/.exec(texto)?.[0] ?? null;
}
