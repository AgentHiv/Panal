/**
 * Panal — ABIs de los contratos desplegados en Monad (mainnet y testnet
 * comparten los mismos ABIs).
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

/**
 * ── ABIs v2 (dual-moneda MON + $PANAL) ────────────────────────────────────
 * Derivadas de contracts/src/v2/PanalRegistryV2.sol y PanalEscrowV2.sol
 * (auditados, 112/112 tests). Cambios vs v1:
 * - Registry: registerAgent/updatePrice con `currency` (address(0) = MON),
 *   getAgent devuelve la tupla v1 + `currency` AL FINAL, PANAL_TOKEN() y
 *   eventos con currency.
 * - Escrow: createTask(worker, taskHash, deadline, currency, amount)
 *   (MON: currency=0 y msg.value == amount; PANAL: currency=PANAL_TOKEN,
 *   msg.value=0 y approve previo), tasks(i) con currency al final,
 *   pendingWithdrawals(token, user) — 2 args —, withdraw(token) — 1 arg —,
 *   MIN_TASK_AMOUNT_TOKEN y eventos con currency/token.
 * Las tuplas mantienen el orden v1 y añaden `currency` al final
 * (ABI-compatible hacia atrás).
 */
export const panalRegistryV2Abi = [
  {
    type: 'function',
    name: 'registerAgent',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'metadataURI', type: 'string' },
      { name: 'pricePerTask', type: 'uint256' },
      { name: 'currency', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'updatePrice',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'newPrice', type: 'uint256' },
      { name: 'currency', type: 'address' },
    ],
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
          { name: 'currency', type: 'address' },
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
    type: 'function',
    name: 'PANAL_TOKEN',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'event',
    name: 'AgentRegistered',
    inputs: [
      { name: 'agent', type: 'address', indexed: true },
      { name: 'owner', type: 'address', indexed: true },
      { name: 'pricePerTask', type: 'uint256', indexed: false },
      { name: 'currency', type: 'address', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'PriceUpdated',
    inputs: [
      { name: 'agent', type: 'address', indexed: true },
      { name: 'newPrice', type: 'uint256', indexed: false },
      { name: 'currency', type: 'address', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'MetadataUpdated',
    inputs: [
      { name: 'agent', type: 'address', indexed: true },
      { name: 'newMetadataURI', type: 'string', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'ActiveUpdated',
    inputs: [
      { name: 'agent', type: 'address', indexed: true },
      { name: 'active', type: 'bool', indexed: false },
    ],
  },
] as const;

export const panalEscrowV2Abi = [
  {
    type: 'function',
    name: 'createTask',
    stateMutability: 'payable',
    inputs: [
      { name: 'worker', type: 'address' },
      { name: 'taskHash', type: 'bytes32' },
      { name: 'deadline', type: 'uint256' },
      { name: 'currency', type: 'address' },
      { name: 'amount', type: 'uint256' },
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
  /** Getter público del mapping `tasks` (tupla v1 + currency al final). Status: 0 Open, 1 Delivered, 2 Completed, 3 Disputed, 4 Cancelled. */
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
          { name: 'currency', type: 'address' },
        ],
      },
    ],
  },
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
  /** Retiro pull payment por moneda: token = address(0) (MON) o ERC-20 ($PANAL). */
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [],
  },
  /** Saldos pull payment por moneda: pendingWithdrawals(token, user). */
  {
    type: 'function',
    name: 'pendingWithdrawals',
    stateMutability: 'view',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'account', type: 'address' },
    ],
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
    name: 'MIN_TASK_AMOUNT_NATIVE',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'MIN_TASK_AMOUNT_TOKEN',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'PANAL_TOKEN',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'event',
    name: 'TaskCreated',
    inputs: [
      { name: 'taskId', type: 'uint256', indexed: true },
      { name: 'client', type: 'address', indexed: true },
      { name: 'worker', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'currency', type: 'address', indexed: false },
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
  {
    type: 'event',
    name: 'DisputeResolved',
    inputs: [
      { name: 'taskId', type: 'uint256', indexed: true },
      { name: 'workerPaid', type: 'uint256', indexed: false },
      { name: 'clientRefunded', type: 'uint256', indexed: false },
      { name: 'rating', type: 'uint8', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'TaskCancelled',
    inputs: [{ name: 'taskId', type: 'uint256', indexed: true }],
  },
  {
    type: 'event',
    name: 'Withdrawal',
    inputs: [
      { name: 'to', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'function',
    name: 'arbitrator',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'owner',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'transferArbitrator',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'newArbitrator', type: 'address' }],
    outputs: [],
  },
] as const;

/**
 * Token oficial $PANAL (ERC-20 mínimo para lecturas de UI).
 * Proxy EIP-1167 en mainnet — ver config.PANAL_TOKEN_ADDRESS.
 */
export const panalTokenAbi = [
  {
    type: 'function',
    name: 'name',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    name: 'symbol',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'totalSupply',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  /** approve(spender, amount) — paso previo a createTask en $PANAL (escrow v2). */
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

/**
 * PanalEscrowV2 — `resolveDispute`, que solo puede llamar el `arbitrator`.
 *
 * Va aparte del ABI principal porque el dashboard nunca la invoca de forma
 * directa: el árbitro es el multisig, así que esta función se codifica como
 * calldata y se propone dentro de `PanalMultisig.submit`.
 *
 *   workerShareBps  reparto al agente en puntos básicos
 *                   (0 = todo al cliente · 10000 = todo al agente)
 *   rating          1-5, queda grabado en la reputación on-chain
 */
export const panalResolveDisputeAbi = [
  {
    type: 'function',
    name: 'resolveDispute',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'taskId', type: 'uint256' },
      { name: 'workerShareBps', type: 'uint256' },
      { name: 'rating', type: 'uint8' },
    ],
    outputs: [],
  },
] as const;

/**
 * PanalMultisig 2-de-3 — el contrato que ostenta el rol de `arbitrator`.
 *
 * Flujo de una resolución: un firmante `submit`ea la propuesta y luego DOS
 * firmantes distintos la `confirm`an; en la segunda confirmación se ejecuta la
 * llamada al escrow. `submit` NO cuenta como confirmación, así que quien
 * propone tiene que confirmar aparte.
 */
export const panalMultisigAbi = [
  {
    type: 'function',
    name: 'REQUIRED',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'owners',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'isOwner',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'txCount',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getTx',
    stateMutability: 'view',
    inputs: [{ name: 'txId', type: 'uint256' }],
    outputs: [
      { name: 'target', type: 'address' },
      { name: 'data', type: 'bytes' },
      { name: 'confirmations', type: 'uint8' },
      { name: 'executed', type: 'bool' },
    ],
  },
  {
    type: 'function',
    name: 'isConfirmedBy',
    stateMutability: 'view',
    inputs: [
      { name: 'txId', type: 'uint256' },
      { name: 'owner', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'submit',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'target', type: 'address' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [{ name: 'txId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'confirm',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'txId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'revoke',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'txId', type: 'uint256' }],
    outputs: [],
  },
] as const;
