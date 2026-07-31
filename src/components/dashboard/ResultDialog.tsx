/**
 * Panal — "Ver resultado": el CLIENTE descarga el resultado entregado.
 *
 * Flujo privado y verificable (sin gas):
 *   1. Lee getAgent(task.worker) del registry activo (v2 si V2_ENABLED) y
 *      extrae la URL del bot del metadataURI (token "bot:<url>", ver
 *      src/lib/botEndpoint.ts). Si no hay, avisa (tasks.resultNoEndpoint).
 *   2. Firma con la wallet (EIP-191, useSignMessage) el mensaje exacto
 *      "Panal resultado #<taskId>" — prueba de que es el cliente, sin gas.
 *   3. fetch al endpoint del bot → {resultText, resultHash}; muestra el texto
 *      en una caja scrollable y compara keccak256(toBytes(resultText)) con
 *      task.resultHash (leído de la tupla on-chain): badge verde si coincide,
 *      rojo si no.
 *   Errores: 403 → tasks.resultForbidden; fetch fallido → tasks.resultFetchError
 *   con botón reintentar.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, BadgeCheck, Loader2, RefreshCw, ShieldX } from 'lucide-react';
import { keccak256, toBytes } from 'viem';
import { useSignMessage } from 'wagmi';
import {
  PANAL_REGISTRY_ADDRESS,
  PANAL_REGISTRY_V2_ADDRESS,
  V2_ENABLED,
  publicClient,
} from '@/contracts/config';
import { panalRegistryAbi, panalRegistryV2Abi } from '@/contracts/abis';
import { buildResultUrl, extractBotUrl, resultSignMessage } from '@/lib/botEndpoint';
import { useWallet } from '@/hooks/useWallet';
import type { RealTask } from '@/hooks/useMyTasks';
import { cn } from '@/lib/utils';

type Phase = 'loadingAgent' | 'noEndpoint' | 'ready' | 'signing' | 'fetching' | 'done' | 'forbidden' | 'fetchError';

interface ResultPayload {
  taskId?: string;
  resultText?: string;
  resultHash?: string;
}

export default function ResultDialog({ task }: { task: RealTask }) {
  const { t } = useTranslation();
  const { address } = useWallet();
  const { signMessageAsync } = useSignMessage();

  const [phase, setPhase] = useState<Phase>('loadingAgent');
  const [botUrl, setBotUrl] = useState<string | null>(null);
  const [resultText, setResultText] = useState('');
  const [verified, setVerified] = useState<boolean | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  // 1. Registry activo → metadataURI del agente → URL del bot.
  useEffect(() => {
    let cancelled = false;
    setPhase('loadingAgent');
    (async () => {
      try {
        const agent = (await publicClient.readContract({
          address: V2_ENABLED ? PANAL_REGISTRY_V2_ADDRESS : PANAL_REGISTRY_ADDRESS,
          abi: V2_ENABLED ? panalRegistryV2Abi : panalRegistryAbi,
          functionName: 'getAgent',
          args: [task.worker],
        })) as { metadataURI?: string };
        if (cancelled) return;
        const url = extractBotUrl(agent.metadataURI);
        setBotUrl(url);
        setPhase(url ? 'ready' : 'noEndpoint');
      } catch {
        if (!cancelled) setPhase('fetchError');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [task.worker, reloadTick]);

  // 2+3. Firmar y descargar.
  const signAndFetch = async () => {
    if (!botUrl || !address) return;
    try {
      setPhase('signing');
      const signature = await signMessageAsync({ message: resultSignMessage(task.id) });
      setPhase('fetching');
      const res = await fetch(buildResultUrl(botUrl, task.id, address, signature));
      if (res.status === 403) {
        setPhase('forbidden');
        return;
      }
      if (!res.ok) {
        setPhase('fetchError');
        return;
      }
      const body = (await res.json()) as ResultPayload;
      const text = typeof body.resultText === 'string' ? body.resultText : '';
      setResultText(text);
      // Verificación local contra el hash anclado on-chain (tupla tasks()).
      setVerified(keccak256(toBytes(text)).toLowerCase() === task.resultHash.toLowerCase());
      setPhase('done');
    } catch (err) {
      // El usuario rechazó la firma: volvemos al estado listo sin error ruidoso.
      const msg = err instanceof Error ? err.message : String(err);
      setPhase(/reject|denied|user/i.test(msg) ? 'ready' : 'fetchError');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {phase === 'loadingAgent' && (
        <div className="flex items-center justify-center gap-2 py-10 text-ink-3">
          <Loader2 size={18} className="animate-spin" /> {t('tasks.resultLoadingAgent')}
        </div>
      )}

      {phase === 'noEndpoint' && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-line bg-cream px-4 py-8 text-center">
          <AlertTriangle size={24} className="text-honey-deep" />
          <p className="max-w-sm text-[0.875rem] text-ink-2">{t('tasks.resultNoEndpoint')}</p>
        </div>
      )}

      {(phase === 'ready' || phase === 'signing') && (
        <button
          type="button"
          onClick={signAndFetch}
          disabled={phase === 'signing'}
          className="btn-monad inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-[0.875rem] font-semibold disabled:opacity-50"
        >
          {phase === 'signing' && <Loader2 size={15} className="animate-spin" />}
          {phase === 'signing' ? t('tasks.resultSigning') : t('tasks.resultSign')}
        </button>
      )}

      {phase === 'fetching' && (
        <div className="flex items-center justify-center gap-2 py-10 text-ink-3">
          <Loader2 size={18} className="animate-spin" /> {t('tasks.resultLoading')}
        </div>
      )}

      {phase === 'forbidden' && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-terra/40 bg-terra/10 px-4 py-8 text-center">
          <ShieldX size={24} className="text-terra" />
          <p className="max-w-sm text-[0.875rem] text-ink-2">{t('tasks.resultForbidden')}</p>
        </div>
      )}

      {phase === 'fetchError' && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-terra/40 bg-terra/10 px-4 py-8 text-center">
          <AlertTriangle size={24} className="text-terra" />
          <p className="max-w-sm text-[0.875rem] text-ink-2">{t('tasks.resultFetchError')}</p>
          <button
            type="button"
            onClick={botUrl ? signAndFetch : () => setReloadTick((n) => n + 1)}
            className="inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-[0.8125rem] font-medium text-ink-2 transition-colors hover:border-honey hover:text-honey-deep"
          >
            <RefreshCw size={13} /> {t('tasks.retry')}
          </button>
        </div>
      )}

      {phase === 'done' && (
        <>
          <div className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-xl border border-line bg-cream p-4 font-mono text-[0.8125rem] leading-relaxed text-ink">
            {resultText}
          </div>
          <div
            className={cn(
              'inline-flex items-center gap-1.5 self-start rounded-full px-3 py-1 text-[0.75rem] font-semibold',
              verified ? 'bg-olive/15 text-olive' : 'bg-terra/15 text-terra',
            )}
          >
            {verified ? <BadgeCheck size={13} /> : <ShieldX size={13} />}
            {verified ? t('tasks.resultVerified') : t('tasks.resultMismatch')}
          </div>
        </>
      )}
    </div>
  );
}
