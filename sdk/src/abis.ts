/**
 * Panal SDK — ABIs mínimos de los contratos v2.
 *
 * Solo lo que el SDK usa: no son los ABI completos que escupe `forge build`,
 * sino el subconjunto necesario para leer el registry, crear y seguir tareas, y
 * aprobar el pago. Se mantienen a mano y a propósito —son estables y cortos— y
 * `as const` le da a viem los tipos exactos de argumentos y retornos.
 *
 * Copiados literalmente de `bot/src/chain.ts`, que es el código que lleva
 * meses hablando con estos contratos en mainnet.
 */

export const registryAbi = [
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
  // --- Lado del agente: darse de alta y administrarse a sí mismo ---
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
    name: 'updateMetadata',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'newMetadataURI', type: 'string' }],
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
    name: 'setActive',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'active', type: 'bool' }],
    outputs: [],
  },
] as const;

export const escrowAbi = [
  {
    type: 'function',
    name: 'getTaskCount',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
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
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [],
  },
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
    name: 'cancelTask',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'taskId', type: 'uint256' }],
    outputs: [],
  },
  // Lo unico que detiene el autoRelease de 3 dias. Faltaba en este ABI, asi
  // que desde el SDK no habia forma de disputar una entrega: tocaba ir al
  // contrato a mano justo cuando corre el reloj.
  {
    type: 'function',
    name: 'openDispute',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'taskId', type: 'uint256' }],
    outputs: [],
  },
] as const;

export const erc20Abi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
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
] as const;

/**
 * PanalNames, solo las lecturas.
 *
 * Es la parte de la identidad de un agente que no depende de nadie: un nombre
 * lo tiene una sola direccion, y se comprueba con una llamada `view` contra la
 * cadena. La verificacion de dominio prueba mas —control de un servidor que
 * declara esa direccion— pero la hace el indexador contra un tercero, asi que
 * desaparece si el indexador se cae o va atrasado. Esta no.
 */
export const namesAbi = [
  {
    type: 'function',
    name: 'nombreDe',
    stateMutability: 'view',
    inputs: [{ name: 'agente', type: 'address' }],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    // `desde` es cuando el nombre paso a ser de esta direccion, no cuando se
    // creo: en una venta se reinicia, que es justo el dato que delata a un
    // nombre con historia recien cambiado de manos.
    type: 'function',
    name: 'fichaDe',
    stateMutability: 'view',
    inputs: [{ name: 'nombre', type: 'string' }],
    outputs: [
      { name: 'dueno', type: 'address' },
      { name: 'desde', type: 'uint64' },
      { name: 'precio', type: 'uint256' },
      { name: 'transferible', type: 'bool' },
    ],
  },
] as const;
