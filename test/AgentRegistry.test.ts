import { expect } from "chai";
import { ethers } from "hardhat";
import { AgentRegistry } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("AgentRegistry", function () {
  let registry: AgentRegistry;
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let charlie: HardhatEthersSigner;

  const MIN_STAKE = ethers.parseEther("0.01"); // 10 tinybar equivalent (use ETH in tests)
  const CAPS = ["code-review", "smart-contract-audit"];
  const RATE = ethers.parseEther("0.5");
  const HCS_TOPIC = "0.0.12345";
  const META_URI = "ipfs://QmTest1234";

  beforeEach(async function () {
    [owner, alice, bob, charlie] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("AgentRegistry");
    registry = await Factory.deploy(MIN_STAKE);
    await registry.waitForDeployment();
  });

  // ============ Registration ============

  describe("register()", function () {
    it("registers a new agent with correct data", async function () {
      await registry.connect(alice).register(
        "Alice Agent", HCS_TOPIC, CAPS, RATE, META_URI,
        { value: MIN_STAKE }
      );
      const agent = await registry.getAgent(alice.address);
      expect(agent.name).to.equal("Alice Agent");
      expect(agent.wallet).to.equal(alice.address);
      expect(agent.hcsTopicId).to.equal(HCS_TOPIC);
      expect(agent.capabilities).to.deep.equal(CAPS);
      expect(agent.ratePerJob).to.equal(RATE);
      expect(agent.status).to.equal(1); // Active
      expect(agent.completedJobs).to.equal(0);
    });

    it("emits AgentRegistered event", async function () {
      await expect(
        registry.connect(alice).register("Alice Agent", HCS_TOPIC, CAPS, RATE, META_URI, { value: MIN_STAKE })
      ).to.emit(registry, "AgentRegistered")
        .withArgs(alice.address, "Alice Agent", CAPS, MIN_STAKE - (MIN_STAKE * 100n / 10000n));
    });

    it("deducts protocol fee (1%) from stake", async function () {
      const stake = MIN_STAKE * 2n;
      await registry.connect(alice).register("Alice", HCS_TOPIC, CAPS, RATE, META_URI, { value: stake });
      const agent = await registry.getAgent(alice.address);
      const expectedStake = stake - (stake * 100n / 10000n);
      expect(agent.stakedAmount).to.equal(expectedStake);
    });

    it("reverts on duplicate registration", async function () {
      await registry.connect(alice).register("Alice", HCS_TOPIC, CAPS, RATE, META_URI, { value: MIN_STAKE });
      await expect(
        registry.connect(alice).register("Alice2", HCS_TOPIC, CAPS, RATE, META_URI, { value: MIN_STAKE })
      ).to.be.revertedWithCustomError(registry, "AlreadyRegistered");
    });

    it("reverts if stake is below minimum", async function () {
      await expect(
        registry.connect(alice).register("Alice", HCS_TOPIC, CAPS, RATE, META_URI, { value: MIN_STAKE - 1n })
      ).to.be.revertedWithCustomError(registry, "InsufficientStake");
    });

    it("reverts with empty capabilities", async function () {
      await expect(
        registry.connect(alice).register("Alice", HCS_TOPIC, [], RATE, META_URI, { value: MIN_STAKE })
      ).to.be.revertedWithCustomError(registry, "ZeroCapabilities");
    });

    it("reverts with more than 20 capabilities", async function () {
      const manyCaps = Array.from({ length: 21 }, (_, i) => `cap-${i}`);
      await expect(
        registry.connect(alice).register("Alice", HCS_TOPIC, manyCaps, RATE, META_URI, { value: MIN_STAKE })
      ).to.be.revertedWithCustomError(registry, "InvalidCapabilities");
    });

    it("indexes by capability", async function () {
      await registry.connect(alice).register("Alice", HCS_TOPIC, CAPS, RATE, META_URI, { value: MIN_STAKE });
      await registry.connect(bob).register("Bob", HCS_TOPIC, ["writing"], RATE, META_URI, { value: MIN_STAKE });

      const [results, total] = await registry.findByCapability("code-review", 0, 10);
      expect(total).to.equal(1);
      expect(results[0].wallet).to.equal(alice.address);
    });

    it("tracks total agents count", async function () {
      expect(await registry.totalAgents()).to.equal(0);
      await registry.connect(alice).register("Alice", HCS_TOPIC, CAPS, RATE, META_URI, { value: MIN_STAKE });
      expect(await registry.totalAgents()).to.equal(1);
      await registry.connect(bob).register("Bob", HCS_TOPIC, CAPS, RATE, META_URI, { value: MIN_STAKE });
      expect(await registry.totalAgents()).to.equal(2);
    });
  });

  // ============ Profile Update ============

  describe("updateProfile()", function () {
    beforeEach(async function () {
      await registry.connect(alice).register("Alice", HCS_TOPIC, CAPS, RATE, META_URI, { value: MIN_STAKE });
    });

    it("updates capabilities and rate", async function () {
      const newCaps = ["writing", "data-analysis"];
      const newRate = ethers.parseEther("1.0");
      await registry.connect(alice).updateProfile(newCaps, newRate, "ipfs://updated");
      const agent = await registry.getAgent(alice.address);
      expect(agent.capabilities).to.deep.equal(newCaps);
      expect(agent.ratePerJob).to.equal(newRate);
    });

    it("updates capability index correctly", async function () {
      const newCaps = ["writing"];
      await registry.connect(alice).updateProfile(newCaps, RATE, META_URI);

      // Old capability removed
      const [oldResults] = await registry.findByCapability("code-review", 0, 10);
      expect(oldResults.length).to.equal(0);

      // New capability added
      const [newResults] = await registry.findByCapability("writing", 0, 10);
      expect(newResults.length).to.equal(1);
    });

    it("reverts for unregistered agent", async function () {
      await expect(
        registry.connect(bob).updateProfile(CAPS, RATE, META_URI)
      ).to.be.revertedWithCustomError(registry, "NotRegistered");
    });

    it("reverts if agent is suspended", async function () {
      await registry.connect(owner).suspendAgent(alice.address, "test");
      await expect(
        registry.connect(alice).updateProfile(CAPS, RATE, META_URI)
      ).to.be.revertedWithCustomError(registry, "AgentSuspendedError");
    });
  });

  // ============ Deregistration ============

  describe("deregister()", function () {
    it("removes agent and returns stake", async function () {
      const stake = MIN_STAKE;
      await registry.connect(alice).register("Alice", HCS_TOPIC, CAPS, RATE, META_URI, { value: stake });
      const agent = await registry.getAgent(alice.address);
      const stakeToReturn = agent.stakedAmount;

      const beforeBalance = await ethers.provider.getBalance(alice.address);
      const tx = await registry.connect(alice).deregister();
      const receipt = await tx.wait();
      const gasCost = receipt!.gasUsed * tx.gasPrice!;
      const afterBalance = await ethers.provider.getBalance(alice.address);

      expect(afterBalance).to.be.closeTo(beforeBalance + stakeToReturn - gasCost, ethers.parseEther("0.001"));
      expect(await registry.isRegistered(alice.address)).to.be.false;
      expect(await registry.totalAgents()).to.equal(0);
    });

    it("removes from capability index", async function () {
      await registry.connect(alice).register("Alice", HCS_TOPIC, CAPS, RATE, META_URI, { value: MIN_STAKE });
      await registry.connect(alice).deregister();
      const [results] = await registry.findByCapability("code-review", 0, 10);
      expect(results.length).to.equal(0);
    });
  });

  // ============ Discovery ============

  describe("findByCapability()", function () {
    beforeEach(async function () {
      await registry.connect(alice).register("Alice", HCS_TOPIC, ["code-review", "audit"], RATE, META_URI, { value: MIN_STAKE });
      await registry.connect(bob).register("Bob", HCS_TOPIC, ["code-review", "writing"], RATE, META_URI, { value: MIN_STAKE });
      await registry.connect(charlie).register("Charlie", HCS_TOPIC, ["writing"], RATE, META_URI, { value: MIN_STAKE });
    });

    it("returns all agents for a capability", async function () {
      const [results, total] = await registry.findByCapability("code-review", 0, 10);
      expect(total).to.equal(2);
      expect(results.length).to.equal(2);
    });

    it("supports pagination with offset", async function () {
      const [results, total] = await registry.findByCapability("code-review", 1, 10);
      expect(total).to.equal(2);
      expect(results.length).to.equal(1);
    });

    it("respects limit", async function () {
      const [results, total] = await registry.findByCapability("code-review", 0, 1);
      expect(total).to.equal(2);
      expect(results.length).to.equal(1);
    });

    it("returns empty for unknown capability", async function () {
      const [results, total] = await registry.findByCapability("quantum-computing", 0, 10);
      expect(total).to.equal(0);
      expect(results.length).to.equal(0);
    });

    it("excludes suspended agents", async function () {
      await registry.connect(owner).suspendAgent(alice.address, "bad actor");
      const [results, total] = await registry.findByCapability("code-review", 0, 10);
      expect(total).to.equal(1);
      expect(results[0].wallet).to.equal(bob.address);
    });
  });

  // ============ Reputation ============

  describe("recordJobCompletion()", function () {
    beforeEach(async function () {
      await registry.connect(alice).register("Alice", HCS_TOPIC, CAPS, RATE, META_URI, { value: MIN_STAKE });
    });

    it("updates completed jobs and rating by owner", async function () {
      await registry.connect(owner).recordJobCompletion(alice.address, 5);
      await registry.connect(owner).recordJobCompletion(alice.address, 3);
      const agent = await registry.getAgent(alice.address);
      expect(agent.completedJobs).to.equal(2);
      expect(await registry.avgRating(alice.address)).to.equal(4); // (5+3)/2
    });

    it("reverts for unregistered agent", async function () {
      await expect(
        registry.connect(owner).recordJobCompletion(bob.address, 5)
      ).to.be.revertedWithCustomError(registry, "NotRegistered");
    });

    it("reverts for invalid rating (0)", async function () {
      await expect(
        registry.connect(owner).recordJobCompletion(alice.address, 0)
      ).to.be.revertedWith("Rating must be 1-5");
    });

    it("reverts for invalid rating (6)", async function () {
      await expect(
        registry.connect(owner).recordJobCompletion(alice.address, 6)
      ).to.be.revertedWith("Rating must be 1-5");
    });
  });

  // ============ Admin ============

  describe("suspendAgent()", function () {
    beforeEach(async function () {
      await registry.connect(alice).register("Alice", HCS_TOPIC, CAPS, RATE, META_URI, { value: MIN_STAKE });
    });

    it("suspends an agent", async function () {
      await registry.connect(owner).suspendAgent(alice.address, "spam");
      const agent = await registry.getAgent(alice.address);
      expect(agent.status).to.equal(2); // Suspended
    });

    it("reinstates a suspended agent", async function () {
      await registry.connect(owner).suspendAgent(alice.address, "test");
      await registry.connect(owner).reinstateAgent(alice.address);
      const agent = await registry.getAgent(alice.address);
      expect(agent.status).to.equal(1); // Active
    });

    it("only owner can suspend", async function () {
      await expect(
        registry.connect(alice).suspendAgent(bob.address, "test")
      ).to.be.reverted;
    });
  });

  describe("setMinStake()", function () {
    it("updates minimum stake", async function () {
      const newMin = ethers.parseEther("0.1");
      await registry.connect(owner).setMinStake(newMin);
      expect(await registry.minStake()).to.equal(newMin);
    });

    it("enforces new minimum on registration", async function () {
      const newMin = ethers.parseEther("0.1");
      await registry.connect(owner).setMinStake(newMin);
      await expect(
        registry.connect(alice).register("Alice", HCS_TOPIC, CAPS, RATE, META_URI, { value: MIN_STAKE })
      ).to.be.revertedWithCustomError(registry, "InsufficientStake");
    });
  });

  describe("withdrawFees()", function () {
    it("withdraws accumulated protocol fees to owner", async function () {
      await registry.connect(alice).register("Alice", HCS_TOPIC, CAPS, RATE, META_URI, { value: MIN_STAKE });
      const fees = await registry.accumulatedFees();
      expect(fees).to.be.gt(0);

      const before = await ethers.provider.getBalance(owner.address);
      const tx = await registry.connect(owner).withdrawFees(owner.address);
      const receipt = await tx.wait();
      const gasCost = receipt!.gasUsed * tx.gasPrice!;
      const after = await ethers.provider.getBalance(owner.address);

      expect(after).to.be.closeTo(before + fees - gasCost, ethers.parseEther("0.0001"));
      expect(await registry.accumulatedFees()).to.equal(0);
    });
  });

  // ============ Pause ============

  describe("pause()", function () {
    it("prevents registration when paused", async function () {
      await registry.connect(owner).pause();
      await expect(
        registry.connect(alice).register("Alice", HCS_TOPIC, CAPS, RATE, META_URI, { value: MIN_STAKE })
      ).to.be.revertedWithCustomError(registry, "EnforcedPause");
    });

    it("allows registration after unpause", async function () {
      await registry.connect(owner).pause();
      await registry.connect(owner).unpause();
      await expect(
        registry.connect(alice).register("Alice", HCS_TOPIC, CAPS, RATE, META_URI, { value: MIN_STAKE })
      ).to.not.be.reverted;
    });
  });

  // ============ getTopAgents ============

  describe("getTopAgents()", function () {
    it("returns agents sorted by reputation", async function () {
      await registry.connect(alice).register("Alice", HCS_TOPIC, CAPS, RATE, META_URI, { value: MIN_STAKE });
      await registry.connect(bob).register("Bob", HCS_TOPIC, CAPS, RATE, META_URI, { value: MIN_STAKE });

      // Alice has 3 completed jobs, Bob has 1
      await registry.connect(owner).recordJobCompletion(alice.address, 5);
      await registry.connect(owner).recordJobCompletion(alice.address, 5);
      await registry.connect(owner).recordJobCompletion(alice.address, 5);
      await registry.connect(owner).recordJobCompletion(bob.address, 5);

      const [results] = await registry.getTopAgents(0, 10);
      expect(results[0].wallet).to.equal(alice.address);
      expect(results[1].wallet).to.equal(bob.address);
    });
  });
});
