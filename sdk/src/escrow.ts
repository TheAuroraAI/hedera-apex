/**
 * HACP SDK — JobEscrow Client
 */

import { ethers, ContractTransactionResponse } from "ethers";
import type {
  Job,
  Bid,
  PostJobParams,
  PlaceBidParams,
  TransactionResult,
} from "./types.js";
import { hbarToTinybars } from "./utils.js";

const ESCROW_ABI = [
  "function postJob(string title, string description, string requiredCapability, uint256 deadline, uint256 autoReleaseDelay) external payable returns (uint256)",
  "function placeBid(uint256 jobId, uint256 proposedRate, string proposal) external",
  "function acceptBid(uint256 jobId, address agent) external",
  "function submitDeliverable(uint256 jobId, string deliverableUri) external",
  "function releasePayment(uint256 jobId, uint8 rating) external",
  "function raiseDispute(uint256 jobId, string reason) external",
  "function cancelJob(uint256 jobId) external",
  "function autoRelease(uint256 jobId) external",
  "function getJob(uint256 jobId) external view returns (tuple(uint256 id, address client, address agent, string title, string description, string requiredCapability, uint256 payment, uint256 postedAt, uint256 deadline, uint256 autoReleaseAt, string deliverableUri, uint8 status))",
  "function getBids(uint256 jobId) external view returns (tuple(address agent, uint256 proposedRate, string proposal, uint256 placedAt, bool accepted)[])",
  "function getClientJobs(address client) external view returns (uint256[])",
  "function getAgentJobs(address agent) external view returns (uint256[])",
  "function totalJobs() external view returns (uint256)",
  "function protocolFeeBps() external view returns (uint256)",
  "event JobPosted(uint256 indexed jobId, address indexed client, uint256 payment, string title)",
  "event BidPlaced(uint256 indexed jobId, address indexed agent, uint256 proposedRate)",
  "event BidAccepted(uint256 indexed jobId, address indexed agent)",
  "event JobSubmitted(uint256 indexed jobId, address indexed agent, string deliverableUri)",
  "event JobCompleted(uint256 indexed jobId, address indexed agent, uint256 payment, uint8 rating)",
  "event JobDisputed(uint256 indexed jobId, address indexed client, string reason)",
  "event JobCancelled(uint256 indexed jobId, address indexed by, uint256 refundAmount)",
];

const DEFAULT_AUTO_RELEASE_DELAY = 7 * 24 * 3600; // 7 days in seconds

export class JobEscrowClient {
  public readonly contract: ethers.Contract;

  constructor(address: string, signer: ethers.Signer) {
    this.contract = new ethers.Contract(address, ESCROW_ABI, signer);
  }

  /**
   * Post a new job. Payment is locked in escrow.
   * @returns Job ID
   */
  async postJob(params: PostJobParams): Promise<{ jobId: bigint; tx: TransactionResult }> {
    if (!params.title || params.title.length === 0) {
      throw new Error("Job title is required");
    }
    if (!params.requiredCapability) {
      throw new Error("Required capability is required");
    }
    const deadline =
      typeof params.deadline === "number"
        ? params.deadline
        : Number(params.deadline);
    if (deadline <= Math.floor(Date.now() / 1000)) {
      throw new Error("Deadline must be in the future");
    }

    const autoReleaseDelay = params.autoReleaseDelay
      ? Number(params.autoReleaseDelay)
      : DEFAULT_AUTO_RELEASE_DELAY;

    const paymentTinybars =
      typeof params.paymentHbar === "bigint"
        ? params.paymentHbar
        : hbarToTinybars(params.paymentHbar.toString());

    const tx: ContractTransactionResponse = await this.contract.postJob(
      params.title,
      params.description ?? "",
      params.requiredCapability,
      deadline,
      autoReleaseDelay,
      { value: paymentTinybars }
    );
    const receipt = await tx.wait();

    // Extract jobId from JobPosted event
    let jobId = 0n;
    if (receipt) {
      const iface = this.contract.interface;
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog(log);
          if (parsed?.name === "JobPosted") {
            jobId = BigInt(parsed.args[0].toString());
            break;
          }
        } catch {
          // skip non-matching logs
        }
      }
    }

    return {
      jobId,
      tx: { hash: tx.hash, blockNumber: receipt?.blockNumber },
    };
  }

  /**
   * Place a bid on an open job.
   */
  async placeBid(params: PlaceBidParams): Promise<TransactionResult> {
    if (!params.proposal || params.proposal.length === 0) {
      throw new Error("Proposal text is required");
    }
    const tx: ContractTransactionResponse = await this.contract.placeBid(
      params.jobId,
      params.proposedRate,
      params.proposal
    );
    const receipt = await tx.wait();
    return { hash: tx.hash, blockNumber: receipt?.blockNumber };
  }

  /**
   * Accept a bid. Only the job client can call this.
   */
  async acceptBid(
    jobId: bigint | number,
    agentAddress: string
  ): Promise<TransactionResult> {
    const tx: ContractTransactionResponse = await this.contract.acceptBid(
      jobId,
      agentAddress
    );
    const receipt = await tx.wait();
    return { hash: tx.hash, blockNumber: receipt?.blockNumber };
  }

  /**
   * Submit a deliverable URI. Only the assigned agent can call this.
   */
  async submitDeliverable(
    jobId: bigint | number,
    deliverableUri: string
  ): Promise<TransactionResult> {
    if (!deliverableUri || deliverableUri.length === 0) {
      throw new Error("Deliverable URI is required");
    }
    const tx: ContractTransactionResponse =
      await this.contract.submitDeliverable(jobId, deliverableUri);
    const receipt = await tx.wait();
    return { hash: tx.hash, blockNumber: receipt?.blockNumber };
  }

  /**
   * Release payment to agent and rate the job. Only the client can call this.
   * @param rating 1-100
   */
  async releasePayment(
    jobId: bigint | number,
    rating: number
  ): Promise<TransactionResult> {
    if (rating < 1 || rating > 100) {
      throw new Error("Rating must be between 1 and 100");
    }
    const tx: ContractTransactionResponse = await this.contract.releasePayment(
      jobId,
      rating
    );
    const receipt = await tx.wait();
    return { hash: tx.hash, blockNumber: receipt?.blockNumber };
  }

  /**
   * Raise a dispute on a submitted job.
   */
  async raiseDispute(
    jobId: bigint | number,
    reason: string
  ): Promise<TransactionResult> {
    if (!reason || reason.length === 0) {
      throw new Error("Dispute reason is required");
    }
    const tx: ContractTransactionResponse = await this.contract.raiseDispute(
      jobId,
      reason
    );
    const receipt = await tx.wait();
    return { hash: tx.hash, blockNumber: receipt?.blockNumber };
  }

  /**
   * Cancel an open job (before bid accepted). Returns payment to client.
   */
  async cancelJob(jobId: bigint | number): Promise<TransactionResult> {
    const tx: ContractTransactionResponse =
      await this.contract.cancelJob(jobId);
    const receipt = await tx.wait();
    return { hash: tx.hash, blockNumber: receipt?.blockNumber };
  }

  /**
   * Trigger auto-release after dispute window expires.
   */
  async autoRelease(jobId: bigint | number): Promise<TransactionResult> {
    const tx: ContractTransactionResponse =
      await this.contract.autoRelease(jobId);
    const receipt = await tx.wait();
    return { hash: tx.hash, blockNumber: receipt?.blockNumber };
  }

  // ============ Read methods ============

  async getJob(jobId: bigint | number): Promise<Job> {
    const raw = await this.contract.getJob(jobId);
    return this._parseJob(raw);
  }

  async getBids(jobId: bigint | number): Promise<Bid[]> {
    const raws = await this.contract.getBids(jobId);
    return raws.map(this._parseBid);
  }

  async getClientJobs(clientAddress: string): Promise<bigint[]> {
    const ids: bigint[] = await this.contract.getClientJobs(clientAddress);
    return ids.map((id) => BigInt(id.toString()));
  }

  async getAgentJobs(agentAddress: string): Promise<bigint[]> {
    const ids: bigint[] = await this.contract.getAgentJobs(agentAddress);
    return ids.map((id) => BigInt(id.toString()));
  }

  async totalJobs(): Promise<number> {
    const n: bigint = await this.contract.totalJobs();
    return Number(n);
  }

  async protocolFeeBps(): Promise<number> {
    const bps: bigint = await this.contract.protocolFeeBps();
    return Number(bps);
  }

  // ============ Private ============

  private _parseJob(raw: Record<string, unknown>): Job {
    return {
      id: BigInt(raw.id.toString()),
      client: raw.client,
      agent: raw.agent,
      title: raw.title,
      description: raw.description,
      requiredCapability: raw.requiredCapability,
      payment: BigInt(raw.payment.toString()),
      postedAt: BigInt(raw.postedAt.toString()),
      deadline: BigInt(raw.deadline.toString()),
      autoReleaseAt: BigInt(raw.autoReleaseAt.toString()),
      deliverableUri: raw.deliverableUri,
      status: Number(raw.status),
    };
  }

  private _parseBid(raw: Record<string, unknown>): Bid {
    return {
      agent: raw.agent,
      proposedRate: BigInt(raw.proposedRate.toString()),
      proposal: raw.proposal,
      placedAt: BigInt(raw.placedAt.toString()),
      accepted: raw.accepted,
    };
  }
}
