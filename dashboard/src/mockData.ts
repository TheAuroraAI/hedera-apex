/**
 * Demo mode mock data for HACP dashboard.
 * Used when contracts are not yet deployed (addresses = 0x000...000).
 */
import type { Agent, Job } from "./types";

export const DEMO_MODE = true;

export const MOCK_AGENTS: Agent[] = [
  {
    wallet: "0xAurora1111111111111111111111111111111111",
    name: "Aurora-CodeReview",
    hcsTopicId: "0.0.1234567",
    capabilities: ["code-review", "smart-contract-audit", "solidity"],
    ratePerJob: BigInt("500000000000000000"), // 0.5 HBAR
    stakedAmount: BigInt("10000000000000000000"), // 10 HBAR
    completedJobs: BigInt(47),
    totalRating: BigInt(235), // 47 jobs × ~5 stars
    status: 1,
  },
  {
    wallet: "0xNexus222222222222222222222222222222222222",
    name: "Nexus-DataAnalyst",
    hcsTopicId: "0.0.2345678",
    capabilities: ["data-analysis", "python", "ml-inference"],
    ratePerJob: BigInt("300000000000000000"), // 0.3 HBAR
    stakedAmount: BigInt("5000000000000000000"), // 5 HBAR
    completedJobs: BigInt(31),
    totalRating: BigInt(148),
    status: 1,
  },
  {
    wallet: "0xForge3333333333333333333333333333333333",
    name: "Forge-SolidityDev",
    hcsTopicId: "0.0.3456789",
    capabilities: ["smart-contract-dev", "solidity", "defi"],
    ratePerJob: BigInt("1000000000000000000"), // 1.0 HBAR
    stakedAmount: BigInt("25000000000000000000"), // 25 HBAR
    completedJobs: BigInt(89),
    totalRating: BigInt(436),
    status: 1,
  },
  {
    wallet: "0xSage44444444444444444444444444444444444",
    name: "Sage-TechnicalWriter",
    hcsTopicId: "0.0.4567890",
    capabilities: ["technical-writing", "documentation", "markdown"],
    ratePerJob: BigInt("200000000000000000"), // 0.2 HBAR
    stakedAmount: BigInt("3000000000000000000"), // 3 HBAR
    completedJobs: BigInt(23),
    totalRating: BigInt(112),
    status: 1,
  },
  {
    wallet: "0xOrbit5555555555555555555555555555555555",
    name: "Orbit-SecurityAuditor",
    hcsTopicId: "0.0.5678901",
    capabilities: ["security-audit", "fuzzing", "invariant-testing"],
    ratePerJob: BigInt("2000000000000000000"), // 2.0 HBAR
    stakedAmount: BigInt("50000000000000000000"), // 50 HBAR
    completedJobs: BigInt(12),
    totalRating: BigInt(60),
    status: 1,
  },
];

export const MOCK_JOBS: Job[] = [
  {
    id: BigInt(1),
    client: "0xClient111111111111111111111111111111111",
    agent: "0x0000000000000000000000000000000000000000",
    title: "Audit 300-line DeFi staking contract",
    description:
      "Review a staking contract for a new Hedera DeFi protocol. Check for reentrancy, overflow, access control issues.",
    requiredCaps: ["security-audit", "solidity"],
    payment: BigInt("5000000000000000000"), // 5 HBAR
    deadline: BigInt(Math.floor(Date.now() / 1000) + 86400 * 3),
    status: 0, // Open
    deliverableUri: "",
    clientRating: 0,
  },
  {
    id: BigInt(2),
    client: "0xClient222222222222222222222222222222222",
    agent: "0xForge3333333333333333333333333333333333",
    title: "Build NFT minting contract for Hedera",
    description:
      "Deploy an HTS-compatible NFT collection with on-chain royalties and metadata. 10K supply.",
    requiredCaps: ["smart-contract-dev", "solidity"],
    payment: BigInt("3000000000000000000"), // 3 HBAR
    deadline: BigInt(Math.floor(Date.now() / 1000) + 86400 * 7),
    status: 1, // Accepted
    deliverableUri: "",
    clientRating: 0,
  },
  {
    id: BigInt(3),
    client: "0xClient333333333333333333333333333333333",
    agent: "0xNexus222222222222222222222222222222222222",
    title: "Analyze on-chain transaction patterns",
    description:
      "Pull 90 days of HCS data, identify whale wallets, cluster by behavior, produce a report.",
    requiredCaps: ["data-analysis", "python"],
    payment: BigInt("1500000000000000000"), // 1.5 HBAR
    deadline: BigInt(Math.floor(Date.now() / 1000) + 86400 * 5),
    status: 2, // Submitted
    deliverableUri: "hcs://0.0.9876543/report-v1",
    clientRating: 0,
  },
  {
    id: BigInt(4),
    client: "0xClient444444444444444444444444444444444",
    agent: "0xSage44444444444444444444444444444444444",
    title: "Write developer documentation for Hedera SDK",
    description:
      "Create comprehensive docs with code examples for the HACP TypeScript SDK.",
    requiredCaps: ["technical-writing", "documentation"],
    payment: BigInt("800000000000000000"), // 0.8 HBAR
    deadline: BigInt(Math.floor(Date.now() / 1000) - 86400), // past deadline
    status: 3, // Released
    deliverableUri: "hcs://0.0.8765432/docs-v2",
    clientRating: 5,
  },
  {
    id: BigInt(5),
    client: "0xClient555555555555555555555555555555555",
    agent: "0x0000000000000000000000000000000000000000",
    title: "Integrate Hedera HCS messaging into React dApp",
    description:
      "Add real-time HCS message subscription to existing React app. Mirror node + WebSocket.",
    requiredCaps: ["smart-contract-dev", "defi"],
    payment: BigInt("2500000000000000000"), // 2.5 HBAR
    deadline: BigInt(Math.floor(Date.now() / 1000) + 86400 * 14),
    status: 0, // Open
    deliverableUri: "",
    clientRating: 0,
  },
];
