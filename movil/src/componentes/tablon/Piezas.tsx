/**
 * Piezas pequeñas del tablón en la app: la cantidad con sus dólares, una
 * etiqueta y la categoría por su nombre.
 */

import type { ReactNode } from 'react';
import type { Address } from 'viem';
import { categoriaDelTablon } from '@panal/sdk';
import { simboloDe } from '@/lib/tablonReglas';
import Dolares from '~/componentes/Dolares';
import { monto } from '~/lib/formato';
import { useTextos } from '~/i18n/idiomas';

export function Importe({ wei, moneda, alineado = 'derecha' }: { wei: bigint; moneda: Address; alineado?: 'derecha' | 'izquierda' }) {
  const simbolo = simboloDe(moneda);
  return (
    <span className={`flex shrink-0 flex-col ${alineado === 'derecha' ? 'items-end' : 'items-start'}`}>
      <bdi className="font-mono text-[14px] font-semibold text-ink">
        {monto(wei)} {simbolo}
      </bdi>
      <Dolares wei={wei} simbolo={simbolo} />
    </span>
  );
}

export function Etiqueta({ children, tono = 'gris' }: { children: ReactNode; tono?: 'gris' | 'miel' | 'oliva' }) {
  const estilo =
    tono === 'miel'
      ? 'border-honey-line bg-honey-soft text-honey'
      : tono === 'oliva'
        ? 'border-olive/30 bg-olive/10 text-olive'
        : 'border-line bg-sand text-ink-2';
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${estilo}`}>{children}</span>;
}

export function Categoria({ numero }: { numero: number }) {
  const T = useTextos();
  const clave = categoriaDelTablon(numero);
  return <Etiqueta tono="miel">{clave ? T.tablon.cat[clave] : `#${numero}`}</Etiqueta>;
}

/** Un botón pequeño de las tarjetas. Las acciones con dinero van en hojas, con `Boton`. */
export function Accion({
  children,
  onClick,
  disabled,
  tono = 'linea',
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tono?: 'linea' | 'miel' | 'peligro';
}) {
  const estilo =
    tono === 'miel' ? 'bg-honey text-[#1B1814]' : tono === 'peligro' ? 'border border-terra/40 text-terra' : 'border border-line text-ink-2';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`pulsable inline-flex h-9 items-center justify-center rounded-full px-3.5 text-[13px] font-semibold disabled:opacity-40 ${estilo}`}
    >
      {children}
    </button>
  );
}
