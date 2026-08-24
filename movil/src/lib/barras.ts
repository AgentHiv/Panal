/**
 * Panal — lo cobrado mes a mes, listo para dibujar.
 *
 * Va aparte del componente y sin nada de React a propósito: aquí está lo que
 * se puede equivocar en silencio —qué mes es cada cosa, qué meses faltan, qué
 * altura le toca a cada barra— y eso se prueba en Node (`test/barras.test.mjs`)
 * en vez de mirándolo.
 *
 * LOS MESES VACÍOS SE DIBUJAN, y es la decisión que importa. `periodosDe` solo
 * devuelve los meses en que se cobró algo, que está bien para una lista de
 * chips y MIENTE en un gráfico: tres meses cobrando y dos parado saldrían como
 * cinco barras seguidas, o sea como si no hubiera parado nunca. Un hueco tiene
 * que verse como un hueco.
 *
 * Y NO se mezclan monedas. Cada `Cuentas` trae la suya; sumar MON con $PANAL
 * daría una barra que no significa nada.
 */

import type { Cuentas } from '~/lib/cuentas';

export interface Barra {
  /** `2026-08`, que ordena solo y sirve de key. */
  clave: string;
  anio: number;
  /** 1-12, como lo dice la gente. */
  mes: number;
  /** Lo que se quedó el agente ese mes, en unidades mínimas. */
  neto: bigint;
  /** Cuántos encargos se liquidaron. Un mes puede tener importe y un encargo. */
  cuantos: number;
  /** De 0 a 1 contra el mes más alto. Es la altura, ya calculada. */
  alto: number;
}

/**
 * Los últimos `cuantos` meses, con los vacíos incluidos.
 *
 * Se cuenta hacia atrás desde el mes MÁS RECIENTE con datos y no desde hoy: si
 * un agente lleva medio año parado, contar desde hoy daría seis barras vacías
 * y ninguna cifra. Lo que interesa es su historia, no el calendario.
 */
export function porMes(c: Cuentas, cuantos = 6, ahora = Date.now()): Barra[] {
  if (c.lineas.length === 0) return [];

  const suma = new Map<string, { neto: bigint; cuantos: number }>();
  for (const l of c.lineas) {
    const d = new Date(l.ts * 1000);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const a = suma.get(k) ?? { neto: 0n, cuantos: 0 };
    suma.set(k, { neto: a.neto + l.pagado, cuantos: a.cuantos + 1 });
  }

  // El último mes con algo, o este si ya pasó — no se dibuja el futuro.
  const ultimo = [...suma.keys()].sort().pop()!;
  const [ua, um] = ultimo.split('-').map(Number);
  const hoy = new Date(ahora);
  const final =
    new Date(ua!, um! - 1, 1) > hoy ? { a: hoy.getFullYear(), m: hoy.getMonth() + 1 } : { a: ua!, m: um! };

  const barras: Barra[] = [];
  for (let i = cuantos - 1; i >= 0; i--) {
    const d = new Date(final.a, final.m - 1 - i, 1);
    const anio = d.getFullYear();
    const mes = d.getMonth() + 1;
    const clave = `${anio}-${String(mes).padStart(2, '0')}`;
    const v = suma.get(clave) ?? { neto: 0n, cuantos: 0 };
    barras.push({ clave, anio, mes, neto: v.neto, cuantos: v.cuantos, alto: 0 });
  }

  return conAltura(barras);
}

/**
 * La altura de cada barra, de 0 a 1.
 *
 * Se divide en `Number` y no en `bigint` porque una división entera daría 0
 * para todo lo que no llegue al máximo — que es casi todo. Se pierde precisión
 * y da igual: esto es la altura de una barra en píxeles, no una cantidad de
 * dinero. Las cifras se escriben desde el `bigint`, sin pasar por aquí.
 */
function conAltura(barras: Barra[]): Barra[] {
  const mayor = barras.reduce((m, b) => (b.neto > m ? b.neto : m), 0n);
  if (mayor === 0n) return barras;
  return barras.map((b) => ({ ...b, alto: Number(b.neto) / Number(mayor) }));
}

/** El mes más alto, para poner la cifra de referencia arriba. */
export function techo(barras: Barra[]): bigint {
  return barras.reduce((m, b) => (b.neto > m ? b.neto : m), 0n);
}

/**
 * Cuánto se movió respecto al mes anterior, en tanto por uno.
 *
 * `null` cuando no se puede decir: sin mes previo, o con el previo a cero
 * —dividir por cero daría infinito, y «subió un ∞ %» no es una cifra que se
 * pueda enseñar—. Quien lo pinta tiene que saber callarse.
 */
export function variacion(barras: Barra[]): number | null {
  if (barras.length < 2) return null;
  const ultima = barras[barras.length - 1]!;
  const previa = barras[barras.length - 2]!;
  if (previa.neto === 0n) return null;
  return (Number(ultima.neto) - Number(previa.neto)) / Number(previa.neto);
}
