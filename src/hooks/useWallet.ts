/**
 * Panal — Hook de wallet simulada (design.md §Nota de datos).
 * El provider vive en @/components/WalletProvider; el estado es global y
 * la dirección mock es 0x7A4f…f9B2.
 */

import { createContext, useContext } from 'react';

export interface WalletState {
  connected: boolean;
  connecting: boolean;
  address: string | null;
  addressShort: string | null;
  connect: () => void;
  disconnect: () => void;
}

export const WalletContext = createContext<WalletState>({
  connected: false,
  connecting: false,
  address: null,
  addressShort: null,
  connect: () => {},
  disconnect: () => {},
});

export function useWallet(): WalletState {
  return useContext(WalletContext);
}
