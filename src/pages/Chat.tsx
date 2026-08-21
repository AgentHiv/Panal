/**
 * Panal — la conversación con un agente.
 *
 * Vive en su propia ruta (`/chat/:id`) y no en un diálogo a propósito: un
 * chat se vuelve a abrir, se comparte por enlace y se deja a medias. Un modal
 * no hace nada de eso.
 *
 * El endpoint del agente se lee de su metadata ON-CHAIN, nunca de algo que
 * venga en la URL ni de una lista cacheada: es a quien se le va a pagar, y el
 * registro es la única fuente que no puede manipular un tercero.
 */

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Loader2, TriangleAlert } from 'lucide-react';
import HexAvatar from '@/components/HexAvatar';
import HiloChat from '@/components/chat/HiloChat';
import { extractBotUrl } from '@/lib/botEndpoint';
import { useTopAgents } from '@/hooks/useTopAgents';
import { isOnchainAgent } from '@/hooks/usePanalAgents';
import { PANAL_REGISTRY_V2_ADDRESS, publicClient } from '@/contracts/config';
import { panalRegistryV2Abi } from '@/contracts/abis';

export default function Chat() {
  const { t } = useTranslation();
  const { id } = useParams();
  const { top: agentes, loading } = useTopAgents();
  const agent = agentes.find((a) => a.id === id);

  /** `undefined` mientras se lee el registro; `null` si no publica endpoint. */
  const [botUrl, setBotUrl] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!agent || !isOnchainAgent(agent)) return;
    let vigente = true;
    void (async () => {
      try {
        const meta = (await publicClient.readContract({
          address: PANAL_REGISTRY_V2_ADDRESS,
          abi: panalRegistryV2Abi,
          functionName: 'getAgent',
          args: [agent.workerAddress],
        })) as { metadataURI?: string };
        if (vigente) setBotUrl(extractBotUrl(meta.metadataURI));
      } catch {
        // Sin endpoint no hay con quién hablar, y decirlo es mejor que dejar
        // un campo de texto que no va a poder enviar nada.
        if (vigente) setBotUrl(null);
      }
    })();
    return () => {
      vigente = false;
    };
  }, [agent]);

  if (loading && !agent) {
    return (
      <div className="container-hive flex min-h-[60vh] items-center justify-center py-24">
        <Loader2 className="size-6 animate-spin text-ink-3" aria-hidden />
      </div>
    );
  }

  if (!agent || !isOnchainAgent(agent)) {
    return (
      <div className="container-hive flex min-h-[60vh] flex-col items-center justify-center gap-4 py-24 text-center">
        <TriangleAlert className="size-7 text-honey" aria-hidden />
        <p className="text-ink-2">{t('chat.notFound')}</p>
        <Link to="/mercado" className="text-[0.875rem] font-medium text-honey hover:text-honey-deep">
          {t('chat.backToMarket')}
        </Link>
      </div>
    );
  }

  return (
    <div className="container-hive flex min-h-[calc(100dvh-4rem)] max-w-2xl flex-col py-4">
      {/* Cabecera del hilo: quién es, y cómo volver a su ficha. */}
      <div className="flex items-center gap-3 border-b border-line pb-4">
        <Link
          to={`/agente/${agent.id}`}
          aria-label={t('chat.backToAgent')}
          className="grid size-11 shrink-0 place-items-center rounded-full text-ink-2 transition-colors hover:text-ink"
        >
          <ArrowLeft className="size-5" aria-hidden />
        </Link>
        <HexAvatar seed={agent.wallet} size={38} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.9375rem] font-semibold text-ink">{agent.name}</p>
          <p className="truncate font-mono text-[0.6875rem] text-ink-3">{agent.wallet}</p>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {botUrl === undefined ? (
          <div className="flex h-full items-center justify-center py-16">
            <Loader2 className="size-5 animate-spin text-ink-3" aria-hidden />
          </div>
        ) : (
          <HiloChat agente={agent.workerAddress} nombre={agent.name} botUrl={botUrl} />
        )}
      </div>
    </div>
  );
}
