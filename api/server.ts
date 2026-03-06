/**
 * HACP Chat API Server
 * Hedera Agent Commerce Protocol — Live Demo Backend
 *
 * Provides a natural language chat interface and REST endpoints
 * for agent discovery, job browsing, and protocol interaction.
 */

import express, { Request, Response, NextFunction } from "express";
import { ethers } from "ethers";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.join(__dirname, "..", ".env") });

// ============ Configuration ============

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

const REGISTRY_ADDRESS =
  process.env.REGISTRY_ADDRESS || "0x1fca2Bc46254583853E434677D1F5CC34B9ce9ca";
const ESCROW_ADDRESS =
  process.env.ESCROW_ADDRESS || "0xFD41170A5cE85Ef70437de337863d3469729dFb8";
const HEDERA_RPC_URL =
  process.env.HEDERA_RPC_URL || "https://testnet.hashio.io/api";

// ============ ABIs (matching actual on-chain contract signatures) ============

// NOTE: getTopAgents and findByCapability return Agent[] structs directly (not address[]).
// getAgent(address) returns a single Agent struct.
// totalAgents() returns the total count in _agentList (all registered, including inactive).
const REGISTRY_ABI = [
  "function totalAgents() external view returns (uint256)",
  "function getAgent(address wallet) external view returns (tuple(address wallet, string name, string hcsTopicId, string[] capabilities, uint256 ratePerJob, uint256 stakedAmount, uint256 completedJobs, uint256 totalRating, uint256 registeredAt, uint8 status, string metadataUri))",
  "function isRegistered(address wallet) external view returns (bool)",
  "function findByCapability(string capability, uint256 offset, uint256 limit) external view returns (tuple(address wallet, string name, string hcsTopicId, string[] capabilities, uint256 ratePerJob, uint256 stakedAmount, uint256 completedJobs, uint256 totalRating, uint256 registeredAt, uint8 status, string metadataUri)[] results, uint256 total)",
  "function getTopAgents(uint256 offset, uint256 limit) external view returns (tuple(address wallet, string name, string hcsTopicId, string[] capabilities, uint256 ratePerJob, uint256 stakedAmount, uint256 completedJobs, uint256 totalRating, uint256 registeredAt, uint8 status, string metadataUri)[] results, uint256 total)",
];

const ESCROW_ABI = [
  "function totalJobs() external view returns (uint256)",
  "function getJob(uint256 jobId) external view returns (tuple(uint256 id, address client, address agent, string title, string description, string[] requiredCaps, uint256 payment, uint256 postedAt, uint256 deadline, uint256 acceptedAt, uint256 submittedAt, uint8 status, string deliverableUri, uint8 clientRating, string disputeReason))",
  "function getClientJobs(address client) external view returns (uint256[])",
];

// ============ Status Labels ============

const AGENT_STATUS: Record<number, string> = {
  0: "Inactive",
  1: "Active",
  2: "Suspended",
};

const JOB_STATUS: Record<number, string> = {
  0: "Open",
  1: "Assigned",
  2: "Submitted",
  3: "Completed",
  4: "Disputed",
  5: "Cancelled",
};

// ============ Provider + Contracts ============

const provider = new ethers.JsonRpcProvider(HEDERA_RPC_URL);
const registry = new ethers.Contract(REGISTRY_ADDRESS, REGISTRY_ABI, provider);
const escrow = new ethers.Contract(ESCROW_ADDRESS, ESCROW_ABI, provider);

// ============ Data Formatters ============

function formatAgent(raw: ethers.Result) {
  const completedJobs = Number(raw.completedJobs);
  const totalRating = Number(raw.totalRating);
  return {
    wallet: raw.wallet,
    name: raw.name,
    hcsTopicId: raw.hcsTopicId,
    capabilities: Array.from(raw.capabilities as string[]),
    ratePerJob: raw.ratePerJob.toString(),
    ratePerJobHbar: (Number(raw.ratePerJob) / 1e8).toFixed(4),
    stakedAmount: raw.stakedAmount.toString(),
    stakedAmountHbar: (Number(raw.stakedAmount) / 1e8).toFixed(4),
    completedJobs,
    totalRating,
    averageRating:
      completedJobs > 0
        ? (totalRating / completedJobs).toFixed(2)
        : "N/A",
    registeredAt: Number(raw.registeredAt),
    registeredAtDate: new Date(Number(raw.registeredAt) * 1000).toISOString(),
    status: Number(raw.status),
    statusLabel: AGENT_STATUS[Number(raw.status)] ?? "Unknown",
    metadataUri: raw.metadataUri,
  };
}

function formatJob(raw: ethers.Result) {
  const status = Number(raw.status);
  return {
    id: Number(raw.id),
    client: raw.client,
    agent: raw.agent === ethers.ZeroAddress ? null : raw.agent,
    title: raw.title,
    description: raw.description,
    requiredCaps: Array.from(raw.requiredCaps as string[]),
    payment: raw.payment.toString(),
    paymentHbar: (Number(raw.payment) / 1e8).toFixed(4),
    postedAt: Number(raw.postedAt),
    postedAtDate: new Date(Number(raw.postedAt) * 1000).toISOString(),
    deadline: Number(raw.deadline),
    deadlineDate: new Date(Number(raw.deadline) * 1000).toISOString(),
    acceptedAt: Number(raw.acceptedAt) || null,
    submittedAt: Number(raw.submittedAt) || null,
    status,
    statusLabel: JOB_STATUS[status] ?? "Unknown",
    deliverableUri: raw.deliverableUri || null,
    clientRating: Number(raw.clientRating) || null,
    disputeReason: raw.disputeReason || null,
  };
}

// ============ Helpers ============

async function fetchTopAgents(offset = 0, limit = 50) {
  // getTopAgents returns only Active agents sorted by reputation
  const [results, total] = await registry.getTopAgents(offset, limit);
  const agents = Array.from(results as ethers.Result[]).map(formatAgent);
  return { agents, activeTotal: Number(total) };
}

async function fetchAllAgents(limit = 50) {
  // totalAgents includes all registered (active + inactive)
  const total = Number(await registry.totalAgents());
  // Use getTopAgents to get active ones; also try individual fetching if needed
  const { agents, activeTotal } = await fetchTopAgents(0, limit);
  return { agents, total, activeTotal };
}

async function fetchAllJobs(limit = 50) {
  const total = Number(await escrow.totalJobs());
  if (total === 0) return { jobs: [], openJobs: [], total: 0 };
  const jobIds = Array.from({ length: Math.min(total, limit) }, (_, i) => i + 1);
  const jobs = await Promise.all(
    jobIds.map(async (id) => {
      try {
        const raw = await escrow.getJob(id);
        return formatJob(raw);
      } catch {
        return null;
      }
    })
  );
  const valid = jobs.filter(Boolean) as ReturnType<typeof formatJob>[];
  const openJobs = valid.filter((j) => j.status === 0);
  return { jobs: valid, openJobs, total };
}

// ============ Chat Intent Router ============

interface ChatResponse {
  reply: string;
  data?: unknown;
  suggestions: string[];
  intent: string;
}

async function handleChat(message: string): Promise<ChatResponse> {
  const lower = message.toLowerCase().trim();

  // --- Protocol description ---
  if (
    lower.includes("protocol") ||
    lower.includes("what is hacp") ||
    lower.includes("what is this") ||
    lower.includes("how does this work") ||
    lower.includes("explain")
  ) {
    return {
      intent: "protocol_info",
      reply:
        "HACP (Hedera Agent Commerce Protocol) is a decentralized marketplace for AI agents built on Hedera Testnet. " +
        "Agents register with capabilities and stake HBAR. Clients post jobs with HBAR payment locked in escrow. " +
        "Agents bid, get assigned, deliver work, and receive payment automatically. " +
        "All coordination uses Hedera Consensus Service (HCS) for tamper-proof messaging. " +
        `Contracts: Registry ${REGISTRY_ADDRESS}, Escrow ${ESCROW_ADDRESS}.`,
      data: {
        contracts: {
          registry: REGISTRY_ADDRESS,
          escrow: ESCROW_ADDRESS,
          rpcUrl: HEDERA_RPC_URL,
        },
      },
      suggestions: [
        "Find me a smart-contract-audit agent",
        "What jobs are available?",
        "How many agents are registered?",
      ],
    };
  }

  // --- Agent count ---
  if (
    lower.includes("how many agent") ||
    lower.includes("total agent") ||
    lower.includes("count agent") ||
    lower.includes("number of agent")
  ) {
    const total = Number(await registry.totalAgents());
    const { activeTotal } = await fetchTopAgents(0, 1);
    return {
      intent: "agent_count",
      reply:
        `There are ${total} agent${total !== 1 ? "s" : ""} registered in the HACP registry ` +
        `(${activeTotal} currently active).`,
      data: { totalAgents: total, activeAgents: activeTotal },
      suggestions: [
        "List all active agents",
        "Find me a smart-contract-audit agent",
        "What jobs are available?",
      ],
    };
  }

  // --- Find by capability ---
  const capabilityMatch = lower.match(
    /(?:find|get|show|search|looking for|need|want)\s+(?:me\s+)?(?:a\s+|an\s+)?(.+?)\s+agent/
  );
  if (capabilityMatch || lower.includes("capability")) {
    let capability = "";
    if (capabilityMatch) {
      capability = capabilityMatch[1].trim().replace(/\s+/g, "-");
    } else {
      const capMatch = lower.match(/capability[:\s]+([a-z0-9-]+)/);
      capability = capMatch ? capMatch[1] : "smart-contract-audit";
    }
    try {
      const [results, total] = await registry.findByCapability(capability, 0, 20);
      const count = Number(total);
      const agents = Array.from(results as ethers.Result[]).map(formatAgent);
      if (count === 0) {
        return {
          intent: "find_by_capability",
          reply: `No active agents found with the "${capability}" capability. Try listing all agents.`,
          data: { capability, agents: [], total: 0 },
          suggestions: [
            "List all active agents",
            "What jobs are available?",
            "Find me a smart-contract-audit agent",
          ],
        };
      }
      return {
        intent: "find_by_capability",
        reply:
          `Found ${count} active agent${count !== 1 ? "s" : ""} with the "${capability}" capability.`,
        data: { capability, agents, total: count },
        suggestions: [
          "What jobs are available?",
          "List all active agents",
          "Post a job",
        ],
      };
    } catch (err) {
      return {
        intent: "find_by_capability",
        reply: `Could not query for "${capability}" agents: ${(err as Error).message}`,
        data: null,
        suggestions: ["List all active agents", "What jobs are available?"],
      };
    }
  }

  // --- List agents ---
  if (
    lower.includes("list agent") ||
    lower.includes("show agent") ||
    lower.includes("all agent") ||
    lower.includes("available agent") ||
    lower.includes("what agents") ||
    lower.includes("top agent")
  ) {
    const { agents, total, activeTotal } = await fetchAllAgents(20);
    if (total === 0) {
      return {
        intent: "list_agents",
        reply: "No agents are currently registered in the HACP registry.",
        data: { agents: [], total: 0, activeTotal: 0 },
        suggestions: [
          "Register as an agent",
          "Tell me about the protocol",
          "What jobs are available?",
        ],
      };
    }
    return {
      intent: "list_agents",
      reply:
        `${total} registered agent${total !== 1 ? "s" : ""} (${activeTotal} active). ` +
        (agents.length > 0
          ? `Top active: ${agents.map((a) => `"${a.name}" (${a.capabilities.join(", ")})`).join("; ")}.`
          : "No active agents at this time."),
      data: { agents, total, activeTotal },
      suggestions: [
        "Find me a smart-contract-audit agent",
        "What jobs are available?",
        "Post a job",
      ],
    };
  }

  // --- Show specific job by ID ---
  const jobIdMatch = lower.match(
    /(?:show|get|display|job|details?(?:\s+(?:for|of))?)\s+(?:job\s+)?#?(\d+)/
  );
  if (jobIdMatch) {
    const jobId = parseInt(jobIdMatch[1]);
    try {
      const raw = await escrow.getJob(jobId);
      const job = formatJob(raw);
      return {
        intent: "get_job",
        reply:
          `Job #${jobId}: "${job.title}" — Status: ${job.statusLabel}, ` +
          `Payment: ${job.paymentHbar} HBAR, ` +
          `Required: ${(job.requiredCaps as string[]).join(", ")}.`,
        data: { job },
        suggestions: [
          "List all open jobs",
          `Find me a ${(job.requiredCaps as string[])[0] || "code-review"} agent`,
          "Post a similar job",
        ],
      };
    } catch (err) {
      return {
        intent: "get_job",
        reply: `Could not find Job #${jobId}: ${(err as Error).message}`,
        data: null,
        suggestions: ["List all open jobs", "How many jobs are posted?"],
      };
    }
  }

  // --- Job count ---
  if (
    lower.includes("how many job") ||
    lower.includes("total job") ||
    lower.includes("count job") ||
    lower.includes("number of job")
  ) {
    const total = Number(await escrow.totalJobs());
    return {
      intent: "job_count",
      reply: `There ${total === 1 ? "is" : "are"} ${total} job${total !== 1 ? "s" : ""} in the HACP escrow contract.`,
      data: { totalJobs: total },
      suggestions: [
        "List all open jobs",
        "Show me job 1",
        "Find me a smart-contract-audit agent",
      ],
    };
  }

  // --- Jobs / open / available / work ---
  if (
    lower.includes("job") ||
    lower.includes("gig") ||
    lower.includes("work") ||
    lower.includes("open") ||
    lower.includes("available")
  ) {
    const { jobs, openJobs, total } = await fetchAllJobs(30);
    if (total === 0) {
      return {
        intent: "list_jobs",
        reply: "No jobs have been posted yet in the HACP escrow contract.",
        data: { jobs: [], openJobs: [], total: 0 },
        suggestions: [
          "Post a job",
          "List all agents",
          "Tell me about the protocol",
        ],
      };
    }
    const openSummary = openJobs.length > 0
      ? `Open: ${openJobs.map((j) => `#${j.id} "${j.title}" (${j.paymentHbar} HBAR)`).join(", ")}.`
      : "No jobs are currently open — all are assigned or completed.";
    return {
      intent: "list_jobs",
      reply:
        `${total} total job${total !== 1 ? "s" : ""}, ${openJobs.length} open. ${openSummary}`,
      data: { jobs, openJobs, total },
      suggestions: [
        "Show me job 1",
        "Find me a smart-contract-audit agent",
        "How many agents are registered?",
      ],
    };
  }

  // --- Register / join ---
  if (
    lower.includes("register") ||
    lower.includes("sign up") ||
    lower.includes("join") ||
    lower.includes("become an agent")
  ) {
    return {
      intent: "register_info",
      reply:
        "To register as an agent: (1) Get testnet HBAR from faucet.hedera.com, " +
        "(2) Run `hacp agent register --name 'My Agent' --capabilities smart-contract-audit --rate 10 --stake 5`. " +
        "You need to stake a minimum of 1 HBAR. Your agent appears in the registry immediately.",
      data: {
        registryAddress: REGISTRY_ADDRESS,
        minStake: "1 HBAR",
        faucet: "https://faucet.hedera.com",
      },
      suggestions: [
        "What jobs are available?",
        "Tell me about the protocol",
        "List all agents",
      ],
    };
  }

  // --- Post a job ---
  if (
    lower.includes("post a job") ||
    lower.includes("create a job") ||
    lower.includes("hire")
  ) {
    return {
      intent: "post_job_info",
      reply:
        "To post a job: run `hacp job post --title 'My Job' --description '...' --capability smart-contract-audit --payment 5 --deadline 7d`. " +
        "Payment is locked in escrow until you approve the deliverable or the auto-release window expires.",
      data: { escrowAddress: ESCROW_ADDRESS },
      suggestions: [
        "Find me a smart-contract-audit agent",
        "What jobs are available?",
        "How does escrow work?",
      ],
    };
  }

  // --- Contracts / addresses ---
  if (
    lower.includes("contract") ||
    lower.includes("address") ||
    lower.includes("deployed") ||
    lower.includes("testnet")
  ) {
    return {
      intent: "contract_info",
      reply:
        `HACP is live on Hedera Testnet. ` +
        `AgentRegistry: ${REGISTRY_ADDRESS}. ` +
        `JobEscrow: ${ESCROW_ADDRESS}. ` +
        `View on HashScan: https://hashscan.io/testnet/contract/${REGISTRY_ADDRESS.toLowerCase()}`,
      data: {
        network: "hedera_testnet",
        registry: REGISTRY_ADDRESS,
        escrow: ESCROW_ADDRESS,
        rpcUrl: HEDERA_RPC_URL,
        hashscan: `https://hashscan.io/testnet/contract/${REGISTRY_ADDRESS.toLowerCase()}`,
      },
      suggestions: [
        "List all agents",
        "What jobs are available?",
        "Tell me about the protocol",
      ],
    };
  }

  // --- Fallback ---
  return {
    intent: "unknown",
    reply:
      "I can help you explore the HACP protocol. Try: 'What agents are available?', " +
      "'Find me a smart-contract-audit agent', 'What jobs are open?', or 'Tell me about the protocol'.",
    data: null,
    suggestions: [
      "List all agents",
      "What jobs are available?",
      "Tell me about the protocol",
      "How many agents are registered?",
    ],
  };
}

// ============ Express App ============

const app = express();

// Middleware
app.use(express.json());
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (_req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

// ============ Root — API Documentation (HTML) ============

app.get("/", (_req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/html");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>HACP API — Hedera Agent Commerce Protocol</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',system-ui,sans-serif;background:#0d1117;color:#e6edf3;line-height:1.6}
    .header{background:linear-gradient(135deg,#1a2332 0%,#0d1117 100%);border-bottom:1px solid #30363d;padding:40px 24px;text-align:center}
    .header h1{font-size:2.4em;color:#58a6ff;margin-bottom:8px}
    .header .subtitle{color:#8b949e;font-size:1.1em}
    .badge{display:inline-block;background:#1f6feb;color:#58a6ff;border:1px solid #1f6feb;padding:2px 10px;border-radius:12px;font-size:0.8em;margin-left:8px}
    .container{max-width:900px;margin:0 auto;padding:32px 24px}
    .section{margin-bottom:40px}
    .section h2{color:#58a6ff;font-size:1.3em;margin-bottom:16px;padding-bottom:8px;border-bottom:1px solid #21262d}
    .endpoint{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px 20px;margin-bottom:12px}
    .method{display:inline-block;padding:2px 10px;border-radius:4px;font-size:0.85em;font-weight:700;margin-right:10px;font-family:monospace}
    .get{background:#1a4a1a;color:#3fb950;border:1px solid #3fb950}
    .post{background:#1a2f4a;color:#58a6ff;border:1px solid #58a6ff}
    .path{font-family:monospace;font-size:1em}
    .desc{color:#8b949e;margin-top:6px;font-size:0.9em}
    pre{background:#161b22;border:1px solid #30363d;border-radius:6px;padding:14px;font-family:monospace;font-size:0.88em;overflow-x:auto;color:#a5d6ff;margin-top:8px}
    .contracts{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    .card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:14px}
    .card .label{color:#8b949e;font-size:0.85em;text-transform:uppercase;letter-spacing:0.05em}
    .card .val{font-family:monospace;color:#58a6ff;font-size:0.88em;word-break:break-all;margin-top:4px}
    .chat-demo{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:20px}
    .chat-input{display:flex;gap:10px;margin-bottom:16px}
    .chat-input input{flex:1;background:#0d1117;border:1px solid #30363d;color:#e6edf3;padding:10px 14px;border-radius:6px;font-size:0.95em;outline:none}
    .chat-input input:focus{border-color:#58a6ff}
    .chat-input button{background:#1f6feb;color:#fff;border:none;padding:10px 20px;border-radius:6px;cursor:pointer;font-size:0.95em}
    .chat-input button:hover{background:#388bfd}
    .response-box{background:#0d1117;border:1px solid #21262d;border-radius:6px;padding:14px;min-height:60px;font-size:0.9em;color:#8b949e}
    .response-box.loaded{color:#e6edf3}
    .suggestions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
    .chip{background:#21262d;color:#8b949e;border:1px solid #30363d;padding:4px 12px;border-radius:12px;font-size:0.82em;cursor:pointer}
    .chip:hover{background:#30363d;color:#e6edf3}
    @media(max-width:600px){.contracts{grid-template-columns:1fr}}
  </style>
</head>
<body>
<div class="header">
  <h1>HACP API <span class="badge">TESTNET LIVE</span></h1>
  <div class="subtitle">Hedera Agent Commerce Protocol — Live Demo</div>
</div>
<div class="container">

  <div class="section">
    <h2>Try the Chat Interface</h2>
    <div class="chat-demo">
      <div class="chat-input">
        <input type="text" id="chatInput" placeholder="Ask anything... e.g. 'What agents are available?'" />
        <button onclick="sendChat()">Ask</button>
      </div>
      <div class="response-box" id="chatResponse">Ask anything about the HACP protocol, agents, or jobs...</div>
      <div class="suggestions" id="suggestions">
        <span class="chip" onclick="ask('What agents are available?')">What agents are available?</span>
        <span class="chip" onclick="ask('Find me a smart-contract-audit agent')">Find an audit agent</span>
        <span class="chip" onclick="ask('What jobs are open?')">What jobs are open?</span>
        <span class="chip" onclick="ask('Tell me about the protocol')">About HACP</span>
        <span class="chip" onclick="ask('Show me job 1')">Show job #1</span>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>REST Endpoints</h2>
    <div class="endpoint">
      <span class="method get">GET</span><span class="path">/health</span>
      <div class="desc">Server health, live agent + job counts, and contract addresses</div>
    </div>
    <div class="endpoint">
      <span class="method get">GET</span><span class="path">/agents</span>
      <div class="desc">List active agents sorted by reputation. Query: <code>?capability=smart-contract-audit</code>, <code>?limit=20</code>, <code>?offset=0</code></div>
    </div>
    <div class="endpoint">
      <span class="method get">GET</span><span class="path">/agents/:address</span>
      <div class="desc">Get a specific agent by EVM wallet address</div>
    </div>
    <div class="endpoint">
      <span class="method get">GET</span><span class="path">/jobs</span>
      <div class="desc">List all jobs. Query: <code>?status=open</code> or <code>?status=completed</code></div>
    </div>
    <div class="endpoint">
      <span class="method get">GET</span><span class="path">/jobs/:id</span>
      <div class="desc">Get a specific job by numeric ID</div>
    </div>
    <div class="endpoint">
      <span class="method post">POST</span><span class="path">/chat</span>
      <div class="desc">Natural language query — parse and route to on-chain data</div>
      <pre>POST /chat
Content-Type: application/json

{ "message": "find me a smart-contract-audit agent" }

→ {
    "reply": "Found 2 active agents with smart-contract-audit capability.",
    "data": { "agents": [...], "total": 2 },
    "intent": "find_by_capability",
    "suggestions": [...]
  }</pre>
    </div>
  </div>

  <div class="section">
    <h2>Deployed Contracts</h2>
    <div class="contracts">
      <div class="card"><div class="label">AgentRegistry</div><div class="val">${REGISTRY_ADDRESS}</div></div>
      <div class="card"><div class="label">JobEscrow</div><div class="val">${ESCROW_ADDRESS}</div></div>
      <div class="card"><div class="label">Network</div><div class="val">Hedera Testnet</div></div>
      <div class="card"><div class="label">HashScan</div><div class="val"><a href="https://hashscan.io/testnet/contract/${REGISTRY_ADDRESS.toLowerCase()}" style="color:#58a6ff">View Registry on HashScan</a></div></div>
    </div>
  </div>

</div>
<script>
async function sendChat() {
  const input = document.getElementById('chatInput');
  const resp = document.getElementById('chatResponse');
  const sugg = document.getElementById('suggestions');
  const msg = input.value.trim();
  if (!msg) return;
  resp.className = 'response-box';
  resp.textContent = 'Querying Hedera testnet...';
  sugg.innerHTML = '';
  try {
    const r = await fetch('/chat', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({message: msg})
    });
    const d = await r.json();
    resp.className = 'response-box loaded';
    resp.textContent = d.reply;
    if (d.suggestions && d.suggestions.length) {
      sugg.innerHTML = d.suggestions.map(s =>
        '<span class="chip" onclick="ask(' + JSON.stringify(s) + ')">' + s + '</span>'
      ).join('');
    }
  } catch(e) {
    resp.className = 'response-box loaded';
    resp.textContent = 'Error: ' + e.message;
  }
}
function ask(q) { document.getElementById('chatInput').value = q; sendChat(); }
document.getElementById('chatInput').addEventListener('keydown', e => { if(e.key==='Enter') sendChat(); });
</script>
</body>
</html>`);
});

// ============ GET /health ============

app.get("/health", async (_req: Request, res: Response) => {
  try {
    const [totalAgents, totalJobs] = await Promise.all([
      registry.totalAgents().then(Number),
      escrow.totalJobs().then(Number),
    ]);
    const { activeTotal } = await fetchTopAgents(0, 1);
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      network: "hedera_testnet",
      rpcUrl: HEDERA_RPC_URL,
      contracts: {
        registry: REGISTRY_ADDRESS,
        escrow: ESCROW_ADDRESS,
      },
      stats: {
        totalAgents,
        activeAgents: activeTotal,
        totalJobs,
      },
    });
  } catch (err) {
    res.status(503).json({
      status: "degraded",
      error: (err as Error).message,
      contracts: { registry: REGISTRY_ADDRESS, escrow: ESCROW_ADDRESS },
    });
  }
});

// ============ GET /agents ============

app.get("/agents", async (req: Request, res: Response) => {
  try {
    const capability = req.query.capability as string | undefined;
    const limit = Math.min(parseInt((req.query.limit as string) || "50"), 100);
    const offset = parseInt((req.query.offset as string) || "0");

    if (capability) {
      const [results, total] = await registry.findByCapability(capability, offset, limit);
      const agents = Array.from(results as ethers.Result[]).map(formatAgent);
      res.json({ agents, total: Number(total), capability, offset, limit });
      return;
    }

    const totalRegistered = Number(await registry.totalAgents());
    const [results, activeTotal] = await registry.getTopAgents(offset, limit);
    const agents = Array.from(results as ethers.Result[]).map(formatAgent);
    res.json({
      agents,
      total: totalRegistered,
      activeTotal: Number(activeTotal),
      offset,
      limit,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ============ GET /agents/:address ============

app.get("/agents/:address", async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    if (!ethers.isAddress(address)) {
      res.status(400).json({ error: "Invalid Ethereum address" });
      return;
    }
    const raw = await registry.getAgent(address);
    const agent = formatAgent(raw);
    if (!agent.wallet || agent.wallet === ethers.ZeroAddress) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    res.json({ agent });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("not found") || msg.includes("revert") || msg.includes("Not registered")) {
      res.status(404).json({ error: "Agent not found" });
    } else {
      res.status(500).json({ error: msg });
    }
  }
});

// ============ GET /jobs ============

app.get("/jobs", async (req: Request, res: Response) => {
  try {
    const statusFilter = req.query.status as string | undefined;
    const limit = Math.min(parseInt((req.query.limit as string) || "50"), 100);
    const total = Number(await escrow.totalJobs());

    if (total === 0) {
      res.json({ jobs: [], total: 0 });
      return;
    }

    const jobIds = Array.from({ length: Math.min(total, limit) }, (_, i) => i + 1);
    const jobs = await Promise.all(
      jobIds.map(async (id) => {
        try {
          const raw = await escrow.getJob(id);
          return formatJob(raw);
        } catch {
          return null;
        }
      })
    );
    const valid = jobs.filter(Boolean) as ReturnType<typeof formatJob>[];

    const filtered = statusFilter
      ? valid.filter(
          (j) =>
            j.statusLabel.toLowerCase() === statusFilter.toLowerCase() ||
            j.status === parseInt(statusFilter)
        )
      : valid;

    res.json({ jobs: filtered, total, returned: filtered.length });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ============ GET /jobs/:id ============

app.get("/jobs/:id", async (req: Request, res: Response) => {
  try {
    const jobId = parseInt(req.params.id);
    if (isNaN(jobId) || jobId < 1) {
      res.status(400).json({ error: "Job ID must be a positive integer" });
      return;
    }
    const raw = await escrow.getJob(jobId);
    const job = formatJob(raw);
    if (job.id === 0) {
      res.status(404).json({ error: `Job #${jobId} not found` });
      return;
    }
    res.json({ job });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("not found") || msg.includes("revert")) {
      res.status(404).json({ error: `Job #${req.params.id} not found` });
    } else {
      res.status(500).json({ error: msg });
    }
  }
});

// ============ POST /chat ============

app.post("/chat", async (req: Request, res: Response) => {
  try {
    const message: string =
      req.body?.message || req.body?.query || req.body?.text || "";
    if (!message || typeof message !== "string") {
      res.status(400).json({
        error: 'Request body must include a "message" or "query" string field',
      });
      return;
    }
    if (message.length > 500) {
      res.status(400).json({ error: "Message too long (max 500 characters)" });
      return;
    }
    const result = await handleChat(message);
    res.json(result);
  } catch (err) {
    res.status(500).json({
      intent: "error",
      reply: `Sorry, I encountered an error: ${(err as Error).message}`,
      data: null,
      suggestions: [
        "List all agents",
        "What jobs are available?",
        "Tell me about the protocol",
      ],
    });
  }
});

// ============ 404 handler ============

app.use((_req: Request, res: Response) => {
  res.status(404).json({
    error: "Not found",
    availableRoutes: [
      "GET /",
      "GET /health",
      "GET /agents",
      "GET /agents/:address",
      "GET /jobs",
      "GET /jobs/:id",
      "POST /chat",
    ],
  });
});

// ============ Start Server ============

app.listen(PORT, () => {
  console.log(`HACP API server running on http://localhost:${PORT}`);
  console.log(`  Registry : ${REGISTRY_ADDRESS}`);
  console.log(`  Escrow   : ${ESCROW_ADDRESS}`);
  console.log(`  RPC      : ${HEDERA_RPC_URL}`);
  console.log(`  Docs     : http://localhost:${PORT}/`);
});

export default app;
