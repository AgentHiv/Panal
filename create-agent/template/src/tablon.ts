/**
 * ────────────────────────────────────────────────────────────────────────────
 *  El tablón: coger solo, sin que nadie haga clic, los encargos que encajen.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * QUÉ ES EL TABLÓN. Un cliente puede pagar un encargo SIN elegir agente
 * (`createTask` con `worker = address(0)`) y colgar un anuncio público. Lo coge
 * el primer agente activo que llame a `claimTask`. Hasta ahora solo podía
 * hacerlo una persona desde la web; el tablón se pensó para que lo hiciera un
 * programa.
 *
 * APAGADO POR DEFECTO, Y A PROPÓSITO. Coger un encargo es comprometerse a
 * entregarlo antes del plazo, con el dinero de un desconocido bloqueado. Eso no
 * se activa solo por actualizar la plantilla: se enciende con `TABLON=on`.
 *
 * QUÉ COGE. Solo lo que cumple las cuatro cosas:
 *   - no lo publicó este mismo agente;
 *   - paga en la moneda de este agente y AL MENOS lo que cobra por un encargo en
 *     el registro: el agente ya decidió su precio, y el tablón no lo rebaja;
 *   - le queda plazo de sobra (`TABLON_MARGEN_MINUTOS`);
 *   - su anuncio menciona alguna de sus habilidades —las de su ficha en la
 *     cadena, más `TABLON_PALABRAS`—. Es una regla simple a propósito: el
 *     encargo de verdad solo se puede leer DESPUÉS de cogerlo, así que lo único
 *     con qué decidir es el anuncio, y un emparejamiento predecible es mejor que
 *     uno listo que nadie sabe explicar.
 * Y de lo que encaja, uno por ronda: el que más paga.
 *
 * CÓMO LO TRABAJA. Con el mismo `work()` que un encargo normal: guarda el
 * encargo en disco, lo trabaja, SIRVE la entrega desde este servidor y ancla su
 * hash. El cliente recoge la entrega del `bot:` que el trabajador publica, como
 * en cualquier encargo, así que la entrega vive aquí y no en el tablón. Y como
 * el encargo queda en disco y la tarea asignada a este agente en la cadena, si
 * el proceso muere a mitad el vigilante lo retoma.
 *
 * LA WALLET, DE UNA EN UNA. `claimTask` es una transacción. Con un encargo en
 * marcha la ronda se salta, y después de coger se espera antes de trabajar: dos
 * transacciones seguidas de la misma wallet chocan por el nonce, y en Monad una
 * lanzada justo detrás de otra revierte. El gas de `claimTask` lo fija el SDK a
 * mano desde la 0.18.3: sin eso, Monad cobra un límite inflado entero.
 */

import type { Address } from 'viem';
import { formatEther } from 'viem';
import type { EncargoDelTablon, PanalClient } from '@panal/sdk';

export interface OpcionesTablon {
  /** Cada cuánto se mira el tablón, en minutos. */
  minutos: number;
  /** Plazo que tiene que quedar, como mínimo, para cogerlo. */
  margenMinutos: number;
  /** Palabras que cuentan como encaje, además de las habilidades de la ficha. */
  palabras: string[];
}

export const TABLON_POR_DEFECTO: OpcionesTablon = {
  minutos: 5,
  margenMinutos: 30,
  palabras: [],
};

/**
 * Las opciones del .env, o `null` si está apagado — que es lo normal.
 *
 * Solo `TABLON=on` lo enciende. Un valor numérico que no se entiende no apaga
 * nada ni lanza: se usa el de por defecto y se dice en el log.
 */
export function opcionesDelEntorno(
  env: Record<string, string | undefined>,
  avisar: (m: string) => void = (m) => console.warn(m),
): OpcionesTablon | null {
  if (env.TABLON?.trim().toLowerCase() !== 'on') return null;
  const o: OpcionesTablon = { ...TABLON_POR_DEFECTO, palabras: [] };

  if (env.TABLON_MINUTOS?.trim()) {
    const n = Number(env.TABLON_MINUTOS);
    if (Number.isFinite(n) && n >= 1) o.minutos = n;
    else avisar(`[tablon] TABLON_MINUTOS="${env.TABLON_MINUTOS}" no vale (mínimo 1): uso ${o.minutos}.`);
  }
  if (env.TABLON_MARGEN_MINUTOS?.trim()) {
    const n = Number(env.TABLON_MARGEN_MINUTOS);
    if (Number.isFinite(n) && n >= 5) o.margenMinutos = n;
    else avisar(`[tablon] TABLON_MARGEN_MINUTOS="${env.TABLON_MARGEN_MINUTOS}" no vale (mínimo 5): uso ${o.margenMinutos}.`);
  }
  if (env.TABLON_PALABRAS?.trim()) {
    o.palabras = env.TABLON_PALABRAS.split(',').map((p) => p.trim()).filter(Boolean);
  }
  return o;
}

/** Sin tildes, en minúsculas, y con guiones y barras como espacios. */
function plano(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[-_/]+/g, ' ');
}

/**
 * ¿Menciona el anuncio alguna de estas palabras?
 *
 * Palabra entera, no trozo: «test» no encaja con «testimonio», y «ai» no encaja
 * con cualquier palabra que contenga esas dos letras. Una palabra de menos de
 * tres letras no cuenta: son justo las que aparecen por casualidad.
 */
export function encaja(anuncio: string, palabras: string[]): boolean {
  const texto = ` ${plano(anuncio).replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
  return palabras.some((p) => {
    const q = plano(p).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    return q.length >= 3 && texto.includes(` ${q} `);
  });
}

export interface DepsTablon {
  panal: PanalClient;
  yo: Address;
  opciones: OpcionesTablon;
  /** Lo que este agente cobra por un encargo en el registro, y en qué moneda. */
  precio: { amount: bigint; currency: Address };
  /** Sus habilidades, de la ficha en la cadena. */
  habilidades: string[];
  /** ¿Hay un encargo en marcha? Entonces no se toca la wallet. */
  ocupado: () => boolean;
  /** Marca la wallet como ocupada mientras se coge y se trabaja. */
  marcar: (ocupada: boolean) => void;
  /** El `work()` de la plantilla: trabaja, sirve y ancla. */
  trabajar: (taskId: bigint, brief: string) => Promise<string>;
  /** Pausa entre coger y trabajar. Inyectable para las pruebas. */
  esperar?: (ms: number) => Promise<void>;
  log?: (m: string) => void;
}

/** Lo que se puede coger de lo que hay publicado, del que más paga al que menos. */
export function candidatos(
  lista: EncargoDelTablon[],
  deps: Pick<DepsTablon, 'yo' | 'precio' | 'habilidades' | 'opciones'>,
  ahoraS: number,
): EncargoDelTablon[] {
  const palabras = [...deps.habilidades, ...deps.opciones.palabras];
  return lista
    .filter((e) => e.cliente.toLowerCase() !== deps.yo.toLowerCase())
    .filter((e) => e.currency.toLowerCase() === deps.precio.currency.toLowerCase())
    .filter((e) => e.amount >= deps.precio.amount)
    .filter((e) => Number(e.deadline) - ahoraS >= deps.opciones.margenMinutos * 60)
    .filter((e) => encaja(e.anuncio, palabras))
    .sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));
}

/**
 * Una ronda: mira el tablón y, si algo encaja, lo coge y lo trabaja.
 *
 * Devuelve lo que hizo, línea a línea, para las pruebas. Nunca lanza: un fallo
 * aquí no puede tumbar el agente que atiende sus encargos normales.
 */
export async function repasarTablon(deps: DepsTablon): Promise<string[]> {
  const log = deps.log ?? ((m: string) => console.log(m));
  const esperar = deps.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const hecho: string[] = [];
  const anotar = (m: string): void => {
    hecho.push(m);
    log(m);
  };

  if (deps.ocupado()) return hecho;

  let lista: EncargoDelTablon[];
  try {
    lista = await deps.panal.listBoard({ limit: 30 });
  } catch (err) {
    anotar(`[tablon] no se pudo leer el tablón: ${err instanceof Error ? err.message.split('\n')[0] : err}`);
    return hecho;
  }
  const elegido = candidatos(lista, deps, Math.floor(Date.now() / 1000))[0];
  if (!elegido) return hecho;

  deps.marcar(true);
  try {
    try {
      await deps.panal.claimTask(elegido.taskId);
    } catch (err) {
      // Lo normal aquí es que otro lo cogiera antes: el tablón es de quien llega
      // primero. No es un fallo del agente.
      anotar(`[tablon] #${elegido.taskId} no se pudo coger: ${err instanceof Error ? err.message.split('\n')[0] : err}`);
      return hecho;
    }
    anotar(
      `[tablon] #${elegido.taskId} cogido · ${formatEther(elegido.amount)} · «${elegido.anuncio.slice(0, 80)}»`,
    );

    // Dos transacciones seguidas de la misma wallet chocan en Monad.
    await esperar(15_000);

    let brief: string;
    try {
      brief = await deps.panal.readBoardBrief(elegido.taskId);
    } catch (err) {
      // Cogido y sin encargo: el cliente pagó pero no dejó el texto. El vigilante
      // lo seguirá avisando; aquí no hay nada más que hacer.
      anotar(`[tablon] #${elegido.taskId} cogido pero sin encargo que leer: ${err instanceof Error ? err.message.split('\n')[0] : err}`);
      return hecho;
    }

    const r = await deps.trabajar(elegido.taskId, brief);
    anotar(`[tablon] #${elegido.taskId} ${r === 'entregada' ? 'entregado' : `sin entregar todavía (${r}): lo retoma el vigilante`}`);
    return hecho;
  } catch (err) {
    anotar(`[tablon] #${elegido.taskId}: ${err instanceof Error ? err.message.split('\n')[0] : err}`);
    return hecho;
  } finally {
    deps.marcar(false);
  }
}

/**
 * Arranca las rondas. Lee de la cadena el precio y las habilidades de este
 * agente una vez, al arrancar: son los que decidió su dueño.
 */
export async function arrancarTablon(
  deps: Omit<DepsTablon, 'precio' | 'habilidades'>,
): Promise<void> {
  let precio: DepsTablon['precio'];
  let habilidades: string[];
  try {
    const ficha = await deps.panal.getAgent(deps.yo);
    if (!ficha.active) {
      console.warn('[tablon] este agente no está activo en el registro: claimTask lo rechazaría. Tablón apagado.');
      return;
    }
    precio = { amount: ficha.pricePerTask, currency: ficha.currency };
    habilidades = ficha.metadata.skills ?? [];
  } catch (err) {
    console.warn(`[tablon] no se pudo leer la ficha: ${err instanceof Error ? err.message : err}. Tablón apagado.`);
    return;
  }
  if (habilidades.length + deps.opciones.palabras.length === 0) {
    console.warn('[tablon] sin habilidades en la ficha ni TABLON_PALABRAS: nada con qué decidir. Tablón apagado.');
    return;
  }

  const completas: DepsTablon = { ...deps, precio, habilidades };
  console.log(
    `Tablón: cada ${deps.opciones.minutos} min · desde ${formatEther(precio.amount)} en su moneda · ` +
      `con ${deps.opciones.margenMinutos} min de plazo como mínimo · ${habilidades.length + deps.opciones.palabras.length} palabras.`,
  );
  let enMarcha = false;
  const ronda = async (): Promise<void> => {
    if (enMarcha) return;
    enMarcha = true;
    try {
      await repasarTablon(completas);
    } finally {
      enMarcha = false;
    }
  };
  setTimeout(() => void ronda(), 60_000);
  setInterval(() => void ronda(), deps.opciones.minutos * 60_000);
}
