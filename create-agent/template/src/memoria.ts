/**
 * La memoria de una conversación.
 *
 * Sin esto, cada llamada x402 es independiente: el cliente pregunta algo, tu
 * agente contesta, y a la siguiente no sabe de qué se hablaba. Eso no es un
 * chat, es un buscador que pasa factura — y quien lo usa lo nota al segundo
 * mensaje, cuando tiene que repetir el contexto entero.
 *
 * QUIÉN HABLA LO DICE EL PAGO. La conversación se guarda por la dirección del
 * pagador, y esa dirección no la afirma nadie: firmó un permiso y el cobro se
 * ejecutó en la cadena. Nadie puede leer ni continuar la conversación de otro
 * sin haber pagado como él, así que no hace falta ninguna autenticación
 * aparte. Es la propiedad más útil de cobrar por llamada.
 *
 * SOLO EN x402, NO EN EL ESCROW. Un encargo del escrow es un trabajo con
 * principio y fin: se paga, se entrega una vez y se aprueba. Arrastrarle
 * memoria sería confundir dos cosas distintas.
 *
 * LO QUE CUESTA, porque conviene tenerlo delante: el historial va dentro del
 * prompt, y el prompt lo pagas TÚ mientras el cliente paga un precio fijo por
 * mensaje. Una conversación larga es cada vez más cara de contestar por lo
 * mismo. De ahí los dos topes de abajo, y de ahí que se puedan bajar.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Un intercambio ya cerrado: lo que preguntaron y lo que contestaste. */
export interface Turno {
  pregunta: string;
  respuesta: string;
  /** Epoch en milisegundos. */
  cuando: number;
}

/**
 * Cuántos turnos se recuerdan. `MEMORIA_TURNOS=0` apaga la memoria.
 *
 * Seis es un número corto a propósito: cubre una conversación normal y deja
 * el coste acotado. Súbelo si tu agente necesita hilos largos y te sale a
 * cuenta; bájalo a cero si lo tuyo son preguntas sueltas.
 */
const TURNOS = (() => {
  const n = Number(process.env.MEMORIA_TURNOS?.trim() || '6');
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 6;
})();

/**
 * Tope de caracteres del historial que entra en el prompt.
 *
 * El tope de turnos por sí solo no acota nada: seis turnos pueden ser seis
 * líneas o seis pantallas de código pegado.
 */
const MAX_CHARS = (() => {
  const n = Number(process.env.MEMORIA_CHARS?.trim() || '4000');
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 4000;
})();

/** Cuántos turnos se guardan en disco, que es más de lo que se manda. */
const GUARDADOS = 60;

/**
 * El archivo de una conversación.
 *
 * El nombre sale de la dirección, y aunque venga ya validada como tal se
 * limpia igual: es lo que decide una ruta en disco, y una comprobación de más
 * en un sitio así no cuesta nada.
 */
function archivo(dataDir: string, quien: string): string {
  const limpio = quien.toLowerCase().replace(/[^a-z0-9x]/g, '');
  return join(dataDir, 'chats', `${limpio}.json`);
}

/** Todo lo que se recuerda de esa persona, de lo más viejo a lo más nuevo. */
export function leerConversacion(dataDir: string, quien: string): Turno[] {
  try {
    const turnos = JSON.parse(readFileSync(archivo(dataDir, quien), 'utf8')) as Turno[];
    return Array.isArray(turnos) ? turnos : [];
  } catch {
    // Sin archivo, o con un archivo ilegible: se empieza de cero. Una memoria
    // rota no puede impedir contestar a alguien que acaba de pagar.
    return [];
  }
}

/**
 * Guarda un intercambio.
 *
 * Se llama DESPUÉS de contestar, con las dos mitades: un turno con pregunta y
 * sin respuesta ensucia la memoria de la siguiente vez, y es justo lo que
 * pasaría si se guardara antes de trabajar y el modelo fallara.
 */
export function recordarTurno(dataDir: string, quien: string, turno: Turno): void {
  if (TURNOS === 0) return;
  try {
    const previos = leerConversacion(dataDir, quien);
    mkdirSync(join(dataDir, 'chats'), { recursive: true });
    writeFileSync(archivo(dataDir, quien), JSON.stringify([...previos, turno].slice(-GUARDADOS)), 'utf8');
  } catch (err) {
    // Perder la memoria no puede tumbar una respuesta ya cobrada.
    console.error(`[memoria] no se pudo guardar el turno: ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * El historial que se le pasa al modelo, ya acotado.
 *
 * Se recorta desde el final: lo reciente es lo que da contexto, y lo viejo es
 * lo primero que sobra. Devuelve vacío con la memoria apagada.
 */
export function historialParaElModelo(dataDir: string, quien: string): Turno[] {
  if (TURNOS === 0) return [];

  const recientes = leerConversacion(dataDir, quien).slice(-TURNOS);
  const salida: Turno[] = [];
  let chars = 0;

  // Se recorren del más nuevo al más viejo para que, si hay que dejar fuera
  // algo, sea lo antiguo. Luego se devuelve en orden cronológico.
  for (let i = recientes.length - 1; i >= 0; i--) {
    const t = recientes[i]!;
    const coste = t.pregunta.length + t.respuesta.length;
    if (chars + coste > MAX_CHARS) break;
    chars += coste;
    salida.unshift(t);
  }
  return salida;
}

/** Cómo se le cuenta el historial al modelo. Vacío si no hay nada que contar. */
export function historialComoTexto(turnos: Turno[]): string {
  if (turnos.length === 0) return '';
  return turnos
    .map((t) => `Cliente: ${t.pregunta}\nTú: ${t.respuesta}`)
    .join('\n\n');
}
