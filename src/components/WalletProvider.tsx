/**
 * AgentHive — Provider del estado global de wallet simulada (0x7A4f…f9B2).
 * La conexión se simula con un pequeño delay de handshake.
 */

import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { WalletContext } from '@/hooks/useWallet';
import type { WalletState } from '@/hooks/useWallet';
import { WALLET_USER, WALLET_USER_SHORT } from '@/data/agents';

export default function WalletProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const connect = useCallback(() => {
    if (connected || connecting) return;
    setConnecting(true);
    window.setTimeout(() => {
      setConnected(true);
      setConnecting(false);
    }, 900);
  }, [connected, connecting]);

  const disconnect = useCallback(() => {
    setConnected(false);
    setConnecting(false);
  }, []);

  const value = useMemo<WalletState>(
    () => ({
      connected,
      connecting,
      address: connected ? WALLET_USER : null,
      addressShort: connected ? WALLET_USER_SHORT : null,
      connect,
      disconnect,
    }),
    [connected, connecting, connect, disconnect],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}
