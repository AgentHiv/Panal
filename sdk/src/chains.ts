/**
 * Panal SDK — redes y direcciones de los contratos.
 *
 * Hasta ahora esto vivía duplicado en tres sitios: el frontend
 * (`src/contracts/config.ts`, atado a `import.meta.env` de Vite), el bot
 * (`bot/src/config.ts`) y el servidor MCP. Quien quisiera integrarse con Panal
 * tenía que copiar las direcciones a mano de uno de ellos, y cuando un contrato
 * rotara no habría forma de enterarse. Aquí son un dato exportado y versionado
 * con el paquete.
 */

import { defineChain } from 'viem';
import type { Address } from 'viem';

/** Monad mainnet. Es la red por defecto: Panal está desplegado y en uso ahí. */
export const monad = defineChain({
  id: 143,
  name: 'Monad',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.monad.xyz'] } },
  blockExplorers: { default: { name: 'MonadVision', url: 'https://monadvision.com' } },
});

/** Monad testnet, para probar un agente sin gastar dinero real. */
export const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz'] } },
  blockExplorers: { default: { name: 'MonadVision', url: 'https://testnet.monadvision.com' } },
  testnet: true,
});

export type PanalNetwork = 'mainnet' | 'testnet';

export interface PanalAddresses {
  registry: Address;
  escrow: Address;
  /** El token $PANAL. Los agentes pueden cobrar en él o en MON nativo. */
  panalToken: Address;
  /** Multisig 2-de-3 que resuelve las disputas. Se lee del escrow en caliente. */
  arbitrator: Address;
}

/** Desplegados en Monad mainnet el 2026-07-29 (escrow v2 auditado). */
export const MAINNET_ADDRESSES: PanalAddresses = {
  registry: '0x89a812BFb1c35fc814ef25a3E6Ca75068B16Ac51',
  escrow: '0xe138A9A492CFe27A13f8b7A6D312DA831791bCe9',
  panalToken: '0x2e2e44e7fa6178822d4397299f719e89d1a67777',
  arbitrator: '0xc384C1F5D6716571DA84329BeAaE6F064C6b1Fe0',
};

/**
 * En testnet solo hay registry y escrow desplegados. El resto queda a cero: el
 * cliente avisa si se pide una operación que los necesite, en vez de mandar una
 * transacción a la dirección cero.
 */
export const TESTNET_ADDRESSES: PanalAddresses = {
  registry: '0x0000000000000000000000000000000000000000',
  escrow: '0x0000000000000000000000000000000000000000',
  panalToken: '0x0000000000000000000000000000000000000000',
  arbitrator: '0x0000000000000000000000000000000000000000',
};

/** `address(0)` significa MON nativo en todo el protocolo. */
export const NATIVE_CURRENCY: Address = '0x0000000000000000000000000000000000000000';

export function addressesFor(network: PanalNetwork): PanalAddresses {
  return network === 'mainnet' ? MAINNET_ADDRESSES : TESTNET_ADDRESSES;
}

export function chainFor(network: PanalNetwork) {
  return network === 'mainnet' ? monad : monadTestnet;
}

/** Comisión del protocolo, en puntos básicos (250 = 2,5 %). */
export const FEE_BPS = 250n;
/** Si el cliente no aprueba ni disputa, el pago se libera solo pasado esto. */
export const AUTO_RELEASE_SECONDS = 3 * 24 * 60 * 60;
/** Si el árbitro no resuelve una disputa en este plazo, se reembolsa al cliente. */
export const DISPUTE_TIMEOUT_SECONDS = 14 * 24 * 60 * 60;
