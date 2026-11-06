import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import EmptyState from '@/components/EmptyState';
import { leerBorrador } from '@/lib/borrador';

/**
 * `/contratar/:id` — donde llega quien recibió un enlace de su asistente.
 *
 * Lee el borrador que preparó el MCP remoto y lleva a la ficha del agente con
 * la ventana de contratar abierta y rellena. Aquí no se paga nada: eso pasa en
 * la ventana, con la wallet de la persona. Ver `src/lib/borrador.ts`.
 */
export default function Contratar() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [estado, setEstado] = useState<'cargando' | 'caducado' | 'error'>('cargando');

  useEffect(() => {
    document.title = t('contratar.metaTitle');
  }, [t]);

  useEffect(() => {
    let vigente = true;
    void leerBorrador(id).then((b) => {
      if (!vigente) return;
      if (b === null) setEstado('caducado');
      else if (b === 'error') setEstado('error');
      // replace: el botón de atrás no debe volver a esta página de paso.
      // La ficha se identifica así en toda la web (ver `id` en usePanalAgents).
      else navigate(`/agente/onchain-${b.agente.toLowerCase()}`, { replace: true, state: { borrador: b } });
    });
    return () => {
      vigente = false;
    };
  }, [id, navigate]);

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
        title={estado === 'caducado' ? t('contratar.caducadoTitulo') : t('contratar.errorTitulo')}
        description={estado === 'caducado' ? t('contratar.caducadoTexto') : t('contratar.errorTexto')}
        actionLabel={t('detail.backToMarket')}
        onAction={() => navigate('/mercado')}
      />
    </div>
  );
}
