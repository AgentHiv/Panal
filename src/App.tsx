import { Route, Routes } from 'react-router-dom';
import Layout from '@/components/Layout';
import Home from '@/pages/Home';
import Marketplace from '@/pages/Marketplace';
import AgentDetail from '@/pages/AgentDetail';
import Dashboard from '@/pages/Dashboard';
import EnVivo from '@/pages/EnVivo';
import Protocolo from '@/pages/Protocolo';

/** Stub provisional — los agentes de página reemplazan estas rutas. */
function PageStub({ title }: { title: string }) {
  return (
    <div className="container-hive flex min-h-[60vh] flex-col items-center justify-center gap-4 py-32 text-center">
      <p className="eyebrow text-ink-3">Panal</p>
      <h1 className="display-l text-ink">{title}</h1>
      <p className="max-w-md text-ink-2">Esta página está en construcción.</p>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="mercado" element={<Marketplace />} />
        <Route path="agente/:id" element={<AgentDetail />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="en-vivo" element={<EnVivo />} />
        <Route path="protocolo" element={<Protocolo />} />
        <Route path="*" element={<PageStub title="404 — Página no encontrada" />} />
      </Route>
    </Routes>
  );
}
