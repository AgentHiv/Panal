/**
 * El aviso de un archivo sospechoso, antes de guardarlo en el teléfono.
 *
 * Es el mismo que el de la web (`src/components/DialogoRevision.tsx`), con la
 * hoja de la app. Se monta una vez, en `App.tsx`, y lo abre
 * `revisarAntesDeGuardar` (ver `src/lib/revisionDeArchivos.ts`) desde
 * `guardarArchivo`. Cerrar la hoja es no guardarlo.
 */

import { useSyncExternalStore } from 'react';
import { archivoEnRevision, responderRevision, suscribirseARevision } from '@/lib/revisionDeArchivos';
import { useTextos } from '~/i18n/idiomas';
import Hoja from './Hoja';

export default function HojaRevision(): React.ReactElement | null {
  const T = useTextos();
  const pendiente = useSyncExternalStore(suscribirseARevision, archivoEnRevision, archivoEnRevision);
  if (!pendiente) return null;

  return (
    <Hoja abierta titulo={T.revision.titulo} onCerrar={() => responderRevision(false)}>
      <p className="mt-2 text-[13px] leading-[1.55] text-ink-2">{T.revision.intro(pendiente.nombre)}</p>
      <ul className="mt-3 flex flex-col gap-1.5 rounded-[14px] border border-terra/40 bg-terra/10 p-3.5 text-[12.5px] leading-[1.5] text-ink">
        {pendiente.revision.motivos.map((m) => (
          <li key={`${m.codigo}|${m.detalle ?? ''}`} className="break-words">
            · {T.revision.motivos[m.codigo].replace('{detalle}', m.detalle ?? '')}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[12px] leading-[1.55] text-ink-3">{T.revision.consejo}</p>
      <div className="mt-4 flex flex-col gap-2 pb-4">
        <button
          type="button"
          onClick={() => responderRevision(false)}
          className="pulsable tocable rounded-full bg-monad py-3 text-[14.5px] font-semibold text-white"
        >
          {T.revision.noGuardar}
        </button>
        <button
          type="button"
          onClick={() => responderRevision(true)}
          className="pulsable tocable rounded-full border border-terra/50 py-3 text-[14px] font-medium text-terra"
        >
          {T.revision.guardar}
        </button>
      </div>
    </Hoja>
  );
}
