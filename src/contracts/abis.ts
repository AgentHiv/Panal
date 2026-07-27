/**
 * Panal — ABIs de los contratos desplegados en Monad testnet.
 * Extraídos del fuente verificado en contracts/src/ (PanalRegistry,
 * PanalReputation, PanalEscrow — solidity ^0.8.24).
 */

export const panalRegistryAbi = [
  {
    type: 'function',
    name: 'registerAgent',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'metadataURI', type: 'string' },
      { name: 'pricePerTask', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'updatePrice',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'newPrice', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'updateMetadata',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'newMetadataURI', type: 'string' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setActive',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'active', type: 'bool' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'getAgent',
    stateMutability: 'view',
    inputs: [{ name: 'agent', type: 'address' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'owner', type: 'address' },
          { name: 'metadataURI', type: 'string' },
          { name: 'pricePerTask', type: 'uint256' },
          { name: 'active', type: 'bool' },
          { name: 'registeredAt', type: 'uint256' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'getAgentCount',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getAgents',
    stateMutability: 'view',
    inputs: [
      { name: 'offset', type: 'uint256' },
      { name: 'limit', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'address[]' }],
  },
  {
    type: 'function',
    name: 'isActiveAgent',
    stateMutability: 'view',
    inputs: [{ name: 'agent', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'event',
    name: 'AgentRegistered',
    inputs: [
      { name: 'agent', type: 'address', indexed: true },
      { name: 'owner', type: 'address', indexed: true },
      { name: 'pricePerTask', type: 'uint256', indexed: false },
    ],
  },
] as const;

export const panalReputationAbi = [
  {
    type: 'function',
    name: 'getScore',
    stateMutability: 'view',
    inputs: [{ name: 'agent', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getReputation',
    stateMutability: 'view',
    inputs: [{ name: 'agent', type: 'address' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'tasksCompleted', type: 'uint256' },
          { name: 'totalEarned', type: 'uint256' },
          { name: 'ratingSum', type: 'uint256' },
          { name: 'ratingCount', type: 'uint256' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'escrow',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;

export const panalEscrowAbi = [
  {
    type: 'function',
    name: 'createTask',
    stateMutability: 'payable',
    inputs: [
      { name: 'worker', type: 'address' },
      { name: 'taskHash', type: 'bytes32' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: 'taskId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'claimTask',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'taskId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'deliverResult',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'taskId', type: 'uint256' },
      { name: 'resultHash', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'approveAndRelease',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'taskId', type: 'uint256' },
      { name: 'rating', type: 'uint8' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'autoRelease',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'taskId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'openDispute',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'taskId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'cancelTask',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'taskId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'getTaskCount',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  /** Getter público del mapping `tasks` (tupla completa). Status: 0 Open, 1 Delivered, 2 Completed, 3 Disputed, 4 Cancelled. */
  {
    type: 'function',
    name: 'tasks',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'client', type: 'address' },
          { name: 'worker', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'taskHash', type: 'bytes32' },
          { name: 'resultHash', type: 'bytes32' },
          { name: 'deadline', type: 'uint256' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'status', type: 'uint8' },
        ],
      },
    ],
  },
  /** Timestamp de entrega (solo tareas en estado Delivered). */
  {
    type: 'function',
    name: 'deliveredAt',
    stateMutability: 'view',
    inputs: [{ name: 'taskId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'FEE_BPS',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'AUTO_RELEASE',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'event',
    name: 'TaskCreated',
    inputs: [
      { name: 'taskId', type: 'uint256', indexed: true },
      { name: 'client', type: 'address', indexed: true },
      { name: 'worker', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'TaskClaimed',
    inputs: [
      { name: 'taskId', type: 'uint256', indexed: true },
      { name: 'worker', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'TaskDelivered',
    inputs: [
      { name: 'taskId', type: 'uint256', indexed: true },
      { name: 'resultHash', type: 'bytes32', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'TaskCompleted',
    inputs: [
      { name: 'taskId', type: 'uint256', indexed: true },
      { name: 'worker', type: 'address', indexed: true },
      { name: 'workerPaid', type: 'uint256', indexed: false },
      { name: 'fee', type: 'uint256', indexed: false },
      { name: 'rating', type: 'uint8', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'TaskDisputed',
    inputs: [
      { name: 'taskId', type: 'uint256', indexed: true },
      { name: 'openedBy', type: 'address', indexed: true },
    ],
  },
  // ---- hardening mainnet (auditoría 2026-07): pagos pull + timeout de disputas ----
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'function',
    name: 'pendingWithdrawals',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'resolveStuckDispute',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'taskId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'disputedAt',
    stateMutability: 'view',
    inputs: [{ name: 'taskId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'DISPUTE_TIMEOUT',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'MIN_TASK_AMOUNT',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'event',
    name: 'Withdrawal',
    inputs: [
      { name: 'to', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
] as const;
