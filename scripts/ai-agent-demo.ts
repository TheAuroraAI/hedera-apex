/**
 * HACP AI Agent Demo — Powered by Google Gemini 2.0 Flash
 *
 * Two autonomous AI agents (Alice and Bob) interact via the HACP protocol
 * on Hedera testnet. Each agent's decisions are made by Gemini via function
 * calling — real on-chain transactions are executed at every step.
 *
 * Run: npx ts-node --transpile-only scripts/ai-agent-demo.ts
 */

import * as dotenv from "dotenv";
import * as path from "path";
import { ethers } from "ethers";
import {
  GoogleGenerativeAI,
  FunctionCallingMode,
  type Tool,
  type FunctionDeclaration,
  type GenerateContentRequest,
  type Part,
} from "@google/generative-ai";

dotenv.config({ path: path.join(__dirname, "../.env") });

// ─── Constants ────────────────────────────────────────────────────────────────

const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const GEMINI_MODEL = "gemini-2.0-flash";

const REGISTRY_ADDRESS = process.env.REGISTRY_ADDRESS!;
const ESCROW_ADDRESS = process.env.ESCROW_ADDRESS!;
const HCS_TOPIC_ID = process.env.HCS_TOPIC_ID ?? "0.0.8099681";
const RPC_URL = process.env.HEDERA_RPC_URL ?? "https://testnet.hashio.io/api";

// Alice = main wallet from .env
const ALICE_PRIVATE_KEY = process.env.PRIVATE_KEY!;

// Bob = deterministic demo wallet (testnet only — never use for real funds)
const BOB_PRIVATE_KEY = ethers.id("hacp-bob-demo-agent-v1");

const HASHSCAN_BASE = "https://hashscan.io/testnet/transaction";

// Payment: 0.2 HBAR locked in escrow
const JOB_PAYMENT = ethers.parseEther("0.2");   // weibars on Hedera EVM
// Minimum stake for registration: 1 HBAR
const MIN_STAKE = ethers.parseEther("1");
// Bob seed funds for gas
const BOB_GAS_FUND = ethers.parseEther("3");

// ─── ABIs ─────────────────────────────────────────────────────────────────────

const REGISTRY_ABI = [
  "function register(string name, string hcsTopicId, string[] capabilities, uint256 ratePerJob, string metadataUri) external payable",
  "function getAgent(address wallet) external view returns (tuple(address wallet, string name, string hcsTopicId, string[] capabilities, uint256 ratePerJob, uint256 stakedAmount, uint256 completedJobs, uint256 totalRating, uint256 registeredAt, uint8 status, string metadataUri))",
  "function isRegistered(address wallet) external view returns (bool)",
  "function findByCapability(string capability, uint256 offset, uint256 limit) external view returns (address[], uint256)",
  "function minStake() external view returns (uint256)",
];

const ESCROW_ABI = [
  "function postJob(string title, string description, string[] requiredCaps, uint256 deadline) external payable returns (uint256)",
  "function placeBid(uint256 jobId, uint256 proposedRate, string proposal) external",
  "function acceptBid(uint256 jobId, address agent) external",
  "function submitDeliverable(uint256 jobId, string deliverableUri) external",
  "function releasePayment(uint256 jobId, uint8 rating) external",
  "function getBids(uint256 jobId) external view returns (tuple(address agent, uint256 proposedRate, string proposal, uint256 createdAt)[])",
  "function getJob(uint256 jobId) external view returns (tuple(uint256 id, address client, address agent, string title, string description, string[] requiredCaps, uint256 payment, uint256 postedAt, uint256 deadline, uint256 acceptedAt, uint256 submittedAt, uint8 status, string deliverableUri, uint8 clientRating, string disputeReason))",
  "function totalJobs() external view returns (uint256)",
  "event JobPosted(uint256 indexed jobId, address indexed client, uint256 payment, string title)",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hashScanLink(txHash: string): string {
  return `${HASHSCAN_BASE}/${txHash}`;
}

function printHeader(title: string): void {
  const width = 65;
  const padded = ` ${title} `;
  const sides = Math.max(0, width - padded.length);
  const left = Math.floor(sides / 2);
  const right = sides - left;
  console.log("\n" + "═".repeat(width));
  console.log("║" + " ".repeat(left) + padded + " ".repeat(right) + "║");
  console.log("═".repeat(width) + "\n");
}

function printStep(emoji: string, label: string, detail?: string): void {
  console.log(`${emoji}  ${label}`);
  if (detail) console.log(`   ${detail}`);
}

function printTx(txHash: string): void {
  console.log(`   🔗 HashScan: ${hashScanLink(txHash)}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

// ─── Gemini Tool Definitions ──────────────────────────────────────────────────

/**
 * These are the on-chain HACP actions Gemini can invoke.
 * They match 1-to-1 with smart contract calls executed below.
 */
const HACP_TOOLS: Tool = {
  functionDeclarations: [
    {
      name: "hacp_list_agents",
      description:
        "Search the HACP agent registry for agents with a given capability.",
      parameters: {
        type: "object" as const,
        properties: {
          capability: {
            type: "string",
            description: "The capability to search for (e.g. 'smart-contract-audit')",
          },
        },
        required: ["capability"],
      },
    } as FunctionDeclaration,
    {
      name: "hacp_post_job",
      description:
        "Post a new job to the HACP escrow contract, locking payment. Returns the job ID.",
      parameters: {
        type: "object" as const,
        properties: {
          title: {
            type: "string",
            description: "Short job title",
          },
          description: {
            type: "string",
            description: "Detailed job description",
          },
          required_capability: {
            type: "string",
            description: "Required agent capability tag",
          },
        },
        required: ["title", "description", "required_capability"],
      },
    } as FunctionDeclaration,
    {
      name: "hacp_get_bids",
      description: "Get all bids placed on a job.",
      parameters: {
        type: "object" as const,
        properties: {
          job_id: {
            type: "number",
            description: "The job ID to fetch bids for",
          },
        },
        required: ["job_id"],
      },
    } as FunctionDeclaration,
    {
      name: "hacp_accept_bid",
      description:
        "Accept a bid from a specific agent and assign the job to them.",
      parameters: {
        type: "object" as const,
        properties: {
          job_id: {
            type: "number",
            description: "The job ID",
          },
          agent_address: {
            type: "string",
            description: "The Ethereum address of the agent whose bid to accept",
          },
        },
        required: ["job_id", "agent_address"],
      },
    } as FunctionDeclaration,
    {
      name: "hacp_release_payment",
      description:
        "Release escrow payment to the agent after reviewing their deliverable.",
      parameters: {
        type: "object" as const,
        properties: {
          job_id: {
            type: "number",
            description: "The job ID",
          },
          rating: {
            type: "number",
            description: "Rating 1-100 for the agent's work quality",
          },
        },
        required: ["job_id", "rating"],
      },
    } as FunctionDeclaration,
    {
      name: "hacp_list_jobs",
      description:
        "Scan recent HACP jobs to find open ones matching a capability.",
      parameters: {
        type: "object" as const,
        properties: {
          capability: {
            type: "string",
            description: "Capability to filter by",
          },
        },
        required: ["capability"],
      },
    } as FunctionDeclaration,
    {
      name: "hacp_place_bid",
      description: "Place a bid on an open job.",
      parameters: {
        type: "object" as const,
        properties: {
          job_id: {
            type: "number",
            description: "The job ID",
          },
          proposed_rate: {
            type: "string",
            description: "Proposed rate in weibars as a string (e.g. '200000000000000000' for 0.2 HBAR)",
          },
          proposal: {
            type: "string",
            description: "Written proposal / pitch to the client",
          },
        },
        required: ["job_id", "proposed_rate", "proposal"],
      },
    } as FunctionDeclaration,
    {
      name: "hacp_submit_deliverable",
      description: "Submit completed work for a job by providing a deliverable URI.",
      parameters: {
        type: "object" as const,
        properties: {
          job_id: {
            type: "number",
            description: "The job ID",
          },
          deliverable_uri: {
            type: "string",
            description: "URI pointing to the deliverable (IPFS, HTTPS, etc.)",
          },
        },
        required: ["job_id", "deliverable_uri"],
      },
    } as FunctionDeclaration,
  ] as FunctionDeclaration[],
};

// ─── On-Chain Tool Executor ───────────────────────────────────────────────────

interface ToolContext {
  aliceRegistry: ethers.Contract;
  aliceEscrow: ethers.Contract;
  bobRegistry: ethers.Contract;
  bobEscrow: ethers.Contract;
  provider: ethers.JsonRpcProvider;
  activeAgent: "alice" | "bob";
  // shared state between rounds
  state: {
    jobId?: bigint;
    bobAddress?: string;
    aliceAddress?: string;
    transactions: string[];
  };
}

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<unknown> {
  const registry =
    ctx.activeAgent === "alice" ? ctx.aliceRegistry : ctx.bobRegistry;
  const escrow =
    ctx.activeAgent === "alice" ? ctx.aliceEscrow : ctx.bobEscrow;

  switch (name) {
    case "hacp_list_agents": {
      const capability = String(args.capability);
      printStep("🔍", `Tool: hacp_list_agents("${capability}")`);
      const [addresses, total]: [string[], bigint] =
        await registry.findByCapability(capability, 0, 10);
      const agents = [];
      for (const addr of addresses) {
        try {
          const raw = await registry.getAgent(addr);
          agents.push({
            address: addr,
            name: raw.name,
            capabilities: [...raw.capabilities],
            ratePerJob: raw.ratePerJob.toString(),
            completedJobs: raw.completedJobs.toString(),
            status: Number(raw.status),
          });
        } catch {
          // skip agents that can't be fetched
        }
      }
      console.log(
        `   Found ${agents.length} agents with capability "${capability}" (total: ${total})`
      );
      if (agents.length > 0) {
        console.log(`   Top result: ${agents[0].name} @ ${agents[0].address}`);
      }
      return { agents, total: total.toString() };
    }

    case "hacp_post_job": {
      const title = String(args.title);
      const description = String(args.description);
      const requiredCapability = String(args.required_capability);
      printStep("📋", `Tool: hacp_post_job("${title}")`);
      const deadline = Math.floor(Date.now() / 1000) + 7 * 86400; // 7 days
      const tx = await escrow.postJob(
        title,
        description,
        [requiredCapability],
        deadline,
        { value: JOB_PAYMENT }
      );
      const receipt = await tx.wait();
      // Parse JobPosted event to extract jobId
      let jobId = 0n;
      const iface = escrow.interface;
      if (receipt) {
        for (const log of receipt.logs) {
          try {
            const parsed = iface.parseLog(log);
            if (parsed?.name === "JobPosted") {
              jobId = BigInt(parsed.args[0].toString());
              break;
            }
          } catch {
            // skip
          }
        }
      }
      ctx.state.jobId = jobId;
      ctx.state.transactions.push(tx.hash);
      console.log(`   Job #${jobId} posted, 0.2 HBAR locked in escrow`);
      printTx(tx.hash);
      return {
        jobId: jobId.toString(),
        txHash: tx.hash,
        payment: "0.2 HBAR",
        status: "Open",
      };
    }

    case "hacp_list_jobs": {
      const capability = String(args.capability);
      printStep("🔍", `Tool: hacp_list_jobs("${capability}")`);
      // Scan last 50 jobs for matching open ones
      let totalJobs = 0n;
      try {
        totalJobs = await escrow.totalJobs();
      } catch {
        totalJobs = 0n;
      }
      const results = [];
      const scanFrom = totalJobs > 10n ? totalJobs - 10n : 0n;
      for (let i = scanFrom; i < totalJobs; i++) {
        try {
          const job = await escrow.getJob(i + 1n);
          const caps: string[] = Array.isArray(job.requiredCaps) ? [...job.requiredCaps] : [String(job.requiredCaps ?? "")];
          const capsMatch = caps.some((c: string) => c.toLowerCase().includes(capability.toLowerCase().replace(/-/g, "")));
          if (Number(job.status) === 0 && capsMatch) {
            results.push({
              jobId: job.id.toString(),
              title: job.title,
              description: job.description,
              requiredCaps: caps,
              payment: job.payment.toString(),
              client: job.client,
              status: "Open",
            });
          }
        } catch {
          // skip
        }
      }
      // Also check the specific jobId we know about from state
      if (ctx.state.jobId) {
        try {
          const job = await escrow.getJob(ctx.state.jobId);
          const alreadyIn = results.some(
            (r) => r.jobId === ctx.state.jobId!.toString()
          );
          if (!alreadyIn && Number(job.status) === 0) {
            results.unshift({
              jobId: job.id.toString(),
              title: job.title,
              description: job.description,
              requiredCapability: job.requiredCapability,
              payment: job.payment.toString(),
              client: job.client,
              status: "Open",
            });
          }
        } catch {
          // skip
        }
      }
      console.log(`   Found ${results.length} matching open job(s)`);
      if (results.length > 0) {
        console.log(`   Best match: "${results[0].title}" (Job #${results[0].jobId})`);
      }
      return { jobs: results };
    }

    case "hacp_place_bid": {
      const jobId = BigInt(String(args.job_id));
      const proposedRate = BigInt(String(args.proposed_rate));
      const proposal = String(args.proposal);
      printStep("🤝", `Tool: hacp_place_bid(jobId=${jobId})`);
      const tx = await escrow.placeBid(jobId, proposedRate, proposal);
      const receipt = await tx.wait();
      ctx.state.transactions.push(tx.hash);
      console.log(`   Bid placed on Job #${jobId} at rate ${proposedRate} weibars`);
      printTx(tx.hash);
      return {
        success: true,
        jobId: jobId.toString(),
        txHash: tx.hash,
        bidder: ctx.state.bobAddress,
      };
    }

    case "hacp_get_bids": {
      const jobId = BigInt(String(args.job_id));
      printStep("📂", `Tool: hacp_get_bids(jobId=${jobId})`);
      const rawBids = await escrow.getBids(jobId);
      const bids = rawBids.map((b: { agent: string; proposedRate: bigint; proposal: string; createdAt: bigint }) => ({
        agent: b.agent,
        proposedRate: b.proposedRate.toString(),
        proposal: b.proposal,
        createdAt: b.createdAt.toString(),
      }));
      console.log(`   Job #${jobId} has ${bids.length} bid(s)`);
      if (bids.length > 0) {
        console.log(`   Top bid from: ${bids[0].agent}`);
        console.log(`   Proposal: "${bids[0].proposal.slice(0, 80)}..."`);
      }
      return { bids };
    }

    case "hacp_accept_bid": {
      const jobId = BigInt(String(args.job_id));
      const agentAddress = String(args.agent_address);
      printStep("✅", `Tool: hacp_accept_bid(jobId=${jobId}, agent=${agentAddress.slice(0, 10)}...)`);
      const tx = await escrow.acceptBid(jobId, agentAddress);
      const receipt = await tx.wait();
      ctx.state.transactions.push(tx.hash);
      console.log(`   Bid accepted! Bob is now assigned to Job #${jobId}`);
      printTx(tx.hash);
      return {
        success: true,
        jobId: jobId.toString(),
        assignedAgent: agentAddress,
        txHash: tx.hash,
      };
    }

    case "hacp_submit_deliverable": {
      const jobId = BigInt(String(args.job_id));
      const deliverableUri = String(args.deliverable_uri);
      printStep("📤", `Tool: hacp_submit_deliverable(jobId=${jobId})`);
      const tx = await escrow.submitDeliverable(jobId, deliverableUri);
      const receipt = await tx.wait();
      ctx.state.transactions.push(tx.hash);
      console.log(`   Deliverable submitted for Job #${jobId}`);
      console.log(`   URI: ${deliverableUri}`);
      printTx(tx.hash);
      return {
        success: true,
        jobId: jobId.toString(),
        deliverableUri,
        txHash: tx.hash,
      };
    }

    case "hacp_release_payment": {
      const jobId = BigInt(String(args.job_id));
      const rating = Number(args.rating);
      printStep("💸", `Tool: hacp_release_payment(jobId=${jobId}, rating=${rating})`);
      const clampedRating2 = Math.max(1, Math.min(5, rating));
      const tx = await escrow.releasePayment(jobId, clampedRating2);
      const receipt = await tx.wait();
      ctx.state.transactions.push(tx.hash);
      const clampedRating = Math.max(1, Math.min(5, rating)); // Ensure 1-5
      console.log(`   Payment released! Bob received 0.2 HBAR. Rating: ${clampedRating}/5`);
      printTx(tx.hash);
      return {
        success: true,
        jobId: jobId.toString(),
        rating,
        paymentReleased: "0.2 HBAR",
        txHash: tx.hash,
      };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ─── Gemini Agent Runner ──────────────────────────────────────────────────────

/**
 * Run one "turn" of a Gemini-powered agent.
 * Gemini decides which HACP tool(s) to call; we execute them on-chain.
 * Supports multi-turn within a single prompt if Gemini needs multiple calls.
 */
async function runAgentTurn(
  gemini: GoogleGenerativeAI,
  agentName: string,
  systemPrompt: string,
  userPrompt: string,
  ctx: ToolContext,
  toolMode: "ANY" | "AUTO" = "ANY"
): Promise<string> {
  console.log(`\n${"─".repeat(65)}`);
  console.log(`🤖  [${agentName.toUpperCase()} AGENT — Powered by Gemini 2.0 Flash]`);
  console.log(`─${"─".repeat(64)}`);
  console.log(`📝  Prompt: "${userPrompt}"\n`);

  const model = gemini.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: systemPrompt,
    tools: [HACP_TOOLS],
    toolConfig: {
      functionCallingConfig: {
        mode: toolMode === "ANY" ? FunctionCallingMode.ANY : FunctionCallingMode.AUTO,
      },
    },
  });

  // Multi-turn conversation: let Gemini call tools until it finishes
  const history: Part[] = [];
  let finalText = "";
  let maxIter = 6; // safety cap

  // Initial request
  let request: GenerateContentRequest = {
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
  };

  while (maxIter-- > 0) {
    let result: Awaited<ReturnType<typeof model.generateContent>>;
    try {
      result = await model.generateContent(request);
    } catch (geminiErr: unknown) {
      const msg = geminiErr instanceof Error ? geminiErr.message : String(geminiErr);
      console.warn(`\n  ⚠️  Gemini unavailable (${msg.slice(0, 100)})`);
      console.log(`  ↳ Proceeding with scripted fallback transactions...\n`);
      return ""; // triggers fallback code in main()
    }
    const response = result.response;
    const candidate = response.candidates?.[0];
    if (!candidate) break;

    const parts = candidate.content?.parts ?? [];
    let hasFunctionCall = false;

    // Collect function responses to build next turn
    const functionResponseParts: Part[] = [];

    for (const part of parts) {
      if (part.functionCall) {
        hasFunctionCall = true;
        const { name, args } = part.functionCall;
        console.log(`\n🧠  Gemini decided to call: ${name}`);
        try {
          const toolResult = await executeTool(
            name,
            args as Record<string, unknown>,
            ctx
          );
          functionResponseParts.push({
            functionResponse: {
              name,
              response: { result: toolResult },
            },
          } as Part);
          await sleep(500); // brief pause between on-chain calls
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`   ⚠️  Tool error: ${msg}`);
          functionResponseParts.push({
            functionResponse: {
              name,
              response: { error: msg },
            },
          } as Part);
        }
      } else if (part.text) {
        finalText += part.text;
      }
    }

    if (!hasFunctionCall) {
      // Gemini finished — no more tool calls
      break;
    }

    // Build next turn: model's tool calls + our responses
    const prevContents = (request.contents ?? []);
    request = {
      contents: [
        ...prevContents,
        { role: "model", parts },
        { role: "user", parts: functionResponseParts },
      ],
    };
  }

  if (finalText) {
    console.log(`\n💬  Agent summary: "${finalText.slice(0, 200)}"`);
  }

  return finalText;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  printHeader("HACP AI Agent Demo — Powered by Gemini");

  // ── 1. Connect wallets ──────────────────────────────────────────────────────
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const aliceWallet = new ethers.Wallet(ALICE_PRIVATE_KEY, provider);
  const bobWallet = new ethers.Wallet(BOB_PRIVATE_KEY, provider);

  console.log("SETUP: Connecting to Hedera testnet...\n");
  console.log(`  Alice (client agent): ${aliceWallet.address}`);
  console.log(`  Bob   (auditor agent): ${bobWallet.address}`);
  console.log(`  Registry: ${REGISTRY_ADDRESS}`);
  console.log(`  Escrow:   ${ESCROW_ADDRESS}\n`);

  // Check balances
  const aliceBalance = await provider.getBalance(aliceWallet.address);
  const bobBalance = await provider.getBalance(bobWallet.address);
  console.log(`  Alice balance: ${ethers.formatEther(aliceBalance)} HBAR`);
  console.log(`  Bob   balance: ${ethers.formatEther(bobBalance)} HBAR`);

  // ── 2. Fund Bob if needed ───────────────────────────────────────────────────
  // On Hedera testnet, transferring to a new EVM address may require a higher
  // gas limit because Hedera auto-creates the account on first receipt.
  if (bobBalance < ethers.parseEther("2.0")) {
    console.log("\n  Transferring 3 HBAR from Alice to Bob for gas...");
    try {
      const fundTx = await aliceWallet.sendTransaction({
        to: bobWallet.address,
        value: BOB_GAS_FUND,
        gasLimit: 1_000_000n, // Hedera needs higher gas for new account creation
      });
      await fundTx.wait();
      const newBal = await provider.getBalance(bobWallet.address);
      console.log(`  Bob funded. New balance: ${ethers.formatEther(newBal)} HBAR`);
      console.log(`  🔗 ${hashScanLink(fundTx.hash)}`);
    } catch (fundErr: unknown) {
      const msg = fundErr instanceof Error ? fundErr.message : String(fundErr);
      console.warn(`  ⚠️  Direct transfer failed (${msg.slice(0, 80)})`);
      console.warn("  Hedera may require account pre-creation. Attempting via contract call...");
      // Second attempt: send with explicit gasLimit override via provider
      try {
        const feeData = await provider.getFeeData();
        const fundTx2 = await aliceWallet.sendTransaction({
          to: bobWallet.address,
          value: BOB_GAS_FUND,
          gasLimit: 2_000_000n,
          maxFeePerGas: feeData.maxFeePerGas ?? undefined,
          maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? undefined,
          type: 2,
        });
        await fundTx2.wait();
        const newBal2 = await provider.getBalance(bobWallet.address);
        console.log(`  Bob funded (attempt 2). New balance: ${ethers.formatEther(newBal2)} HBAR`);
        console.log(`  🔗 ${hashScanLink(fundTx2.hash)}`);
      } catch (fundErr2: unknown) {
        const msg2 = fundErr2 instanceof Error ? fundErr2.message : String(fundErr2);
        console.error(`  ❌ Could not fund Bob's wallet: ${msg2.slice(0, 120)}`);
        console.error("  Please fund Bob manually via Hedera testnet faucet:");
        console.error(`  https://portal.hedera.com/faucet → ${bobWallet.address}`);
        console.error("  Then re-run the demo.");
        process.exit(1);
      }
    }
  } else {
    console.log("\n  Bob already has sufficient balance, skipping fund transfer.");
  }

  // ── 3. Wire up contracts ────────────────────────────────────────────────────
  const aliceRegistry = new ethers.Contract(
    REGISTRY_ADDRESS,
    REGISTRY_ABI,
    aliceWallet
  );
  const aliceEscrow = new ethers.Contract(
    ESCROW_ADDRESS,
    ESCROW_ABI,
    aliceWallet
  );
  const bobRegistry = new ethers.Contract(
    REGISTRY_ADDRESS,
    REGISTRY_ABI,
    bobWallet
  );
  const bobEscrow = new ethers.Contract(
    ESCROW_ADDRESS,
    ESCROW_ABI,
    bobWallet
  );

  // ── 4. Register Bob if needed ───────────────────────────────────────────────
  console.log("\n  Checking Bob's registration status...");
  const bobRegistered: boolean = await bobRegistry.isRegistered(
    bobWallet.address
  );

  if (!bobRegistered) {
    console.log("  Bob is not registered. Registering as security auditor agent...");
    const minStake = await bobRegistry.minStake().catch(() => MIN_STAKE);
    const stakeAmount =
      BigInt(minStake.toString()) < MIN_STAKE ? MIN_STAKE : BigInt(minStake.toString());
    const regTx = await bobRegistry.register(
      "Bob-SecurityAuditor",
      HCS_TOPIC_ID,
      ["smart-contract-audit", "security-review", "defi-audit"],
      ethers.parseEther("0.2"), // rate per job
      "ipfs://QmBobSecurityAuditorManifest",
      { value: stakeAmount }
    );
    const regReceipt = await regTx.wait();
    console.log(`  Bob registered on-chain!`);
    console.log(`  🔗 ${hashScanLink(regTx.hash)}`);
  } else {
    console.log("  Bob is already registered — skipping registration.");
  }

  // ── 5. Initialise Gemini and shared state ───────────────────────────────────
  const gemini = new GoogleGenerativeAI(GEMINI_API_KEY);

  const sharedState: ToolContext["state"] = {
    bobAddress: bobWallet.address,
    aliceAddress: aliceWallet.address,
    transactions: [],
  };

  const ctx: ToolContext = {
    aliceRegistry,
    aliceEscrow,
    bobRegistry,
    bobEscrow,
    provider,
    activeAgent: "alice",
    state: sharedState,
  };

  // ── 6. ALICE ROUND 1: Find an agent and post a job ──────────────────────────
  ctx.activeAgent = "alice";
  await runAgentTurn(
    gemini,
    "Alice",
    `You are Alice, an autonomous AI agent client on the HACP (Hedera Agent Commerce Protocol).
You need to hire a smart contract security auditor via HACP.
Use the available HACP tools to:
1. First search for agents with 'smart-contract-audit' capability.
2. Then post a job titled "DeFi Protocol Security Audit" with a clear description, requiring capability "smart-contract-audit".
Always use both tools in sequence — do not stop after just one tool call.`,
    `I need a smart contract security audit for my new DeFi protocol.
Find a suitable agent on HACP and post a job to hire them. The job should offer 0.2 HBAR.`,
    ctx,
    "ANY"
  );

  if (!sharedState.jobId) {
    // Fallback: post job directly if Gemini didn't
    console.log("\n  ⚠️  Posting job directly as fallback...");
    const deadline = Math.floor(Date.now() / 1000) + 7 * 86400;
    const tx = await aliceEscrow.postJob(
      "DeFi Protocol Security Audit",
      "Perform a comprehensive security audit of our DeFi smart contracts. Check for reentrancy, overflow, access control issues, and logic bugs.",
      ["smart-contract-audit"],
      deadline,
      { value: JOB_PAYMENT }
    );
    const receipt = await tx.wait();
    let jobId = 0n;
    if (receipt) {
      for (const log of receipt.logs) {
        try {
          const parsed = aliceEscrow.interface.parseLog(log);
          if (parsed?.name === "JobPosted") {
            jobId = BigInt(parsed.args[0].toString());
            break;
          }
        } catch { /* skip */ }
      }
    }
    sharedState.jobId = jobId;
    sharedState.transactions.push(tx.hash);
    console.log(`  Job #${jobId} posted. TX: ${hashScanLink(tx.hash)}`);
  }

  console.log(`\n  ✅ Job ID established: #${sharedState.jobId}`);
  await sleep(2000);

  // ── 7. BOB ROUND 1: Find the job and place a bid ───────────────────────────
  ctx.activeAgent = "bob";
  await runAgentTurn(
    gemini,
    "Bob",
    `You are Bob, an autonomous AI security auditor agent on HACP.
Your wallet address is ${bobWallet.address}.
You specialize in smart contract security audits.
Use the HACP tools to:
1. List available jobs matching 'smart-contract-audit'.
2. Place a bid on the most promising job (job ID ${sharedState.jobId ?? "the first open one"}).
   Use proposed_rate of exactly "${JOB_PAYMENT.toString()}" weibars.
   Write a professional proposal.
Do both tool calls — do not stop after listing jobs.`,
    `You are a security auditor agent. Find available audit jobs on HACP and place a competitive bid.`,
    ctx,
    "ANY"
  );

  // Verify bid was placed; if not, place directly
  const bidsAfterBob = await bobEscrow.getBids(sharedState.jobId!).catch(() => []);
  const bobBidExists = (bidsAfterBob as { agent: string }[]).some(
    (b) => b.agent.toLowerCase() === bobWallet.address.toLowerCase()
  );
  if (!bobBidExists) {
    console.log("\n  ⚠️  Placing bid directly as fallback...");
    const tx = await bobEscrow.placeBid(
      sharedState.jobId!,
      JOB_PAYMENT,
      "I am Bob, a specialist in EVM smart contract security. I will deliver a comprehensive audit covering reentrancy, integer overflow, access control, and DeFi-specific attack vectors within 48 hours."
    );
    await tx.wait();
    sharedState.transactions.push(tx.hash);
    console.log(`  Bid placed. TX: ${hashScanLink(tx.hash)}`);
  }

  await sleep(2000);

  // ── 8. ALICE ROUND 2: Review bids and accept Bob's ─────────────────────────
  ctx.activeAgent = "alice";
  await runAgentTurn(
    gemini,
    "Alice",
    `You are Alice, an autonomous AI agent client on HACP.
You previously posted job #${sharedState.jobId}.
Now you need to:
1. Get the bids on job #${sharedState.jobId}.
2. Accept the bid from agent ${bobWallet.address}.
Do both tool calls in sequence.`,
    `I posted job #${sharedState.jobId} for a smart contract audit. Check the bids and accept the best one.`,
    ctx,
    "ANY"
  );

  // Verify bid was accepted; check job status
  const jobAfterAccept = await aliceEscrow.getJob(sharedState.jobId!).catch(() => null);
  if (!jobAfterAccept || Number(jobAfterAccept.status) === 0) {
    console.log("\n  ⚠️  Accepting bid directly as fallback...");
    const tx = await aliceEscrow.acceptBid(
      sharedState.jobId!,
      bobWallet.address
    );
    await tx.wait();
    sharedState.transactions.push(tx.hash);
    console.log(`  Bid accepted. TX: ${hashScanLink(tx.hash)}`);
  }

  await sleep(2000);

  // ── 9. BOB ROUND 2: Submit deliverable ─────────────────────────────────────
  ctx.activeAgent = "bob";
  await runAgentTurn(
    gemini,
    "Bob",
    `You are Bob, a security auditor agent on HACP.
Your bid on job #${sharedState.jobId} was accepted.
Submit your completed audit deliverable by calling hacp_submit_deliverable.
Use job_id ${sharedState.jobId} and a realistic IPFS URI for the deliverable.`,
    `Your bid was accepted for job #${sharedState.jobId}. Submit your completed security audit deliverable now.`,
    ctx,
    "ANY"
  );

  // Verify submission; check job status
  const jobAfterSubmit = await bobEscrow.getJob(sharedState.jobId!).catch(() => null);
  if (!jobAfterSubmit || Number(jobAfterSubmit.status) < 2) {
    console.log("\n  ⚠️  Submitting deliverable directly as fallback...");
    const tx = await bobEscrow.submitDeliverable(
      sharedState.jobId!,
      "ipfs://QmBobAuditReport2026SecurityFindingsHACPDemo"
    );
    await tx.wait();
    sharedState.transactions.push(tx.hash);
    console.log(`  Deliverable submitted. TX: ${hashScanLink(tx.hash)}`);
  }

  await sleep(2000);

  // ── 10. ALICE ROUND 3: Release payment ─────────────────────────────────────
  ctx.activeAgent = "alice";
  await runAgentTurn(
    gemini,
    "Alice",
    `You are Alice, an autonomous AI agent client on HACP.
Bob has submitted his audit deliverable for job #${sharedState.jobId}.
Review the work and release payment with a rating between 1 and 5 (where 5 is best).
Call hacp_release_payment with job_id ${sharedState.jobId} and a rating of 5.`,
    `The security auditor submitted their deliverable for job #${sharedState.jobId}. Review and release payment with a rating.`,
    ctx,
    "ANY"
  );

  // Verify payment released; check job status
  const jobFinal = await aliceEscrow.getJob(sharedState.jobId!).catch(() => null);
  if (!jobFinal || Number(jobFinal.status) < 3) {
    console.log("\n  ⚠️  Releasing payment directly as fallback...");
    const tx = await aliceEscrow.releasePayment(sharedState.jobId!, 5);
    await tx.wait();
    sharedState.transactions.push(tx.hash);
    console.log(`  Payment released. TX: ${hashScanLink(tx.hash)}`);
  }

  // ── 11. Final summary ───────────────────────────────────────────────────────
  printHeader("DEMO COMPLETE");

  console.log("All HACP interactions executed on Hedera testnet:\n");
  console.log(`  Job ID:        #${sharedState.jobId}`);
  console.log(`  Alice (client): ${aliceWallet.address}`);
  console.log(`  Bob (auditor): ${bobWallet.address}`);
  console.log(`  Payment:       0.2 HBAR (transferred from Alice → Bob via escrow)`);
  console.log(`  Model:         ${GEMINI_MODEL}`);
  console.log(`\nTransaction History:`);

  for (let i = 0; i < sharedState.transactions.length; i++) {
    const txHash = sharedState.transactions[i];
    console.log(`  [${i + 1}] ${hashScanLink(txHash)}`);
  }

  console.log("\n" + "═".repeat(65));
  console.log("Two agents completed a full hiring cycle via HACP protocol.");
  console.log("Every step above was a real Hedera testnet transaction.");
  console.log("Re-run with live Gemini access for full AI-driven decision making.");
  console.log("═".repeat(65) + "\n");
}

main().catch((err) => {
  console.error("\n❌ Demo failed:", err.message ?? err);
  process.exit(1);
});
