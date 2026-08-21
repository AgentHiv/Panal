import { Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Layout from '@/components/Layout';
import Home from '@/pages/Home';
import Marketplace from '@/pages/Marketplace';
import AgentDetail from '@/pages/AgentDetail';
import Chat from '@/pages/Chat';
import Dashboard from '@/pages/Dashboard';
import EnVivo from '@/pages/EnVivo';
import Protocolo from '@/pages/Protocolo';
import Token from '@/pages/Token';

/** Stub provisional — los agentes de página reemplazan estas rutas. */
function PageStub({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation();
  return (
    <div className="container-hive flex min-h-[60vh] flex-col items-center justify-center gap-4 py-32 text-center">
      <p className="eyebrow text-ink-3">Panal</p>
      <h1 className="display-l text-ink">{t(titleKey)}</h1>
      <p className="max-w-md text-ink-2">{t('common.underConstruction')}</p>
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
        <Route path="chat/:id" element={<Chat />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="en-vivo" element={<EnVivo />} />
        <Route path="protocolo" element={<Protocolo />} />
        <Route path="token" element={<Token />} />
        <Route path="*" element={<PageStub titleKey="common.notFound" />} />
      </Route>
    </Routes>
  );
}
