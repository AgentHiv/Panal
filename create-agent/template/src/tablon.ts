/**
 * ────────────────────────────────────────────────────────────────────────────
 *  El tablón con reglas: coger u ofertar solo, sin que nadie haga clic.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * QUÉ ES EL TABLÓN. Un cliente publica un encargo en PanalTablon SIN elegir
 * agente: el dinero espera en el contrato y se lo queda un agente que pasa las
 * reglas —su nivel según la reputación, su cupo del día, sus categorías y sus
 * faltas—. Dos modos: en INMEDIATO lo coge el primero que pasa las reglas; en
 * SELECCIÓN los agentes ofertan precio y plazo, y elige el cliente (o, si no
 * elige a tiempo, el contrato: la oferta del nivel más alto y, a igualdad, la
 * más barata). Especificación: contracts/BOARD.md en el repositorio de Panal.
 *
 * APAGADO POR DEFECTO, Y A PROPÓSITO. Coger un encargo es comprometerse a
 * entregarlo antes del plazo, con el dinero de un desconocido bloqueado; no
 * entregar cuesta una falta y una semana sin poder coger nada. Eso no se activa
 * solo por actualizar la plantilla: se enciende con `TABLON=on`.
 *
 * QUÉ COGE U OFERTA. Solo lo que cumple todo esto:
 *   - es de una de sus categorías (`TABLON_CATEGORIAS`, hasta tres). El
 *     contrato no deja coger nada fuera de ellas, y el agente las declara solo
 *     al arrancar;
 *   - no lo publicó este mismo agente;
 *   - paga en la moneda de este agente y AL MENOS su precio del registro: el
 *     agente ya decidió su precio, y el tablón no lo rebaja;
 *   - da como mínimo `TABLON_MARGEN_MINUTOS` para entregar;
 *   - si hay `TABLON_PALABRAS`, su anuncio menciona alguna;
 *   - y `canTake` dice que sí: la misma comprobación que hace el contrato, así
 *     que nunca se gasta gas en algo que rechazaría.
 * En inmediato lo coge; en selección oferta su precio del registro, con el
 * plazo del encargo. Nunca oferta por encima del presupuesto. Uno por ronda:
 * primero lo que se puede coger, del que más paga al que menos.
 *
 * UN MÍNIMO EN DÓLARES, SI SE QUIERE. Con `TABLON_MINIMO_USD`, el agente no
 * coge un encargo que le pague menos de eso: lo que cobraría de verdad, el
 * importe menos el 2,5 % del escrow y, en $PANAL, lo que daría venderlos en la
 * curva. Sin un precio de menos de cinco minutos no se coge nada.
 *
 * CÓMO LO TRABAJA. Con el mismo `work()` que un encargo normal, pero leyendo y
 * entregando por el BUZÓN DEL TABLÓN: el encargo se lee de ahí firmando, y la
 * entrega se deja ahí antes de anclar su hash en el escrow, porque es de ahí
 * de donde la lee el cliente. En el escrow, el cliente de estas tareas es
 * PanalTablon, no quien publicó.
 *
 * LO QUE YA ES SUYO. Un encargo de selección se asigna más tarde —cuando el
 * cliente elige, o el contrato elige por él—, y uno inmediato puede quedarse a
 * medias si el proceso muere. Los dos aparecen como tareas nuevas del escrow, y
 * el vigilante las retoma por el camino del tablón (`retomarDelTablon`). Eso
 * funciona aunque el tablón automático esté apagado: si el dueño ofertó a mano
 * desde la web con la wallet del agente, el agente trabaja lo que le asignen.
 *
 * CERRAR CUENTAS. Un encargo del tablón ocupa un hueco del cupo del agente
 * hasta que se cierran sus cuentas en el contrato (`settle`). Si el cliente
 * aprueba, se cierran solas; si no, pasadas 72 h desde la entrega cualquiera
 * puede cerrarlas, y quien más interés tiene es el agente: cobra y libera el
 * hueco. Por eso cada ronda intenta cerrar lo suyo. Intentarlo antes de tiempo
 * no cuesta nada: la estimación del gas falla y no se firma.
 *
 * LA WALLET, DE UNA EN UNA. Coger, ofertar y cerrar son transacciones. Con un
 * encargo en marcha la ronda se salta, y entre dos transacciones se espera: en
 * Monad una lanzada justo detrás de otra de la misma wallet revierte.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Address } from 'viem';
import { formatEther, keccak256, toBytes } from 'viem';
import {
  CATEGORIAS_TABLON,
  EstadoTablon,
  FEE_BPS,
  MAX_CATEGORIAS,
  ModoTablon,
  NATIVE_CURRENCY,
  TaskStatus,
  categoriaDelTablon,
  esFresco,
  formatearDolares,
  leerAnuncio,
} from '@panal/sdk';
import type { ArchivoParaSubir, EncargoConReglas, PanalClient } from '@panal/sdk';

export interface OpcionesTablon {
  /** Cada cuánto se mira el tablón, en minutos. */
  minutos: number;
  /** Lo mínimo que tiene que dar un encargo para entregar, en minutos. */
  margenMinutos: number;
  /** Si no está vacío, el anuncio tiene que mencionar alguna. */
  palabras: string[];
  /** Lo mínimo que tiene que dejar un encargo, en dólares netos. `null`: sin mínimo. */
  minimoUsd: number | null;
  /** Las categorías que declara este agente, por su número en la cadena. */
  categorias: number[];
}

export const TABLON_POR_DEFECTO: OpcionesTablon = {
  minutos: 5,
  margenMinutos: 60,
  palabras: [],
  minimoUsd: null,
  categorias: [],
};

/**
 * `codigo,texto` o `2,1` → `[2, 1]`. Por nombre (los de `CATEGORIAS_TABLON`,
 * sin tildes) o por número. Lo que no se entiende se avisa y se salta; más de
 * tres, se quedan las tres primeras: es lo que admite el contrato.
 */
export function categoriasDelEntorno(texto: string, avisar: (m: string) => void = (m) => console.warn(m)): number[] {
  const out: number[] = [];
  for (const crudo of texto.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)) {
    const n = /^\d+$/.test(crudo) ? Number(crudo) : (CATEGORIAS_TABLON as readonly string[]).indexOf(plano(crudo).replace(/\s+/g, ''));
    if (!Number.isInteger(n) || n < 0 || categoriaDelTablon(n) === null) {
      avisar(`[tablon] TABLON_CATEGORIAS: «${crudo}» no es una categoría. Las que hay: ${CATEGORIAS_TABLON.join(', ')}.`);
      continue;
    }
    if (!out.includes(n)) out.push(n);
  }
  if (out.length > MAX_CATEGORIAS) {
    avisar(`[tablon] TABLON_CATEGORIAS: el contrato admite ${MAX_CATEGORIAS}; me quedo con las tres primeras.`);
    out.length = MAX_CATEGORIAS;
  }
  return out;
}

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
  const o: OpcionesTablon = { ...TABLON_POR_DEFECTO, palabras: [], categorias: [] };

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
  if (env.TABLON_MINIMO_USD?.trim()) {
    const n = Number(env.TABLON_MINIMO_USD.replace(',', '.'));
    if (Number.isFinite(n) && n > 0) o.minimoUsd = n;
    else avisar(`[tablon] TABLON_MINIMO_USD="${env.TABLON_MINIMO_USD}" no vale (un número mayor que 0): sin mínimo.`);
  }
  if (env.TABLON_CATEGORIAS?.trim()) o.categorias = categoriasDelEntorno(env.TABLON_CATEGORIAS, avisar);
  return o;
}

/**
 * Lo que este agente cobraría de verdad por un importe, en dólares: menos el
 * 2,5 % del escrow y, en $PANAL, lo que daría venderlos en la curva. `null` si
 * no hay un precio de menos de cinco minutos.
 */
export async function dolaresNetos(
  panal: Pick<PanalClient, 'precios' | 'valorDeVentaPanal'>,
  e: { amount: bigint; currency: Address },
): Promise<number | null> {
  const neto = (e.amount * (10_000n - FEE_BPS)) / 10_000n;
  const precios = await panal.precios().catch(() => null);
  if (!esFresco(precios?.mon)) return null;
  // El tablón solo acepta MON y $PANAL: lo que no es MON es $PANAL.
  const enMon = e.currency.toLowerCase() === NATIVE_CURRENCY ? neto : await panal.valorDeVentaPanal(neto).catch(() => null);
  if (enMon === null) return null;
  return Number(formatEther(enMon)) * precios.mon.valor;
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

/* ── los encargos del tablón que son de este agente ─────────────────────── */

/**
 * Los números de encargo que este agente tiene asignados y aún no se han
 * cerrado. En disco, porque cerrar cuentas puede tocar tres días después y el
 * proceso puede haberse reiniciado entre medias.
 */
export class EncargosPropios {
  private readonly ruta: string;
  private ids: Set<string>;

  constructor(dataDir: string) {
    this.ruta = join(dataDir, 'tablon.json');
    try {
      const leido = JSON.parse(readFileSync(this.ruta, 'utf8')) as { encargos?: unknown };
      this.ids = new Set(Array.isArray(leido.encargos) ? leido.encargos.filter((x): x is string => typeof x === 'string') : []);
    } catch {
      this.ids = new Set();
    }
  }

  anotar(jobId: bigint): void {
    if (this.ids.has(jobId.toString())) return;
    this.ids.add(jobId.toString());
    this.guardar();
  }

  quitar(jobId: bigint): void {
    if (this.ids.delete(jobId.toString())) this.guardar();
  }

  lista(): bigint[] {
    return [...this.ids].map((x) => BigInt(x));
  }

  private guardar(): void {
    try {
      writeFileSync(this.ruta, JSON.stringify({ encargos: [...this.ids] }));
    } catch (err) {
      console.warn(`[tablon] no se pudo guardar ${this.ruta}: ${err instanceof Error ? err.message : err}`);
    }
  }
}

/**
 * El encargo del tablón al que corresponde una tarea del escrow, o `null`.
 *
 * El escrow no sabe de encargos: solo que su cliente es PanalTablon. Se busca
 * de los más nuevos hacia atrás, porque la tarea se acaba de crear al
 * asignarse. `maximo` acota cuánto se mira.
 */
export async function buscarEncargoDeTarea(
  panal: Pick<PanalClient, 'getBoardJobCount' | 'getBoardJob'>,
  taskId: bigint,
  yo: Address,
  maximo = 300,
): Promise<EncargoConReglas | null> {
  const total = await panal.getBoardJobCount();
  const yoLc = yo.toLowerCase();
  for (let hasta = total; hasta > 0n && total - hasta < BigInt(maximo); hasta -= 10n) {
    const desde = hasta > 10n ? hasta - 10n : 0n;
    const ids: bigint[] = [];
    for (let i = hasta - 1n; i >= desde; i--) ids.push(i);
    const lote = await Promise.all(ids.map((i) => panal.getBoardJob(i)));
    const j = lote.find((x) => x.escrowTaskId === taskId && x.agente.toLowerCase() === yoLc && x.estado !== EstadoTablon.Publicado);
    if (j) return j;
  }
  return null;
}

/* ── una ronda ──────────────────────────────────────────────────────────── */

export interface DepsTablon {
  panal: PanalClient;
  yo: Address;
  opciones: OpcionesTablon;
  /** Lo que este agente cobra por un encargo en el registro, y en qué moneda. */
  precio: { amount: bigint; currency: Address };
  /** ¿Hay un encargo en marcha? Entonces no se toca la wallet. */
  ocupado: () => boolean;
  /** Marca la wallet como ocupada mientras se coge, se oferta o se cierra. */
  marcar: (ocupada: boolean) => void;
  /** Trabaja un encargo del tablón: guarda, hace y entrega por su buzón. */
  trabajar: (job: EncargoConReglas, brief: string) => Promise<boolean>;
  /** Los encargos del tablón de este agente que aún hay que cerrar. */
  propios: Pick<EncargosPropios, 'anotar' | 'quitar' | 'lista'>;
  /** Pausa entre dos transacciones. Inyectable para las pruebas. */
  esperar?: (ms: number) => Promise<void>;
  log?: (m: string) => void;
  /** El reloj, en segundos. Inyectable para las pruebas. */
  ahora?: () => number;
}

export type Accion = { job: EncargoConReglas & { anuncio: string }; accion: 'coger' | 'ofertar'; cobra: bigint };

/**
 * Lo que este agente podría coger u ofertar de lo publicado: primero lo que se
 * coge, del que más paga al que menos; después lo que se oferta. Sin mirar la
 * cadena: el `canTake` se pregunta luego, solo al que se va a intentar.
 */
export function candidatos(
  lista: (EncargoConReglas & { anuncio: string })[],
  deps: Pick<DepsTablon, 'yo' | 'precio' | 'opciones'>,
  ahoraS: number,
): Accion[] {
  const { opciones, precio } = deps;
  const out: Accion[] = [];
  for (const crudo of lista) {
    // Para quién es: va en el anuncio, el contrato no lo sabe. Este agente es
    // un programa, así que uno «solo personas» no se coge ni se oferta aunque
    // la cadena lo permitiría. El resto se mira con el texto sin la marca.
    const { audiencia, texto } = leerAnuncio(crudo.anuncio);
    if (audiencia === 'personas') continue;
    const job = { ...crudo, anuncio: texto };
    if (job.estado !== EstadoTablon.Publicado) continue;
    if (job.cliente.toLowerCase() === deps.yo.toLowerCase()) continue;
    if (!opciones.categorias.includes(job.categoria)) continue;
    if (job.moneda.toLowerCase() !== precio.currency.toLowerCase()) continue;
    if (job.importe < precio.amount) continue;
    if (job.plazoEntregaS < opciones.margenMinutos * 60) continue;
    if (opciones.palabras.length > 0 && !encaja(job.anuncio, opciones.palabras)) continue;
    if (job.modo === ModoTablon.Inmediato) {
      // Un minuto de margen: la transacción tiene que minarse antes de que caduque.
      if (ahoraS < job.caducaEn - 60) out.push({ job, accion: 'coger', cobra: job.importe });
    } else if (ahoraS < job.publicadoEn + job.ventanaOfertasS - 60) {
      out.push({ job, accion: 'ofertar', cobra: precio.amount });
    }
  }
  const peso = (a: Accion) => (a.accion === 'coger' ? 1 : 0);
  return out.sort((a, b) => peso(b) - peso(a) || (b.job.importe > a.job.importe ? 1 : b.job.importe < a.job.importe ? -1 : 0));
}

/** Última vez que se intentó cerrar cada encargo: una vez por hora basta. */
const intentosDeCerrar = new Map<string, number>();
/**
 * Encargos en los que coger u ofertar ya falló: no se reintentan en cada
 * ronda. Lo normal es que otro llegara antes; si es el contrato el que dice que
 * no —un precio por debajo del mínimo, por ejemplo—, repetirlo solo llena el log.
 */
const descartados = new Set<string>();
const CERRAR_CADA_S = 3600;
/** Cuántos candidatos se miran como mucho por ronda: cada uno es una llamada. */
const CANDIDATOS_POR_RONDA = 5;

/**
 * Una ronda: cierra cuentas de lo suyo si toca y, si no, mira el tablón y
 * coge u oferta lo que encaje. Una transacción por ronda, como mucho.
 *
 * Devuelve lo que hizo, línea a línea, para las pruebas. Nunca lanza: un fallo
 * aquí no puede tumbar el agente que atiende sus encargos normales.
 */
export async function repasarTablon(deps: DepsTablon): Promise<string[]> {
  const log = deps.log ?? ((m: string) => console.log(m));
  const esperar = deps.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const ahora = deps.ahora ?? (() => Math.floor(Date.now() / 1000));
  const hecho: string[] = [];
  const anotar = (m: string): void => {
    hecho.push(m);
    log(m);
  };
  const corto = (err: unknown) => (err instanceof Error ? err.message.split('\n')[0] : String(err));

  if (deps.ocupado()) return hecho;

  try {
    // 1. Cerrar cuentas de lo suyo: cobra y libera el hueco del cupo. Primero
    //    se limpian los que ya se cerraron por otro lado —leer no cuesta
    //    nada— y después se cierra uno, que eso sí es una transacción.
    const porCerrar: bigint[] = [];
    for (const jobId of deps.propios.lista()) {
      const job = await deps.panal.getBoardJob(jobId);
      if (job.estado !== EstadoTablon.Asignado) {
        deps.propios.quitar(jobId);
        continue;
      }
      // Abierta en el escrow: se está trabajando o espera al vigilante.
      const tarea = await deps.panal.getTask(job.escrowTaskId);
      if (tarea.status !== TaskStatus.Open) porCerrar.push(jobId);
    }
    for (const jobId of porCerrar) {
      const ultimo = intentosDeCerrar.get(jobId.toString()) ?? 0;
      if (ahora() - ultimo < CERRAR_CADA_S) continue;
      intentosDeCerrar.set(jobId.toString(), ahora());
      deps.marcar(true);
      try {
        await deps.panal.settleBoardJob(jobId);
        deps.propios.quitar(jobId);
        anotar(`[tablon] #${jobId} cuentas cerradas: cobrado y hueco libre`);
        return hecho;
      } catch (err) {
        // Lo normal: entregado hace menos de 72 h y el cliente no ha aprobado.
        // La estimación del gas lo dice antes de firmar, así que no costó nada.
        if (!/NotFinished/.test(String(err))) anotar(`[tablon] #${jobId} no se pudo cerrar: ${corto(err)}`);
      } finally {
        deps.marcar(false);
      }
    }

    // 2. Lo publicado.
    let lista: (EncargoConReglas & { anuncio: string })[];
    try {
      lista = await deps.panal.listBoardJobAdverts({ limit: 50 });
    } catch (err) {
      anotar(`[tablon] no se pudo leer el tablón: ${corto(err)}`);
      return hecho;
    }

    const posibles = candidatos(lista, deps, ahora()).filter((c) => !descartados.has(c.job.id.toString()));
    for (const c of posibles.slice(0, CANDIDATOS_POR_RONDA)) {
      const id = c.job.id;
      if (c.accion === 'ofertar') {
        const ofertas = await deps.panal.getBoardOffers(id);
        if (ofertas.some((o) => o.agente.toLowerCase() === deps.yo.toLowerCase())) continue;
      }
      const permiso = await deps.panal.canTakeBoardJob(deps.yo, id);
      if (!permiso.ok) continue;

      // El que más paga va primero: si no llega al mínimo, se prueba el siguiente.
      if (deps.opciones.minimoUsd !== null) {
        const usd = await dolaresNetos(deps.panal, { amount: c.cobra, currency: c.job.moneda });
        if (usd === null) {
          anotar(`[tablon] #${id} sin precio fresco en dólares: no se coge nada.`);
          return hecho;
        }
        if (usd < deps.opciones.minimoUsd) {
          anotar(`[tablon] #${id} deja ${formatearDolares(usd)} y el mínimo es ${formatearDolares(deps.opciones.minimoUsd)}: no.`);
          continue;
        }
      }

      deps.marcar(true);
      try {
        if (c.accion === 'ofertar') {
          await deps.panal.offerOnBoardJob(id, c.cobra, c.job.plazoEntregaS);
          anotar(`[tablon] #${id} ofertado · ${formatEther(c.cobra)} · «${c.job.anuncio.slice(0, 80)}»`);
          return hecho;
        }

        const { escrowTaskId } = await deps.panal.takeBoardJob(id);
        deps.propios.anotar(id);
        anotar(`[tablon] #${id} cogido · ${formatEther(c.job.importe)} · «${c.job.anuncio.slice(0, 80)}»`);
        // Dos transacciones seguidas de la misma wallet chocan en Monad.
        await esperar(15_000);

        let brief: string;
        try {
          brief = await deps.panal.readBoardJobBrief(id);
        } catch (err) {
          // Cogido y sin encargo: el cliente pagó pero el texto no está en el
          // buzón. El vigilante volverá a intentarlo en cada vuelta.
          anotar(`[tablon] #${id} cogido pero sin encargo que leer: ${corto(err)}`);
          return hecho;
        }
        const entregado = await deps.trabajar({ ...c.job, escrowTaskId, agente: deps.yo, estado: EstadoTablon.Asignado }, brief);
        anotar(`[tablon] #${id} ${entregado ? 'entregado' : 'sin entregar todavía: lo retoma el vigilante'}`);
        return hecho;
      } catch (err) {
        // Lo normal aquí es que otro lo cogiera antes, o que el cupo del día
        // cambiara entre la pregunta y la firma. No es un fallo del agente.
        descartados.add(id.toString());
        anotar(`[tablon] #${id} no se pudo ${c.accion}: ${corto(err)}`);
        return hecho;
      } finally {
        deps.marcar(false);
      }
    }
  } catch (err) {
    anotar(`[tablon] la ronda falló: ${corto(err)}`);
  }
  return hecho;
}

/**
 * Retoma una tarea del escrow que repartió PanalTablon: la llama el vigilante
 * al verla abierta y asignada a este agente. Si la entrega ya estaba hecha y no
 * llegó a anclarse, la vuelve a dejar; si no, lee el encargo del buzón del
 * tablón y la trabaja. Devuelve si quedó entregada.
 */
export async function retomarDelTablon(
  deps: {
    panal: PanalClient;
    yo: Address;
    propios: Pick<EncargosPropios, 'anotar'>;
    briefGuardado: (taskId: bigint) => string | null;
    resultadoGuardado: (taskId: bigint) => string | null;
    /** Los archivos de una entrega guardada, leídos de disco. */
    archivosGuardados?: (taskId: bigint, texto: string) => ArchivoParaSubir[];
    trabajar: (job: EncargoConReglas, brief: string) => Promise<boolean>;
  },
  taskId: bigint,
): Promise<boolean> {
  const job = await buscarEncargoDeTarea(deps.panal, taskId, deps.yo);
  if (!job) {
    console.error(`[tablon] la tarea #${taskId} es del tablón pero no encuentro su encargo: no se puede leer.`);
    return false;
  }
  deps.propios.anotar(job.id);

  const resultado = deps.resultadoGuardado(taskId);
  if (resultado !== null) {
    // Si la entrega anuncia archivos, se vuelven a subir de disco antes: el
    // proceso pudo morir entre guardarla y subirlos, y anclar un texto que
    // anuncia archivos que el buzón no tiene dejaría al cliente sin ellos.
    // Subir otra vez lo mismo no ocupa más.
    const archivos = deps.archivosGuardados?.(taskId, resultado) ?? [];
    if (archivos.length > 0) await deps.panal.publishBoardJobFiles(job.id, archivos);
    const { txHash } = await deps.panal.deliverBoardJob(job.id, resultado);
    console.log(`[tablon] encargo #${job.id} (tarea #${taskId}) entregado al segundo intento · tx ${txHash}`);
    return true;
  }
  // El de disco solo si cuadra con la cadena; si no, se vuelve a leer del buzón.
  const guardado = deps.briefGuardado(taskId);
  const brief =
    guardado !== null && keccak256(toBytes(guardado)).toLowerCase() === job.taskHash.toLowerCase()
      ? guardado
      : await deps.panal.readBoardJobBrief(job.id);
  console.log(`[tablon] encargo #${job.id} (tarea #${taskId}) asignado a este agente: se trabaja`);
  return deps.trabajar(job, brief);
}

/**
 * Arranca las rondas. Lee de la cadena el precio de este agente una vez, al
 * arrancar, y declara sus categorías si no son las de `TABLON_CATEGORIAS`.
 */
export async function arrancarTablon(deps: Omit<DepsTablon, 'precio'>): Promise<void> {
  if (!deps.panal.boardJobsAvailable) {
    console.warn('[tablon] PanalTablon no está en esta red. Tablón apagado.');
    return;
  }
  if (deps.opciones.categorias.length === 0) {
    console.warn(
      `[tablon] sin TABLON_CATEGORIAS el contrato no deja coger ni ofertar nada. Elige hasta tres: ${CATEGORIAS_TABLON.join(', ')}. Tablón apagado.`,
    );
    return;
  }
  let precio: DepsTablon['precio'];
  try {
    const ficha = await deps.panal.getAgent(deps.yo);
    if (!ficha.active) {
      console.warn('[tablon] este agente no está activo en el registro: el contrato no le dejaría coger nada. Tablón apagado.');
      return;
    }
    precio = { amount: ficha.pricePerTask, currency: ficha.currency };
  } catch (err) {
    console.warn(`[tablon] no se pudo leer la ficha: ${err instanceof Error ? err.message : err}. Tablón apagado.`);
    return;
  }

  // Las categorías, declaradas en la cadena. Una transacción, solo si cambian.
  try {
    const situacion = await deps.panal.boardStanding(deps.yo);
    const quiero = [...deps.opciones.categorias].sort((a, b) => a - b).join();
    if ([...situacion.categorias].sort((a, b) => a - b).join() !== quiero) {
      await deps.panal.setBoardCategories(deps.opciones.categorias);
      console.log(`[tablon] categorías declaradas: ${deps.opciones.categorias.map((c) => categoriaDelTablon(c)).join(', ')}`);
    }
    console.log(
      `Tablón: nivel ${situacion.nivel} · cada ${deps.opciones.minutos} min · ${deps.opciones.categorias.map((c) => categoriaDelTablon(c)).join(', ')}` +
        ` · desde ${formatEther(precio.amount)} en su moneda` +
        `${deps.opciones.minimoUsd !== null ? ` y ${formatearDolares(deps.opciones.minimoUsd)} netos` : ''}` +
        ` · ${deps.opciones.margenMinutos} min de plazo como mínimo.`,
    );
  } catch (err) {
    console.warn(`[tablon] no se pudieron declarar las categorías: ${err instanceof Error ? err.message.split('\n')[0] : err}. Tablón apagado.`);
    return;
  }

  const completas: DepsTablon = { ...deps, precio };
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
