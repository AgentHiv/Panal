import { formatEther, formatUnits } from 'viem';

/**
 * Cuántos decimales necesita una cantidad para no mentir.
 *
 * ESTO ARREGLA UN FALLO DE VERDAD. Antes cada sitio elegía su número fijo y el
 * más repetido era CERO —`dinero(importe, 0)`— en la tarjeta del encargo, en el
 * botón de bloquear el dinero, en el de aprobar el pago y en los avisos del
 * teléfono. Con un encargo de 0,5 MON eso ponía «Bloquear 1 MON»: no es que se
 * viera feo, es que decía otra cantidad que la que se iba a firmar. Y con 0,4
 * ponía «Bloquear 0 MON».
 *
 * Por debajo de 1 hacen falta cuatro decimales: una comisión del 2,5 % sobre
 * 0,5 son 0,0125, y con dos saldría 0,01. De 1 en adelante bastan dos.
 *
 * NO hay un tramo «grande, sin decimales». Lo probé y lo quité: con él un
 * encargo de 1.284,5 salía como «1.285», medio MON de más en la pantalla donde
 * se firma. Da igual que la desviación relativa sea ridícula —medio MON es
 * medio MON— y ahorrar dos caracteres no compra nada.
 *
 * `minimumFractionDigits: 0` remata: 100 se escribe «100», no «100,00».
 */
function decimalesPara(n: number): number {
  return n >= 1 ? 2 : 4;
}

function escribir(n: number): string {
  return n.toLocaleString('es-ES', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimalesPara(n),
  });
}

/**
 * Una cantidad de dinero en unidades mínimas, como la escribe un español y sin
 * redondearla a algo que no es.
 *
 * Nunca devuelve «0» para algo que no es cero: por debajo de lo que se puede
 * escribir dice «menos de», porque un cero delante de alguien que está a punto
 * de firmar es peor que un número largo.
 */
export function monto(wei: bigint | string): string {
  const n = Number(formatEther(typeof wei === 'string' ? BigInt(wei) : wei));
  if (n === 0) return '0';
  if (n < 0.0001) return '<0,0001';
  return escribir(n);
}

/**
 * Lo mismo, pero para una COLUMNA de cifras.
 *
 * `monto` sigue el es-ES de Intl, que no agrupa los números de cuatro dígitos:
 * es lo correcto para una cantidad suelta y lo que recomienda la RAE. En una
 * cascada de cuentas produce esto:
 *
 *     Facturado           110.050
 *     Comisión de Panal   2188,75      ← se sale de la columna
 *     Tuyo                85.361,25
 *
 * Ahí el separador deja de ser ortografía y pasa a ser alineación, que es
 * justo el caso en que sí se pone. Solo para tablas: en un botón de firmar se
 * usa `monto`, que es el que decide toda la app.
 */
export function montoCuadro(wei: bigint | string): string {
  const n = Number(formatEther(typeof wei === 'string' ? BigInt(wei) : wei));
  if (n === 0) return '0';
  if (n < 0.0001) return '<0,0001';
  return n.toLocaleString('es-ES', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimalesPara(n),
    useGrouping: 'always',
  });
}

/**
 * «hace un momento», «17:42», «ayer», «mar».
 *
 * La bandeja necesita que la hora quepa en un hueco estrecho y que se entienda
 * de un vistazo; una fecha completa no cumple ni lo uno ni lo otro.
 */
export function cuando(ms: number, ahora = Date.now()): string {
  const seg = Math.floor((ahora - ms) / 1000);
  if (seg < 60) return 'ahora';
  const dia = new Date(ms);
  const hoy = new Date(ahora);
  const mismoDia = dia.toDateString() === hoy.toDateString();
  if (mismoDia) return dia.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  const ayer = new Date(ahora - 86_400_000);
  if (dia.toDateString() === ayer.toDateString()) return 'ayer';
  if (seg < 7 * 86_400) return dia.toLocaleDateString('es-ES', { weekday: 'short' }).slice(0, 3);
  return dia.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
}

/**
 * Lo que queda para que el escrow se libere solo.
 *
 * Existe porque callarse NO es neutral: a los tres días de la entrega
 * `autoRelease` lo cobra cualquiera y deja un 5 registrado. Si la app no
 * cuenta ese tiempo, no lo cuenta nadie.
 */
export const AUTO_RELEASE_MS = 3 * 24 * 60 * 60 * 1000;

export function restante(entregadoMs: number, ahora = Date.now()): string {
  const queda = entregadoMs + AUTO_RELEASE_MS - ahora;
  if (queda <= 0) return 'ya se puede liberar';
  const h = Math.floor(queda / 3_600_000);
  if (h >= 24) {
    const d = Math.floor(h / 24);
    return `${d} d ${h - d * 24} h`;
  }
  if (h >= 1) return `${h} h`;
  return `${Math.max(1, Math.floor(queda / 60_000))} min`;
}

/**
 * Un precio en MON o en $PANAL, en español y sin redondear a cero.
 *
 * `formatMon(x, 0)` —lo que se usaba— hace `toFixed(0)`, así que un agente que
 * cobra 0,5 MON por tarea salía en el mercado como «0 MON / tarea»: gratis. Y
 * no era un agente: eran cuatro de los cinco que hay, porque casi todos cobran
 * menos de 1.
 *
 * Los decimales dependen del tamaño, que es como se escriben los precios: tres
 * por debajo de 1 (0,005 tiene que poder verse), dos hasta 100, ninguno por
 * encima. Devuelve `null` cuando de verdad no hay precio, para que quien lo
 * pinta diga eso y no un número.
 */
export function precio(n: number): string | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 0.0001) return '<0,0001';
  return escribir(n);
}

/**
 * La cantidad EXACTA, sin redondear ni una cifra.
 *
 * Existe por un fallo que se vio en una foto: la pantalla de confirmar decía
 * «2,00 MON» cuando lo que se iba a firmar eran 1,995 —lo que deja el botón
 * «Todo» tras apartar el gas—. `monto` redondea a dos decimales de 1 en
 * adelante, que está bien para leer un precio y está MAL para lo último que
 * alguien mira antes de mandar dinero. Aquí no se redondea nada: se enseñan
 * todas las cifras que tenga.
 */
export function exacto(wei: bigint, decimales = 18): string {
  const [entera, decimal] = formatUnits(wei, decimales).split('.');
  const miles = entera.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return decimal ? `${miles},${decimal}` : miles;
}

/**
 * Una dirección en grupos de cuatro.
 *
 * Es como se comprueba una dirección a ojo sin perder el sitio, y además
 * parte por los grupos al llegar al borde en vez de dejar una cifra suelta
 * en la línea siguiente.
 */
export function troceada(dir: string): string {
  return `0x ${dir.slice(2).replace(/(.{4})/g, '$1 ').trim()}`;
}

/**
 * Un saldo se lee de un vistazo o no se lee.
 *
 * Dos decimales para las cantidades normales; cuatro solo cuando con dos
 * saldría «0,00» teniendo algo, que es peor que un número largo: parece que no
 * tienes nada.
 *
 * SE CORTA, NO SE REDONDEA. `toLocaleString` redondea al más cercano, y eso
 * hacía que 1,995 MON se enseñaran como «2,00»: la pantalla decía que tienes
 * más de lo que tienes, y al escribir esa cifra saltaba un «no hay tanto» que
 * parece un fallo de la app. Un saldo puede quedarse corto; no puede pasarse.
 *
 * Los miles se agrupan a mano porque el español NO agrupa cuatro cifras por
 * defecto: sin eso, mil salía «1000,00» y diez mil «10.000,00», y los saldos
 * del llavero —uno debajo de otro, MON al lado de $PANAL— quedaban
 * desalineados justo donde hay que comparar dos cantidades de un vistazo.
 */
export function conDecimales(bruto: bigint, decimales: number): string {
  if (bruto === 0n) return '0';
  const [entera, decimal = ''] = formatUnits(bruto, decimales).split('.');
  const cuantos = Number(`${entera}.${decimal}`) < 0.01 ? 4 : 2;
  const cortada = decimal.slice(0, cuantos).padEnd(cuantos, '0');
  // Algo que existe pero no cabe ni en cuatro decimales no es un cero.
  if (entera === '0' && /^0+$/.test(cortada)) return '<0,0001';
  const miles = entera.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${miles},${cortada}`;
}
