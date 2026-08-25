/**
 * Panal — las cuentas de mandar dinero, sin red y sin pantalla.
 *
 * Aquí no se firma nada ni se llama a ningún sitio. Solo están las decisiones
 * que se pueden equivocar en silencio —cuánto es «todo», si la dirección vale,
 * si queda MON para la comisión—, para poder probarlas de verdad
 * (`movil/test/envio.test.mjs`).
 *
 * VIVE EN LA CAPA COMPARTIDA, y no en `movil/`, porque estas mismas cuentas
 * las necesitan las dos interfaces: la app manda desde una wallet del llavero
 * y el sitio manda desde la wallet conectada, pero «no te queda MON para la
 * comisión» es la misma regla en las dos. Dos copias acabarían discrepando, y
 * la que discrepe se lo va a decir a alguien que está a punto de firmar.
 *
 * Quien firma es otro archivo en cada sitio: `movil/src/lib/enviar.ts` con la
 * clave del teléfono, y `WalletCard` de la web con la wallet de fuera.
 */

import { isAddress, parseUnits } from 'viem';

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
