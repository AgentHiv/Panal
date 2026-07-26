/**
 * Panal — Configuración web3 (Monad).
 * Cadena, direcciones de los contratos desplegados y config de wagmi
 * (conector injected: MetaMask / Rabby / etc.).
 *
 * Red activa: por defecto **Monad testnet** (10143).
 * Para mainnet define `VITE_CHAIN=mainnet` en el build (ver MAINNET.md).
 */

import { defineChain, createPublicClient, http } from 'viem';
import { createConfig } from 'wagmi';
import { injected } from 'wagmi/connectors';

export const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://testnet-rpc.monad.xyz'] },
  },
  blockExplorers: {
    default: { name: 'MonadVision', url: 'https://testnet.monadvision.com' },
  },
  testnet: true,
});

export const monadMainnet = defineChain({
  id: 143,
  name: 'Monad',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.monad.xyz'] },
  },
  blockExplorers: {
    default: { name: 'MonadVision', url: 'https://monadvision.com' },
  },
});

const IS_MAINNET = import.meta.env.VITE_CHAIN === 'mainnet';

/** Red activa de la dApp. */
export const activeChain = IS_MAINNET ? monadMainnet : monadTestnet;

const TESTNET_ADDRESSES = {
  registry: '0x7e00b165198dB7EA7F3237f04f0f56138D367F7F',
  reputation: '0xB7C23d8A2e954C2EBce35fCd90F44f1bDFcF1F9a',
  escrow: '0xE0264F84b5Cab935Fee4948440773CFd83eb0D7a',
} as const;

// TODO(mainnet): sustituir por las direcciones reales tras desplegar
// con `forge script script/Deploy.s.sol --rpc-url https://rpc.monad.xyz` (ver MAINNET.md).
const MAINNET_ADDRESSES = {
  registry: '0x0000000000000000000000000000000000000000',
  reputation: '0x0000000000000000000000000000000000000000',
  escrow: '0x0000000000000000000000000000000000000000',
} as const;

const ADDR = IS_MAINNET ? MAINNET_ADDRESSES : TESTNET_ADDRESSES;

export const PANAL_REGISTRY_ADDRESS = ADDR.registry;
export const PANAL_REPUTATION_ADDRESS = ADDR.reputation;
export const PANAL_ESCROW_ADDRESS = ADDR.escrow;

const EXPLORER_BASE = IS_MAINNET ? 'https://monadvision.com' : 'https://testnet.monadvision.com';
export const EXPLORER_TX = (hash: string) => `${EXPLORER_BASE}/tx/${hash}`;

export const wagmiConfig = createConfig({
  chains: [activeChain],
  connectors: [injected()],
  transports: {
    // wagmi exige transport tipado para ambas cadenas de la unión;
    // en runtime solo se usa la de `activeChain`.
    [monadTestnet.id]: http(monadTestnet.rpcUrls.default.http[0]),
    [monadMainnet.id]: http(monadMainnet.rpcUrls.default.http[0]),
  },
});

/** Cliente de solo lectura — funciona sin wallet conectada. */
export const publicClient = createPublicClient({
  chain: activeChain,
  transport: http(activeChain.rpcUrls.default.http[0]),
});
