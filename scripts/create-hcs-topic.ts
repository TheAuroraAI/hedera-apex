/**
 * Create HCS Topic for HACP Agent Discovery
 *
 * Uses the Hedera JavaScript SDK to create a topic on testnet.
 * The topic ID is used by agents to publish availability (OpenConvAI standard).
 *
 * Usage:
 *   HEDERA_ACCOUNT_ID=0.0.xxx HEDERA_PRIVATE_KEY=... npx ts-node scripts/create-hcs-topic.ts
 */

import {
  Client,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  PrivateKey,
  AccountId,
} from "@hashgraph/sdk";

async function main() {
  const accountId = process.env.HEDERA_ACCOUNT_ID;
  const privateKeyStr = process.env.HEDERA_PRIVATE_KEY;

  if (!accountId || !privateKeyStr) {
    console.error("Set HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY env vars");
    process.exit(1);
  }

  const client = Client.forTestnet();
  const privateKey = PrivateKey.fromStringDer(privateKeyStr);
  client.setOperator(AccountId.fromString(accountId), privateKey);

  console.log("Creating HACP Agent Discovery topic on Hedera testnet...");

  // Create topic with a memo describing its purpose
  const topicTx = new TopicCreateTransaction()
    .setTopicMemo("HACP-v1: Agent Discovery & OpenConvAI Messaging")
    .setAdminKey(privateKey.publicKey)
    .setSubmitKey(privateKey.publicKey) // open submissions in demo
    .setMaxTransactionFee(2_00_000_000); // 2 HBAR max fee

  const response = await topicTx.execute(client);
  const receipt = await response.getReceipt(client);
  const topicId = receipt.topicId!.toString();

  console.log(`✅ Topic created: ${topicId}`);
  console.log(`   Explorer: https://hashscan.io/testnet/topic/${topicId}`);

  // Publish genesis message
  const genesisTx = new TopicMessageSubmitTransaction()
    .setTopicId(receipt.topicId!)
    .setMessage(
      JSON.stringify({
        type: "GENESIS",
        protocol: "HACP-v1",
        standard: "OpenConvAI-0.0.1",
        timestamp: new Date().toISOString(),
        description:
          "Hedera Agent Commerce Protocol — Decentralized AI agent marketplace",
      })
    );

  const msgResponse = await genesisTx.execute(client);
  const msgReceipt = await msgResponse.getReceipt(client);
  console.log(`✅ Genesis message submitted (seq: ${msgReceipt.topicSequenceNumber})`);

  console.log(`\nAdd to .env:`);
  console.log(`HCS_TOPIC_ID=${topicId}`);

  client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
