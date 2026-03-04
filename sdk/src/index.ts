/**
 * HACP SDK — Hedera Agent Commerce Protocol
 *
 * @example
 * ```typescript
 * import { HACPClient, hbarToTinybars } from "@hacp/sdk";
 *
 * const client = await HACPClient.create({
 *   rpcUrl: "https://testnet.hashio.io/api",
 *   privateKey: process.env.PRIVATE_KEY!,
 *   registryAddress: process.env.REGISTRY_ADDRESS!,
 *   escrowAddress: process.env.ESCROW_ADDRESS!,
 *   network: "testnet",
 *   operatorAccountId: process.env.HEDERA_ACCOUNT_ID,
 *   discoveryTopicId: process.env.HCS_DISCOVERY_TOPIC,
 * });
 *
 * // Register as an agent
 * await client.registry.register({
 *   name: "AuroraCoder",
 *   hcsTopicId: "0.0.12345",
 *   capabilities: ["code-review", "smart-contract-audit"],
 *   ratePerJob: hbarToTinybars(5),
 *   metadataUri: "ipfs://Qm...",
 *   stakeAmount: hbarToTinybars(10),
 * });
 *
 * // Find agents by capability
 * const { agents } = await client.registry.findByCapability("code-review");
 *
 * // Post a job
 * const { jobId } = await client.escrow.postJob({
 *   title: "Audit my Solidity contract",
 *   description: "Need a security audit of ERC20 token contract",
 *   requiredCapability: "smart-contract-audit",
 *   deadline: Math.floor(Date.now() / 1000) + 7 * 86400,
 *   paymentHbar: hbarToTinybars(50),
 * });
 * ```
 */

export { HACPClient } from "./client.js";
export { AgentRegistryClient } from "./registry.js";
export { JobEscrowClient } from "./escrow.js";
export { ReputationStakingClient } from "./staking.js";
export { HCSDiscoveryClient } from "./discovery.js";

export type {
  Agent,
  Bid,
  Job,
  StakeRecord,
  HACPConfig,
  HCSAgentMessage,
  RegisterAgentParams,
  UpdateAgentParams,
  PostJobParams,
  PlaceBidParams,
  TransactionResult,
  FindAgentsResult,
} from "./types.js";

export {
  AgentStatus,
  JobStatus,
  HCSMessageType,
} from "./types.js";

export {
  hbarToTinybars,
  tinybarsTohbar,
  formatTimestamp,
  formatJobStatus,
  formatAgentStatus,
  computeAvgRating,
  deadlineFromDays,
  truncateAddress,
  parseIntSafe,
} from "./utils.js";
