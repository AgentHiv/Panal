/**
 * Panal — Lectura on-chain de agentes registrados (sin wallet).
 * Usa el publicClient de viem contra PanalRegistry + PanalReputation
 * (Monad mainnet) y enriquece cada agente con las stats REALES del
 * indexador (useIndexAgents: tareas completadas, rating medio, nº de
 * ratings, volumen cobrado en MON). Si el indexador no responde, los
 * campos derivados quedan con los valores on-chain/cero (fallback honesto).
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatEther } from 'viem';
import type { Address } from 'viem';
import {
  NATIVE_CURRENCY,
  currencySymbol,
  PANAL_REGISTRY_ADDRESS,
  PANAL_REGISTRY_V2_ADDRESS,
  PANAL_REPUTATION_ADDRESS,
  PANAL_REPUTATION_V2_ADDRESS,
  V2_ENABLED,
  publicClient,
} from '@/contracts/config';
import { panalRegistryAbi, panalRegistryV2Abi, panalReputationAbi } from '@/contracts/abis';
import type { Agent } from '@/data/agents';
import { useIndexAgents, type AgentStats } from '@/lib/indexer';

/** Agent del mercado enriquecido con datos reales on-chain + indexador. */
export interface OnchainAgent extends Agent {
  onchain: true;
  /** dirección real del agente (worker en PanalEscrow) */
  workerAddress: Address;
  /** precio exacto en wei (para el value/amount de createTask) */
  priceWei: bigint;
  /** moneda del precio: address(0) = MON (v1 siempre), PANAL_TOKEN = $PANAL (solo v2) */
  currency: Address;
  /** stats del indexador para esta address (null si aún no tiene actividad) */
  indexStats: AgentStats | null;
}

export function isOnchainAgent(agent: Agent): agent is OnchainAgent {
  return (agent as OnchainAgent).onchain === true;
}

/**
 * La clave de traducción del precio según la moneda REAL del agente.
 *
 * Cada texto con un precio existe dos veces en los locales: `foo` dice MON y
 * `fooToken` dice $PANAL. Elegir a mano en cada sitio es justo lo que falló —
 * un agente que cobraba 100 $PANAL salía anunciado a "100 MON" en el ranking
 * y en el botón de contratar, que es prometer un precio que no es el que se
 * va a cobrar. Con este ayudante el sitio nuevo solo tiene que pasar la base.
 */
export function priceKey(base: string, agent: Agent): string {
  return isOnchainAgent(agent) && currencySymbol(agent.currency) === '$PANAL' ? `${base}Token` : base;
}

function short(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** metadataURI de texto libre → campos de presentación. */
function parseMetadata(uri: string, addr: Address): { name: string; tagline: string; skills: string[] } {
  const fallback = { name: `Agente ${short(addr)}`, tagline: '', skills: [] as string[] };
  const text = uri.trim();
  if (!text) return { ...fallback, tagline: 'Agente registrado on-chain en PanalRegistry.' };
  // Formato sugerido: "Nombre · descripción · skill1, skill2"
  const parts = text.split('·').map((p) => p.trim()).filter(Boolean);
  if (parts.length > 0) {
    return {
      name: parts[0] || fallback.name,
      tagline: parts[1] || parts[0],
      skills: parts[2] ? parts[2].split(',').map((s) => s.trim()).filter(Boolean).slice(0, 6) : [],
    };
  }
  return { ...fallback, tagline: text };
}

interface RawAgentTuple {
  owner: Address;
  metadataURI: string;
  pricePerTask: bigint;
  active: boolean;
  registeredAt: bigint;
  /** solo registry v2 (ausente en v1) */
  currency?: Address;
}

async function fetchOnchainAgents(): Promise<OnchainAgent[]> {
  // Con V2_ENABLED se lee del registry v2 (mismo formato + currency al final).
  const registryAddr = V2_ENABLED ? PANAL_REGISTRY_V2_ADDRESS : PANAL_REGISTRY_ADDRESS;
  const reputationAddr = V2_ENABLED ? PANAL_REPUTATION_V2_ADDRESS : PANAL_REPUTATION_ADDRESS;
  const registryAbi = V2_ENABLED ? panalRegistryV2Abi : panalRegistryAbi;

  const count = (await publicClient.readContract({
    address: registryAddr,
    abi: registryAbi,
    functionName: 'getAgentCount',
  })) as bigint;

  if (count === 0n) return [];

  const addresses = (await publicClient.readContract({
    address: registryAddr,
    abi: registryAbi,
    functionName: 'getAgents',
    args: [0n, 50n],
  })) as Address[];

  // El RPC público limita a ~15 req/s (HTTP 429): leemos en lotes de 4
  // agentes con pausa entre lotes en vez de un Promise.all masivo.
  const BATCH = 4;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const readOne = async (addr: Address): Promise<OnchainAgent | null> => {
    const [data, score] = await Promise.all([
      publicClient.readContract({
        address: registryAddr,
        abi: registryAbi,
        functionName: 'getAgent',
        args: [addr],
      }) as Promise<RawAgentTuple>,
      publicClient.readContract({
        address: reputationAddr,
        abi: panalReputationAbi,
        functionName: 'getScore',
        args: [addr],
      }).catch(() => 0n),
    ]);

    const meta = parseMetadata(data.metadataURI, addr);
    const priceWei = data.pricePerTask;
    const priceMon = Number(formatEther(priceWei));
    const rating = Number(score) / 100; // score x100 → estrellas

    return {
      id: `onchain-${addr.toLowerCase()}`,
      name: meta.name,
      category: 'codigo',
      type: 'ia',
      tagline: meta.tagline || 'Agente registrado on-chain en PanalRegistry.',
      description:
        meta.tagline ||
        'Agente registrado directamente en PanalRegistry (Monad mainnet). La reputación mostrada proviene de PanalReputation.',
      pricePerTask: priceMon,
      rating: rating > 0 ? Math.min(5, rating) : 0,
      reviews: 0,
      tasksCompleted: 0,
      avgResponse: '—',
      avgResponseSec: Number.MAX_SAFE_INTEGER,
      successRate: 100,
      status: data.active ? 'en-linea' : 'desconectado',
      verified: false,
      acceptsSubcontracting: false,
      wallet: addr,
      walletShort: short(addr),
      skills: meta.skills,
      totalEarned: 0,
      memberSince: new Date(Number(data.registeredAt) * 1000).toLocaleDateString('es-ES', {
        month: 'short',
        year: 'numeric',
      }),
      volume24h: 0,
      trend7d: [0, 0, 0, 0, 0, 0, 0],
      onchain: true,
      workerAddress: addr,
      priceWei,
      currency: data.currency ?? NATIVE_CURRENCY,
      indexStats: null,
    };
  };

  const agents: Array<OnchainAgent | null> = [];
  for (let i = 0; i < addresses.length; i += BATCH) {
    const chunk = await Promise.all(addresses.slice(i, i + BATCH).map(readOne));
    agents.push(...chunk);
    if (i + BATCH < addresses.length) await sleep(350);
  }

  return agents.filter((a): a is OnchainAgent => a !== null && a.status === 'en-linea');
}

export function usePanalAgents() {
  const query = useQuery({
    queryKey: ['panal-agents', V2_ENABLED],
    queryFn: fetchOnchainAgents,
    staleTime: 30_000,
    retry: 3,
    retryDelay: (attempt) => Math.min(1500 * 2 ** attempt, 10_000),
  });
  // Stats reales del indexador (react-query dedup por queryKey: el fetch lo
  // comparte con el resto de consumidores de useIndexAgents).
  const { byAddress } = useIndexAgents();

  const agents = useMemo<OnchainAgent[]>(
    () =>
      (query.data ?? []).map((a) => {
        const st = byAddress.get(a.workerAddress.toLowerCase()) ?? null;
        if (!st) return a;
        const propia = currencySymbol(a.currency);
        const otra = propia === '$PANAL' ? 'MON' : '$PANAL';
        const enOtra = Number(formatEther(BigInt(st.volume[otra] ?? '0')));
        return {
          ...a,
          indexStats: st,
          tasksCompleted: st.completed,
          rating: st.avgRating ?? a.rating,
          reviews: st.ratingCount,
          // El volumen se lee en la moneda del agente. Antes se cogía siempre
          // el de MON, así que un agente que cobra en $PANAL salía con volumen
          // cero por muchas tareas que hubiera hecho.
          totalEarned: Number(formatEther(BigInt(st.volume[propia] ?? '0'))),
          earnedOther: enOtra > 0 ? { amount: enOtra, symbol: otra } : undefined,
        };
      }),
    [query.data, byAddress],
  );

  return {
    agents,
    loading: query.isLoading,
    hasOnchain: agents.length > 0,
  };
}
