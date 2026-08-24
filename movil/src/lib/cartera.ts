/**
 * Panal — la cartera: varios agentes vistos a la vez.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ESTO ES DE MIRAR, Y NO ES UNA LIMITACIÓN DE LA PANTALLA.
 *
 * `updatePrice`, `setActive` y `updateMetadata` actúan sobre `msg.sender`, así
 * que una wallet solo puede mandar sobre sí misma. Cobrar es igual:
 * `withdraw(token)` paga a quien firma. Mandar sobre varios agentes desde una
 * wallet no se puede hoy, y una pantalla no lo arregla.
 *
 * Lo que sí se puede es VER, y eso no necesita firmar nada: la ficha y el
 * dinero de cada agente son públicos. De ahí que esta pantalla no tenga ni un
 * botón que mueva dinero — y que el número que enseña no sea «1 firma» sino
 * cuántas hacen falta de verdad, que hoy es una por agente y moneda.
 * ───────────────────────────────────────────────────────────────────────────
 */

export interface FilaCartera {
  direccion: string;
  nombre: string;
  registrado: boolean;
  activo: boolean;
  precio: bigint;
  moneda: string;
  conEndpoint: boolean;
  /** Ganado y todavía dentro del depósito. */
  panal: bigint;
  mon: bigint;
  /** Encargos abiertos sin entregar, de los que ya vencieron su plazo. */
  vencidos: number;
  /** Encargos abiertos sin entregar, en plazo. */
  abiertos: number;
}

export interface Totales {
  panal: bigint;
  mon: bigint;
  /**
   * Cuántas firmas hacen falta para recogerlo todo.
   *
   * Una por agente y por moneda con saldo, cada una desde la wallet de ESE
   * agente. Es el número que hace visible el coste de no tener dueño separado
   * del agente — y por eso se cuenta en vez de escribir «18» a mano.
   */
  firmas: number;
  activos: number;
  pausados: number;
  /** Agentes con algo abierto y el plazo ya pasado. */
  enRiesgo: number;
}

/**
 * Cuál de los avisos posibles toca, si toca alguno.
 *
 * Devuelve la CLAVE y no la frase. No es un rodeo: esta función decide cuál es
 * el problema más grave de una fila, y esa decisión es la misma en los cuatro
 * idiomas. Con la frase dentro, la prueba comprobaba la redacción —que cambia—
 * en vez de la decisión —que no—; ahora comprueba lo que de verdad importa.
 *
 * Solo una cosa por fila: la más grave. Una tarjeta con tres avisos no se lee,
 * y la lista está para recorrerla con el pulgar.
 */
export type Aviso =
  | { clave: 'sin-registrar' }
  | { clave: 'vencidos'; n: number }
  | { clave: 'pausado-con-dinero' }
  | { clave: 'pausado-con-dinero-sin-endpoint' }
  | { clave: 'pausado' }
  | { clave: 'sin-endpoint' }
  | { clave: 'abiertos'; n: number };

export function avisar(f: FilaCartera): Aviso | null {
  if (!f.registrado) return { clave: 'sin-registrar' };

  if (f.vencidos > 0) return { clave: 'vencidos', n: f.vencidos };

  const conDinero = f.panal > 0n || f.mon > 0n;

  if (!f.activo && conDinero) {
    return { clave: f.conEndpoint ? 'pausado-con-dinero' : 'pausado-con-dinero-sin-endpoint' };
  }
  if (!f.activo && !conDinero) return { clave: 'pausado' };
  // Activo y sin endpoint: aparece en el mercado, pero nadie puede hablarle.
  if (!f.conEndpoint) return { clave: 'sin-endpoint' };
  if (f.abiertos > 0) return { clave: 'abiertos', n: f.abiertos };
  return null;
}

/** Gravedad del aviso, para pintarlo. `null` cuando no hay nada que decir. */
export function tono(f: FilaCartera): 'rojo' | 'miel' | 'gris' | null {
  if (!f.registrado || f.vencidos > 0) return 'rojo';
  if (!f.activo) return f.panal > 0n || f.mon > 0n ? 'miel' : 'gris';
  if (!f.conEndpoint) return 'miel';
  if (f.abiertos > 0) return 'gris';
  return null;
}

export function totales(filas: FilaCartera[]): Totales {
  let panal = 0n;
  let mon = 0n;
  let firmas = 0;
  let activos = 0;
  let pausados = 0;
  let enRiesgo = 0;

  for (const f of filas) {
    panal += f.panal;
    mon += f.mon;
    // Una firma por moneda con saldo. Un agente con las dos cuenta dos.
    if (f.panal > 0n) firmas++;
    if (f.mon > 0n) firmas++;
    if (f.registrado && f.activo) activos++;
    if (f.registrado && !f.activo) pausados++;
    if (f.vencidos > 0) enRiesgo++;
  }

  return { panal, mon, firmas, activos, pausados, enRiesgo };
}
