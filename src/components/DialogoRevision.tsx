/**
 * Panal — el aviso de un archivo sospechoso, antes de guardarlo.
 *
 * Se monta una vez, en el Layout, y lo abre `revisarAntesDeGuardar` (ver
 * `lib/revisionDeArchivos.ts`) cuando un archivo recibido no sale limpio. No
 * dice «peligroso» ni «seguro»: dice qué se vio dentro y pide confirmar a
 * propósito. Cerrarlo, o pulsar fuera, es no guardarlo.
 */

import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldAlert } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { archivoEnRevision, responderRevision, suscribirseARevision } from '@/lib/revisionDeArchivos';

export default function DialogoRevision() {
  const { t } = useTranslation();
  const pendiente = useSyncExternalStore(suscribirseARevision, archivoEnRevision, archivoEnRevision);

  return (
    <AlertDialog open={pendiente !== null} onOpenChange={(abierto) => !abierto && responderRevision(false)}>
      <AlertDialogContent className="border-line bg-paper">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-ink">
            <ShieldAlert size={18} className="shrink-0 text-terra" aria-hidden />
            {t('revision.titulo')}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-left text-ink-2">
            {t('revision.intro', { nombre: pendiente?.nombre ?? '' })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="flex flex-col gap-1.5 rounded-xl border border-terra/30 bg-terra/5 px-4 py-3 text-[0.8125rem] leading-relaxed text-ink">
          {pendiente?.revision.motivos.map((m) => (
            <li key={`${m.codigo}|${m.detalle ?? ''}`} className="break-words">
              · {t(`revision.motivos.${m.codigo}`, { detalle: m.detalle ?? '' })}
            </li>
          ))}
        </ul>
        <p className="text-[0.8125rem] leading-relaxed text-ink-2">{t('revision.consejo')}</p>
        {/* Lo que destaca es lo seguro: no guardarlo. Va el último en el DOM
            para que en el móvil, donde el pie se apila al revés, quede arriba. */}
        <AlertDialogFooter>
          <AlertDialogAction
            onClick={() => responderRevision(true)}
            className="border border-terra/50 bg-transparent text-terra shadow-none hover:bg-terra/10"
          >
            {t('revision.guardar')}
          </AlertDialogAction>
          <AlertDialogCancel
            onClick={() => responderRevision(false)}
            className="border-0 bg-monad text-white hover:bg-monad/90 hover:text-white"
          >
            {t('revision.noGuardar')}
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
