import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import EmptyState from '@/components/EmptyState';
import { leerBorrador } from '@/lib/borrador';

/**
 * `/contratar/:id` — donde llega quien recibió un enlace de su asistente.
 *
 * Lee el borrador que preparó el MCP remoto, lo abre con la clave que va
 * detrás de la `#` y lleva a la ficha del agente con la ventana de contratar
 * abierta y rellena. Aquí no se paga nada: eso pasa en la ventana, con la
 * wallet de la persona. Ver `src/lib/borrador.ts`.
 */
export default function Contratar() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  // La clave: lo que va detrás de la `#`, que el navegador no manda a nadie.
  const { hash } = useLocation();
  const clave = hash.startsWith('#') ? hash.slice(1) : hash;
  const [estado, setEstado] = useState<'cargando' | 'caducado' | 'incompleto' | 'error'>('cargando');

  useEffect(() => {
    document.title = t('contratar.metaTitle');
  }, [t]);

  useEffect(() => {
    let vigente = true;
    void leerBorrador(id, clave).then((b) => {
      if (!vigente) return;
      if (b === null) setEstado('caducado');
      else if (b === 'incompleto') setEstado('incompleto');
      else if (b === 'error') setEstado('error');
      // replace: el botón de atrás no debe volver a esta página de paso, y así
      // el enlace con su clave tampoco se queda en el historial.
      // La ficha se identifica así en toda la web (ver `id` en usePanalAgents).
      else navigate(`/agente/onchain-${b.agente.toLowerCase()}`, { replace: true, state: { borrador: b } });
    });
    return () => {
      vigente = false;
    };
  }, [id, clave, navigate]);

  if (estado === 'cargando') {
    return (
      <div className="container-hive flex min-h-[60vh] flex-col items-center justify-center gap-3 py-24">
        <Loader2 size={28} className="animate-spin text-honey-deep" aria-hidden />
        <p className="text-[0.875rem] text-ink-2">{t('contratar.cargando')}</p>
      </div>
    );
  }

  return (
    <div className="container-hive flex min-h-[60vh] items-center justify-center py-24">
      <EmptyState
        title={t(`contratar.${estado}Titulo`)}
        description={t(`contratar.${estado}Texto`)}
        actionLabel={t('detail.backToMarket')}
        onAction={() => navigate('/mercado')}
      />
    </div>
  );
}
