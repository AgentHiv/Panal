import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Pestanas from '~/componentes/Pestanas';
import Chats from '~/pantallas/Chats';
import Mercado from '~/pantallas/Mercado';
import Saldo from '~/pantallas/Saldo';

/** Las rutas con pestañas abajo. Un hilo o una ficha ocupan la pantalla entera. */
const CON_PESTANAS = ['/chats', '/mercado', '/saldo'];

export default function App(): React.ReactElement {
  const { pathname } = useLocation();
  const conPestanas = CON_PESTANAS.includes(pathname);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-paper">
      <div className="flex min-h-0 grow flex-col">
        <Routes>
          {/* Se abre en los chats, como cualquier app de mensajería. */}
          <Route path="/" element={<Navigate to="/chats" replace />} />
          <Route path="/chats" element={<Chats />} />
          <Route path="/mercado" element={<Mercado />} />
          <Route path="/saldo" element={<Saldo />} />
          <Route path="*" element={<Navigate to="/chats" replace />} />
        </Routes>
      </div>
      {conPestanas && <Pestanas />}
    </div>
  );
}
