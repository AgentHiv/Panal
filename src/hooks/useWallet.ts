/**
 * Panal — Hook de wallet real (wagmi · injected).
 * El provider vive en @/components/WalletProvider; el estado es global.
 * Mantiene la API pública original (connected, connecting, address,
 * addressShort, connect, disconnect) y añade gestión de red:
 * `wrongNetwork` + `switchToMonad` cuando la wallet no está en Monad testnet.
 */

import { createContext, useContext } from 'react';

export interface WalletState {
  connected: boolean;
  connecting: boolean;
  address: string | null;
  addressShort: string | null;
  connect: () => void;
  disconnect: () => void;
  /** true si hay wallet conectada pero en una red distinta de Monad testnet */
  wrongNetwork: boolean;
  /** pide a la wallet cambiar (o añadir) Monad testnet */
  switchToMonad: () => void;
  chainId: number | null;
  /** true mientras el diálogo "instala una wallet" está abierto */
  installOpen: boolean;
  /** abre el diálogo de instalación de wallet (sin wallet inyectada) */
  openInstallDialog: () => void;
}

export const WalletContext = createContext<WalletState>({
  connected: false,
  connecting: false,
  address: null,
  addressShort: null,
  connect: () => {},
  disconnect: () => {},
  wrongNetwork: false,
  switchToMonad: () => {},
  chainId: null,
  installOpen: false,
  openInstallDialog: () => {},
});

export function useWallet(): WalletState {
  return useContext(WalletContext);
}

/** 0x7A4f9e2B… → 0x7A4f…f9B2 */
export function shortAddress(addr: string): string {
  return addr.length > 10 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}
