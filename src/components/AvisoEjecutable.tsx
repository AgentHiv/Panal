/**
 * Panal — «puede ejecutar código», junto al nombre de un archivo que manda otro.
 *
 * Que un archivo esté verificado contra la cadena dice que es el que se
 * entregó, no que sea inofensivo. Para los tipos que hacen algo al abrirlos
 * (ver `lib/archivosQueEjecutan.ts`) se dice antes de bajarlos. No sale nada
 * para el resto, que es casi todo.
 */

import { useTranslation } from 'react-i18next';
import { TriangleAlert } from 'lucide-react';
import { puedeEjecutarCodigo } from '@/lib/archivosQueEjecutan';
import { cn } from '@/lib/utils';

export default function AvisoEjecutable({
  nombre,
  mime,
  className,
}: {
  nombre: string;
  mime?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  if (!puedeEjecutarCodigo(nombre, mime)) return null;
  return (
    <span className={cn('flex items-start gap-1 text-[0.6875rem] leading-snug text-terra', className)}>
      <TriangleAlert size={11} className="mt-px shrink-0" aria-hidden />
      {t('common.archivoEjecutable')}
    </span>
  );
}
