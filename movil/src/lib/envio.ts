/**
 * Panal — mover dinero desde una wallet del llavero: las cuentas, sin red.
 *
 * Aquí no se firma nada ni se llama a ningún sitio. Solo están las decisiones
 * que se pueden equivocar en silencio —cuánto es «todo», si la dirección vale,
 * si queda MON para la comisión— y por eso están aquí y no dentro de la
 * pantalla: así se pueden probar de verdad (`test/envio.test.mjs`).
 *
 * Quien firma es `lib/enviar.ts`, que sí toca la red.
 */

import { isAddress, parseUnits, sha256 } from 'viem';
import { english } from 'viem/accounts';

export type Moneda = 'MON' | '$PANAL';

/**
 * Lo que se deja quieto al mandar «todo» el MON.
 *
 * Una transferencia de MON son 21.000 de gas; una de $PANAL, unos 51.000. A
 * 100 gwei eso es 0,0021 y 0,0051 MON. Se reserva 0,005 —el doble de una
 * transferencia normal— porque quedarse corto no cuesta una comisión de más:
 * cuesta que la transacción no salga y que la persona se quede mirando una
 * pantalla que dice «enviando» sin que pase nada.
 *
 * No es una estimación: `enviar.ts` pide la de verdad antes de firmar. Esta es
 * la que usa el botón «Todo» para escribir un número en la casilla.
 */
export const RESERVA_GAS = 5_000_000_000_000_000n;

/* ── lo que se escribe en la casilla ─────────────────────────────────────── */

/**
 * «1,5» → 1500000000000000000n. `null` si eso no es una cantidad.
 *
 * Se acepta la coma porque la app está en español y el teclado numérico de
 * Android saca coma: rechazar «1,5» por no ser «1.5» sería culpar a la persona
 * de la tecla que le pusimos delante.
 */
export function aWei(texto: string, decimales = 18): bigint | null {
  const limpio = texto.trim().replace(/\s/g, '').replace(',', '.');
  if (!limpio || limpio === '.' || !/^\d*\.?\d*$/.test(limpio)) return null;
  try {
    return parseUnits(limpio, decimales);
  } catch {
    return null;
  }
}

/** Cuánto se puede mandar como mucho, dejando el gas si hace falta. */
export function maximo(moneda: Moneda, saldoMon: bigint, saldoPanal: bigint): bigint {
  if (moneda === '$PANAL') return saldoPanal;
  return saldoMon > RESERVA_GAS ? saldoMon - RESERVA_GAS : 0n;
}

/* ── revisar antes de firmar ─────────────────────────────────────────────── */

export interface Envio {
  moneda: Moneda;
  /** Tal cual está escrito en la casilla. */
  importe: string;
  destino: string;
  /** La wallet que manda. */
  mio: string;
  saldoMon: bigint;
  saldoPanal: bigint;
}

/**
 * Qué es lo que impide firmar, o lo que conviene saber.
 *
 * Claves y no frases: esta función decide si un envío se puede firmar, y esa
 * decisión es la misma en los cuatro idiomas. Con la frase dentro, el test
 * comprobaba la redacción en vez de la regla. La pantalla las escribe.
 */
export type Pega =
  | 'sin-destino'
  | 'destino-malo'
  | 'destino-soy-yo'
  | 'sin-cantidad'
  | 'cantidad-mala'
  | 'cantidad-cero'
  | 'no-hay-tanto'
  | 'deja-gas'
  | 'sin-mon-para-gas';

export type AvisoEnvio = 'poco-mon';

export interface Revision {
  /** Si se puede firmar. */
  ok: boolean;
  /** La cantidad ya en unidades mínimas; 0n si no se entiende. */
  wei: bigint;
  /** Lo que lo impide. `null` si no hay nada. */
  pega: Pega | null;
  /** Lo que conviene saber pero no lo impide. */
  aviso: AvisoEnvio | null;
}

/**
 * Todo lo que puede salir mal, en el orden en que le importa a quien manda.
 *
 * Primero el destino: equivocarse ahí es lo único irreversible de esta
 * pantalla. Después la cantidad. Y al final el gas, que es el fallo que más
 * desconcierta —tener 1.000 $PANAL y que no salgan porque faltan dos céntimos
 * de MON— y por eso se dice con todas las letras en vez de dejar que reviente
 * el nodo.
 */
export function revisar(e: Envio): Revision {
  const wei = aWei(e.importe) ?? 0n;
  const saldo = e.moneda === '$PANAL' ? e.saldoPanal : e.saldoMon;
  const no = (pega: Pega): Revision => ({ ok: false, wei, pega, aviso: null });

  const destino = e.destino.trim();
  if (!destino) return no('sin-destino');
  if (!isAddress(destino, { strict: false })) return no('destino-malo');
  if (destino.toLowerCase() === e.mio.trim().toLowerCase()) return no('destino-soy-yo');

  if (!e.importe.trim()) return no('sin-cantidad');
  if (aWei(e.importe) === null) return no('cantidad-mala');
  if (wei === 0n) return no('cantidad-cero');
  if (wei > saldo) return no('no-hay-tanto');

  // El gas se paga en MON siempre, se mande lo que se mande.
  if (e.moneda === 'MON' && wei > maximo('MON', e.saldoMon, e.saldoPanal)) return no('deja-gas');
  if (e.moneda === '$PANAL' && e.saldoMon === 0n) return no('sin-mon-para-gas');

  const aviso: AvisoEnvio | null =
    e.moneda === '$PANAL' && e.saldoMon < RESERVA_GAS ? 'poco-mon' : null;

  return { ok: true, wei, pega: null, aviso };
}

/* ── importar una wallet de fuera ────────────────────────────────────────── */

/**
 * Deja la frase como la espera BIP-39: minúsculas y un espacio entre palabras.
 *
 * Se borra todo lo que no sea una letra a propósito. Las doce palabras se
 * copian de sitios que las numeran («1. abandon 2. ability»), las pegan con
 * comas o las meten en una tabla, y hacer que la persona limpie eso a mano en
 * el teclado del móvil es pedirle que se equivoque.
 */
export function limpiarFrase(texto: string): string {
  return texto
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Una clave privada suelta, con o sin `0x`. `null` si no lo es. */
export function limpiarClave(texto: string): `0x${string}` | null {
  const s = texto.trim().replace(/\s/g, '');
  const hex = /^0[xX]/.test(s) ? s.slice(2) : s;
  return /^[0-9a-fA-F]{64}$/.test(hex) ? (`0x${hex.toLowerCase()}` as `0x${string}`) : null;
}

/** Cuántas palabras admite BIP-39. Doce es lo normal; 24 lo usan las frías. */
const LARGOS = [12, 15, 18, 21, 24];

/**
 * Qué ha pegado la persona, mirando solo la forma.
 *
 * No dice si es válido —eso lo comprueba viem con la suma de control, y por
 * eso no se repite aquí—: dice cuál de los dos caminos hay que intentar, para
 * que el mensaje de error hable de lo que la persona creía estar pegando.
 */
export function claseDeSecreto(texto: string): 'palabras' | 'clave' | null {
  if (limpiarClave(texto)) return 'clave';
  const n = limpiarFrase(texto).split(' ').filter(Boolean).length;
  return LARGOS.includes(n) ? 'palabras' : null;
}

/**
 * Si esas palabras son de verdad una frase BIP-39.
 *
 * ESTO NO ES UN ADORNO. `mnemonicToAccount` de viem NO comprueba la suma de
 * control: con la última palabra cambiada devuelve tan contenta una dirección
 * distinta —comprobado— y la persona se quedaría mirando una wallet vacía sin
 * entender por qué, convencida de haber importado la suya. La suma de control
 * existe justo para eso: doce palabras de la lista, en el orden equivocado,
 * fallan.
 *
 * Cómo va: cada palabra son 11 bits (2048 = 2¹¹). De los N·11 bits, los
 * últimos N/3 no son entropía, son los primeros bits del SHA-256 de la
 * entropía. Se rehace el SHA-256 y se comparan.
 */
export function validarPalabras(frase: string): boolean {
  const palabras = limpiarFrase(frase).split(' ').filter(Boolean);
  if (!LARGOS.includes(palabras.length)) return false;

  let bits = '';
  for (const p of palabras) {
    const i = english.indexOf(p);
    if (i < 0) return false;
    bits += i.toString(2).padStart(11, '0');
  }

  const control = palabras.length / 3;
  const entropia = bits.slice(0, bits.length - control);
  const bytes = new Uint8Array(entropia.length / 8);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(entropia.slice(i * 8, i * 8 + 8), 2);

  const resumen = sha256(bytes).slice(2);
  let esperado = '';
  for (const c of resumen) {
    esperado += parseInt(c, 16).toString(2).padStart(4, '0');
    if (esperado.length >= control) break;
  }

  return esperado.slice(0, control) === bits.slice(bits.length - control);
}
