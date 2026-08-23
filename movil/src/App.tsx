import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import BarraRed from '~/componentes/BarraRed';
import Pestanas from '~/componentes/Pestanas';
import Chats from '~/pantallas/Chats';
import Mercado from '~/pantallas/Mercado';
import Saldo from '~/pantallas/Saldo';
import Hilo from '~/pantallas/Hilo';
import Agente from '~/pantallas/Agente';
import Archivo from '~/pantallas/Archivo';
import Expediente from '~/pantallas/Expediente';
import Llavero from '~/pantallas/Llavero';
import { useAvisos } from '~/lib/usarAvisos';

/** Las rutas con pestañas abajo. Un hilo o una ficha ocupan la pantalla entera. */
const CON_PESTANAS = ['/chats', '/mercado', '/archivo', '/saldo'];

export default function App(): React.ReactElement {
  const { pathname } = useLocation();
  const conPestanas = CON_PESTANAS.includes(pathname);

  // Vigila las tareas y levanta los avisos del teléfono. No pinta nada.
  useAvisos();

  return (
    <div className="con-barra-arriba flex h-full flex-col overflow-hidden bg-paper">
      <BarraRed />
      <div className="flex min-h-0 grow flex-col">
        <Routes>
          {/* Se abre en los chats, como cualquier app de mensajería. */}
          <Route path="/" element={<Navigate to="/chats" replace />} />
          <Route path="/chats" element={<Chats />} />
          <Route path="/chat/:id" element={<Hilo />} />
          <Route path="/agente/:id" element={<Agente />} />
          <Route path="/mercado" element={<Mercado />} />
          <Route path="/archivo" element={<Archivo />} />
          <Route path="/expediente/:id" element={<Expediente />} />
          <Route path="/saldo" element={<Saldo />} />
          <Route path="/llavero" element={<Llavero />} />
          <Route path="*" element={<Navigate to="/chats" replace />} />
        </Routes>
      </div>
      {conPestanas && <Pestanas />}
    </div>
  );
}
