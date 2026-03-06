/**
 * HACP SDK — AgentRegistry Client
 */

import { ethers, ContractTransactionResponse } from "ethers";
import type {
  Agent,
  RegisterAgentParams,
  UpdateAgentParams,
  FindAgentsResult,
  TransactionResult,
} from "./types.js";
import { hbarToTinybars } from "./utils.js";

// Minimal ABI — only the functions we call
const REGISTRY_ABI = [
  "function register(string name, string hcsTopicId, string[] capabilities, uint256 ratePerJob, string metadataUri) external payable",
  "function updateProfile(string hcsTopicId, string[] capabilities, uint256 ratePerJob, string metadataUri) external",
  "function deregister() external",
  "function getAgent(address wallet) external view returns (tuple(address wallet, string name, string hcsTopicId, string[] capabilities, uint256 ratePerJob, uint256 stakedAmount, uint256 completedJobs, uint256 totalRating, uint256 registeredAt, uint8 status, string metadataUri))",
  "function isRegistered(address wallet) external view returns (bool)",
  "function isActive(address wallet) external view returns (bool)",
  "function avgRating(address wallet) external view returns (uint256)",
  "function totalAgents() external view returns (uint256)",
  "function minStake() external view returns (uint256)",
  "function findByCapability(string capability, uint256 offset, uint256 limit) external view returns (address[], uint256)",
  "function getTopAgents(uint256 offset, uint256 limit) external view returns (address[], uint256)",
  "function authorizeEscrow(address escrow) external",
  "event AgentRegistered(address indexed agent, string name, string[] capabilities, uint256 stake)",
  "event AgentUpdated(address indexed agent, string[] capabilities, uint256 ratePerJob)",
  "event AgentDeregistered(address indexed agent, uint256 stakeReturned)",
];

export class AgentRegistryClient {
  public readonly contract: ethers.Contract;
  private readonly signer: ethers.Signer;

  constructor(address: string, signer: ethers.Signer) {
    this.signer = signer;
    this.contract = new ethers.Contract(address, REGISTRY_ABI, signer);
  }

  /**
   * Register as an AI agent. Requires staking HBAR >= minStake.
   */
  async register(params: RegisterAgentParams): Promise<TransactionResult> {
    if (!params.name || params.name.length === 0) {
      throw new Error("Agent name is required");
    }
    if (!params.capabilities || params.capabilities.length === 0) {
      throw new Error("At least one capability is required");
    }

    const stakeValue =
      typeof params.stakeAmount === "bigint"
        ? params.stakeAmount
        : BigInt(params.stakeAmount.toString());

    const tx: ContractTransactionResponse = await this.contract.register(
      params.name,
      params.hcsTopicId,
      params.capabilities,
      params.ratePerJob,
      params.metadataUri,
      { value: stakeValue }
    );
    const receipt = await tx.wait();
    return { hash: tx.hash, blockNumber: receipt?.blockNumber };
  }

  /**
   * Update agent profile. Only registered agents can call this.
   */
  async updateProfile(params: UpdateAgentParams): Promise<TransactionResult> {
    const current = await this.getAgent(await this.signer.getAddress());
    const tx: ContractTransactionResponse = await this.contract.updateProfile(
      params.hcsTopicId ?? current.hcsTopicId,
      params.capabilities ?? current.capabilities,
      params.ratePerJob ?? current.ratePerJob,
      params.metadataUri ?? current.metadataUri
    );
    const receipt = await tx.wait();
    return { hash: tx.hash, blockNumber: receipt?.blockNumber };
  }

  /**
   * Deregister and reclaim staked HBAR (minus protocol fee).
   */
  async deregister(): Promise<TransactionResult> {
    const tx: ContractTransactionResponse = await this.contract.deregister();
    const receipt = await tx.wait();
    return { hash: tx.hash, blockNumber: receipt?.blockNumber };
  }

  /**
   * Authorize an escrow contract to call recordJobCompletion.
   * Only callable by registry owner.
   */
  async authorizeEscrow(escrowAddress: string): Promise<TransactionResult> {
    const tx: ContractTransactionResponse =
      await this.contract.authorizeEscrow(escrowAddress);
    const receipt = await tx.wait();
    return { hash: tx.hash, blockNumber: receipt?.blockNumber };
  }

  // ============ Read methods ============

  async getAgent(address: string): Promise<Agent> {
    const raw = await this.contract.getAgent(address);
    return this._parseAgent(raw);
  }

  async isRegistered(address: string): Promise<boolean> {
    return this.contract.isRegistered(address);
  }

  async isActive(address: string): Promise<boolean> {
    return this.contract.isActive(address);
  }

  async avgRating(address: string): Promise<number> {
    const raw: bigint = await this.contract.avgRating(address);
    return Number(raw) / 100; // contract returns rating * 100
  }

  async totalAgents(): Promise<number> {
    const n: bigint = await this.contract.totalAgents();
    return Number(n);
  }

  async minStake(): Promise<bigint> {
    return this.contract.minStake();
  }

  /**
   * Find agents by capability. Returns paginated results.
   */
  async findByCapability(
    capability: string,
    offset = 0,
    limit = 20
  ): Promise<FindAgentsResult> {
    const [addresses, total]: [string[], bigint] =
      await this.contract.findByCapability(capability, offset, limit);
    const agents = await Promise.all(addresses.map((a) => this.getAgent(a)));
    return { agents, total: Number(total) };
  }

  /**
   * Get top agents sorted by reputation score.
   */
  async getTopAgents(offset = 0, limit = 20): Promise<FindAgentsResult> {
    const [addresses, total]: [string[], bigint] =
      await this.contract.getTopAgents(offset, limit);
    const agents = await Promise.all(addresses.map((a) => this.getAgent(a)));
    return { agents, total: Number(total) };
  }

  // ============ Private ============

  private _parseAgent(raw: Record<string, unknown>): Agent {
    return {
      wallet: raw.wallet,
      name: raw.name,
      hcsTopicId: raw.hcsTopicId,
      capabilities: [...raw.capabilities],
      ratePerJob: BigInt(raw.ratePerJob.toString()),
      stakedAmount: BigInt(raw.stakedAmount.toString()),
      completedJobs: BigInt(raw.completedJobs.toString()),
      totalRating: BigInt(raw.totalRating.toString()),
      registeredAt: BigInt(raw.registeredAt.toString()),
      status: Number(raw.status),
      metadataUri: raw.metadataUri,
    };
  }
}
