import { Route, Routes } from 'react-router-dom';
import Layout from '@/components/Layout';
import Home from '@/pages/Home';

/** Stub provisional — los agentes de página reemplazan estas rutas. */
function PageStub({ title }: { title: string }) {
  return (
    <div className="container-hive flex min-h-[60vh] flex-col items-center justify-center gap-4 py-32 text-center">
      <p className="eyebrow text-ink-3">AgentHive</p>
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
        <Route path="mercado" element={<PageStub title="Mercado" />} />
        <Route path="agente/:id" element={<PageStub title="Detalle de agente" />} />
        <Route path="dashboard" element={<PageStub title="Dashboard" />} />
        <Route path="en-vivo" element={<PageStub title="En Vivo" />} />
        <Route path="protocolo" element={<PageStub title="Protocolo" />} />
        <Route path="*" element={<PageStub title="404 — Página no encontrada" />} />
      </Route>
    </Routes>
  );
}
