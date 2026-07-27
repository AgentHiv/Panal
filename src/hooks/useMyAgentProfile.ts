/**
 * Panal — Perfil on-chain de la wallet conectada.
 *
 * Una sola query (3 lecturas paralelas, dentro del rate limit):
 * - PanalRegistry.getAgent(me) → si revierte, la wallet no es agente.
 * - PanalRegistry.isActiveAgent(me).
 * - PanalReputation.getReputation(me) → si revierte, ceros reales.
 *
 * Alimenta el header del dashboard (miembro desde / reputación global),
 * OwnAgentCard, los KPIs de proveedor y ReputationSection.
 */

import { useQuery } from '@tanstack/react-query';
import type { Address } from 'viem';
import {
  PANAL_REGISTRY_ADDRESS,
  PANAL_REPUTATION_ADDRESS,
  activeChain,
  publicClient,
} from '@/contracts/config';
import { panalRegistryAbi, panalReputationAbi } from '@/contracts/abis';
import { useWallet } from '@/hooks/useWallet';

export interface MyAgentData {
  owner: Address;
  metadataURI: string;
  pricePerTask: bigint;
  active: boolean;
  registeredAt: bigint;
}

export interface MyReputation {
  tasksCompleted: bigint;
  totalEarned: bigint;
  ratingSum: bigint;
  ratingCount: bigint;
}

export interface MyAgentProfile {
  /** true si la wallet está registrada como agente (getAgent no revierte) */
  isAgent: boolean;
  isActive: boolean;
  agent: MyAgentData | null;
  reputation: MyReputation;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

const ZERO_REPUTATION: MyReputation = {
  tasksCompleted: 0n,
  totalEarned: 0n,
  ratingSum: 0n,
  ratingCount: 0n,
};

async function fetchProfile(me: Address): Promise<{
  agent: MyAgentData | null;
  isActive: boolean;
  reputation: MyReputation;
}> {
  const [agent, isActive, reputation] = await Promise.all([
    publicClient
      .readContract({
        address: PANAL_REGISTRY_ADDRESS,
        abi: panalRegistryAbi,
        functionName: 'getAgent',
        args: [me],
      })
      .catch(() => null) as Promise<MyAgentData | null>,
    publicClient
      .readContract({
        address: PANAL_REGISTRY_ADDRESS,
        abi: panalRegistryAbi,
        functionName: 'isActiveAgent',
        args: [me],
      })
      .catch(() => false) as Promise<boolean>,
    publicClient
      .readContract({
        address: PANAL_REPUTATION_ADDRESS,
        abi: panalReputationAbi,
        functionName: 'getReputation',
        args: [me],
      })
      .catch(() => ZERO_REPUTATION) as Promise<MyReputation>,
  ]);

  return {
    agent,
    isActive: Boolean(isActive) && agent !== null,
    reputation: reputation ?? ZERO_REPUTATION,
  };
}

/** Rating medio 0–5 (null si aún no hay reseñas). */
export function avgRating(rep: MyReputation): number | null {
  if (rep.ratingCount === 0n) return null;
  return Number(rep.ratingSum) / Number(rep.ratingCount);
}

export function useMyAgentProfile(): MyAgentProfile {
  const { address, connected } = useWallet();
  const addr = (connected && address ? address : null) as Address | null;

  const query = useQuery({
    queryKey: ['my-agent-profile', activeChain.id, addr],
    enabled: !!addr,
    queryFn: () => fetchProfile(addr as Address),
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: 1,
  });

  const data = query.data;
  return {
    isAgent: data?.agent != null,
    isActive: data?.isActive ?? false,
    agent: data?.agent ?? null,
    reputation: data?.reputation ?? ZERO_REPUTATION,
    loading: !!addr && query.isLoading,
    error: query.isError ? (query.error as Error) : null,
    refetch: () => void query.refetch(),
  };
}
