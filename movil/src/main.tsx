import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { wagmiConfig } from '@/contracts/config';
import ProveedorWallet from '~/ProveedorWallet';
import App from '~/App';
import '~/estilos.css';

const cola = new QueryClient({
  defaultOptions: {
    queries: {
      // En un móvil la red se va y vuelve. Reintentar en silencio evita que la
      // pantalla parpadee a "error" cada vez que se pasa por un ascensor.
      retry: 2,
      staleTime: 30_000,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={cola}>
        <ProveedorWallet>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ProveedorWallet>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
);
