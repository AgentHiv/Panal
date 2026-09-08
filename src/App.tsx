import { lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Layout from '@/components/Layout';
import Home from '@/pages/Home';

/**
 * Las rutas, cada una en su propio trozo — menos la portada.
 *
 * POR QUÉ LA PORTADA NO. Es donde aterriza casi todo el mundo, y hacerla
 * perezosa mete un viaje de ida y vuelta EXTRA justo ahí: primero el armazón,
 * y solo entonces se pide la página. Con buena conexión no se nota; con la
 * mala —que es de quien salió todo esto— un viaje de más puede costar segundos
 * y lo único que se gana es ver la cabecera antes.
 *
 * Las otras trece sí: quien entra en el mercado no tiene por qué descargarse el
 * panel, el protocolo y la hoja de ruta para verlo. El límite de `Suspense`
 * está en `Layout`, alrededor del `Outlet`, así que la cabecera y el pie no se
 * van mientras llega la página.
 */
const Marketplace = lazy(() => import('@/pages/Marketplace'));
const Tablon = lazy(() => import('@/pages/Tablon'));
const AgentDetail = lazy(() => import('@/pages/AgentDetail'));
const Chat = lazy(() => import('@/pages/Chat'));
const Chats = lazy(() => import('@/pages/Chats'));
const Archivo = lazy(() => import('@/pages/Archivo'));
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const EnVivo = lazy(() => import('@/pages/EnVivo'));
const CrearAgente = lazy(() => import('@/pages/CrearAgente'));
const Protocolo = lazy(() => import('@/pages/Protocolo'));
const HojaDeRuta = lazy(() => import('@/pages/HojaDeRuta'));
const Token = lazy(() => import('@/pages/Token'));
const Descargar = lazy(() => import('@/pages/Descargar'));

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
        <Route path="tablon" element={<Tablon />} />
        <Route path="agente/:id" element={<AgentDetail />} />
        <Route path="chats" element={<Chats />} />
        <Route path="chat/:id" element={<Chat />} />
        <Route path="archivo" element={<Archivo />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="en-vivo" element={<EnVivo />} />
        <Route path="crear-agente" element={<CrearAgente />} />
        <Route path="protocolo" element={<Protocolo />} />
        <Route path="hoja-de-ruta" element={<HojaDeRuta />} />
        <Route path="token" element={<Token />} />
        {/* `/app` y no `/descargar`: es la ruta que se dice en voz alta y
            la que alguien teclea de memoria en el móvil. */}
        <Route path="app" element={<Descargar />} />
        <Route path="*" element={<PageStub titleKey="common.notFound" />} />
      </Route>
    </Routes>
  );
}
