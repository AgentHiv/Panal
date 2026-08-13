/**
 * El vigilante: se entera de las tareas aunque nadie llame a la puerta.
 *
 * Un agente normal solo trabaja cuando alguien le hace POST /brief. Eso deja
 * tres agujeros que cuestan dinero de verdad, y los tres han pasado:
 *
 *   1. EL ENCARGO QUE NO LLEGÓ. El cliente pagó on-chain y el push del brief
 *      falló —móvil, wallet que se traga la firma, pestaña cerrada, tu agente
 *      caído dos minutos—. El pago se queda bloqueado y tú no te enteras.
 *   2. EL TRABAJO A MEDIAS. Recibiste el encargo, te pusiste a trabajar y el
 *      proceso murió. Al arrancar no queda ni rastro: la tarea sigue abierta
 *      para siempre.
 *   3. LA ENTREGA QUE NO SE ANCLÓ. Terminaste el trabajo, lo guardaste, y la
 *      transacción de entrega falló. Tienes el resultado en disco y el cliente
 *      no tiene nada.
 *
 * LO QUE NO PUEDE HACER, y conviene tenerlo claro antes de esperarlo: el
 * escrow guarda `keccak256(encargo)`, no el encargo. Un vigilante que ve una
 * tarea nueva sabe que existe, de quién es y cuánto paga, pero NO qué le
 * pidieron. Si el encargo nunca llegó, no hay nada que inventar: se avisa con
 * el enlace de reenvío y se espera. Adivinar sería entregar cualquier cosa
 * anclando su hash, que es peor que no entregar.
 *
 * SE SONDEA, NO SE ESCUCHAN EVENTOS. `eth_getLogs` del RPC público está
 * limitado a 100 bloques, así que un agente parado veinte minutos ya no puede
 * recuperar su propio hueco. Leer el contador de tareas y mirar las nuevas es
 * una llamada cada vuelta, funciona igual tras cualquier parón y no depende de
 * que el RPC conserve nada.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { keccak256, toBytes } from 'viem';
import type { Address } from 'viem';
import { TaskStatus, type PanalClient } from '@panal/sdk';

export interface VigilanteDeps {
  panal: PanalClient;
  /** La dirección de este agente. */
  yo: Address;
  /** Dónde guardar hasta dónde se miró. */
  dataDir: string;
  /** Trabaja una tarea de la que YA se tiene el encargo. */
  trabajar: (taskId: bigint, brief: string) => Promise<void>;
  /**
   * ¿Se está trabajando esa tarea AHORA MISMO?
   *
   * Sin esto, el vigilante no sabe distinguir un trabajo en curso de uno
   * muerto: los dos se ven igual desde fuera —tarea abierta, encargo en disco,
   * sin resultado—. Se vio en la primera prueba real, donde anunció que
   * retomaba una tarea que estaba corriendo tan tranquila. No llegó a
   * duplicarla porque `work` tiene su propia guarda, pero el aviso era falso, y
   * un trabajo más largo que el intervalo lo repetiría en cada vuelta.
   */
  enCurso: (taskId: bigint) => boolean;
  /** El encargo recibido, si se guardó. */
  briefGuardado: (taskId: bigint) => string | null;
  /** El resultado ya calculado, si lo hay. */
  resultadoGuardado: (taskId: bigint) => string | null;
  /** Reintenta anclar un resultado que ya está calculado. */
  reentregar: (taskId: bigint, texto: string) => Promise<void>;
  /** URL pública del agente, para el aviso de encargo huérfano. */
  urlPublica?: string;
}

/** Cada cuánto se mira cuando hay movimiento, en segundos. */
const CADA = (() => {
  const n = Number(process.env.VIGILANTE_SEGUNDOS?.trim() || '60');
  // Menos de 15 s no aporta nada y sí gasta el límite del RPC.
  return Number.isFinite(n) && n >= 15 ? Math.floor(n) : 60;
})();

/**
 * Cuántas vueltas en blanco antes de bajar el ritmo, y a cuánto se baja.
 *
 * Un agente parado pregunta `getTaskCount()` cada 60 s aunque no pase nada.
 * Una gota. Pero el RPC público es COMPARTIDO y corta cerca de 50 llamadas
 * concurrentes: con mil agentes son 16,7 llamadas/s permanentes, y entre
 * todos ahogan el pozo del que bebe también el indexador — que es de quien
 * depende el catálogo entero del mercado.
 *
 * Así que tras un rato sin encontrar nada —el caso normal— se pasa a mirar
 * cada cinco minutos. Al primer hallazgo se vuelve al ritmo corto.
 *
 * Lo que cuesta: un encargo perdido se detecta en cinco minutos en vez de en
 * uno. Los plazos se miden en horas, así que no cambia nada para nadie.
 */
const VUELTAS_EN_BLANCO = 20;
const CADA_TRANQUILO = Math.max(CADA, 300);

/**
 * Cuánto se espera antes de dar por perdido un encargo.
 *
 * El camino normal es: la transacción se mina y el cliente empuja el encargo
 * unos segundos después. Sin esta espera, el vigilante gritaría en cada tarea
 * legítima y el aviso dejaría de significar nada.
 */
const GRACIA_MS = 3 * 60 * 1000;

/** Cuántas tareas hacia atrás se miran al arrancar sin marca previa. */
const REPASO_INICIAL = 50n;

export function arrancarVigilante(deps: VigilanteDeps): { parar: () => void } {
  if (process.env.VIGILANTE === 'off') {
    console.log('Vigilante desactivado (VIGILANTE=off).');
    return { parar: () => {} };
  }

  const marcaPath = join(deps.dataDir, 'vigilante.json');
  /** Tareas vistas sin encargo, con el momento en que se vieron. */
  const huerfanas = new Map<string, number>();
  /** De las que ya se avisó, para no repetir el aviso cada vuelta. */
  const avisadas = new Set<string>();
  let parado = false;

  const leerMarca = (): bigint => {
    try {
      const raw = JSON.parse(readFileSync(marcaPath, 'utf8')) as { visto?: string };
      return BigInt(raw.visto ?? '0');
    } catch {
      return -1n; // sin marca: se hace el repaso inicial
    }
  };
  const escribirMarca = (visto: bigint): void => {
    try {
      writeFileSync(marcaPath, JSON.stringify({ visto: visto.toString() }, null, 2));
    } catch (err) {
      // Perder la marca solo cuesta repetir el repaso, así que no se para nada.
      console.error(`[vigilante] no se pudo guardar la marca: ${err instanceof Error ? err.message : err}`);
    }
  };

  /** true si encontro algo que atender: eso es lo que decide el ritmo. */
  async function repasar(): Promise<boolean> {
    const total = await deps.panal.getTaskCount();
    const marca = leerMarca();
    // La primera vez se miran las últimas REPASO_INICIAL en vez de las 30.000
    // que pueda haber: las viejas están cerradas y no cambian.
    const desde = marca >= 0n ? marca + 1n : total > REPASO_INICIAL ? total - REPASO_INICIAL : 0n;

    // Las nuevas, más las que quedaron pendientes de vueltas anteriores.
    const pendientes = new Set<string>(huerfanas.keys());
    for (let i = desde; i < total; i++) pendientes.add(i.toString());
    if (pendientes.size === 0) {
      escribirMarca(total - 1n);
      return false;
    }

    for (const id of pendientes) {
      if (parado) return true;
      const taskId = BigInt(id);
      try {
        await revisarUna(taskId);
      } catch (err) {
        console.error(`[vigilante] #${taskId}: ${err instanceof Error ? err.message : err}`);
      }
    }
    escribirMarca(total - 1n);
    // Habia algo que mirar, aunque no fuera nuestro: no es una vuelta en blanco.
    return true;
  }

  async function revisarUna(taskId: bigint): Promise<void> {
    const task = await deps.panal.getTask(taskId);
    const id = taskId.toString();

    // Ni mía, ni viva: fuera de la lista y a otra cosa.
    if (task.worker.toLowerCase() !== deps.yo.toLowerCase()) {
      huerfanas.delete(id);
      return;
    }
    if (task.status !== TaskStatus.Open) {
      huerfanas.delete(id);
      avisadas.delete(id);
      return;
    }

    // Se está trabajando ahora mismo: no es un hueco, es el camino normal. Ni
    // se retoma, ni se avisa de que falte el encargo — lo tiene y lo está
    // usando. El vigilante solo se ocupa de lo que ya no se mueve.
    if (deps.enCurso(taskId)) {
      huerfanas.delete(id);
      return;
    }

    // CASO 3: el resultado está calculado y la tarea sigue abierta, así que la
    // entrega no llegó a anclarse. Se reintenta, que es gratis para el cliente
    // y le devuelve una tarea que daba por perdida.
    const resultado = deps.resultadoGuardado(taskId);
    if (resultado !== null) {
      console.log(`[vigilante] #${taskId} tenía resultado sin anclar: se reintenta la entrega`);
      await deps.reentregar(taskId, resultado);
      huerfanas.delete(id);
      return;
    }

    // CASO 2: el encargo está guardado pero no hay resultado, o sea que el
    // trabajo se quedó a medias. Se retoma.
    const brief = deps.briefGuardado(taskId);
    if (brief !== null) {
      // Se comprueba el hash ANTES de trabajar. El archivo lleva en disco desde
      // otra ejecución y no vale fiarse: si no cuadra con lo que hay en la
      // cadena, trabajar sobre él sería entregar algo que el cliente no pidió.
      if (keccak256(toBytes(brief)) !== task.taskHash) {
        console.error(
          `[vigilante] #${taskId} el encargo guardado NO cuadra con el taskHash de la cadena: se ignora`,
        );
        huerfanas.delete(id);
        return;
      }
      console.log(`[vigilante] #${taskId} se quedó a medias: se retoma el trabajo`);
      await deps.trabajar(taskId, brief);
      huerfanas.delete(id);
      return;
    }

    // CASO 1: hay tarea y no hay encargo. Aquí no se puede hacer nada más que
    // avisar: el texto no está en la cadena y adivinarlo sería inventárselo.
    const visto = huerfanas.get(id);
    if (visto === undefined) {
      huerfanas.set(id, Date.now());
      return;
    }
    if (Date.now() - visto < GRACIA_MS || avisadas.has(id)) return;

    avisadas.add(id);
    // En cuánto vence, no cuándo. La fecha absoluta se imprimía en UTC junto a
    // una marca de log en hora local, y un plazo de dos horas se leía como
    // vencido. Lo que hace falta saber aquí es cuánto margen queda.
    const restanMin = Math.round((Number(task.deadline) * 1000 - Date.now()) / 60000);
    const vence =
      restanMin <= 0
        ? 'YA VENCIDO'
        : restanMin < 60
          ? `en ${restanMin} min`
          : `en ${Math.floor(restanMin / 60)} h ${restanMin % 60} min`;
    console.error(
      `[vigilante] #${taskId} PAGADA Y SIN ENCARGO. ${task.client} bloqueó su pago hace más de ` +
        `${Math.round(GRACIA_MS / 60000)} min y el texto no ha llegado nunca. No se puede adivinar: el escrow ` +
        `solo guarda su hash.\n` +
        `  Que lo reenvíe desde ${deps.urlPublica ? `${deps.urlPublica}/reenviar?task=${taskId}` : 'tu /reenviar'}` +
        ` o desde https://panal.lat/dashboard.\n` +
        `  Si nadie lo hace, el plazo vence ${vence} y el cliente recupera su dinero.`,
    );
  }

  console.log(`Vigilante activo: repasa cada ${CADA} s (VIGILANTE=off para apagarlo).`);
  // Una pasada al arrancar, que es cuando más falta hace: recoge todo lo que
  // se perdió mientras el proceso estaba caído.
  void repasar().catch((err) => console.error(`[vigilante] primer repaso: ${err instanceof Error ? err.message : err}`));

  // El ritmo se reprograma en vez de usar un intervalo fijo: así puede
  // aflojar solo cuando lleva un rato sin encontrar nada.
  let enBlanco = 0;
  let tranquilo = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const programar = (ms: number): void => {
    timer = setTimeout(() => {
      void (async () => {
        let hizoAlgo = false;
        try {
          hizoAlgo = await repasar();
        } catch (err) {
          console.error(`[vigilante] ${err instanceof Error ? err.message : err}`);
        }

        if (hizoAlgo) {
          enBlanco = 0;
          if (tranquilo) {
            tranquilo = false;
            console.log(`[vigilante] hay movimiento: vuelvo a mirar cada ${CADA} s`);
          }
        } else if (++enBlanco >= VUELTAS_EN_BLANCO && !tranquilo) {
          tranquilo = true;
          console.log(
            `[vigilante] ${VUELTAS_EN_BLANCO} vueltas sin nada: paso a mirar cada ${CADA_TRANQUILO} s ` +
              'para no cargar el RPC compartido. Vuelvo al ritmo corto en cuanto haya algo.',
          );
        }
        if (!parado) programar((tranquilo ? CADA_TRANQUILO : CADA) * 1000);
      })();
    }, ms);
    // Sin unref, este temporizador mantiene vivo el proceso para siempre
    // aunque todo lo demás haya terminado.
    timer.unref?.();
  };
  programar(CADA * 1000);

  return {
    parar: () => {
      parado = true;
      if (timer) clearTimeout(timer);
    },
  };
}
