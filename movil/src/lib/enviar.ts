/**
 * Panal — firmar y mandar desde una wallet del llavero.
 *
 * Este es el archivo que rompe la frontera: hasta ahora, una wallet creada en
 * el teléfono era una dirección y doce palabras, y para mover algo había que
 * escribir esas doce palabras en otra wallet. Aquí se firma con la clave que ya
 * está en el móvil.
 *
 * NO PASA POR WAGMI, Y ES A PROPÓSITO
 *
 * El resto de la app firma por WalletConnect: se manda la petición a la wallet
 * de la persona, que abre su app y aprueba. Eso vale cuando la clave es suya y
 * está fuera. Aquí la clave es esta, está dentro, y no hay a quién preguntar:
 * se construye un `WalletClient` de viem con la cuenta local y se manda al RPC
 * directamente. Meterlo en wagmi habría exigido escribir un conector entero
 * para que el único cliente fuera esta misma pantalla.
 *
 * El precio de eso está dicho en la pantalla: aquí no hay una segunda app que
 * enseñe lo que se firma. Lo que se ve antes de pulsar es lo único que hay, así
 * que la hoja de confirmación enseña destino y cantidad enteros.
 */

import { createWalletClient, http } from 'viem';
import type { Account } from 'viem';
import { activeChain, PANAL_TOKEN_ADDRESS, publicClient } from '@/contracts/config';
import { panalTokenAbi } from '@/contracts/abis';
import type { Moneda } from '~/lib/envio';

export type Resultado = { ok: true; hash: `0x${string}` } | { ok: false; pega: string };

export interface Orden {
  cuenta: Account;
  moneda: Moneda;
  /** Ya en unidades mínimas: lo que devolvió `revisar`. */
  wei: bigint;
  destino: `0x${string}`;
}

function cliente(cuenta: Account) {
  return createWalletClient({
    account: cuenta,
    chain: activeChain,
    transport: http(activeChain.rpcUrls.default.http[0]),
  });
}

/**
 * Manda, y devuelve el hash sin esperar a que entre en un bloque.
 *
 * Van separados a propósito: el hash existe en cuanto el nodo acepta la
 * transacción, y enseñarlo entonces —en vez de dejar la pantalla girando— es lo
 * que permite a quien manda ir a mirarlo al explorador si algo tarda.
 */
export async function enviar({ cuenta, moneda, wei, destino }: Orden): Promise<Resultado> {
  try {
    const hash =
      moneda === 'MON'
        ? await cliente(cuenta).sendTransaction({ to: destino, value: wei })
        : await cliente(cuenta).writeContract({
            address: PANAL_TOKEN_ADDRESS,
            abi: panalTokenAbi,
            functionName: 'transfer',
            args: [destino, wei],
          });
    return { ok: true, hash };
  } catch (e) {
    return { ok: false, pega: traducir(e) };
  }
}

/** Espera a que entre en un bloque. `false` si la transacción se revirtió. */
export async function esperar(hash: `0x${string}`): Promise<boolean> {
  const recibo = await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
  return recibo.status === 'success';
}

/**
 * Los errores del nodo, dichos como se los cuenta uno a otra persona.
 *
 * Un `execution reverted` o un JSON-RPC -32000 en medio de la pantalla no le
 * dice a nadie qué hacer. Lo que sí dice algo es «te falta MON para la
 * comisión», que además es el fallo que se va a llevar nueve de cada diez.
 */
function traducir(e: unknown): string {
  const texto = (e instanceof Error ? `${e.name} ${e.message}` : String(e)).toLowerCase();
  if (texto.includes('insufficient funds') || texto.includes('exceeds the balance'))
    return 'No llega para la cantidad más la comisión de red. Manda un poco menos.';
  if (texto.includes('transfer amount exceeds balance'))
    return 'La wallet no tiene ese saldo.';
  if (texto.includes('nonce'))
    return 'Hay otra transacción de esta wallet todavía en marcha. Espera a que termine.';
  if (texto.includes('timeout') || texto.includes('fetch') || texto.includes('network'))
    return 'No se ha podido hablar con la red. Comprueba la conexión y vuelve a intentarlo.';
  if (texto.includes('user rejected')) return 'Cancelado.';
  return 'La red ha rechazado la transacción. No se ha movido nada.';
}
