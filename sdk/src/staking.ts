/**
 * HACP SDK — ReputationStaking Client
 */

import { ethers, ContractTransactionResponse } from "ethers";
import type { StakeRecord, TransactionResult } from "./types.js";

const STAKING_ABI = [
  "function stake(uint256 amount) external",
  "function unstake(uint256 amount) external",
  "function getStake(address agent) external view returns (tuple(uint256 amount, uint256 lockedUntil, uint256 lockedForJob, uint256 slashCount))",
  "function stakedAmount(address agent) external view returns (uint256)",
  "function isBoosted(address agent) external view returns (bool)",
  "function reputationMultiplier(address agent) external view returns (uint256)",
  "function boostThreshold() external view returns (uint256)",
  "function slashRateBps() external view returns (uint256)",
  "function token() external view returns (address)",
  "event Staked(address indexed agent, uint256 amount, uint256 totalStake)",
  "event Unstaked(address indexed agent, uint256 amount, uint256 remainingStake)",
  "event Slashed(address indexed agent, uint256 amount, string reason)",
  "event StakeLocked(address indexed agent, uint256 jobId)",
  "event StakeUnlocked(address indexed agent, uint256 jobId)",
];

export class ReputationStakingClient {
  public readonly contract: ethers.Contract;

  constructor(address: string, signer: ethers.Signer) {
    this.contract = new ethers.Contract(address, STAKING_ABI, signer);
  }

  /**
   * Stake HACP tokens for reputation boost.
   * Requires prior ERC20 approval of the staking contract.
   * @param amount Token amount (in base units / wei)
   */
  async stake(amount: bigint): Promise<TransactionResult> {
    if (amount <= 0n) throw new Error("Stake amount must be positive");
    const tx: ContractTransactionResponse = await this.contract.stake(amount);
    const receipt = await tx.wait();
    return { hash: tx.hash, blockNumber: receipt?.blockNumber };
  }

  /**
   * Unstake HACP tokens. Stake must not be locked by an active job.
   */
  async unstake(amount: bigint): Promise<TransactionResult> {
    if (amount <= 0n) throw new Error("Unstake amount must be positive");
    const tx: ContractTransactionResponse = await this.contract.unstake(amount);
    const receipt = await tx.wait();
    return { hash: tx.hash, blockNumber: receipt?.blockNumber };
  }

  // ============ Read methods ============

  async getStake(agentAddress: string): Promise<StakeRecord> {
    const raw = await this.contract.getStake(agentAddress);
    return {
      amount: BigInt(raw.amount.toString()),
      lockedUntil: BigInt(raw.lockedUntil.toString()),
      lockedForJob: BigInt(raw.lockedForJob.toString()),
      slashCount: BigInt(raw.slashCount.toString()),
    };
  }

  async stakedAmount(agentAddress: string): Promise<bigint> {
    const n: bigint = await this.contract.stakedAmount(agentAddress);
    return BigInt(n.toString());
  }

  async isBoosted(agentAddress: string): Promise<boolean> {
    return this.contract.isBoosted(agentAddress);
  }

  /**
   * Reputation multiplier in basis points (e.g. 12000 = 1.2x).
   */
  async reputationMultiplier(agentAddress: string): Promise<number> {
    const bps: bigint = await this.contract.reputationMultiplier(agentAddress);
    return Number(bps);
  }

  async boostThreshold(): Promise<bigint> {
    return this.contract.boostThreshold();
  }

  async slashRateBps(): Promise<number> {
    const bps: bigint = await this.contract.slashRateBps();
    return Number(bps);
  }

  async tokenAddress(): Promise<string> {
    return this.contract.token();
  }
}
