/**
 * Panal — Contenido del protocolo y de la red (protocolo.md, home.md S4/S8/S9)
 */

import type { LucideIcon } from 'lucide-react';
import {
  Hexagon,
  Lock,
  Award,
  Handshake,
  Cpu,
  PackageCheck,
  ScanSearch,
  Coins,
  Network,
} from 'lucide-react';
import {
  PANAL_ESCROW_ADDRESS,
  PANAL_REGISTRY_ADDRESS,
  PANAL_REPUTATION_ADDRESS,
} from '@/contracts/config';

/** 0x1234…abcd — direcciones cortas derivadas de la config de red activa. */
const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/* ---------- Red ---------- */

export const NETWORK = {
  name: 'Monad',
  chainId: 143,
  rpc: 'rpc.monad.xyz',
  finality: '~800ms',
  tps: '10.000',
  feePerTx: '<$0.001',
} as const;

export const PROTOCOL_FEE = 0.025; // 2,5%
export const ESCROW_AUTO_RELEASE_H = 72;

/* ---------- Contratos ---------- */

export interface ContractInfo {
  id: 'registry' | 'escrow' | 'reputation';
  name: string;
  address: string;
  addressShort: string;
  icon: LucideIcon;
  tagline: string;
  image: string;
}

export const CONTRACTS: ContractInfo[] = [
  {
    id: 'registry',
    name: 'PanalRegistry',
    address: PANAL_REGISTRY_ADDRESS,
    addressShort: shortAddr(PANAL_REGISTRY_ADDRESS),
    icon: Hexagon,
    tagline: 'protocol.contracts.registry.tagline',
    image: '/registry-totem.webp',
  },
  {
    id: 'escrow',
    name: 'PanalEscrow',
    address: PANAL_ESCROW_ADDRESS,
    addressShort: shortAddr(PANAL_ESCROW_ADDRESS),
    icon: Lock,
    tagline: 'protocol.contracts.escrow.tagline',
    image: '/escrow-vault.webp',
  },
  {
    id: 'reputation',
    name: 'PanalReputation',
    address: PANAL_REPUTATION_ADDRESS,
    addressShort: shortAddr(PANAL_REPUTATION_ADDRESS),
    icon: Award,
    tagline: 'protocol.contracts.reputation.tagline',
    image: '/reputation-laurel.webp',
  },
];

/* ---------- Stats de red (home.md S2) ---------- */

export interface NetworkStat {
  value: number;
  decimals?: number;
  suffix?: string;
  label: string;
}

export const NETWORK_STATS: NetworkStat[] = [
  { value: 48291, label: 'home.stats.agents' },
  { value: 1240912, label: 'home.stats.tasks' },
  { value: 4.8, decimals: 1, suffix: 'M MON', label: 'home.stats.volume' },
  { value: 812, suffix: 'ms', label: 'home.stats.finality' },
];

/* ---------- Ciclo de vida de una tarea (protocolo.md S3) ---------- */

export interface LifecycleStep {
  n: number;
  title: string;
  icon: LucideIcon;
  text: string;
}

export const LIFECYCLE_STEPS: LifecycleStep[] = [
  { n: 1, title: 'protocol.lifecycle.1.title', icon: Hexagon, text: 'protocol.lifecycle.1.text' },
  { n: 2, title: 'protocol.lifecycle.2.title', icon: Handshake, text: 'protocol.lifecycle.2.text' },
  { n: 3, title: 'protocol.lifecycle.3.title', icon: Cpu, text: 'protocol.lifecycle.3.text' },
  { n: 4, title: 'protocol.lifecycle.4.title', icon: PackageCheck, text: 'protocol.lifecycle.4.text' },
  { n: 5, title: 'protocol.lifecycle.5.title', icon: ScanSearch, text: 'protocol.lifecycle.5.text' },
  { n: 6, title: 'protocol.lifecycle.6.title', icon: Coins, text: 'protocol.lifecycle.6.text' },
  { n: 7, title: 'protocol.lifecycle.7.title', icon: Award, text: 'protocol.lifecycle.7.text' },
  { n: 8, title: 'protocol.lifecycle.8.title', icon: Network, text: 'protocol.lifecycle.8.text' },
];

/* ---------- Roadmap (home.md S9) ---------- */

export type RoadmapStatus = 'completada' | 'en-curso' | 'futura';

export interface RoadmapPhase {
  phase: string;
  title: string;
  status: RoadmapStatus;
  text: string;
  quarter: string;
}

export const ROADMAP_PHASES: RoadmapPhase[] = [
  { phase: 'home.roadmap.0.phase', title: 'home.roadmap.0.title', status: 'completada', text: 'home.roadmap.0.text', quarter: 'Q2 2026' },
  { phase: 'home.roadmap.1.phase', title: 'home.roadmap.1.title', status: 'completada', text: 'home.roadmap.1.text', quarter: 'Q3 2026' },
  { phase: 'home.roadmap.2.phase', title: 'home.roadmap.2.title', status: 'en-curso', text: 'home.roadmap.2.text', quarter: 'Q4 2026' },
  { phase: 'home.roadmap.3.phase', title: 'home.roadmap.3.title', status: 'futura', text: 'home.roadmap.3.text', quarter: 'Q1 2027' },
];

/* ---------- Tabla comparativa de redes (home.md S8, protocolo.md S6) ---------- */

export type MicrotaskVerdict = 'si' | 'apenas' | 'no';

export interface NetworkRow {
  network: string;
  fee: string;
  finality: string;
  tps: string;
  microtask: MicrotaskVerdict;
  microtaskLabel: string;
  evm?: string;
  highlight?: boolean;
}

export const NETWORK_COMPARISON: NetworkRow[] = [
  { network: 'Monad', fee: '< $0.001', finality: '~800 ms', tps: '10.000', microtask: 'si', microtaskLabel: 'home.monad.viable', evm: 'home.monad.evmFull', highlight: true },
  { network: 'Ethereum L1', fee: '~$1.20', finality: '~12 min', tps: '~15', microtask: 'no', microtaskLabel: 'common.no', evm: 'home.monad.evmFull' },
  { network: 'L2 típica', fee: '~$0.05', finality: '~2 s (soft)', tps: '~100', microtask: 'apenas', microtaskLabel: 'home.monad.barely', evm: 'home.monad.evmFull' },
  { network: 'Pagos tradicionales', fee: '~$0.30 + 2,9%', finality: '~2 días', tps: '—', microtask: 'no', microtaskLabel: 'common.no', evm: '—' },
];

/* ---------- FAQ (protocolo.md S7) ---------- */

export interface FaqItem {
  q: string;
  a: string;
}

export const FAQ_ITEMS: FaqItem[] = [
  {
    q: 'protocol.faq.q1.q',
    a: 'protocol.faq.q1.a',
  },
  {
    q: 'protocol.faq.q2.q',
    a: 'protocol.faq.q2.a',
  },
  {
    q: 'protocol.faq.q3.q',
    a: 'protocol.faq.q3.a',
  },
  {
    q: 'protocol.faq.q4.q',
    a: 'protocol.faq.q4.a',
  },
  {
    q: 'protocol.faq.q5.q',
    a: 'protocol.faq.q5.a',
  },
  {
    q: 'protocol.faq.q6.q',
    a: 'protocol.faq.q6.a',
  },
];
