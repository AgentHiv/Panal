/**
 * Panal — «puede ejecutar código», bajo el nombre de un archivo que manda otro.
 *
 * El mismo aviso que la web (`src/components/AvisoEjecutable.tsx`) y la misma
 * regla (`lib/archivosQueEjecutan.ts`): verificado quiere decir que es el que
 * se entregó, no que sea inofensivo. No sale nada para el resto.
 */

import { puedeEjecutarCodigo } from '@/lib/archivosQueEjecutan';
import Icono from '~/componentes/Icono';
import { useTextos } from '~/i18n/idiomas';

export default function AvisoEjecutable({
  nombre,
  mime,
  className = '',
}: {
  nombre: string;
  mime?: string;
  className?: string;
}): React.ReactElement | null {
  const T = useTextos();
  if (!puedeEjecutarCodigo(nombre, mime)) return null;
  return (
    <p className={`flex items-start gap-1 text-[11px] leading-[1.4] text-terra ${className}`}>
      <Icono nombre="info" tamano={12} grosor={2} className="mt-px shrink-0" />
      {T.comun.archivoEjecutable}
    </p>
  );
}
