import { expect } from "chai";
import { ethers } from "hardhat";
import { AgentRegistry, JobEscrow } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("JobEscrow", function () {
  let registry: AgentRegistry;
  let escrow: JobEscrow;
  let owner: HardhatEthersSigner;
  let client: HardhatEthersSigner;
  let agent: HardhatEthersSigner;
  let arbitrator: HardhatEthersSigner;
  let other: HardhatEthersSigner;

  const MIN_STAKE = ethers.parseEther("0.01");
  const JOB_PAYMENT = ethers.parseEther("1.0");
  const CAPS = ["code-review"];
  const HCS_TOPIC = "0.0.12345";
  const PROTOCOL_FEE_BPS = 250n; // 2.5%

  async function deployAndRegisterAgent() {
    await registry.connect(agent).register(
      "Agent Smith", HCS_TOPIC, CAPS, ethers.parseEther("0.5"), "ipfs://meta",
      { value: MIN_STAKE }
    );
  }

  async function postJob(deadline?: number) {
    const block = await ethers.provider.getBlock("latest");
    const dl = deadline ?? (block!.timestamp + 86400);
    const tx = await escrow.connect(client).postJob(
      "Code Review", "Review my Solidity contracts", CAPS, dl,
      { value: JOB_PAYMENT }
    );
    const receipt = await tx.wait();
    const event = receipt!.logs.find(
      (l) => escrow.interface.parseLog({ topics: l.topics as string[], data: l.data })?.name === "JobPosted"
    );
    const parsed = escrow.interface.parseLog({ topics: event!.topics as string[], data: event!.data });
    return parsed!.args[0] as bigint;
  }

  async function postAndAccept() {
    const jobId = await postJob();
    await escrow.connect(agent).placeBid(jobId, ethers.parseEther("0.9"), "I'll do it");
    await escrow.connect(client).acceptBid(jobId, agent.address);
    return jobId;
  }

  beforeEach(async function () {
    [owner, client, agent, arbitrator, other] = await ethers.getSigners();

    const RegFactory = await ethers.getContractFactory("AgentRegistry");
    registry = await RegFactory.deploy(MIN_STAKE);
    await registry.waitForDeployment();

    const EscFactory = await ethers.getContractFactory("JobEscrow");
    escrow = await EscFactory.deploy(await registry.getAddress());
    await escrow.waitForDeployment();

    // Authorize escrow on registry
    await registry.connect(owner).authorizeEscrow(await escrow.getAddress());
    await escrow.connect(owner).addArbitrator(arbitrator.address);

    await deployAndRegisterAgent();
  });

  // ============ postJob ============

  describe("postJob()", function () {
    it("creates a job with correct data", async function () {
      const deadline = Math.floor(Date.now() / 1000) + 86400;
      const tx = await escrow.connect(client).postJob(
        "Code Review", "Review my code", CAPS, deadline,
        { value: JOB_PAYMENT }
      );
      await tx.wait();
      const job = await escrow.getJob(1);
      expect(job.client).to.equal(client.address);
      expect(job.payment).to.equal(JOB_PAYMENT);
      expect(job.status).to.equal(0); // Open
      expect(job.title).to.equal("Code Review");
    });

    it("emits JobPosted event", async function () {
      const deadline = Math.floor(Date.now() / 1000) + 86400;
      await expect(
        escrow.connect(client).postJob("Code Review", "desc", CAPS, deadline, { value: JOB_PAYMENT })
      ).to.emit(escrow, "JobPosted")
        .withArgs(1, client.address, JOB_PAYMENT, "Code Review");
    });

    it("reverts with zero payment", async function () {
      const deadline = Math.floor(Date.now() / 1000) + 86400;
      await expect(
        escrow.connect(client).postJob("title", "desc", CAPS, deadline, { value: 0 })
      ).to.be.revertedWithCustomError(escrow, "InsufficientPayment");
    });

    it("reverts with past deadline", async function () {
      const past = Math.floor(Date.now() / 1000) - 1;
      await expect(
        escrow.connect(client).postJob("title", "desc", CAPS, past, { value: JOB_PAYMENT })
      ).to.be.revertedWithCustomError(escrow, "DeadlinePassed");
    });

    it("increments job counter", async function () {
      expect(await escrow.totalJobs()).to.equal(0);
      await postJob();
      expect(await escrow.totalJobs()).to.equal(1);
      await postJob();
      expect(await escrow.totalJobs()).to.equal(2);
    });
  });

  // ============ placeBid ============

  describe("placeBid()", function () {
    it("places a bid successfully", async function () {
      const jobId = await postJob();
      await escrow.connect(agent).placeBid(jobId, ethers.parseEther("0.9"), "Great proposal");
      const bids = await escrow.getBids(jobId);
      expect(bids.length).to.equal(1);
      expect(bids[0].agent).to.equal(agent.address);
      expect(bids[0].proposal).to.equal("Great proposal");
    });

    it("emits BidPlaced event", async function () {
      const jobId = await postJob();
      await expect(
        escrow.connect(agent).placeBid(jobId, ethers.parseEther("0.9"), "proposal")
      ).to.emit(escrow, "BidPlaced")
        .withArgs(jobId, agent.address, ethers.parseEther("0.9"));
    });

    it("reverts for unregistered agent", async function () {
      const jobId = await postJob();
      await expect(
        escrow.connect(other).placeBid(jobId, JOB_PAYMENT, "proposal")
      ).to.be.revertedWithCustomError(escrow, "AgentNotActive");
    });

    it("reverts on duplicate bid", async function () {
      const jobId = await postJob();
      await escrow.connect(agent).placeBid(jobId, JOB_PAYMENT, "first");
      await expect(
        escrow.connect(agent).placeBid(jobId, JOB_PAYMENT, "second")
      ).to.be.revertedWith("Already bid");
    });

    it("reverts on non-open job", async function () {
      const jobId = await postAndAccept();
      await expect(
        escrow.connect(agent).placeBid(jobId, JOB_PAYMENT, "late")
      ).to.be.revertedWithCustomError(escrow, "InvalidStatus");
    });
  });

  // ============ acceptBid ============

  describe("acceptBid()", function () {
    it("accepts a bid and transitions to Accepted", async function () {
      const jobId = await postJob();
      await escrow.connect(agent).placeBid(jobId, JOB_PAYMENT, "proposal");
      await escrow.connect(client).acceptBid(jobId, agent.address);

      const job = await escrow.getJob(jobId);
      expect(job.status).to.equal(1); // Accepted
      expect(job.agent).to.equal(agent.address);
    });

    it("emits BidAccepted event", async function () {
      const jobId = await postJob();
      await escrow.connect(agent).placeBid(jobId, JOB_PAYMENT, "proposal");
      await expect(
        escrow.connect(client).acceptBid(jobId, agent.address)
      ).to.emit(escrow, "BidAccepted")
        .withArgs(jobId, agent.address);
    });

    it("reverts if agent did not bid", async function () {
      const jobId = await postJob();
      await expect(
        escrow.connect(client).acceptBid(jobId, agent.address)
      ).to.be.revertedWithCustomError(escrow, "BidNotFound");
    });

    it("reverts if not client", async function () {
      const jobId = await postJob();
      await escrow.connect(agent).placeBid(jobId, JOB_PAYMENT, "proposal");
      await expect(
        escrow.connect(other).acceptBid(jobId, agent.address)
      ).to.be.revertedWithCustomError(escrow, "NotClient");
    });
  });

  // ============ submitDeliverable ============

  describe("submitDeliverable()", function () {
    it("submits deliverable and transitions to Submitted", async function () {
      const jobId = await postAndAccept();
      await escrow.connect(agent).submitDeliverable(jobId, "ipfs://QmDeliverable");
      const job = await escrow.getJob(jobId);
      expect(job.status).to.equal(2); // Submitted
      expect(job.deliverableUri).to.equal("ipfs://QmDeliverable");
    });

    it("emits JobSubmitted event", async function () {
      const jobId = await postAndAccept();
      await expect(
        escrow.connect(agent).submitDeliverable(jobId, "ipfs://QmDeliverable")
      ).to.emit(escrow, "JobSubmitted")
        .withArgs(jobId, agent.address, "ipfs://QmDeliverable");
    });

    it("reverts if not the agent", async function () {
      const jobId = await postAndAccept();
      await expect(
        escrow.connect(client).submitDeliverable(jobId, "ipfs://fake")
      ).to.be.revertedWithCustomError(escrow, "NotAgent");
    });

    it("reverts when trying to re-submit on Submitted job", async function () {
      const jobId = await postAndAccept();
      await escrow.connect(agent).submitDeliverable(jobId, "ipfs://first");
      // Job is now Submitted, agent tries to submit again — status is no longer Accepted
      await expect(
        escrow.connect(agent).submitDeliverable(jobId, "ipfs://second")
      ).to.be.revertedWithCustomError(escrow, "InvalidStatus");
    });
  });

  // ============ releasePayment ============

  describe("releasePayment()", function () {
    it("releases payment to agent minus protocol fee", async function () {
      const jobId = await postAndAccept();
      await escrow.connect(agent).submitDeliverable(jobId, "ipfs://done");

      const agentBefore = await ethers.provider.getBalance(agent.address);
      const tx = await escrow.connect(client).releasePayment(jobId, 5);
      const receipt = await tx.wait();

      const agentAfter = await ethers.provider.getBalance(agent.address);
      const fee = (JOB_PAYMENT * PROTOCOL_FEE_BPS) / 10000n;
      const expected = JOB_PAYMENT - fee;

      expect(agentAfter - agentBefore).to.be.closeTo(expected, ethers.parseEther("0.001"));
      expect(await escrow.accumulatedFees()).to.equal(fee);
    });

    it("marks job as Completed", async function () {
      const jobId = await postAndAccept();
      await escrow.connect(agent).submitDeliverable(jobId, "ipfs://done");
      await escrow.connect(client).releasePayment(jobId, 4);
      const job = await escrow.getJob(jobId);
      expect(job.status).to.equal(3); // Completed
      expect(job.clientRating).to.equal(4);
    });

    it("emits JobCompleted event", async function () {
      const jobId = await postAndAccept();
      await escrow.connect(agent).submitDeliverable(jobId, "ipfs://done");
      const fee = (JOB_PAYMENT * PROTOCOL_FEE_BPS) / 10000n;
      await expect(
        escrow.connect(client).releasePayment(jobId, 5)
      ).to.emit(escrow, "JobCompleted")
        .withArgs(jobId, agent.address, JOB_PAYMENT - fee, 5);
    });

    it("records job completion on registry", async function () {
      const jobId = await postAndAccept();
      await escrow.connect(agent).submitDeliverable(jobId, "ipfs://done");
      await escrow.connect(client).releasePayment(jobId, 5);
      const agentData = await registry.getAgent(agent.address);
      expect(agentData.completedJobs).to.equal(1);
    });

    it("reverts for invalid rating (0)", async function () {
      const jobId = await postAndAccept();
      await escrow.connect(agent).submitDeliverable(jobId, "ipfs://done");
      await expect(
        escrow.connect(client).releasePayment(jobId, 0)
      ).to.be.revertedWith("Rating must be 1-5");
    });

    it("reverts if not client", async function () {
      const jobId = await postAndAccept();
      await escrow.connect(agent).submitDeliverable(jobId, "ipfs://done");
      await expect(
        escrow.connect(other).releasePayment(jobId, 5)
      ).to.be.revertedWithCustomError(escrow, "NotClient");
    });
  });

  // ============ cancelJob ============

  describe("cancelJob()", function () {
    it("cancels open job and refunds client", async function () {
      const jobId = await postJob();
      const before = await ethers.provider.getBalance(client.address);
      const tx = await escrow.connect(client).cancelJob(jobId);
      const receipt = await tx.wait();
      const gasCost = receipt!.gasUsed * tx.gasPrice!;
      const after = await ethers.provider.getBalance(client.address);
      expect(after).to.be.closeTo(before + JOB_PAYMENT - gasCost, ethers.parseEther("0.001"));
    });

    it("emits JobCancelled event", async function () {
      const jobId = await postJob();
      await expect(
        escrow.connect(client).cancelJob(jobId)
      ).to.emit(escrow, "JobCancelled")
        .withArgs(jobId, client.address, JOB_PAYMENT);
    });

    it("reverts on non-open job", async function () {
      const jobId = await postAndAccept();
      await expect(
        escrow.connect(client).cancelJob(jobId)
      ).to.be.revertedWithCustomError(escrow, "InvalidStatus");
    });
  });

  // ============ raiseDispute ============

  describe("raiseDispute()", function () {
    it("transitions to Disputed within window", async function () {
      const jobId = await postAndAccept();
      await escrow.connect(agent).submitDeliverable(jobId, "ipfs://bad");
      await escrow.connect(client).raiseDispute(jobId, "Work is incomplete");
      const job = await escrow.getJob(jobId);
      expect(job.status).to.equal(4); // Disputed
      expect(job.disputeReason).to.equal("Work is incomplete");
    });

    it("reverts after dispute window", async function () {
      const jobId = await postAndAccept();
      await escrow.connect(agent).submitDeliverable(jobId, "ipfs://done");
      await time.increase(4 * 24 * 60 * 60); // 4 days > 3 day window
      await expect(
        escrow.connect(client).raiseDispute(jobId, "late")
      ).to.be.revertedWithCustomError(escrow, "DisputeWindowClosed");
    });

    it("reverts if not client", async function () {
      const jobId = await postAndAccept();
      await escrow.connect(agent).submitDeliverable(jobId, "ipfs://done");
      await expect(
        escrow.connect(other).raiseDispute(jobId, "fake")
      ).to.be.revertedWithCustomError(escrow, "NotClient");
    });
  });

  // ============ autoRelease ============

  describe("autoRelease()", function () {
    it("auto-releases after dispute window expires", async function () {
      const jobId = await postAndAccept();
      await escrow.connect(agent).submitDeliverable(jobId, "ipfs://done");

      await time.increase(4 * 24 * 60 * 60); // 4 days

      const agentBefore = await ethers.provider.getBalance(agent.address);
      await escrow.connect(other).autoRelease(jobId); // anyone can trigger
      const agentAfter = await ethers.provider.getBalance(agent.address);

      const fee = (JOB_PAYMENT * PROTOCOL_FEE_BPS) / 10000n;
      expect(agentAfter - agentBefore).to.be.closeTo(JOB_PAYMENT - fee, ethers.parseEther("0.001"));
    });

    it("reverts if window still open", async function () {
      const jobId = await postAndAccept();
      await escrow.connect(agent).submitDeliverable(jobId, "ipfs://done");
      await expect(
        escrow.connect(other).autoRelease(jobId)
      ).to.be.revertedWith("Dispute window still open");
    });
  });

  // ============ resolveDispute ============

  describe("resolveDispute()", function () {
    async function setupDispute() {
      const jobId = await postAndAccept();
      await escrow.connect(agent).submitDeliverable(jobId, "ipfs://partial");
      await escrow.connect(client).raiseDispute(jobId, "Incomplete work");
      return jobId;
    }

    it("splits payment 50/50", async function () {
      const jobId = await setupDispute();
      const agentBefore = await ethers.provider.getBalance(agent.address);
      const clientBefore = await ethers.provider.getBalance(client.address);

      await escrow.connect(arbitrator).resolveDispute(jobId, 5000, 3); // 50% agent

      const fee = (JOB_PAYMENT * PROTOCOL_FEE_BPS) / 10000n;
      const net = JOB_PAYMENT - fee;
      const agentShare = net / 2n;
      const clientShare = net - agentShare;

      const agentAfter = await ethers.provider.getBalance(agent.address);
      const clientAfter = await ethers.provider.getBalance(client.address);

      expect(agentAfter - agentBefore).to.be.closeTo(agentShare, ethers.parseEther("0.001"));
      expect(clientAfter - clientBefore).to.be.closeTo(clientShare, ethers.parseEther("0.001"));
    });

    it("gives all to client (0% agent)", async function () {
      const jobId = await setupDispute();
      const clientBefore = await ethers.provider.getBalance(client.address);
      await escrow.connect(arbitrator).resolveDispute(jobId, 0, 0); // 0% agent
      const fee = (JOB_PAYMENT * PROTOCOL_FEE_BPS) / 10000n;
      const net = JOB_PAYMENT - fee;
      const clientAfter = await ethers.provider.getBalance(client.address);
      expect(clientAfter - clientBefore).to.be.closeTo(net, ethers.parseEther("0.001"));
    });

    it("reverts if not arbitrator", async function () {
      const jobId = await setupDispute();
      await expect(
        escrow.connect(other).resolveDispute(jobId, 5000, 3)
      ).to.be.revertedWithCustomError(escrow, "NotArbitrator");
    });

    it("reverts on non-disputed job", async function () {
      const jobId = await postAndAccept();
      await expect(
        escrow.connect(arbitrator).resolveDispute(jobId, 5000, 3)
      ).to.be.revertedWithCustomError(escrow, "InvalidStatus");
    });
  });

  // ============ Admin ============

  describe("setProtocolFee()", function () {
    it("updates protocol fee", async function () {
      await escrow.connect(owner).setProtocolFee(500); // 5%
      expect(await escrow.protocolFeeBps()).to.equal(500);
    });

    it("reverts above 10%", async function () {
      await expect(
        escrow.connect(owner).setProtocolFee(1001)
      ).to.be.revertedWith("Max 10%");
    });
  });

  describe("withdrawFees()", function () {
    it("withdraws accumulated fees", async function () {
      const jobId = await postAndAccept();
      await escrow.connect(agent).submitDeliverable(jobId, "ipfs://done");
      await escrow.connect(client).releasePayment(jobId, 5);

      const fee = await escrow.accumulatedFees();
      const before = await ethers.provider.getBalance(owner.address);
      const tx = await escrow.connect(owner).withdrawFees(owner.address);
      const receipt = await tx.wait();
      const gasCost = receipt!.gasUsed * tx.gasPrice!;
      const after = await ethers.provider.getBalance(owner.address);

      expect(after).to.be.closeTo(before + fee - gasCost, ethers.parseEther("0.001"));
      expect(await escrow.accumulatedFees()).to.equal(0);
    });
  });

  // ============ View Functions ============

  describe("getClientJobs() / getAgentJobs()", function () {
    it("tracks jobs by client", async function () {
      await postJob();
      await postJob();
      const jobs = await escrow.getClientJobs(client.address);
      expect(jobs.length).to.equal(2);
      expect(jobs[0]).to.equal(1);
      expect(jobs[1]).to.equal(2);
    });

    it("tracks jobs by agent after acceptance", async function () {
      const jobId = await postAndAccept();
      const jobs = await escrow.getAgentJobs(agent.address);
      expect(jobs.length).to.equal(1);
      expect(jobs[0]).to.equal(jobId);
    });
  });

  describe("getJob()", function () {
    it("reverts for non-existent job", async function () {
      await expect(
        escrow.getJob(999)
      ).to.be.revertedWithCustomError(escrow, "JobNotFound");
    });
  });
});
