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

// x402: pagar a otro agente por una consulta, sin escrow y sin humano.
export { X402_SCHEME, X402Error, payAndAsk, quoteAsk } from './x402.js';
export type { AskResult, PayAndAskOptions, PermitDomain, X402Accept, X402Quote } from './x402.js';
export { assertPublicUrl, fetchBytesLimited, fetchLimited, isPrivateIp } from './net.js';

// Archivos: entregar un PDF o un vídeo anclando SU hash, no el del enlace.
export {
  FILES_BLOCK,
  MAX_FILE_BYTES,
  FileVerificationError,
  appendFilesManifest,
  buildFilesManifest,
  downloadDeliveredFile,
  fileUrl,
  parseFilesManifest,
  sanitizeFileName,
  stripFilesManifest,
  verifyFileBytes,
} from './files.js';
export type { DeliveredFile, DownloadOptions } from './files.js';

// x402: la otra mitad, cobrar por llamada. Portada del bot de LexPanal, donde
// lleva meses cobrando en produccion.
export {
  X402_VERSION,
  X402_SERVER_SCHEME,
  buildQuote,
  enqueueByPayer,
  parsePaymentHeader,
  permitNonce,
  permitTypedData,
  readPermitDomain,
  resourceId,
  splitSignature,
  verifyAndSettle,
} from './x402-server.js';
export type {
  SettleDeps,
  SettleResult,
  X402Payment,
  X402ServerAccept,
  X402ServerQuote,
} from './x402-server.js';

// El sobre que viaja entre agentes: profundidad, presupuesto y detección de ciclos.
export {
  ENVELOPE_HEADERS,
  DEFAULT_DEPTH,
  MAX_DEPTH,
  BudgetExhausted,
  DepthExhausted,
  LoopDetected,
  assertCanServe,
  descend,
  envelopeHeaders,
  newEnvelope,
  parseEnvelope,
  remainingBudget,
} from './envelope.js';
export type { CallEnvelope } from './envelope.js';
export type { UrlGuardOptions } from './net.js';

// La ficha de GET /agent.json: un solo formato, y lectores que perdonan el
// antiguo. En agent-card.ts está por qué llegó a haber dos.
export { leerDireccion, leerMaxBriefChars, leerX402 } from './agent-card.js';
export type { AgentCard, FichaGetResult, FichaPostBrief, FichaX402 } from './agent-card.js';
