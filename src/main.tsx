import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { wagmiConfig } from '@/contracts/config'
import './index.css'
import { idiomaListo } from './i18n'
import App from './App.tsx'

const queryClient = new QueryClient()

// Se pinta CUANDO el idioma detectado esta cargado. Sin esta espera, quien
// tiene el sitio en arabe ve la primera pantalla en espanol y luego salta.
// `idiomaListo` no rechaza nunca: si el trozo no llega, se sigue en espanol.
void idiomaListo.then(() =>
  createRoot(document.getElementById('root')!).render(
  <WagmiProvider config={wagmiConfig}>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </WagmiProvider>,
),
)
