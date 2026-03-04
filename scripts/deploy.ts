import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * HACP Deployment Script — Hedera Testnet
 *
 * Deployment order:
 * 1. MockHACPToken (ERC20 for staking)
 * 2. AgentRegistry (minStake: 1 HBAR = 100_000_000 tinybar)
 * 3. JobEscrow (requires registry address)
 * 4. ReputationStaking (requires registry, token, treasury, boostThreshold)
 *
 * After deployment, writes addresses to deployments/testnet.json
 */

const TINYBAR_PER_HBAR = 100_000_000n;
const MIN_STAKE = TINYBAR_PER_HBAR; // 1 HBAR
const BOOST_THRESHOLD = ethers.parseEther("100"); // 100 HACP tokens for reputation boost

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("=== HACP Deployment ===");
  console.log("Network:", (await ethers.provider.getNetwork()).name);
  console.log("Deployer:", deployer.address);
  console.log(
    "Balance:",
    ethers.formatEther(await ethers.provider.getBalance(deployer.address)),
    "HBAR"
  );
  console.log("");

  // 1. Deploy HACP Token (ERC20 for staking)
  console.log("1/4 Deploying MockHACPToken...");
  const HACPToken = await ethers.getContractFactory("MockHACPToken");
  const hacpToken = await HACPToken.deploy();
  await hacpToken.waitForDeployment();
  const hacpTokenAddr = await hacpToken.getAddress();
  console.log(`   ✅ MockHACPToken: ${hacpTokenAddr}`);

  // 2. Deploy AgentRegistry
  console.log("2/4 Deploying AgentRegistry...");
  const AgentRegistry = await ethers.getContractFactory("AgentRegistry");
  const registry = await AgentRegistry.deploy(MIN_STAKE);
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  console.log(`   ✅ AgentRegistry: ${registryAddr}`);

  // 3. Deploy JobEscrow
  console.log("3/4 Deploying JobEscrow...");
  const JobEscrow = await ethers.getContractFactory("JobEscrow");
  const escrow = await JobEscrow.deploy(registryAddr);
  await escrow.waitForDeployment();
  const escrowAddr = await escrow.getAddress();
  console.log(`   ✅ JobEscrow: ${escrowAddr}`);

  // 4. Deploy ReputationStaking
  console.log("4/4 Deploying ReputationStaking...");
  const treasury = deployer.address; // deployer as treasury for demo
  const ReputationStaking = await ethers.getContractFactory("ReputationStaking");
  const staking = await ReputationStaking.deploy(
    registryAddr,
    hacpTokenAddr,
    treasury,
    BOOST_THRESHOLD
  );
  await staking.waitForDeployment();
  const stakingAddr = await staking.getAddress();
  console.log(`   ✅ ReputationStaking: ${stakingAddr}`);

  // Wire contracts: authorize escrow to update registry reputation
  console.log("\nWiring contracts...");
  const tx = await registry.authorizeEscrow(escrowAddr);
  await tx.wait();
  console.log("   ✅ Authorized JobEscrow on AgentRegistry");

  // Write deployment manifest
  const deployments = {
    network: "hedera_testnet",
    chainId: 296,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      HACPToken: hacpTokenAddr,
      AgentRegistry: registryAddr,
      JobEscrow: escrowAddr,
      ReputationStaking: stakingAddr,
    },
    // HCS topic for agent discovery — created separately via Hedera SDK
    hcsTopicId: process.env.HCS_TOPIC_ID || "TBD",
  };

  const deployDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deployDir)) fs.mkdirSync(deployDir, { recursive: true });

  fs.writeFileSync(
    path.join(deployDir, "testnet.json"),
    JSON.stringify(deployments, null, 2)
  );

  console.log("\n=== Deployment Complete ===");
  console.log("Addresses written to deployments/testnet.json");
  console.log("\nSummary:");
  console.log(`  HACPToken:          ${hacpTokenAddr}`);
  console.log(`  AgentRegistry:      ${registryAddr}`);
  console.log(`  JobEscrow:          ${escrowAddr}`);
  console.log(`  ReputationStaking:  ${stakingAddr}`);
  console.log("\nNext: Set HCS_TOPIC_ID env var and update deployments/testnet.json");
}

main().catch((err) => {
  console.error("Deploy failed:", err);
  process.exit(1);
});
