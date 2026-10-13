/**
 * Los encargos que quedan del tablón anterior: `createTask(worker = 0)` en el
 * escrow, donde el primer agente que llega se lo queda (`claimTask`).
 *
 * Ya no se publica ahí desde la web —lo nuevo va a PanalTablon—, pero lo que
 * se publicó sigue pagado en el escrow y alguien tiene que poder cogerlo. Esto
 * los enseña mientras quede alguno; vacío, no pinta nada.
 */

import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import type { Abi } from 'viem';
import { NATIVE_CURRENCY, PANAL_ESCROW_V2_ADDRESS, ZERO_ADDRESS, activeChain, publicClient } from '@/contracts/config';
import { panalEscrowV2Abi } from '@/contracts/abis';
import { useFirmaDelTablon } from '@/hooks/useFirmaDelTablon';
import { BUZON_BASE } from '@/lib/botEndpoint';
import { firmarYEsperar } from '@/lib/tablonReglas';
import { Girando, Importe } from './comun';
import { BOTON_LINEA } from './util';

interface Fila {
  taskId: bigint;
  publico: string;
  amount: bigint;
  currency: `0x${string}`;
}

async function leerAnteriores(): Promise<Fila[]> {
  const res = await fetch(`${BUZON_BASE}/${ZERO_ADDRESS}/lista`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return [];
  const { ofertas = [] } = (await res.json()) as { ofertas?: { taskId: string; publico: string }[] };
  const vivas = await Promise.all(
    ofertas.slice(0, 60).map(async (o) => {
      try {
        const tarea = (await publicClient.readContract({
          address: PANAL_ESCROW_V2_ADDRESS,
          abi: panalEscrowV2Abi,
          functionName: 'tasks',
          args: [BigInt(o.taskId)],
        })) as { worker: string; amount: bigint; status: number; currency: `0x${string}` };
        // Sin dueño y abierta: lo demás ya es trabajo de alguien.
        if (Number(tarea.status) !== 0 || tarea.worker.toLowerCase() !== ZERO_ADDRESS) return null;
        return { taskId: BigInt(o.taskId), publico: o.publico, amount: tarea.amount, currency: tarea.currency ?? NATIVE_CURRENCY };
      } catch {
        return null;
      }
    }),
  );
  return vivas.filter((f): f is Fila => f !== null);
}

export default function TablonAnterior({ esAgente }: { esAgente: boolean }) {
  const { t } = useTranslation();
  const { ejecutar, ocupado } = useFirmaDelTablon();
  const { data: filas = [], refetch } = useQuery({
    queryKey: ['tablon-anterior', activeChain.id],
    queryFn: leerAnteriores,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  if (filas.length === 0) return null;

  return (
    <section className="mt-10 rounded-2xl border border-line bg-cream p-5">
      <h2 className="text-[0.9375rem] font-semibold text-ink">{t('tablon.anterior.titulo', { n: filas.length })}</h2>
      <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-3">{t('tablon.anterior.sub')}</p>
      <ul className="mt-4 flex flex-col gap-3">
        {filas.map((f) => {
          const clave = `anterior:${f.taskId.toString()}`;
          return (
            <li key={clave} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-paper px-4 py-3">
              <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[0.875rem] text-ink">{f.publico}</p>
              <Importe wei={f.amount} moneda={f.currency} className="text-right text-[0.875rem] font-semibold" />
              <button
                type="button"
                disabled={!esAgente || ocupado !== null}
                title={esAgente ? undefined : t('tablon.soloAgentes')}
                onClick={() =>
                  void ejecutar(clave, async (e, c) => {
                    await firmarYEsperar(e, c, {
                      address: PANAL_ESCROW_V2_ADDRESS,
                      abi: panalEscrowV2Abi as unknown as Abi,
                      functionName: 'claimTask',
                      args: [f.taskId],
                    });
                    void refetch();
                  })
                }
                className={BOTON_LINEA}
              >
                {ocupado === clave && <Girando />}
                {t('tablon.coger')}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
