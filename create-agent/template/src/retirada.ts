/**
 * ────────────────────────────────────────────────────────────────────────────
 *  La retirada automática: lo que el escrow le debe a este agente, a su wallet.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * POR QUÉ EXISTE. El escrow de Panal es de pago TIRADO: aprobar un encargo le
 * ACREDITA el dinero al agente dentro del contrato, no se lo manda. Hasta que
 * alguien llama a `withdraw`, se queda ahí. Un humano lo ve en el panel y le da
 * al botón; un agente que corre solo, sin nadie mirando, acumulaba cobros sin
 * recogerlos nunca. Los cuatro agentes de Panal llegaron a tener más de 2 MON y
 * 3.000 $PANAL parados en el escrow.
 *
 * Este agente tiene su clave en el .env —con ella firma cada entrega—, así que
 * puede retirar solo. Una persona que vende por el buzón no: su clave está en
 * su wallet y nadie más puede retirar por ella, que es justo lo que protege el
 * contrato (`withdraw` le paga siempre a quien llama).
 *
 * CUÁNDO RETIRA, Y POR QUÉ NO SIEMPRE. Retirar cuesta gas, y el gas se paga en
 * MON aunque lo retirado sea $PANAL. Medido en mainnet el 2026-09-14:
 *
 *     retirar MON      55.157 de gas   ≈ 0,0056 MON
 *     retirar $PANAL  103.511 de gas   ≈ 0,0106 MON
 *
 * Retirar 0,049 MON en cada encargo sería dejarse un 13 % por el camino. Así
 * que:
 *
 *   - En MON se retira cuando el gas no pasa de `maxGasPct` de lo retirado (2 %
 *     por defecto). Es una regla sobre el gas DE AHORA, no un número fijo: si
 *     el gas sube, espera a que haya más; si baja, retira antes.
 *   - En $PANAL se retira a partir de `panalDesde` (1000 por defecto). Ahí no
 *     hay regla relativa posible: el gas es en MON y el token no tiene precio
 *     con el que compararlo.
 *
 * Y en los dos casos solo si la wallet cubre la RESERVA de Monad —límite de gas
 * × precio máximo—, que se bloquea antes de ejecutar aunque luego se cobre
 * menos. Sin esa comprobación, el nodo rechaza con «insufficient balance» y un
 * reintento con el mismo nonce y las mismas comisiones repite el rechazo.
 *
 * EL GAS SE FIJA A MANO, Y ESTO COSTÓ 1,096 MON APRENDERLO. viem no estima el
 * gas: le pide al nodo que rellene la transacción (`eth_fillTransaction`), y el
 * de Monad devuelve un gas disparatado justo para `withdraw(address(0))` —1,05 M
 * para una wallet, 10,7 M para otra—, cuando lo necesario son 55.157. Y Monad
 * cobra el LÍMITE de gas entero, no lo usado. La primera retirada automática de
 * Lint sacó 1,092 MON y pagó 1,096 de gas (2026-09-14, tx 0xa960cb7e…). Así
 * que el gas sale de `eth_estimateGas` —que sí da el número bueno—, con un 10 %
 * de margen, y se pasa explícito: viem lo respeta. Y si la estimación vuelve por
 * encima de `TOPE_GAS`, no se firma nada.
 *
 * NUNCA A LA VEZ QUE UNA ENTREGA. Si hay un encargo en marcha, la ronda se
 * salta: dos transacciones seguidas de la misma wallet chocan por el nonce, y
 * en Monad una lanzada justo después de otra revierte. Por lo mismo, entre
 * retirar MON y retirar $PANAL se espera un rato.
 */

import type { Address, Hex } from 'viem';
import { formatEther, parseEther } from 'viem';
import { NATIVE_CURRENCY, escrowAbi, type PanalClient } from '@panal/sdk';

export interface OpcionesRetirada {
  /** Cada cuánto se mira el escrow, en minutos. */
  minutos: number;
  /** MON: retirar solo si el gas (reserva) no pasa de este % de lo retirado. */
  maxGasPct: number;
  /** $PANAL: retirar a partir de esta cantidad, en wei. */
  panalDesde: bigint;
}

/**
 * Por encima de esto una retirada no se firma. Retirar MON son 55.157 de gas y
 * $PANAL 103.511: 300.000 deja margen de sobra para cualquier retirada honrada
 * y corta en seco una estimación disparatada antes de que se cobre.
 */
export const TOPE_GAS = 300_000n;

/** El gas con el que se firma: lo estimado más un 10 %. */
export function gasConMargen(estimado: bigint): bigint {
  return (estimado * 11n + 9n) / 10n;
}

export const RETIRADA_POR_DEFECTO: OpcionesRetirada = {
  minutos: 60,
  maxGasPct: 2,
  panalDesde: parseEther('1000'),
};

/**
 * Las opciones del .env, o `null` si está apagada (`RETIRADA=off`).
 *
 * Un valor que no se entiende no apaga nada ni lanza: se usa el de por defecto
 * y se dice en el log. Un agente que se niega a arrancar por una errata en una
 * variable opcional es peor que uno que retira con el umbral de siempre.
 */
export function opcionesDelEntorno(
  env: Record<string, string | undefined>,
  avisar: (m: string) => void = (m) => console.warn(m),
): OpcionesRetirada | null {
  if (env.RETIRADA?.trim().toLowerCase() === 'off') return null;
  const o = { ...RETIRADA_POR_DEFECTO };

  const minutos = Number(env.RETIRADA_MINUTOS);
  if (env.RETIRADA_MINUTOS?.trim()) {
    if (Number.isFinite(minutos) && minutos >= 5) o.minutos = minutos;
    else avisar(`[retirada] RETIRADA_MINUTOS="${env.RETIRADA_MINUTOS}" no vale (mínimo 5): uso ${o.minutos}.`);
  }
  const pct = Number(env.RETIRADA_MAX_GAS_PCT);
  if (env.RETIRADA_MAX_GAS_PCT?.trim()) {
    if (Number.isFinite(pct) && pct > 0 && pct <= 50) o.maxGasPct = pct;
    else avisar(`[retirada] RETIRADA_MAX_GAS_PCT="${env.RETIRADA_MAX_GAS_PCT}" no vale (0-50): uso ${o.maxGasPct}.`);
  }
  if (env.RETIRADA_PANAL_DESDE?.trim()) {
    try {
      o.panalDesde = parseEther(env.RETIRADA_PANAL_DESDE.trim());
    } catch {
      avisar(`[retirada] RETIRADA_PANAL_DESDE="${env.RETIRADA_PANAL_DESDE}" no vale: uso ${formatEther(o.panalDesde)}.`);
    }
  }
  return o;
}

export interface DepsRetirada {
  panal: PanalClient;
  yo: Address;
  opciones: OpcionesRetirada;
  /** ¿Hay un encargo en marcha? Entonces no se toca la wallet. */
  ocupado: () => boolean;
  /** Pausa entre dos retiradas seguidas. Inyectable para las pruebas. */
  esperar?: (ms: number) => Promise<void>;
  log?: (m: string) => void;
}

/**
 * Una ronda: mira lo que se debe en cada moneda y retira lo que compense.
 *
 * Devuelve lo que hizo, línea a línea, para que las pruebas lo puedan leer.
 * Nunca lanza: un fallo aquí no puede tumbar el agente que atiende encargos.
 */
export async function repasarRetirada(deps: DepsRetirada): Promise<string[]> {
  const log = deps.log ?? ((m: string) => console.log(m));
  const esperar = deps.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const hecho: string[] = [];
  const anotar = (m: string): void => {
    hecho.push(m);
    log(m);
  };

  if (deps.ocupado()) return hecho;

  const { panal, yo, opciones } = deps;
  const monedas: Array<{ direccion: Address; simbolo: 'MON' | '$PANAL' }> = [
    { direccion: NATIVE_CURRENCY, simbolo: 'MON' },
    { direccion: panal.addresses.panalToken, simbolo: '$PANAL' },
  ];

  let retiradas = 0;
  for (const { direccion, simbolo } of monedas) {
    try {
      const pendiente = await panal.getPendingWithdrawal(yo, direccion);
      if (pendiente === 0n) continue;

      // $PANAL: el umbral se mira antes de gastar ni una lectura más.
      if (simbolo === '$PANAL' && pendiente < opciones.panalDesde) continue;

      const llamada = {
        address: panal.addresses.escrow,
        abi: escrowAbi,
        functionName: 'withdraw',
        args: [direccion],
      } as const;
      const [estimado, comisiones, saldo] = await Promise.all([
        panal.publicClient.estimateContractGas({ ...llamada, account: yo } as never),
        panal.publicClient.estimateFeesPerGas(),
        panal.publicClient.getBalance({ address: yo }),
      ]);
      const gas = gasConMargen(estimado);
      if (gas > TOPE_GAS) {
        anotar(
          `[retirada] la estimación de gas para retirar ${simbolo} salió en ${estimado}, por encima del tope ` +
            `de ${TOPE_GAS}: no se firma nada. Monad cobra el límite entero.`,
        );
        continue;
      }
      // La reserva, con el MISMO gas con el que se va a firmar.
      const reserva = gas * comisiones.maxFeePerGas;

      // MON: que el gas no se coma más de maxGasPct de lo que se retira. Se
      // compara con la RESERVA, que es la cota alta: si compensa con ella,
      // compensa con lo que de verdad se cobre.
      if (simbolo === 'MON' && reserva * 10_000n > pendiente * BigInt(Math.round(opciones.maxGasPct * 100))) continue;

      if (saldo < reserva) {
        anotar(
          `[retirada] ${formatEther(pendiente)} ${simbolo} esperan en el escrow, pero la wallet tiene ` +
            `${formatEther(saldo)} MON y retirar reserva ${formatEther(reserva)} MON de gas. Recarga un poco de MON.`,
        );
        continue;
      }

      // Otra transacción de esta wallet justo antes revierte en Monad.
      if (retiradas > 0) await esperar(20_000);
      if (deps.ocupado()) return hecho;

      const wallet = panal.walletClient;
      if (!wallet) {
        anotar('[retirada] el cliente no tiene cuenta para firmar: no se puede retirar.');
        return hecho;
      }
      const hash: Hex = await wallet.writeContract({
        ...llamada,
        // Explícito. Sin esto viem le pide el gas al nodo y paga lo que diga.
        gas,
        chain: panal.publicClient.chain,
        account: wallet.account ?? yo,
      } as never);
      // Un revert también llega con recibo: hay que mirar `status`.
      const recibo = await panal.publicClient.waitForTransactionReceipt({ hash });
      if (recibo.status !== 'success') {
        anotar(`[retirada] retirar ${simbolo} revirtió (tx ${hash}): sigue acreditado, se reintenta en la próxima ronda.`);
        continue;
      }
      retiradas++;
      anotar(`[retirada] ${formatEther(pendiente)} ${simbolo} retirados a la wallet · tx ${hash}`);
    } catch (err) {
      anotar(`[retirada] no se pudo retirar ${simbolo}: ${err instanceof Error ? err.message.split('\n')[0] : err}`);
    }
  }
  return hecho;
}

/**
 * Arranca las rondas. La primera, a los dos minutos: el agente acaba de
 * arrancar y lo primero es atender encargos, no mover dinero.
 */
export function arrancarRetirada(deps: DepsRetirada): void {
  const { opciones } = deps;
  console.log(
    `Retirada automática: cada ${opciones.minutos} min · MON cuando el gas no pase del ${opciones.maxGasPct} % · ` +
      `$PANAL desde ${formatEther(opciones.panalDesde)} (RETIRADA=off la apaga).`,
  );
  let enMarcha = false;
  const ronda = async (): Promise<void> => {
    if (enMarcha) return;
    enMarcha = true;
    try {
      await repasarRetirada(deps);
    } finally {
      enMarcha = false;
    }
  };
  setTimeout(() => void ronda(), 2 * 60_000);
  setInterval(() => void ronda(), opciones.minutos * 60_000);
}
