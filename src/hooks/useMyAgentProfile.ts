/**
 * Panal — Perfil on-chain de la wallet conectada.
 *
 * Una sola query (3 lecturas paralelas, dentro del rate limit):
 * - PanalRegistry.getAgent(me) → OJO: no revierte para quien no está
 *   registrado, devuelve la estructura a ceros. Lo que dice si existe es
 *   registeredAt != 0, igual que hace el contrato en isActiveAgent.
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
  PANAL_REGISTRY_V2_ADDRESS,
  PANAL_REPUTATION_ADDRESS,
  PANAL_REPUTATION_V2_ADDRESS,
  V2_ENABLED,
  activeChain,
  publicClient,
} from '@/contracts/config';
import { panalRegistryAbi, panalRegistryV2Abi, panalReputationAbi } from '@/contracts/abis';

/** Registry/reputation activos: v2 cuando esté desplegado, v1 mientras tanto. */
const REGISTRY = V2_ENABLED ? PANAL_REGISTRY_V2_ADDRESS : PANAL_REGISTRY_ADDRESS;
const REPUTATION = V2_ENABLED ? PANAL_REPUTATION_V2_ADDRESS : PANAL_REPUTATION_ADDRESS;
const REGISTRY_ABI = V2_ENABLED ? panalRegistryV2Abi : panalRegistryAbi;
import { useWallet } from '@/hooks/useWallet';

export interface MyAgentData {
  owner: Address;
  metadataURI: string;
  pricePerTask: bigint;
  active: boolean;
  registeredAt: bigint;
  /** v2: moneda de cobro (address(0) = MON). Ausente en v1. */
  currency?: Address;
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
        address: REGISTRY,
        abi: REGISTRY_ABI,
        functionName: 'getAgent',
        args: [me],
      })
      .catch(() => null) as Promise<MyAgentData | null>,
    publicClient
      .readContract({
        address: REGISTRY,
        abi: REGISTRY_ABI,
        functionName: 'isActiveAgent',
        args: [me],
      })
      .catch(() => false) as Promise<boolean>,
    publicClient
      .readContract({
        address: REPUTATION,
        abi: panalReputationAbi,
        functionName: 'getReputation',
        args: [me],
      })
      .catch(() => ZERO_REPUTATION) as Promise<MyReputation>,
  ]);

  // `getAgent` NO revierte para una wallet sin registrar: devuelve la Agent a
  // ceros, porque en Solidity leer un mapping vacío no es un error. Por eso no
  // basta con `.catch(() => null)` — el catch no salta nunca y toda wallet
  // parecía un agente registrado. El panel llegaba a anunciar "Miembro del
  // panal desde ene 1970" a quien solo había contratado: registeredAt = 0,
  // Date(0), epoch.
  //
  // La marca de "existe" es la misma que usa el propio contrato en
  // isActiveAgent: registeredAt != 0. Nadie se registró en 1970.
  const registrado = agent !== null && agent.registeredAt > 0n;

  return {
    agent: registrado ? agent : null,
    isActive: Boolean(isActive) && registrado,
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
