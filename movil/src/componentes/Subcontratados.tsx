/**
 * Panal — «Subcontratado»: a quién pagó el agente para hacer este encargo.
 *
 * Lo mismo que el recuadro de la web (`SubcontratosDeLaEntrega`), con las
 * piezas de la app. Sale de la entrega guardada, que ya cuadró con la cadena:
 * lo que dice es lo que el agente ancló, y no puede quitarlo después.
 *
 * No sale nada si el agente no subcontrató, que es lo normal.
 */

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { EXPLORER_TX } from '@/contracts/config';
import { usePanalAgents } from '@/hooks/usePanalAgents';
import type { Subcontrato } from '@/lib/subcontratos';
import { monto } from '~/lib/formato';
import Icono from '~/componentes/Icono';
import { useTextos } from '~/i18n/idiomas';

export default function Subcontratados({ lista }: { lista: Subcontrato[] }): React.ReactElement | null {
  const T = useTextos();
  const { agents } = usePanalAgents();

  // Los mismos nombres que el archivo; uno que no está en el mercado sale con
  // su dirección corta, que es lo único que se sabe de él.
  const nombreDe = useMemo(() => {
    const mapa = new Map(agents.map((a) => [a.workerAddress.toLowerCase(), a.name]));
    return (dir: string): string =>
      mapa.get(dir.toLowerCase()) ?? `${dir.slice(0, 6)}…${dir.slice(-4)}`;
  }, [agents]);

  if (lista.length === 0) return null;

  return (
    <div className="mt-3 rounded-[11px] border border-monad/30 bg-monad/5 p-3">
      <p className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-monad-mist">
        <Icono nombre="eslabon" tamano={13} grosor={2} />
        {T.expediente.subcontratado}
      </p>
      <p className="mt-1 text-[11.5px] leading-[1.5] text-ink-3">{T.expediente.subcontratadoPie}</p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {lista.map((s, i) => (
          <li key={`${s.agente}-${i}`} className="rounded-[10px] border border-line bg-paper px-3 py-2">
            <div className="flex items-baseline justify-between gap-2">
              <Link to={`/agente/${s.agente}`} className="pulsable truncate text-[13px] font-medium">
                {nombreDe(s.agente)}
              </Link>
              <span className="shrink-0 font-mono text-[12.5px]">
                {monto(s.importe, s.moneda.decimales)} {s.moneda.simbolo}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-ink-3">
              <span className="rounded-full bg-sand px-2 py-0.5 text-ink-2">{s.skill}</span>
              {s.archivos && <span>{T.expediente.subcontratadoArchivos(s.archivos)}</span>}
              {s.tx && (
                <a href={EXPLORER_TX(s.tx)} target="_blank" rel="noreferrer" className="text-honey">
                  {T.expediente.subcontratadoPago}
                </a>
              )}
            </div>
            {s.via && (
              <p className="mt-1 text-[11px] text-ink-3">{T.expediente.subcontratadoVia(nombreDe(s.via))}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
