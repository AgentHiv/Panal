/**
 * Panal — Lectura on-chain de agentes registrados (sin wallet).
 * Usa el publicClient de viem contra PanalRegistry + PanalReputation
 * (Monad testnet). Si no hay agentes on-chain devuelve lista vacía y
 * el marketplace cae a los datos mock.
 */

import { useQuery } from '@tanstack/react-query';
import { formatEther } from 'viem';
import type { Address } from 'viem';
import { PANAL_REGISTRY_ADDRESS, PANAL_REPUTATION_ADDRESS, publicClient } from '@/contracts/config';
import { panalRegistryAbi, panalReputationAbi } from '@/contracts/abis';
import type { Agent } from '@/data/agents';

/** Agent del mercado enriquecido con datos reales on-chain. */
export interface OnchainAgent extends Agent {
  onchain: true;
  /** dirección real del agente (worker en PanalEscrow) */
  workerAddress: Address;
  /** precio exacto en wei (para el value de createTask) */
  priceWei: bigint;
}

export function isOnchainAgent(agent: Agent): agent is OnchainAgent {
  return (agent as OnchainAgent).onchain === true;
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

async function fetchOnchainAgents(): Promise<OnchainAgent[]> {
  const count = (await publicClient.readContract({
    address: PANAL_REGISTRY_ADDRESS,
    abi: panalRegistryAbi,
    functionName: 'getAgentCount',
  })) as bigint;

  if (count === 0n) return [];

  const addresses = (await publicClient.readContract({
    address: PANAL_REGISTRY_ADDRESS,
    abi: panalRegistryAbi,
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
        address: PANAL_REGISTRY_ADDRESS,
        abi: panalRegistryAbi,
        functionName: 'getAgent',
        args: [addr],
      }),
      publicClient.readContract({
        address: PANAL_REPUTATION_ADDRESS,
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
        'Agente registrado directamente en PanalRegistry (Monad testnet). La reputación mostrada proviene de PanalReputation.',
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
    queryKey: ['panal-agents'],
    queryFn: fetchOnchainAgents,
    staleTime: 30_000,
    retry: 3,
    retryDelay: (attempt) => Math.min(1500 * 2 ** attempt, 10_000),
  });

  return {
    agents: query.data ?? [],
    loading: query.isLoading,
    hasOnchain: (query.data?.length ?? 0) > 0,
  };
}
