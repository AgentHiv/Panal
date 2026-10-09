/**
 * Las monedas con las que se paga una consulta x402 en Panal.
 *
 * POR QUÉ UNA LISTA CERRADA
 *
 * La cotización la escribe el agente: qué token, qué importe y cómo se llama.
 * Fiarse de eso para enseñar el precio era el agujero. Un agente podía cobrar
 * en un token de 6 decimales y llamarlo «$PANAL»: 1.000 USDC se pintaban
 * «0,000000001 $PANAL» y la persona firmaba un permiso por 1.000 USDC creyendo
 * que no pagaba nada.
 *
 * Aquí se fija, para cada red, qué tokens se aceptan y con qué nombre y
 * decimales. El nombre y los decimales salen SIEMPRE de esta lista, nunca de
 * la cotización, y un token que no está aquí no se paga. Es la misma lista
 * para todas las capas —web, app, MCP y agentes— para que ninguna pueda
 * enseñar un precio distinto del que se firma.
 *
 * Las cuatro de token cobran con `permit` (EIP-2612), comprobado en mainnet:
 * firma gratis, y el gas lo pone el agente que cobra. MON, la moneda nativa,
 * no tiene `permit`: quien paga MANDA una transferencia (paga él su gas, una
 * fracción de céntimo) y la presenta. Ver `native-transfer` en x402-server.ts.
 *
 *   - MON    — la moneda de Monad. Nadie puede congelarla.
 *   - $PANAL — el token de Panal.
 *   - GHO    — de Aave. Respaldo cripto, sin lista negra ni pausa: nadie puede
 *              congelarlo. La opción estable que no depende de una empresa.
 *   - USDC   — de Circle. Respaldo en dólares; Circle puede congelar
 *              direcciones y pausar el token.
 *   - AUSD   — de Agora. Respaldo en dólares; Agora puede congelar
 *              direcciones y pausar transferencias.
 *
 * En x402 que USDC y AUSD se puedan congelar pesa poco: Panal no guarda nada,
 * el dinero va directo de quien paga al agente, y si alguien es congelado es
 * en su propia wallet. Cada uno elige con qué paga o cobra.
 */

import { formatUnits, getAddress, parseUnits, type Address } from 'viem';
import type { PanalNetwork } from './chains.js';

/**
 * Cómo se cobra en una moneda: con una firma de `permit` que ejecuta quien
 * cobra, o con una transferencia que manda quien paga.
 */
export type X402Scheme = 'eip2612-permit' | 'native-transfer';

/** La moneda nativa, como la escribe Panal en todas partes: la dirección cero. */
export const X402_NATIVE = '0x0000000000000000000000000000000000000000' as Address;

const MON: X402Currency = {
  symbol: 'MON',
  address: X402_NATIVE,
  decimals: 18,
  scheme: 'native-transfer',
  issuerCanFreeze: false,
};

export interface X402Currency {
  /** Como se enseña: `$PANAL`, `GHO`, `USDC`, `AUSD`. */
  symbol: string;
  address: Address;
  decimals: number;
  scheme: X402Scheme;
  /** Si su emisor puede congelar direcciones o pausar el token. */
  issuerCanFreeze: boolean;
}

const MAINNET: readonly X402Currency[] = [
  {
    symbol: '$PANAL',
    address: getAddress('0x2e2e44e7fa6178822d4397299f719e89d1a67777'),
    decimals: 18,
    scheme: 'eip2612-permit',
    issuerCanFreeze: false,
  },
  MON,
  {
    symbol: 'GHO',
    address: getAddress('0xfc421ad3c883bf9e7c4f42de845c4e4405799e73'),
    decimals: 18,
    scheme: 'eip2612-permit',
    issuerCanFreeze: false,
  },
  {
    symbol: 'USDC',
    address: getAddress('0x754704bc059f8c67012fed69bc8a327a5aafb603'),
    decimals: 6,
    scheme: 'eip2612-permit',
    issuerCanFreeze: true,
  },
  {
    symbol: 'AUSD',
    address: getAddress('0x00000000efe302beaa2b3e6e1b18d08d69a9012a'),
    decimals: 6,
    scheme: 'eip2612-permit',
    issuerCanFreeze: true,
  },
];

/** En testnet no hay ninguno de estos tokens, pero MON sí. */
const TESTNET: readonly X402Currency[] = [MON];

/** Las monedas aceptadas en una red, en el orden en que se ofrecen. */
export function x402Currencies(network: PanalNetwork = 'mainnet'): readonly X402Currency[] {
  return network === 'mainnet' ? MAINNET : TESTNET;
}

/** La red de un chainId de Monad, o `null` si no es ninguna de las dos. */
export function networkOfChain(chainId: number): PanalNetwork | null {
  return chainId === 143 ? 'mainnet' : chainId === 10143 ? 'testnet' : null;
}

/**
 * La moneda de un token, o `null` si Panal no acepta pagar en él.
 *
 * Por dirección: el nombre lo puede escribir cualquiera, la dirección no.
 */
export function x402Currency(token: string, network: PanalNetwork = 'mainnet'): X402Currency | null {
  const t = token.trim().toLowerCase();
  return x402Currencies(network).find((c) => c.address.toLowerCase() === t) ?? null;
}

/**
 * Lo mismo, admitiendo también el símbolo: `USDC`, `gho`, `$PANAL` o `PANAL`.
 * Es para configurar un agente a mano (`X402_TOKEN=USDC`), no para leer lo que
 * llega de fuera: eso va siempre por dirección.
 */
export function x402CurrencyByName(name: string, network: PanalNetwork = 'mainnet'): X402Currency | null {
  const n = name.trim().replace(/^\$/, '').toUpperCase();
  return x402Currencies(network).find((c) => c.symbol.replace(/^\$/, '').toUpperCase() === n) ?? x402Currency(name, network);
}

/** Un importe en unidades mínimas, en texto legible: `0.05`. */
export function formatX402Amount(amount: bigint | string, currency: X402Currency): string {
  return formatUnits(BigInt(amount), currency.decimals);
}

/** `0.05` → unidades mínimas de esa moneda. Lanza si el texto no es un número. */
export function parseX402Amount(text: string, currency: X402Currency): bigint {
  return parseUnits(text.trim(), currency.decimals);
}
