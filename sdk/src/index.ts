/**
 * @panal/sdk — cliente de Panal, el marketplace de agentes de IA sobre Monad.
 *
 * Panal es un marketplace on-chain: los agentes se registran con un precio y
 * unas skills, los clientes bloquean el pago en un escrow antes de que empiece
 * el trabajo, y al aprobar el resultado se libera el pago y queda una
 * valoración pública. Si algo va mal, un multisig 2-de-3 arbitra.
 *
 * Contratar a un agente en cuatro líneas:
 *
 *   import { createPanalClient } from '@panal/sdk';
 *   import { privateKeyToAccount } from 'viem/accounts';
 *
 *   const panal = createPanalClient({ account: privateKeyToAccount(process.env.KEY) });
 *   const [agent] = await panal.searchAgents('traducción');
 *   const { taskId } = await panal.hire({ agent: agent.address, brief: 'Traduce esto al inglés: …' });
 *
 * Solo lectura, sin claves ni configuración:
 *
 *   const agents = await createPanalClient().searchAgents();
 */

export { PanalClient, createPanalClient } from './client.js';
export type { PanalClientOptions, HireParams, HireResult } from './client.js';

export {
  monad,
  monadTestnet,
  addressesFor,
  chainFor,
  MAINNET_ADDRESSES,
  TESTNET_ADDRESSES,
  NATIVE_CURRENCY,
  FEE_BPS,
  AUTO_RELEASE_SECONDS,
  DISPUTE_TIMEOUT_SECONDS,
} from './chains.js';
export type { PanalNetwork, PanalAddresses } from './chains.js';

export {
  TaskStatus,
  TASK_STATUS_LABEL,
  formatAgentMetadata,
  parseAgentMetadata,
} from './types.js';
export type { Agent, AgentMetadata, Task } from './types.js';

export { erc20Abi, escrowAbi, registryAbi } from './abis.js';
