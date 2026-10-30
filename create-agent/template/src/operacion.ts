/**
 * Lo que hace falta para operar el agente sin dejar a nadie colgado: cuánto puede
 * tardar una respuesta ya cobrada y cómo se apaga sin cortar lo que está en curso.
 *
 * Va aparte de server.ts para poder probarlo sin levantar un agente entero.
 */

import type { Server } from 'node:http';

/**
 * Cuánto puede tardar tu `handleTask` en una pregunta x402.
 *
 * Aquí se cobra ANTES de trabajar, y quien pagó está esperando. Sin plazo, un
 * modelo atascado dejaba al cliente mirando hasta rendirse sin saber si su pago
 * había servido. Con él recibe un error a tiempo, con el comprobante del cobro.
 *
 * 100 s porque la cotización promete 120 y el cobro y la subida de archivos también
 * cuentan. Si tu agente está detrás de Cloudflare, que corta a los 100 s, usa 85.
 */
export const X402_PLAZO_SEGUNDOS = 100;
const X402_PLAZO_MIN = 5;
const X402_PLAZO_MAX = 110;

/** Cuánto se espera al apagar a lo que está en curso. El gestor debe esperar más (ver deploy/). */
export const APAGADO_SEGUNDOS = 110;
/** Con todo el trabajo terminado, cuánto se espera a que acaben de salir las respuestas. */
const APAGADO_VACIADO_MS = 5_000;

function segundos(crudo: string | undefined, porDefecto: number, min: number, max: number): number {
  const n = Number(crudo?.trim() || porDefecto);
  if (!Number.isFinite(n)) return porDefecto;
  return Math.min(Math.max(n, min), max);
}

export function plazoX402Ms(env: NodeJS.ProcessEnv = process.env): number {
  return segundos(env.X402_PLAZO_SEGUNDOS, X402_PLAZO_SEGUNDOS, X402_PLAZO_MIN, X402_PLAZO_MAX) * 1000;
}

export function plazoApagadoMs(env: NodeJS.ProcessEnv = process.env): number {
  return segundos(env.APAGADO_SEGUNDOS, APAGADO_SEGUNDOS, 0, 600) * 1000;
}

export class PlazoAgotado extends Error {
  constructor(readonly ms: number) {
    super(`sin respuesta en ${Math.round(ms / 1000)} s`);
    this.name = 'PlazoAgotado';
  }
}

/**
 * El resultado de `trabajo`, o `PlazoAgotado` si no llega a tiempo.
 *
 * No cancela nada: el trabajo sigue hasta que acabe y su resultado se ignora. Si
 * luego falla no queda como rechazo sin atender, porque `race` ya lo escucha.
 */
export function conPlazo<T>(trabajo: Promise<T>, ms: number): Promise<T> {
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<never>((_, rechazar) => {
    temporizador = setTimeout(() => rechazar(new PlazoAgotado(ms)), ms);
  });
  return Promise.race([trabajo, limite]).finally(() => clearTimeout(temporizador));
}

export interface OpcionesDeApagado {
  server: Pick<Server, 'close' | 'closeIdleConnections'>;
  /** Si queda algo que no se debe cortar: un encargo, un pago, una firma. */
  ocupado: () => boolean;
  plazoMs: number;
  salir: (codigo: number) => void;
  log?: (mensaje: string) => void;
  intervaloMs?: number;
}

/**
 * Deja de aceptar conexiones, espera a lo que está en curso y sale.
 *
 * Un encargo cortado aquí no se pierde: el brief está en disco y el vigilante lo
 * retoma al arrancar. Una pregunta ya cobrada no tiene esa segunda oportunidad, y
 * por eso se espera. Si no acaba dentro del plazo se sale igual: un apagado que no
 * termina es peor, porque el gestor acabaría matando el proceso sin avisar.
 */
export function apagarEnOrden(o: OpcionesDeApagado): void {
  const log = o.log ?? console.log;
  const intervalo = o.intervaloMs ?? 250;
  const inicio = Date.now();
  let cerrado = false;
  let libreDesde: number | null = null;
  o.server.close(() => {
    cerrado = true;
  });
  const repaso = (): void => {
    o.server.closeIdleConnections();
    const ahora = Date.now();
    if (o.ocupado()) libreDesde = null;
    else libreDesde ??= ahora;
    if (libreDesde !== null && (cerrado || ahora - libreDesde >= APAGADO_VACIADO_MS)) {
      log('[panal] apagado: no quedaba nada en curso');
      o.salir(0);
      return;
    }
    if (ahora - inicio >= o.plazoMs) {
      log(`[panal] apagado: se agotó el plazo con trabajo en curso; lo pendiente del escrow se retoma al arrancar`);
      o.salir(0);
      return;
    }
    setTimeout(repaso, intervalo);
  };
  repaso();
}
