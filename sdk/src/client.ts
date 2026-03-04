/**
 * HACP SDK — Main Client
 * Entry point for all HACP protocol interactions.
 */

import { ethers } from "ethers";
import { AgentRegistryClient } from "./registry.js";
import { JobEscrowClient } from "./escrow.js";
import { ReputationStakingClient } from "./staking.js";
import { HCSDiscoveryClient } from "./discovery.js";
import type { HACPConfig } from "./types.js";
import { parsePrivateKey } from "./utils.js";

export class HACPClient {
  public readonly registry: AgentRegistryClient;
  public readonly escrow: JobEscrowClient;
  public readonly staking: ReputationStakingClient | null;
  public readonly discovery: HCSDiscoveryClient | null;
  public readonly provider: ethers.JsonRpcProvider;
  public readonly signer: ethers.Wallet;

  private constructor(
    registry: AgentRegistryClient,
    escrow: JobEscrowClient,
    staking: ReputationStakingClient | null,
    discovery: HCSDiscoveryClient | null,
    provider: ethers.JsonRpcProvider,
    signer: ethers.Wallet
  ) {
    this.registry = registry;
    this.escrow = escrow;
    this.staking = staking;
    this.discovery = discovery;
    this.provider = provider;
    this.signer = signer;
  }

  /**
   * Create an HACP client from configuration.
   *
   * @example
   * ```ts
   * const client = await HACPClient.create({
   *   rpcUrl: "https://testnet.hashio.io/api",
   *   privateKey: process.env.PRIVATE_KEY!,
   *   registryAddress: "0x...",
   *   escrowAddress: "0x...",
   *   network: "testnet",
   *   operatorAccountId: "0.0.12345",
   *   discoveryTopicId: "0.0.67890",
   * });
   * ```
   */
  static async create(config: HACPConfig): Promise<HACPClient> {
    // Validate required config
    if (!config.rpcUrl) throw new Error("rpcUrl is required");
    if (!config.privateKey) throw new Error("privateKey is required");
    if (!config.registryAddress) throw new Error("registryAddress is required");
    if (!config.escrowAddress) throw new Error("escrowAddress is required");

    const provider = new ethers.JsonRpcProvider(config.rpcUrl);
    const signer = new ethers.Wallet(parsePrivateKey(config.privateKey), provider);

    const registry = new AgentRegistryClient(config.registryAddress, signer);
    const escrow = new JobEscrowClient(config.escrowAddress, signer);

    let staking: ReputationStakingClient | null = null;
    if (config.stakingAddress) {
      staking = new ReputationStakingClient(config.stakingAddress, signer);
    }

    let discovery: HCSDiscoveryClient | null = null;
    if (config.operatorAccountId && config.network) {
      discovery = new HCSDiscoveryClient({
        accountId: config.operatorAccountId,
        privateKey: config.privateKey,
        network: config.network,
        discoveryTopicId: config.discoveryTopicId,
      });
    }

    return new HACPClient(registry, escrow, staking, discovery, provider, signer);
  }

  /**
   * Get the signer's address.
   */
  async getAddress(): Promise<string> {
    return this.signer.getAddress();
  }

  /**
   * Get the HBAR balance of the signer in tinybars.
   */
  async getBalance(): Promise<bigint> {
    const balance = await this.provider.getBalance(await this.getAddress());
    return balance;
  }

  /**
   * Close all connections.
   */
  async close(): Promise<void> {
    await this.discovery?.close();
  }
}
