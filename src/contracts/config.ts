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

export const IS_MAINNET = import.meta.env.VITE_CHAIN === 'mainnet';

/** Red activa de la dApp. */
export const activeChain = IS_MAINNET ? monadMainnet : monadTestnet;

const TESTNET_ADDRESSES = {
  registry: '0x7e00b165198dB7EA7F3237f04f0f56138D367F7F',
  reputation: '0xB7C23d8A2e954C2EBce35fCd90F44f1bDFcF1F9a',
  escrow: '0xE0264F84b5Cab935Fee4948440773CFd83eb0D7a',
} as const;

// TODO(mainnet): sustituir por las direcciones reales tras desplegar
// con `forge script script/Deploy.s.sol --rpc-url https://rpc.monad.xyz` (ver MAINNET.md).
// Desplegados en Monad mainnet el 2026-07-27 (versión hardenida post-auditoría).
const MAINNET_ADDRESSES = {
  registry: '0xe13C7d97e1EBc13A296e725DA90Bf3B04fDBf496',
  reputation: '0xadAd5582B2023aAE7a89d42d6aF0B530c6C3e4D6',
  escrow: '0x80db3eD4e50e3405B7F1b9e4a0bD5c0a901e4D2d',
} as const;

const ADDR = IS_MAINNET ? MAINNET_ADDRESSES : TESTNET_ADDRESSES;

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

/** Moneda nativa (MON) codificada como address(0) en los contratos v2. */
export const NATIVE_CURRENCY: `0x${string}` = ZERO_ADDRESS;

// Fail-closed: un build mainnet con direcciones placeholder quemaría fondos
// (un CALL con valor a 0x0 tiene éxito aparente). Mejor romper el arranque.
if (IS_MAINNET && Object.values(ADDR).some((a) => a === (ZERO_ADDRESS as string))) {
  throw new Error(
    '[Panal] Build mainnet sin direcciones de contratos reales. ' +
      'Rellena MAINNET_ADDRESSES en src/contracts/config.ts (ver MAINNET.md).',
  );
}

export const PANAL_REGISTRY_ADDRESS = ADDR.registry;
export const PANAL_REPUTATION_ADDRESS = ADDR.reputation;
export const PANAL_ESCROW_ADDRESS = ADDR.escrow;

/**
 * Contratos v2 (dual-moneda MON + $PANAL) — fuente auditada en
 * contracts/src/v2/. AÚN NO desplegados.
 * TODO(deploy v2): rellenar tras `forge script script/DeployV2.s.sol`.
 * Fail-closed: con direcciones en cero V2_ENABLED es false y toda la UI
 * sigue el comportamiento v1 (sin selector de moneda ni flujo approve).
 */
export const V2_ADDRESSES = {
  registry: ZERO_ADDRESS,
  reputation: ZERO_ADDRESS,
  escrow: ZERO_ADDRESS,
} as const;

/** true solo en mainnet Y con las tres direcciones v2 rellenadas. */
export const V2_ENABLED =
  IS_MAINNET && !(Object.values(V2_ADDRESSES) as string[]).includes(ZERO_ADDRESS);

export const PANAL_REGISTRY_V2_ADDRESS = V2_ADDRESSES.registry as `0x${string}`;
export const PANAL_REPUTATION_V2_ADDRESS = V2_ADDRESSES.reputation as `0x${string}`;
export const PANAL_ESCROW_V2_ADDRESS = V2_ADDRESSES.escrow as `0x${string}`;

const EXPLORER_BASE = IS_MAINNET ? 'https://monadvision.com' : 'https://testnet.monadvision.com';
export const EXPLORER_TX = (hash: string) => `${EXPLORER_BASE}/tx/${hash}`;
export const EXPLORER_ADDRESS = (addr: string) => `${EXPLORER_BASE}/address/${addr}`;

/**
 * Token oficial $PANAL (ERC-20, EIP-1167 proxy) — lanzado en Monad mainnet.
 * Verificado on-chain: name "PANAL", symbol "PANAL", 18 decimales,
 * supply total 1.000.000.000. Solo existe en mainnet.
 */
export const PANAL_TOKEN_ADDRESS = '0x2e2e44e7fa6178822d4397299f719e89d1a67777' as const;

/** Símbolo de UI para una `currency` on-chain: address(0) = MON, PANAL_TOKEN = $PANAL. */
export function currencySymbol(currency?: string | null): 'MON' | '$PANAL' {
  return currency && currency.toLowerCase() === PANAL_TOKEN_ADDRESS.toLowerCase() ? '$PANAL' : 'MON';
}

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
