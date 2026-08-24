import type { ReactNode } from 'react';
import { useTextos } from '~/i18n/idiomas';

/**
 * La hoja que sube desde abajo. Es el gesto de la app: todo lo que cuesta
 * dinero pasa por aquí, para que firmar nunca sea un botón perdido en medio
 * de una pantalla.
 *
 * El fondo oscurecido cierra al tocarlo, salvo mientras hay una firma en
 * marcha: cerrar por accidente con la wallet abierta deja a la persona sin
 * saber si pagó.
 */
export default function Hoja({
  abierta,
  titulo,
  onCerrar,
  bloqueada = false,
  children,
}: {
  abierta: boolean;
  titulo: string;
  onCerrar: () => void;
  bloqueada?: boolean;
  children: ReactNode;
}): React.ReactElement | null {
  const T = useTextos();
  if (!abierta) return null;

  return (
    <div className="absolute inset-0 z-20 flex flex-col justify-end bg-[rgba(12,10,18,.72)]">
      <button
        type="button"
        aria-label={T.comun.cerrar}
        className="grow"
        onClick={bloqueada ? undefined : onCerrar}
      />
      <div className="con-barra-abajo max-h-[88%] overflow-y-auto rounded-t-[22px] border-t border-line bg-cream px-5 pt-2.5 shadow-hoja">
        <div className="mx-auto mb-[18px] h-1 w-[38px] rounded-full bg-line" />
        <h2 className="font-display text-[21px] font-semibold -tracking-[0.015em]">{titulo}</h2>
        {children}
      </div>
    </div>
  );
}

/** Una fila etiqueta/valor dentro de una tarjeta con borde. */
export function Fila({
  etiqueta,
  pie,
  valor,
  color = 'text-ink',
  destacada = false,
}: {
  etiqueta: string;
  pie?: string;
  valor: ReactNode;
  color?: string;
  destacada?: boolean;
}): React.ReactElement {
  return (
    <div
      className={`flex items-center justify-between gap-2.5 px-[15px] py-3.5 ${destacada ? 'bg-sand' : ''}`}
    >
      <div className="min-w-0">
        <p className={`text-[13.5px] ${destacada ? 'font-semibold text-ink' : 'text-ink-2'}`}>
          {etiqueta}
        </p>
        {pie && <p className="mt-0.5 text-[11.5px] text-ink-3">{pie}</p>}
      </div>
      <div className={`shrink-0 font-mono text-[14px] ${color}`}>{valor}</div>
    </div>
  );
}

export function Tarjeta({ children }: { children: ReactNode }): React.ReactElement {
  return (
    <div className="mt-4 divide-y divide-line overflow-hidden rounded-[14px] border border-line">
      {children}
    </div>
  );
}

export function Nota({ children, tono = 'gris' }: { children: ReactNode; tono?: 'gris' | 'miel' }) {
  const estilos =
    tono === 'miel'
      ? 'border border-honey-line bg-honey-soft text-honey'
      : 'bg-sand text-ink-3';
  return (
    <div className={`mt-3.5 rounded-xl px-3.5 py-3 text-[12px] leading-[1.5] ${estilos}`}>
      {children}
    </div>
  );
}

export function Boton({
  children,
  onClick,
  variante = 'principal',
  disabled = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  variante?: 'principal' | 'secundario' | 'peligro' | 'apagado';
  disabled?: boolean;
}): React.ReactElement {
  const estilos = {
    principal: 'bg-monad text-white shadow-monad',
    secundario: 'border border-line text-ink-2',
    peligro: 'bg-terra text-white',
    apagado: 'bg-sand text-ink-3',
  }[variante];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`pulsable flex h-[52px] w-full items-center justify-center gap-2 rounded-full text-[15px] font-semibold disabled:opacity-100 ${estilos}`}
    >
      {children}
    </button>
  );
}
