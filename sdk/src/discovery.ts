/**
 * HACP SDK — HCS Discovery Client
 * Implements OpenConvAI agent discovery via Hedera Consensus Service
 */

import {
  Client,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  TopicMessageQuery,
  TopicId,
  PrivateKey,
  AccountId,
  TransactionReceiptQuery,
  TransactionId,
} from "@hashgraph/sdk";
import type { HCSAgentMessage, HCSMessageType } from "./types.js";

export interface HCSDiscoveryConfig {
  /** Hedera account ID (e.g. "0.0.12345") */
  accountId: string;
  /** Hedera private key (hex or DER) */
  privateKey: string;
  /** Network: 'testnet' | 'mainnet' | 'previewnet' */
  network: "testnet" | "mainnet" | "previewnet";
  /** Existing topic ID — if not provided, call createTopic() first */
  discoveryTopicId?: string;
}

export class HCSDiscoveryClient {
  private readonly client: Client;
  private readonly privateKey: PrivateKey;
  private topicId: string | null;

  constructor(config: HCSDiscoveryConfig) {
    this.privateKey = PrivateKey.fromStringECDSA(
      config.privateKey.replace(/^0x/, "")
    );
    const accountId = AccountId.fromString(config.accountId);

    if (config.network === "mainnet") {
      this.client = Client.forMainnet();
    } else if (config.network === "previewnet") {
      this.client = Client.forPreviewnet();
    } else {
      this.client = Client.forTestnet();
    }

    this.client.setOperator(accountId, this.privateKey);
    this.topicId = config.discoveryTopicId ?? null;
  }

  /**
   * Create a new HCS topic for agent discovery.
   * @returns Topic ID string (e.g. "0.0.12345")
   */
  async createTopic(memo = "HACP Agent Discovery"): Promise<string> {
    const tx = await new TopicCreateTransaction()
      .setTopicMemo(memo)
      .execute(this.client);

    const receipt = await tx.getReceipt(this.client);
    if (!receipt.topicId) {
      throw new Error("Failed to create HCS topic");
    }
    this.topicId = receipt.topicId.toString();
    return this.topicId;
  }

  /**
   * Publish an agent message to the discovery topic.
   * Follows OpenConvAI agent discovery message format.
   */
  async publishMessage(message: HCSAgentMessage): Promise<string> {
    if (!this.topicId) {
      throw new Error("No topic ID set. Call createTopic() or set discoveryTopicId in config.");
    }

    const payload = JSON.stringify(message);
    if (payload.length > 4096) {
      throw new Error("Message exceeds HCS 4KB limit");
    }

    const tx = await new TopicMessageSubmitTransaction()
      .setTopicId(TopicId.fromString(this.topicId))
      .setMessage(payload)
      .execute(this.client);

    await tx.getReceipt(this.client);
    return tx.transactionId?.toString() ?? "unknown";
  }

  /**
   * Announce agent registration to the discovery topic.
   */
  async announceAgent(params: {
    agentAddress: string;
    name: string;
    capabilities: string[];
    ratePerJob: string;
    hcsTopicId: string;
  }): Promise<string> {
    const message: HCSAgentMessage = {
      type: "REGISTER" as HCSMessageType,
      agentAddress: params.agentAddress,
      name: params.name,
      capabilities: params.capabilities,
      ratePerJob: params.ratePerJob,
      hcsTopicId: params.hcsTopicId,
      timestamp: Math.floor(Date.now() / 1000),
    };
    return this.publishMessage(message);
  }

  /**
   * Announce job offer to the discovery topic.
   */
  async announceOffer(params: {
    agentAddress: string;
    jobId: string;
    capability: string;
    payload?: Record<string, unknown>;
  }): Promise<string> {
    const message: HCSAgentMessage = {
      type: "OFFER" as HCSMessageType,
      agentAddress: params.agentAddress,
      capabilities: [params.capability],
      timestamp: Math.floor(Date.now() / 1000),
      jobId: params.jobId,
      payload: params.payload,
    };
    return this.publishMessage(message);
  }

  /**
   * Subscribe to discovery messages and call handler for each.
   * Non-blocking — returns a function to stop the subscription.
   */
  subscribe(
    handler: (message: HCSAgentMessage) => void,
    onError?: (err: Error) => void
  ): () => void {
    if (!this.topicId) {
      throw new Error("No topic ID set.");
    }

    const query = new TopicMessageQuery()
      .setTopicId(TopicId.fromString(this.topicId))
      .setStartTime(0);

    const handle = query.subscribe(
      this.client,
      (msg) => {
        if (!msg) return;
        try {
          const parsed = JSON.parse(
            Buffer.from(msg.contents).toString("utf-8")
          ) as HCSAgentMessage;
          handler(parsed);
        } catch {
          // Skip non-JSON messages
        }
      },
      (err) => {
        onError?.(err as unknown as Error);
      }
    );

    return () => handle.unsubscribe();
  }

  /**
   * Get the current topic ID.
   */
  getTopicId(): string | null {
    return this.topicId;
  }

  /**
   * Set the topic ID manually.
   */
  setTopicId(topicId: string): void {
    this.topicId = topicId;
  }

  /**
   * Close the Hedera client connection.
   */
  async close(): Promise<void> {
    await this.client.close();
  }
}
