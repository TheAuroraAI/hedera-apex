#!/usr/bin/env node
/**
 * HACP CLI — Hedera Agent Commerce Protocol
 * 12 commands for managing agents, jobs, and staking.
 */

import { Command } from "commander";
import { config as dotenvConfig } from "dotenv";
import { resolve, join } from "path";
import { existsSync, readFileSync } from "fs";
import {
  HACPClient,
  hbarToTinybars,
  tinybarsTohbar,
  formatJobStatus,
  formatAgentStatus,
  formatTimestamp,
  computeAvgRating,
  truncateAddress,
  deadlineFromDays,
  parseIntSafe,
} from "../sdk/src/index.js";
import type { HACPConfig } from "../sdk/src/index.js";

// Load .env from cwd or project root
dotenvConfig({ path: resolve(process.cwd(), ".env") });

const program = new Command();

program
  .name("hacp")
  .description("Hedera Agent Commerce Protocol CLI")
  .version("1.0.0")
  .option("--rpc <url>", "Hedera JSON-RPC relay URL", process.env.HEDERA_RPC_URL)
  .option("--key <key>", "Private key (hex)", process.env.PRIVATE_KEY)
  .option("--registry <addr>", "AgentRegistry contract address", process.env.REGISTRY_ADDRESS)
  .option("--escrow <addr>", "JobEscrow contract address", process.env.ESCROW_ADDRESS)
  .option("--staking <addr>", "ReputationStaking contract address", process.env.STAKING_ADDRESS)
  .option("--account <id>", "Hedera account ID (for HCS)", process.env.HEDERA_ACCOUNT_ID)
  .option("--topic <id>", "HCS discovery topic ID", process.env.HCS_DISCOVERY_TOPIC)
  .option("--network <net>", "Hedera network (testnet|mainnet|previewnet)", process.env.HEDERA_NETWORK ?? "testnet");

// ============ Helpers ============

function getConfig(opts: any): HACPConfig {
  const rpcUrl = opts.rpc ?? process.env.HEDERA_RPC_URL;
  const privateKey = opts.key ?? process.env.PRIVATE_KEY;
  const registryAddress = opts.registry ?? process.env.REGISTRY_ADDRESS;
  const escrowAddress = opts.escrow ?? process.env.ESCROW_ADDRESS;

  if (!rpcUrl) fatal("Missing --rpc or HEDERA_RPC_URL");
  if (!privateKey) fatal("Missing --key or PRIVATE_KEY");
  if (!registryAddress) fatal("Missing --registry or REGISTRY_ADDRESS");
  if (!escrowAddress) fatal("Missing --escrow or ESCROW_ADDRESS");

  return {
    rpcUrl,
    privateKey,
    registryAddress,
    escrowAddress,
    stakingAddress: opts.staking ?? process.env.STAKING_ADDRESS,
    operatorAccountId: opts.account ?? process.env.HEDERA_ACCOUNT_ID,
    discoveryTopicId: opts.topic ?? process.env.HCS_DISCOVERY_TOPIC,
    network: (opts.network ?? process.env.HEDERA_NETWORK ?? "testnet") as
      | "testnet"
      | "mainnet"
      | "previewnet",
  };
}

async function withClient<T>(
  opts: any,
  fn: (client: HACPClient) => Promise<T>
): Promise<T> {
  const cfg = getConfig(opts);
  const client = await HACPClient.create(cfg);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

function fatal(msg: string): never {
  console.error(`\nError: ${msg}\n`);
  process.exit(1);
}

function ok(label: string, value?: string | number | bigint) {
  if (value !== undefined) {
    console.log(`  ${label}: ${value}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

function printTx(result: { hash: string; blockNumber?: number }) {
  console.log(`\n  Transaction hash: ${result.hash}`);
  if (result.blockNumber) console.log(`  Block:            ${result.blockNumber}`);
}

// ============ agent subcommand ============

const agent = program
  .command("agent")
  .description("Manage AI agents in the registry");

// 1. agent register
agent
  .command("register")
  .description("Register as an AI agent (stakes HBAR)")
  .requiredOption("-n, --name <name>", "Agent name")
  .requiredOption("-c, --capabilities <caps>", "Comma-separated capabilities (e.g. code-review,writing)")
  .requiredOption("-r, --rate <hbar>", "Minimum rate per job in HBAR")
  .option("-t, --topic <topicId>", "HCS topic ID for direct messaging", "")
  .option("-m, --metadata <uri>", "Metadata URI (IPFS/HCS)", "")
  .option("-s, --stake <hbar>", "HBAR to stake (default: 1.0)", "1.0")
  .action(async (opts) => {
    const globalOpts = program.opts();
    const caps = opts.capabilities.split(",").map((c: string) => c.trim()).filter(Boolean);
    if (caps.length === 0) fatal("At least one capability required");

    const rate = parseFloat(opts.rate);
    if (isNaN(rate) || rate <= 0) fatal("Rate must be a positive number");

    const stake = parseFloat(opts.stake);
    if (isNaN(stake) || stake <= 0) fatal("Stake must be a positive number");

    console.log(`\nRegistering agent "${opts.name}"...`);
    await withClient(globalOpts, async (client) => {
      const result = await client.registry.register({
        name: opts.name,
        hcsTopicId: opts.topic,
        capabilities: caps,
        ratePerJob: hbarToTinybars(rate),
        metadataUri: opts.metadata,
        stakeAmount: hbarToTinybars(stake),
      });
      console.log("\n  ✓ Agent registered successfully");
      ok("Name", opts.name);
      ok("Capabilities", caps.join(", "));
      ok("Rate", `${rate} HBAR/job`);
      ok("Staked", `${stake} HBAR`);
      printTx(result);
    });
  });

// 2. agent info
agent
  .command("info [address]")
  .description("Get agent information (defaults to own wallet)")
  .action(async (address, _opts, cmd) => {
    const globalOpts = program.opts();
    await withClient(globalOpts, async (client) => {
      const addr = address ?? (await client.getAddress());
      const isReg = await client.registry.isRegistered(addr);
      if (!isReg) {
        console.log(`\n  Agent ${truncateAddress(addr)} is not registered.\n`);
        return;
      }
      const ag = await client.registry.getAgent(addr);
      console.log(`\n  Agent: ${ag.name}`);
      ok("Address", ag.wallet);
      ok("Status", formatAgentStatus(ag.status));
      ok("Capabilities", ag.capabilities.join(", "));
      ok("Rate", `${tinybarsTohbar(ag.ratePerJob)} HBAR/job`);
      ok("Staked", `${tinybarsTohbar(ag.stakedAmount)} HBAR`);
      ok("Jobs completed", String(ag.completedJobs));
      ok("Avg rating", String(computeAvgRating(ag.totalRating, ag.completedJobs)));
      ok("HCS topic", ag.hcsTopicId || "(none)");
      ok("Registered", formatTimestamp(ag.registeredAt));
      if (ag.metadataUri) ok("Metadata", ag.metadataUri);
      console.log();
    });
  });

// 3. agent list
agent
  .command("list")
  .description("List agents by capability or top agents")
  .option("-c, --capability <cap>", "Filter by capability")
  .option("--offset <n>", "Pagination offset", "0")
  .option("--limit <n>", "Max results", "20")
  .action(async (opts) => {
    const globalOpts = program.opts();
    const offset = parseIntSafe(opts.offset) ?? 0;
    const limit = parseIntSafe(opts.limit) ?? 20;

    await withClient(globalOpts, async (client) => {
      const result = opts.capability
        ? await client.registry.findByCapability(opts.capability, offset, limit)
        : await client.registry.getTopAgents(offset, limit);

      console.log(`\n  ${result.total} agent(s) found:\n`);
      for (const ag of result.agents) {
        console.log(`  ${ag.name} (${truncateAddress(ag.wallet)})`);
        ok("  Status", formatAgentStatus(ag.status));
        ok("  Capabilities", ag.capabilities.join(", "));
        ok("  Rate", `${tinybarsTohbar(ag.ratePerJob)} HBAR/job`);
        ok("  Rating", String(computeAvgRating(ag.totalRating, ag.completedJobs)));
        console.log();
      }
    });
  });

// 4. agent update
agent
  .command("update")
  .description("Update agent profile")
  .option("-c, --capabilities <caps>", "New comma-separated capabilities")
  .option("-r, --rate <hbar>", "New rate in HBAR")
  .option("-t, --topic <topicId>", "New HCS topic ID")
  .option("-m, --metadata <uri>", "New metadata URI")
  .action(async (opts) => {
    const globalOpts = program.opts();
    const update: Record<string, any> = {};
    if (opts.capabilities) {
      update.capabilities = opts.capabilities.split(",").map((c: string) => c.trim());
    }
    if (opts.rate) {
      const r = parseFloat(opts.rate);
      if (isNaN(r) || r <= 0) fatal("Rate must be a positive number");
      update.ratePerJob = hbarToTinybars(r);
    }
    if (opts.topic) update.hcsTopicId = opts.topic;
    if (opts.metadata) update.metadataUri = opts.metadata;

    if (Object.keys(update).length === 0) {
      fatal("Provide at least one field to update (--capabilities, --rate, --topic, --metadata)");
    }

    console.log("\nUpdating agent profile...");
    await withClient(globalOpts, async (client) => {
      const result = await client.registry.updateProfile(update);
      console.log("\n  ✓ Profile updated");
      printTx(result);
    });
  });

// 5. agent deregister
agent
  .command("deregister")
  .description("Deregister agent and reclaim staked HBAR")
  .option("--confirm", "Confirm deregistration (required)")
  .action(async (opts) => {
    const globalOpts = program.opts();
    if (!opts.confirm) {
      fatal("Pass --confirm to confirm deregistration and stake withdrawal");
    }
    console.log("\nDeregistering agent...");
    await withClient(globalOpts, async (client) => {
      const result = await client.registry.deregister();
      console.log("\n  ✓ Agent deregistered. Staked HBAR returned (minus protocol fee).");
      printTx(result);
    });
  });

// ============ job subcommand ============

const job = program
  .command("job")
  .description("Manage jobs in the escrow marketplace");

// 6. job post
job
  .command("post")
  .description("Post a new job (locks HBAR in escrow)")
  .requiredOption("-t, --title <title>", "Job title")
  .requiredOption("-d, --description <desc>", "Job description")
  .requiredOption("-c, --capability <cap>", "Required agent capability")
  .requiredOption("-p, --payment <hbar>", "Payment in HBAR (locked in escrow)")
  .option("--deadline-days <n>", "Deadline in days from now (default: 7)", "7")
  .option("--auto-release-days <n>", "Auto-release delay in days (default: 7)", "7")
  .action(async (opts) => {
    const globalOpts = program.opts();
    const payment = parseFloat(opts.payment);
    if (isNaN(payment) || payment <= 0) fatal("Payment must be a positive number");

    const deadlineDays = parseIntSafe(opts.deadlineDays) ?? 7;
    const autoReleaseDays = parseIntSafe(opts.autoReleaseDays) ?? 7;

    console.log(`\nPosting job "${opts.title}"...`);
    await withClient(globalOpts, async (client) => {
      const { jobId, tx } = await client.escrow.postJob({
        title: opts.title,
        description: opts.description,
        requiredCapability: opts.capability,
        deadline: deadlineFromDays(deadlineDays),
        autoReleaseDelay: autoReleaseDays * 86400,
        paymentHbar: hbarToTinybars(payment),
      });
      console.log("\n  ✓ Job posted successfully");
      ok("Job ID", String(jobId));
      ok("Payment (escrowed)", `${payment} HBAR`);
      ok("Capability required", opts.capability);
      ok("Deadline", formatTimestamp(BigInt(deadlineFromDays(deadlineDays))));
      printTx(tx);
    });
  });

// 7. job bid
job
  .command("bid <jobId>")
  .description("Place a bid on an open job")
  .requiredOption("-r, --rate <hbar>", "Proposed rate in HBAR")
  .requiredOption("-p, --proposal <text>", "Bid proposal text")
  .action(async (jobId, opts) => {
    const globalOpts = program.opts();
    const id = parseIntSafe(jobId);
    if (id === undefined) fatal("Invalid job ID");

    const rate = parseFloat(opts.rate);
    if (isNaN(rate) || rate <= 0) fatal("Rate must be a positive number");

    console.log(`\nPlacing bid on job #${id}...`);
    await withClient(globalOpts, async (client) => {
      const result = await client.escrow.placeBid({
        jobId: BigInt(id),
        proposedRate: hbarToTinybars(rate),
        proposal: opts.proposal,
      });
      console.log("\n  ✓ Bid placed");
      ok("Job ID", id);
      ok("Proposed rate", `${rate} HBAR`);
      printTx(result);
    });
  });

// 8. job accept
job
  .command("accept <jobId> <agentAddress>")
  .description("Accept a bid — assigns agent and locks payment")
  .action(async (jobId, agentAddress, opts) => {
    const globalOpts = program.opts();
    const id = parseIntSafe(jobId);
    if (id === undefined) fatal("Invalid job ID");

    console.log(`\nAccepting bid from ${truncateAddress(agentAddress)} on job #${id}...`);
    await withClient(globalOpts, async (client) => {
      const result = await client.escrow.acceptBid(BigInt(id), agentAddress);
      console.log("\n  ✓ Bid accepted. Job assigned.");
      ok("Job ID", id);
      ok("Agent", agentAddress);
      printTx(result);
    });
  });

// 9. job submit
job
  .command("submit <jobId>")
  .description("Submit deliverable URI for a job")
  .requiredOption("-u, --uri <uri>", "Deliverable URI (IPFS/HTTPS/HCS)")
  .action(async (jobId, opts) => {
    const globalOpts = program.opts();
    const id = parseIntSafe(jobId);
    if (id === undefined) fatal("Invalid job ID");

    console.log(`\nSubmitting deliverable for job #${id}...`);
    await withClient(globalOpts, async (client) => {
      const result = await client.escrow.submitDeliverable(BigInt(id), opts.uri);
      console.log("\n  ✓ Deliverable submitted");
      ok("Job ID", id);
      ok("URI", opts.uri);
      printTx(result);
    });
  });

// 10. job release
job
  .command("release <jobId>")
  .description("Approve deliverable and release payment to agent")
  .requiredOption("-r, --rating <n>", "Rating 1-100")
  .action(async (jobId, opts) => {
    const globalOpts = program.opts();
    const id = parseIntSafe(jobId);
    if (id === undefined) fatal("Invalid job ID");

    const rating = parseIntSafe(opts.rating);
    if (rating === undefined || rating < 1 || rating > 100) fatal("Rating must be 1-100");

    console.log(`\nReleasing payment for job #${id} (rating: ${rating})...`);
    await withClient(globalOpts, async (client) => {
      const result = await client.escrow.releasePayment(BigInt(id), rating);
      console.log("\n  ✓ Payment released to agent");
      ok("Job ID", id);
      ok("Rating given", rating);
      printTx(result);
    });
  });

// 11. job get
job
  .command("get <jobId>")
  .description("Get job details and bids")
  .option("--bids", "Also show all bids")
  .action(async (jobId, opts) => {
    const globalOpts = program.opts();
    const id = parseIntSafe(jobId);
    if (id === undefined) fatal("Invalid job ID");

    await withClient(globalOpts, async (client) => {
      const j = await client.escrow.getJob(BigInt(id));
      console.log(`\n  Job #${j.id}: ${j.title}`);
      ok("Status", formatJobStatus(j.status));
      ok("Client", truncateAddress(j.client));
      ok("Agent", j.agent === ethers_ZERO_ADDR ? "(none)" : truncateAddress(j.agent));
      ok("Payment", `${tinybarsTohbar(j.payment)} HBAR`);
      ok("Capability", j.requiredCapability);
      ok("Posted", formatTimestamp(j.postedAt));
      ok("Deadline", formatTimestamp(j.deadline));
      if (j.deliverableUri) ok("Deliverable", j.deliverableUri);
      if (j.description) console.log(`\n  Description: ${j.description}`);

      if (opts.bids) {
        const bids = await client.escrow.getBids(BigInt(id));
        console.log(`\n  Bids (${bids.length}):`);
        for (const b of bids) {
          console.log(`    ${truncateAddress(b.agent)} — ${tinybarsTohbar(b.proposedRate)} HBAR${b.accepted ? " ✓ accepted" : ""}`);
          if (b.proposal) console.log(`      Proposal: ${b.proposal.slice(0, 80)}...`);
        }
      }
      console.log();
    });
  });

// 12. job cancel
job
  .command("cancel <jobId>")
  .description("Cancel an open job and refund payment")
  .option("--confirm", "Confirm cancellation (required)")
  .action(async (jobId, opts) => {
    const globalOpts = program.opts();
    const id = parseIntSafe(jobId);
    if (id === undefined) fatal("Invalid job ID");

    if (!opts.confirm) fatal("Pass --confirm to confirm job cancellation");

    console.log(`\nCancelling job #${id}...`);
    await withClient(globalOpts, async (client) => {
      const result = await client.escrow.cancelJob(BigInt(id));
      console.log("\n  ✓ Job cancelled. Payment refunded.");
      ok("Job ID", id);
      printTx(result);
    });
  });

// ============ Placeholder for zero address ============
const ethers_ZERO_ADDR = "0x0000000000000000000000000000000000000000";

// ============ staking subcommand ============

const staking = program
  .command("stake")
  .description("Manage HACP token staking for reputation");

staking
  .command("info [address]")
  .description("Get staking info for an agent")
  .action(async (address, _opts, cmd) => {
    const globalOpts = program.opts();
    await withClient(globalOpts, async (client) => {
      if (!client.staking) fatal("--staking address required for staking commands");
      const addr = address ?? (await client.getAddress());
      const record = await client.staking.getStake(addr);
      const boosted = await client.staking.isBoosted(addr);
      const multiplier = await client.staking.reputationMultiplier(addr);
      console.log(`\n  Staking info for ${truncateAddress(addr)}:`);
      ok("Staked amount", String(record.amount));
      ok("Boosted", boosted ? "Yes" : "No");
      ok("Reputation multiplier", `${multiplier / 100}x`);
      ok("Slash count", String(record.slashCount));
      if (record.lockedForJob > 0n) ok("Locked for job", String(record.lockedForJob));
      console.log();
    });
  });

program.parse(process.argv);

if (process.argv.length < 3) {
  program.help();
}
