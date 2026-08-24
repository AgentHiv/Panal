/**
 * Panal — las cuentas de un agente: lo que entró y lo que se quedó.
 *
 * Solo aritmética. Lo que va a buscarlas al indexador está en `informe.ts`, y
 * están separados por lo mismo que `ficha.ts` y `agentes.ts`: esto se prueba en
 * Node sin red, y la capa de transporte arrastra `import.meta.env`, que fuera
 * de Vite no existe.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * NO SE MULTIPLICA EL BRUTO POR LA COMISIÓN. Se suma lo que de verdad se pagó.
 *
 * Un informe que hiciera `bruto × 0,975` daría un número que no existe, y no es
 * un detalle fino: de los siete encargos de Audit en agosto, uno acabó en
 * disputa y 22.500 $PANAL volvieron al cliente. Además la comisión de una
 * disputa NO se cobra sobre el bruto — se cobra sobre la parte del trabajador:
 * en la #52 el escrow tenía 25.000, volvieron 22.500, al agente le llegaron
 * 2.437,50 y Panal se quedó 62,50, que es el 2,5 % de 2.500 y no de 25.000.
 *
 * Comprobado contra mainnet: la suma de `workerPaid` de Audit da 85.361,25
 * $PANAL, que es exactamente lo que el escrow tiene guardado para él. Un
 * `110.050 × 0,975 − 22.500` habría dado 84.798,75 — quinientos de menos.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * De ahí que todo salga de los EVENTOS de liquidación y no de las tareas:
 *
 *   TaskCompleted    → workerPaid, fee
 *   DisputeResolved  → workerPaid, clientRefunded (y la comisión se despeja)
 *
 * Y de ahí que `DisputeResolved` haya que emparejarlo a mano: ese evento NO
 * lleva `worker`, así que el filtro por dirección que usa la web se lo salta
 * entero. Justo el caso en que las cuentas cambian.
 */

import type { IndexedEvent } from '@/lib/indexer';

/** Una tarea del indexador. Estructural, para poder probar sin red. */
export interface TareaIndexada {
  taskId: string;
  client: string;
  worker: string;
  amount: string;
  coin: string;
  status: string;
  createdTs: number;
  updatedTs: number;
  resultHash?: string;
  rating?: number;
}

export interface Linea {
  id: string;
  /** Cuándo se liquidó. Es la fecha que cuenta para un periodo. */
  ts: number;
  cliente: string;
  moneda: string;
  /** Lo que el cliente bloqueó en el escrow. */
  bruto: bigint;
  /** Lo que le llegó al agente. */
  pagado: bigint;
  comision: bigint;
  /** Lo que volvió al cliente. Solo en disputas. */
  devuelto: bigint;
  rating: number | null;
  resultHash: string | null;
  /** La transacción que lo prueba. Es lo que hace comprobable el recibo. */
  txHash: string | null;
  disputada: boolean;
}

export interface Cuentas {
  moneda: string;
  bruto: bigint;
  comision: bigint;
  devuelto: bigint;
  /** bruto − comisión − devuelto. Sale de sumar, no de multiplicar. */
  neto: bigint;
  lineas: Linea[];
}

const cero = { bruto: 0n, comision: 0n, devuelto: 0n, neto: 0n };

/**
 * Empareja las tareas de un agente con sus eventos de liquidación.
 *
 * Solo entran las liquidadas: un encargo abierto no ha entrado en caja y
 * ponerlo en un informe de cuentas sería contar lo que aún puede no llegar.
 */
export function armar(
  tareas: TareaIndexada[],
  eventos: IndexedEvent[],
  direccion: string,
): Cuentas[] {
  const dir = direccion.toLowerCase();
  const mias = new Map(
    tareas.filter((t) => t.worker.toLowerCase() === dir).map((t) => [t.taskId, t]),
  );

  const lineas: Linea[] = [];

  for (const ev of eventos) {
    const id = String(ev.args['taskId'] ?? '');
    const tarea = mias.get(id);
    // Un evento de otro agente, o de una tarea que el indexador no tiene.
    if (!tarea) continue;

    const bruto = BigInt(tarea.amount);

    if (ev.event === 'TaskCompleted') {
      const pagado = BigInt(String(ev.args['workerPaid'] ?? '0'));
      lineas.push({
        id,
        ts: ev.ts,
        cliente: tarea.client,
        moneda: tarea.coin,
        bruto,
        pagado,
        comision: BigInt(String(ev.args['fee'] ?? '0')),
        devuelto: 0n,
        rating: tarea.rating ?? null,
        resultHash: tarea.resultHash ?? null,
        txHash: ev.txHash,
        disputada: false,
      });
      continue;
    }

    if (ev.event === 'DisputeResolved') {
      const pagado = BigInt(String(ev.args['workerPaid'] ?? '0'));
      const devuelto = BigInt(String(ev.args['clientRefunded'] ?? '0'));
      // El evento no trae `fee`, así que se despeja. Si por lo que sea saliera
      // negativo, se deja en cero antes que enseñar una comisión imposible.
      const resto = bruto - devuelto - pagado;
      lineas.push({
        id,
        ts: ev.ts,
        cliente: tarea.client,
        moneda: tarea.coin,
        bruto,
        pagado,
        comision: resto > 0n ? resto : 0n,
        devuelto,
        rating: tarea.rating ?? null,
        resultHash: tarea.resultHash ?? null,
        txHash: ev.txHash,
        disputada: true,
      });
    }
  }

  // Una moneda no se suma con otra. Nunca. Un total mezclado no sirve para
  // decidir nada y en un papel de cuentas es directamente falso.
  const porMoneda = new Map<string, Linea[]>();
  for (const l of lineas) {
    const lista = porMoneda.get(l.moneda) ?? [];
    lista.push(l);
    porMoneda.set(l.moneda, lista);
  }

  return [...porMoneda.entries()]
    .map(([moneda, suyas]) => {
      const t = suyas.reduce(
        (a, l) => ({
          bruto: a.bruto + l.bruto,
          comision: a.comision + l.comision,
          devuelto: a.devuelto + l.devuelto,
          neto: a.neto + l.pagado,
        }),
        cero,
      );
      // De más reciente a más viejo, como todo lo demás en la app.
      return { moneda, ...t, lineas: suyas.sort((a, b) => b.ts - a.ts) };
    })
    .sort((a, b) => b.lineas.length - a.lineas.length);
}

/* ── periodos ────────────────────────────────────────────────────────────── */

export interface Periodo {
  /** `2026-08`, que ordena solo. */
  clave: string;
  /**
   * El año y el mes en crudo, no «agosto de 2026».
   *
   * El rótulo lo escribe la pantalla con el idioma puesto. Aquí no se puede:
   * este módulo es puro —se prueba en Node, sin navegador— y el nombre del mes
   * depende del idioma, que es cosa de la interfaz.
   */
  anio: number;
  /** 1-12, como lo dice la gente y no como lo cuenta `Date`. */
  mes: number;
  desde: number;
  hasta: number;
}

/** Los meses en los que este agente cobró algo. Sin meses vacíos por medio. */
export function periodosDe(cuentas: Cuentas[]): Periodo[] {
  const claves = new Set<string>();
  for (const c of cuentas) {
    for (const l of c.lineas) {
      const d = new Date(l.ts * 1000);
      claves.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
  }
  return [...claves]
    .sort()
    .reverse()
    .map((clave) => {
      const [anio, mes] = clave.split('-').map(Number);
      return {
        clave,
        anio: anio!,
        mes: mes!,
        desde: new Date(anio!, mes! - 1, 1).getTime() / 1000,
        hasta: new Date(anio!, mes!, 1).getTime() / 1000,
      };
    });
}

/** Recorta unas cuentas a un periodo, recalculando los totales. */
export function enPeriodo(cuentas: Cuentas[], p: Periodo | null): Cuentas[] {
  if (!p) return cuentas;
  return cuentas
    .map((c) => {
      const lineas = c.lineas.filter((l) => l.ts >= p.desde && l.ts < p.hasta);
      const t = lineas.reduce(
        (a, l) => ({
          bruto: a.bruto + l.bruto,
          comision: a.comision + l.comision,
          devuelto: a.devuelto + l.devuelto,
          neto: a.neto + l.pagado,
        }),
        cero,
      );
      return { moneda: c.moneda, ...t, lineas };
    })
    .filter((c) => c.lineas.length > 0);
}
