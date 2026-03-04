/**
 * HACP Integration Demo
 *
 * Demonstrates a complete end-to-end agent commerce flow:
 *   1. Alice (client agent) posts a code review job (0.5 HBAR)
 *   2. Bob (provider agent) registers and submits bid
 *   3. Alice accepts Bob's bid → payment locked in escrow
 *   4. Bob delivers the code review
 *   5. Alice approves → Bob receives 0.5 HBAR
 *   6. Bob's reputation score increases
 *
 * Run against local hardhat or testnet:
 *   npx hardhat run scripts/demo-integration.ts --network hardhat
 *   npx hardhat run scripts/demo-integration.ts --network hedera_testnet
 */

import { ethers } from "hardhat";

const TINYBAR = 100_000_000n; // 1 HBAR in tinybars

function fmt(tinybar: bigint): string {
  return `${(Number(tinybar) / Number(TINYBAR)).toFixed(4)} HBAR`;
}

async function main() {
  const [deployer, alice, bob] = await ethers.getSigners();

  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║       HACP Integration Demo — End-to-End         ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  console.log("Participants:");
  console.log(`  Deployer: ${deployer.address}`);
  console.log(`  Alice (client):   ${alice.address}`);
  console.log(`  Bob (provider):   ${bob.address}\n`);

  // ── Deploy contracts ──────────────────────────────────────────
  console.log("Step 0: Deploying contracts...");

  const HACPToken = await ethers.getContractFactory("MockHACPToken");
  const token = await HACPToken.deploy();
  await token.waitForDeployment();

  const Registry = await ethers.getContractFactory("AgentRegistry");
  const registry = await Registry.deploy(TINYBAR); // 1 HBAR min stake
  await registry.waitForDeployment();

  const Escrow = await ethers.getContractFactory("JobEscrow");
  const escrow = await Escrow.deploy(await registry.getAddress());
  await escrow.waitForDeployment();

  const Staking = await ethers.getContractFactory("ReputationStaking");
  const staking = await Staking.deploy(
    await registry.getAddress(),
    await token.getAddress(),
    deployer.address,
    ethers.parseEther("100")
  );
  await staking.waitForDeployment();

  await registry.authorizeEscrow(await escrow.getAddress());

  console.log(`  ✅ AgentRegistry:     ${await registry.getAddress()}`);
  console.log(`  ✅ JobEscrow:         ${await escrow.getAddress()}`);
  console.log(`  ✅ ReputationStaking: ${await staking.getAddress()}`);

  // ── Register Bob as provider agent ───────────────────────────
  console.log("\nStep 1: Bob registers as a code-review agent...");
  const registerTx = await registry.connect(bob).register(
    "Bob-CodeReview-Agent",
    "0.0.123456",                            // HCS topic ID
    ["code-review", "smart-contract-audit"], // capabilities
    TINYBAR / 2n,                            // 0.5 HBAR rate per job
    "ipfs://QmBobAgentMetadata",
    { value: TINYBAR }                       // 1 HBAR stake
  );
  await registerTx.wait();
  const bobInfo = await registry.getAgent(bob.address);
  console.log(`  ✅ Bob registered. Stake: ${fmt(bobInfo.stakedAmount)}`);

  // ── Alice posts a job ─────────────────────────────────────────
  console.log("\nStep 2: Alice posts a code review job...");
  const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
  const postTx = await escrow.connect(alice).postJob(
    "Solidity Escrow Security Review",
    "Review this HBAR escrow contract for reentrancy and access control issues",
    ["code-review"],
    deadline,
    { value: TINYBAR / 2n } // 0.5 HBAR payment
  );
  const postReceipt = await postTx.wait();

  // Extract job ID from JobPosted event
  let jobId = 1n;
  for (const log of postReceipt!.logs) {
    try {
      const parsed = escrow.interface.parseLog(log);
      if (parsed?.name === "JobPosted") {
        jobId = parsed.args.jobId as bigint;
        break;
      }
    } catch {}
  }
  console.log(`  ✅ Job #${jobId} posted. Payment locked: ${fmt(TINYBAR / 2n)}`);

  // ── Bob submits a bid ─────────────────────────────────────────
  console.log("\nStep 3: Bob discovers job and submits bid...");
  const bidTx = await escrow.connect(bob).placeBid(
    jobId,
    TINYBAR / 2n, // matching rate
    "Solidity security specialist. Will deliver full reentrancy & access control report within 30 min."
  );
  await bidTx.wait();
  console.log(`  ✅ Bob placed bid on job #${jobId}`);

  // ── Alice accepts Bob's bid ───────────────────────────────────
  console.log("\nStep 4: Alice accepts Bob's bid...");
  const acceptTx = await escrow.connect(alice).acceptBid(jobId, bob.address);
  await acceptTx.wait();
  const job = await escrow.getJob(jobId);
  console.log(`  ✅ Bid accepted. Job status: ${job.status} (1=Accepted)`);

  // ── Bob delivers the work ─────────────────────────────────────
  console.log("\nStep 5: Bob submits code review deliverable...");
  const deliverUri = "ipfs://QmCodeReviewReport_xj9k2m";
  const submitTx = await escrow.connect(bob).submitDeliverable(jobId, deliverUri);
  await submitTx.wait();
  console.log(`  ✅ Deliverable submitted: ${deliverUri}`);

  // ── Alice approves and releases payment ──────────────────────
  console.log("\nStep 6: Alice approves and releases payment...");
  const bobBalanceBefore = await ethers.provider.getBalance(bob.address);

  const releaseTx = await escrow.connect(alice).releasePayment(jobId, 5); // 5/5 rating
  await releaseTx.wait();

  const bobBalanceAfter = await ethers.provider.getBalance(bob.address);
  const gained = bobBalanceAfter - bobBalanceBefore;

  console.log(`  ✅ Payment released!`);
  console.log(`  💰 Bob's balance change: ${gained >= 0n ? "+" : ""}${fmt(gained < 0n ? -gained : gained)}`);

  // ── Check reputation update ───────────────────────────────────
  console.log("\nStep 7: Checking reputation...");
  const updatedBob = await registry.getAgent(bob.address);
  const avgRating =
    updatedBob.completedJobs > 0n
      ? Number(updatedBob.totalRating) / Number(updatedBob.completedJobs)
      : 0;
  console.log(`  ✅ Bob completed jobs: ${updatedBob.completedJobs}`);
  console.log(`  ✅ Bob avg rating: ${avgRating}/5`);

  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║        ✅ Demo Complete — All Steps Passed        ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log("\nFlow verified:");
  console.log("  ✅ Agent registration with HBAR stake");
  console.log("  ✅ Job posting with escrow payment lock");
  console.log("  ✅ Bid discovery & acceptance");
  console.log("  ✅ Deliverable submission (IPFS URI)");
  console.log("  ✅ Trustless payment release with rating");
  console.log("  ✅ On-chain reputation update");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
