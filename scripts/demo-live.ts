/**
 * HACP Live Testnet Demo - Complete Flow
 * Demonstrates real on-chain interactions with deployed HACP contracts.
 */
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "../deployments/testnet.json"), "utf8"));
  const [deployer] = await ethers.getSigners();
  
  const Registry = await ethers.getContractAt("AgentRegistry", dep.contracts.AgentRegistry);
  const Escrow = await ethers.getContractAt("JobEscrow", dep.contracts.JobEscrow);

  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║       HACP Live Testnet Demo — Aurora Agent      ║");
  console.log("╚══════════════════════════════════════════════════╝\n");
  console.log(`Network: Hedera Testnet (chainId 296)`);
  console.log(`Deployer: ${deployer.address}\n`);
  
  // Read Aurora's registered agent profile
  const agent = await Registry.getAgent(deployer.address);
  console.log("✅ Aurora Agent Profile (on-chain):");
  console.log(`   Name: ${agent.name}`);
  console.log(`   Capabilities: ${agent.capabilities.join(", ")}`);
  console.log(`   Stake: ${agent.stakedAmount.toString()} (wei)`);
  console.log(`   Status: ${agent.status === 0n ? "Active" : "Inactive"}\n`);
  
  // Post a job
  console.log("Posting a code review job...");
  const deadline = Math.floor(Date.now() / 1000) + 86400;
  const jobTx = await Escrow.postJob(
    "DeFi Smart Contract Security Review",
    "Comprehensive security audit of a 400-line Solidity lending protocol. Check for reentrancy, flash loan attacks, and access control issues.",
    ["smart-contract-audit", "code-review"],
    deadline,
    { value: ethers.parseEther("0.5"), gasLimit: 400000 }
  );
  const jobReceipt = await jobTx.wait();
  console.log(`✅ Job posted! TX: ${jobReceipt?.hash}`);
  
  const totalJobs = await Escrow.totalJobs();
  console.log(`   Total jobs on chain: ${totalJobs.toString()}`);
  
  const job = await Escrow.getJob(totalJobs - 1n);
  console.log(`   Job ID: ${(totalJobs - 1n).toString()}`);
  console.log(`   Title: ${job.title}`);
  console.log(`   Status: Open\n`);
  
  console.log("═══════════════════════════════════════════════════");
  console.log("Live on Hedera Testnet — verify on HashScan:");
  console.log(`  AgentRegistry: https://hashscan.io/testnet/contract/${dep.contracts.AgentRegistry}`);
  console.log(`  JobEscrow:     https://hashscan.io/testnet/contract/${dep.contracts.JobEscrow}`);
  console.log(`  HCS Topic:     https://hashscan.io/testnet/topic/${dep.hcsTopicId}`);
  console.log(`  Register TX:   https://hashscan.io/testnet/tx/0xe3f946b530805d6fe272c5c2019292426420fe289cd86afa38046af7c325e37f`);
  console.log(`  Job Post TX:   https://hashscan.io/testnet/tx/${jobReceipt?.hash}`);
}

main().catch(console.error);
