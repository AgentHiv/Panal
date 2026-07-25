/**
 * Panal — Configuración web3 (Monad testnet).
 * Cadena, direcciones de los contratos desplegados y config de wagmi
 * (conector injected: MetaMask / Rabby / etc.).
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

export const PANAL_REGISTRY_ADDRESS = '0x7e00b165198dB7EA7F3237f04f0f56138D367F7F' as const;
export const PANAL_REPUTATION_ADDRESS = '0xB7C23d8A2e954C2EBce35fCd90F44f1bDFcF1F9a' as const;
export const PANAL_ESCROW_ADDRESS = '0xE0264F84b5Cab935Fee4948440773CFd83eb0D7a' as const;

export const EXPLORER_TX = (hash: string) => `https://testnet.monadvision.com/tx/${hash}`;

export const wagmiConfig = createConfig({
  chains: [monadTestnet],
  connectors: [injected()],
  transports: {
    [monadTestnet.id]: http('https://testnet-rpc.monad.xyz'),
  },
});

/** Cliente de solo lectura — funciona sin wallet conectada. */
export const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: http('https://testnet-rpc.monad.xyz'),
});
