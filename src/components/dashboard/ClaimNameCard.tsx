/**
 * Panal — reclamar el nombre único de tu agente, desde el panel.
 *
 * Existe porque quien registra su agente con el formulario de la web se
 * quedaba sin nombre: solo lo conseguía quien usara `npx create-panal-agent`,
 * que lo reclama al registrar. Eso dejaba a la mitad de los agentes sin lo
 * único que los señala sin ambigüedad, y con su handle libre para que se lo
 * llevara cualquiera.
 *
 * Las reglas del handle se validan aquí ANTES de firmar, con las mismas que
 * aplica el contrato (ver `lib/handle.ts`). Mandar a firmar algo que va a
 * revertir cuesta gas y no explica nada.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AtSign, Check, Loader2 } from 'lucide-react';
import { useReadContract } from 'wagmi';
import { formatEther } from 'viem';
import { panalNamesAbi } from '@/contracts/abis';
import { PANAL_NAMES_ADDRESS, activeChain } from '@/contracts/config';
import { useContractAction } from '@/hooks/useContractAction';
import { useWallet } from '@/hooks/useWallet';
import { aHandle, revisaHandle, HANDLE_MAX } from '@/lib/handle';
import { cn } from '@/lib/utils';

export default function ClaimNameCard({ nombrePerfil }: { nombrePerfil: string }) {
  const { t } = useTranslation();
  const { address, connected } = useWallet();
  // Lo que el usuario ha escrito. `null` = todavía no ha tocado nada, y
  // entonces se propone el que sale de su nombre de perfil.
  const [escrito, setEscrito] = useState<string | null>(null);

  const agente = (address ?? null) as `0x${string}` | null;

  // El que ya tiene, si tiene. Es la lectura que decide si esta tarjeta pinta
  // un formulario o una confirmación.
  const { data: yaTengo, refetch } = useReadContract({
    address: PANAL_NAMES_ADDRESS,
    abi: panalNamesAbi,
    functionName: 'nombreDe',
    args: agente ? [agente] : undefined,
    chainId: activeChain.id,
    query: { enabled: Boolean(agente), staleTime: 30_000 },
  });

  // Derivado, no sincronizado con un efecto: copiar el nombre del perfil al
  // estado dentro de un `useEffect` dispara renders en cascada, y además deja
  // un frame en el que el campo esta vacio.
  const handle = escrito ?? aHandle(nombrePerfil);

  const motivo = handle ? revisaHandle(handle) : null;
  const consultable = handle.length > 0 && motivo === null;

  const { data: libre, isFetching: mirando } = useReadContract({
    address: PANAL_NAMES_ADDRESS,
    abi: panalNamesAbi,
    functionName: 'disponible',
    args: [handle],
    chainId: activeChain.id,
    query: { enabled: consultable, staleTime: 15_000 },
  });

  // Se pregunta aparte para poder decir POR QUÉ no se puede: «está reservado»
  // y «ya lo cogió alguien» son cosas distintas, y la segunda invita a probar
  // con otro mientras la primera no.
  const { data: reservado } = useReadContract({
    address: PANAL_NAMES_ADDRESS,
    abi: panalNamesAbi,
    functionName: 'estaReservado',
    args: [handle],
    chainId: activeChain.id,
    query: { enabled: consultable && libre === false, staleTime: 60_000 },
  });

  const { data: tarifa } = useReadContract({
    address: PANAL_NAMES_ADDRESS,
    abi: panalNamesAbi,
    functionName: 'tarifaDe',
    args: [handle],
    chainId: activeChain.id,
    query: { enabled: consultable, staleTime: 60_000 },
  });

  const accion = useContractAction({ onMined: () => void refetch() });

  if (!connected || !agente) return null;

  if (yaTengo) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-line bg-sand/40 px-4 py-3">
        <AtSign size={16} className="shrink-0 text-honey-deep" aria-hidden />
        <p className="text-[0.875rem] text-ink-2">
          {t('ownAgent.name.yours')} <span className="font-mono text-ink">@{String(yaTengo)}</span>
        </p>
      </div>
    );
  }

  const puedeReclamar = consultable && libre === true && !accion.signing && !accion.confirming;

  const aviso = (() => {
    if (!handle) return null;
    if (motivo) return t(`ownAgent.name.error.${motivo}`);
    if (mirando) return null;
    if (libre === false) return t(reservado ? 'ownAgent.name.reserved' : 'ownAgent.name.taken');
    if (libre === true && tarifa !== undefined && tarifa > 0n) {
      return t('ownAgent.name.costs', { price: formatEther(tarifa) });
    }
    return null;
  })();

  return (
    <div className="rounded-xl border border-line bg-paper px-4 py-4">
      <p className="font-display text-[0.9375rem] font-semibold text-ink">{t('ownAgent.name.title')}</p>
      <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-3">{t('ownAgent.name.sub')}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 rounded-lg border border-line bg-cream px-3 py-2 focus-within:border-honey">
          <span className="font-mono text-[0.875rem] text-ink-3">@</span>
          <input
            value={handle}
            onChange={(e) => setEscrito(aHandle(e.target.value))}
            maxLength={HANDLE_MAX}
            spellCheck={false}
            autoCapitalize="none"
            aria-label={t('ownAgent.name.title')}
            aria-invalid={Boolean(motivo) || libre === false}
            className="min-w-0 flex-1 bg-transparent font-mono text-[0.875rem] text-ink outline-none"
            placeholder="traductor"
          />
          {consultable && mirando && <Loader2 size={14} className="shrink-0 animate-spin text-ink-3" aria-hidden />}
          {consultable && !mirando && libre === true && (
            <Check size={14} className="shrink-0 text-olive" aria-hidden />
          )}
        </div>

        <button
          type="button"
          disabled={!puedeReclamar}
          onClick={() =>
            void accion.run({
              address: PANAL_NAMES_ADDRESS,
              abi: panalNamesAbi,
              functionName: 'reclamar',
              args: [handle],
            })
          }
          className={cn(
            'rounded-lg px-4 py-2 text-[0.875rem] font-medium transition-colors',
            puedeReclamar ? 'bg-ink text-paper hover:bg-ink-2' : 'cursor-not-allowed bg-line text-ink-3',
          )}
        >
          {accion.signing || accion.confirming ? (
            <span className="flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" aria-hidden />
              {t('ownAgent.name.claiming')}
            </span>
          ) : (
            t('ownAgent.name.claim')
          )}
        </button>
      </div>

      {aviso && (
        <p className={cn('mt-2 text-[0.8125rem]', libre === false || motivo ? 'text-terra' : 'text-ink-3')}>{aviso}</p>
      )}
    </div>
  );
}
