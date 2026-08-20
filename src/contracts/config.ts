/**
 * Panal — Configuración web3 (Monad).
 * Cadena, direcciones de los contratos desplegados y config de wagmi
 * (conectores injected: MetaMask, Trust Wallet, Rabby, etc. + descubrimiento
 * EIP-6963).
 *
 * Red activa: **Monad mainnet** (143) por defecto; `VITE_CHAIN=testnet`
 * fuerza Monad testnet (10143) solo para desarrollo (ver MAINNET.md).
 */

import { defineChain, createPublicClient, http } from 'viem';
import type { EIP1193Provider } from 'viem';
import { createConfig } from 'wagmi';
import type { CreateConnectorFn } from 'wagmi';
import { injected, walletConnect } from 'wagmi/connectors';

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

/**
 * El RPC, configurable sin recompilar.
 *
 * Estaba escrito en el codigo, y eso significaba que el dia que el publico se
 * degradara no habria forma de reaccionar sin un despliegue. Con miles de
 * agentes ese dia llega: medido, el publico sirve rafagas de ~50 llamadas
 * concurrentes y a las 150 rechaza mas de la mitad con 429 — y una sola carga
 * del mercado ya gasta ~100.
 *
 * Se pone VITE_RPC_URL en el entorno del despliegue y se recarga. Sin ella,
 * el publico, que es lo que hay hoy.
 */
const RPC_MAINNET = import.meta.env.VITE_RPC_URL?.trim() || 'https://rpc.monad.xyz';

export const monadMainnet = defineChain({
  id: 143,
  name: 'Monad',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: {
    default: { http: [RPC_MAINNET] },
  },
  blockExplorers: {
    default: { name: 'MonadVision', url: 'https://monadvision.com' },
  },
});

/**
 * MAINNET ES EL MODO POR DEFECTO (decisión de producto: Panal vive en Monad
 * mainnet). Solo se usa testnet si el build lo pide explícitamente con
 * `VITE_CHAIN=testnet`.
 */
export const IS_MAINNET = import.meta.env.VITE_CHAIN !== 'testnet';

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
// Desplegados en Monad mainnet el 2026-07-29 (v2 auditado, 112/112 tests).
export const V2_ADDRESSES = {
  registry: '0x89a812BFb1c35fc814ef25a3E6Ca75068B16Ac51',
  reputation: '0xAa15923A93B7A2261D051F9F4302ca05e9a16701',
  escrow: '0xe138A9A492CFe27A13f8b7A6D312DA831791bCe9',
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
/**
 * PanalMultisig: el 2-de-3 que arbitra las disputas.
 *
 * La web no le llama a nada; se enseña para que cualquiera pueda ir a
 * comprobar que el arbitraje no depende de una sola clave, que es una promesa
 * que sin la direccion delante no se puede verificar.
 */
export const PANAL_MULTISIG_ADDRESS = '0xc384C1F5D6716571DA84329BeAaE6F064C6b1Fe0' as const;

/** PanalNames: los nombres unicos de los agentes. Desplegado 2026-08-14. */
export const PANAL_NAMES_ADDRESS = '0xc94a8107C87859cAd2E472e71BbE25c15cdD614A' as const;

export const PANAL_TOKEN_ADDRESS = '0x2e2e44e7fa6178822d4397299f719e89d1a67777' as const;

/** Símbolo de UI para una `currency` on-chain: address(0) = MON, PANAL_TOKEN = $PANAL. */
export function currencySymbol(currency?: string | null): 'MON' | '$PANAL' {
  return currency && currency.toLowerCase() === PANAL_TOKEN_ADDRESS.toLowerCase() ? '$PANAL' : 'MON';
}

/**
 * Trust Wallet inyecta `window.trustwallet` (extensión) o se anuncia dentro de
 * `window.ethereum.providers` / con flags `isTrust` cuando coexisten varias
 * wallets. El conector dirigido garantiza que aparezca como opción propia
 * aunque el anuncio EIP-6963 falle; wagmi además descubre wallets por
 * EIP-6963 (multiInjectedProviderDiscovery, activo por defecto) y el picker
 * deduplica por nombre (ver WalletProvider).
 */
type TrustishProvider = EIP1193Provider & { isTrust?: boolean; isTrustWallet?: boolean };

function findTrustWalletProvider(): EIP1193Provider | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as {
    trustwallet?: TrustishProvider;
    ethereum?: TrustishProvider & { providers?: TrustishProvider[] };
  };
  if (w.trustwallet) return w.trustwallet;
  const eth = w.ethereum;
  if (!eth) return undefined;
  if (eth.isTrust || eth.isTrustWallet) return eth;
  return eth.providers?.find((p) => p.isTrust || p.isTrustWallet);
}

const connectors: CreateConnectorFn[] = [injected()];
const trustProvider = findTrustWalletProvider();
if (trustProvider) {
  connectors.push(
    injected({
      target: { id: 'trustWallet', name: 'Trust Wallet', provider: trustProvider },
    }),
  );
}

/**
 * WalletConnect: la única forma de conectar desde un navegador móvil normal.
 *
 * Todo lo de arriba depende de que alguien haya INYECTADO un proveedor en la
 * página, y eso solo pasa en un navegador de escritorio con extensión o dentro
 * del navegador propio de una wallet. En el Chrome o el Safari de un teléfono
 * no hay `window.ethereum`, así que hasta ahora quien llegaba desde un enlace
 * en el móvil no podía contratar nada: veía el mercado y se quedaba ahí.
 *
 * Con esto la web abre la wallet que la persona ya tiene instalada, se firma
 * allí y se vuelve.
 *
 * Va detrás de una variable de entorno A PROPÓSITO. Sin `projectId` el
 * conector no funciona, y arrancarlo con uno vacío daría un error al pulsar en
 * vez de al desplegar. Sin la variable, la web se comporta exactamente como
 * antes.
 */
const WC_PROJECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID?.trim();
if (WC_PROJECT_ID) {
  connectors.push(
    walletConnect({
      projectId: WC_PROJECT_ID,
      // NO se usa el modal de Reown (AppKit). Con esto el conector se limita
      // a emitir la URI de la sesión y la pantalla la pinta `WalletConnectDialog`.
      //
      // Se hizo así por lo que costó descubrir: el modal ajeno viene en inglés
      // dentro de una web que se cuida en diez idiomas, trae su estética, y
      // sobre todo descarga su catálogo de wallets de la API de AppKit, que
      // exige tener el proyecto dado de alta para ESE producto. Con un
      // projectId válido pero de otro tipo, el modal revienta al arrancar y el
      // usuario ve "no se pudo conectar" sin que aparezca nada.
      showQrModal: false,
      // Lo que la persona ve en la pantalla de aprobación de su wallet. La URL
      // sale del origen real para que no discrepe en los despliegues de
      // vista previa, donde una URL fija haría que la wallet avise.
      metadata: {
        name: 'Panal',
        description: 'Marketplace de agentes de IA autónomos sobre Monad',
        url: typeof window === 'undefined' ? 'https://panal.lat' : window.location.origin,
        icons: [`${typeof window === 'undefined' ? 'https://panal.lat' : window.location.origin}/logo.svg`],
      },
    }),
  );
}

export const wagmiConfig = createConfig({
  chains: [activeChain],
  connectors,
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
