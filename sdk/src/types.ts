/**
 * HACP SDK — Type Definitions
 * Hedera Agent Commerce Protocol
 */

import { BigNumberish } from "ethers";

// ============ Agent Types ============

export enum AgentStatus {
  Inactive = 0,
  Active = 1,
  Suspended = 2,
}

export interface Agent {
  wallet: string;
  name: string;
  hcsTopicId: string;
  capabilities: string[];
  ratePerJob: bigint;
  stakedAmount: bigint;
  completedJobs: bigint;
  totalRating: bigint;
  registeredAt: bigint;
  status: AgentStatus;
  metadataUri: string;
}

export interface RegisterAgentParams {
  name: string;
  hcsTopicId: string;
  capabilities: string[];
  ratePerJob: BigNumberish;
  metadataUri: string;
  stakeAmount: BigNumberish; // HBAR in tinybars (must exceed minStake)
}

export interface UpdateAgentParams {
  hcsTopicId?: string;
  capabilities?: string[];
  ratePerJob?: BigNumberish;
  metadataUri?: string;
}

// ============ Job Types ============

export enum JobStatus {
  Open = 0,
  Assigned = 1,
  Submitted = 2,
  Completed = 3,
  Disputed = 4,
  Cancelled = 5,
}

export interface Job {
  id: bigint;
  client: string;
  agent: string;
  title: string;
  description: string;
  requiredCapability: string;
  payment: bigint;
  postedAt: bigint;
  deadline: bigint;
  autoReleaseAt: bigint;
  deliverableUri: string;
  status: JobStatus;
}

export interface Bid {
  agent: string;
  proposedRate: bigint;
  proposal: string;
  placedAt: bigint;
  accepted: boolean;
}

export interface PostJobParams {
  title: string;
  description: string;
  requiredCapability: string;
  deadline: BigNumberish; // unix timestamp
  autoReleaseDelay?: BigNumberish; // seconds, default 7 days
  paymentHbar: BigNumberish; // HBAR amount (will be converted to tinybars)
}

export interface PlaceBidParams {
  jobId: BigNumberish;
  proposedRate: BigNumberish; // tinybars
  proposal: string;
}

// ============ Staking Types ============

export interface StakeRecord {
  amount: bigint;
  lockedUntil: bigint;
  lockedForJob: bigint;
  slashCount: bigint;
}

// ============ HCS Types ============

export enum HCSMessageType {
  REGISTER = "REGISTER",
  OFFER = "OFFER",
  REQUEST = "REQUEST",
  ACCEPT = "ACCEPT",
  COMPLETE = "COMPLETE",
  UPDATE = "UPDATE",
}

export interface HCSAgentMessage {
  type: HCSMessageType;
  agentAddress: string;
  name?: string;
  capabilities?: string[];
  ratePerJob?: string; // HBAR as string to avoid precision issues
  hcsTopicId?: string;
  timestamp: number;
  jobId?: string;
  payload?: Record<string, unknown>;
}

// ============ Config ============

export interface HACPConfig {
  /** RPC URL for Hedera JSON-RPC relay */
  rpcUrl: string;
  /** Private key (hex, with or without 0x prefix) */
  privateKey: string;
  /** AgentRegistry contract address */
  registryAddress: string;
  /** JobEscrow contract address */
  escrowAddress: string;
  /** ReputationStaking contract address */
  stakingAddress?: string;
  /** HCS topic ID for agent discovery (e.g. "0.0.12345") */
  discoveryTopicId?: string;
  /** Hedera network: 'testnet' | 'mainnet' | 'previewnet' */
  network?: "testnet" | "mainnet" | "previewnet";
  /** Hedera operator account ID (for HCS) */
  operatorAccountId?: string;
}

// ============ Results ============

export interface TransactionResult {
  hash: string;
  blockNumber?: number;
}

export interface FindAgentsResult {
  agents: Agent[];
  total: number;
}
