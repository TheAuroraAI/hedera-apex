import { expect } from "chai";
import { ethers, network } from "hardhat";
import {
  AgentRegistry,
  ReputationStaking,
  MockHACPToken,
} from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

const HTS_PRECOMPILE_ADDRESS = "0x0000000000000000000000000000000000000167";

describe("ReputationStaking", function () {
  let registry: AgentRegistry;
  let staking: ReputationStaking;
  let token: MockHACPToken;
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let treasury: HardhatEthersSigner;
  let escrow: HardhatEthersSigner;

  const MIN_STAKE = ethers.parseEther("0.01");
  const BOOST_THRESHOLD = ethers.parseUnits("1000", 0); // 1000 HACP
  const STAKE_AMOUNT = ethers.parseUnits("1000", 0);    // 1000 HACP (= boost threshold)
  const SMALL_STAKE = ethers.parseUnits("100", 0);       // 100 HACP (below boost)

  async function deployMockHTS() {
    const MockHTS = await ethers.getContractFactory("MockHTS");
    const mockHTS = await MockHTS.deploy();
    await mockHTS.waitForDeployment();
    const bytecode = await ethers.provider.getCode(await mockHTS.getAddress());

    await network.provider.send("hardhat_setCode", [
      HTS_PRECOMPILE_ADDRESS,
      bytecode,
    ]);
  }

  async function registerAgent(signer: HardhatEthersSigner) {
    await registry.connect(signer).register(
      "TestAgent",
      "0.0.99999",
      ["code-review"],
      ethers.parseEther("0.1"),
      "ipfs://test",
      { value: MIN_STAKE }
    );
  }

  beforeEach(async function () {
    [owner, alice, bob, treasury, escrow] = await ethers.getSigners();

    // Deploy mock HTS precompile at 0x167
    await deployMockHTS();

    // Deploy AgentRegistry
    const RegistryFactory = await ethers.getContractFactory("AgentRegistry");
    registry = await RegistryFactory.deploy(MIN_STAKE);
    await registry.waitForDeployment();

    // Deploy mock HACP token
    const TokenFactory = await ethers.getContractFactory("MockHACPToken");
    token = await TokenFactory.deploy();
    await token.waitForDeployment();

    // Deploy ReputationStaking
    const StakingFactory = await ethers.getContractFactory("ReputationStaking");
    staking = await StakingFactory.deploy(
      await registry.getAddress(),
      await token.getAddress(),
      await treasury.getAddress(),
      BOOST_THRESHOLD
    );
    await staking.waitForDeployment();

    // Register alice as agent
    await registerAgent(alice);

    // Mint tokens to alice and bob
    await token.mint(alice.address, ethers.parseUnits("10000", 0));
    await token.mint(bob.address, ethers.parseUnits("10000", 0));
  });

  // ============ Deployment ============

  describe("deployment", function () {
    it("sets correct initial values", async function () {
      expect(await staking.boostThreshold()).to.equal(BOOST_THRESHOLD);
      expect(await staking.slashRateBps()).to.equal(1000); // 10%
      expect(await staking.treasury()).to.equal(treasury.address);
      expect(await staking.totalStaked()).to.equal(0);
    });

    it("links to correct registry and token", async function () {
      expect(await staking.registry()).to.equal(await registry.getAddress());
      expect(await staking.hacpToken()).to.equal(await token.getAddress());
    });
  });

  // ============ stake() ============

  describe("stake()", function () {
    it("allows registered agent to stake tokens", async function () {
      await expect(staking.connect(alice).stake(STAKE_AMOUNT))
        .to.emit(staking, "Staked")
        .withArgs(alice.address, STAKE_AMOUNT, STAKE_AMOUNT);

      expect(await staking.stakedAmount(alice.address)).to.equal(STAKE_AMOUNT);
      expect(await staking.totalStaked()).to.equal(STAKE_AMOUNT);
    });

    it("reverts on zero amount", async function () {
      await expect(staking.connect(alice).stake(0)).to.be.revertedWithCustomError(
        staking,
        "ZeroAmount"
      );
    });

    it("reverts if agent not registered", async function () {
      await expect(staking.connect(bob).stake(STAKE_AMOUNT)).to.be.revertedWithCustomError(
        staking,
        "AgentNotRegistered"
      );
    });

    it("accumulates stake on multiple calls", async function () {
      await staking.connect(alice).stake(SMALL_STAKE);
      await staking.connect(alice).stake(SMALL_STAKE);
      expect(await staking.stakedAmount(alice.address)).to.equal(SMALL_STAKE * 2n);
    });
  });

  // ============ unstake() ============

  describe("unstake()", function () {
    beforeEach(async function () {
      await staking.connect(alice).stake(STAKE_AMOUNT);
    });

    it("allows agent to unstake tokens", async function () {
      await expect(staking.connect(alice).unstake(SMALL_STAKE))
        .to.emit(staking, "Unstaked")
        .withArgs(alice.address, SMALL_STAKE, STAKE_AMOUNT - SMALL_STAKE);

      expect(await staking.stakedAmount(alice.address)).to.equal(
        STAKE_AMOUNT - SMALL_STAKE
      );
    });

    it("reverts on zero amount", async function () {
      await expect(staking.connect(alice).unstake(0)).to.be.revertedWithCustomError(
        staking,
        "ZeroAmount"
      );
    });

    it("reverts if amount exceeds stake", async function () {
      const excess = STAKE_AMOUNT + 1n;
      await expect(staking.connect(alice).unstake(excess)).to.be.revertedWithCustomError(
        staking,
        "InsufficientStake"
      );
    });

    it("decreases totalStaked", async function () {
      await staking.connect(alice).unstake(SMALL_STAKE);
      expect(await staking.totalStaked()).to.equal(STAKE_AMOUNT - SMALL_STAKE);
    });
  });

  // ============ isBoosted() / reputationMultiplier() ============

  describe("boost + reputation multiplier", function () {
    it("not boosted with no stake", async function () {
      expect(await staking.isBoosted(alice.address)).to.equal(false);
    });

    it("not boosted below threshold", async function () {
      await staking.connect(alice).stake(SMALL_STAKE);
      expect(await staking.isBoosted(alice.address)).to.equal(false);
    });

    it("boosted at or above threshold", async function () {
      await staking.connect(alice).stake(BOOST_THRESHOLD);
      expect(await staking.isBoosted(alice.address)).to.equal(true);
    });

    it("returns base multiplier (100) with no stake", async function () {
      expect(await staking.reputationMultiplier(alice.address)).to.equal(100);
    });

    it("returns 120 (1.2x) below boost threshold", async function () {
      await staking.connect(alice).stake(SMALL_STAKE);
      expect(await staking.reputationMultiplier(alice.address)).to.equal(120);
    });

    it("returns 150 (1.5x) at boost threshold", async function () {
      await staking.connect(alice).stake(BOOST_THRESHOLD);
      expect(await staking.reputationMultiplier(alice.address)).to.equal(150);
    });

    it("returns 200 (2.0x) at 5x threshold", async function () {
      await staking.connect(alice).stake(BOOST_THRESHOLD * 5n);
      expect(await staking.reputationMultiplier(alice.address)).to.equal(200);
    });

    it("returns 300 (3.0x) at 20x+ threshold", async function () {
      await staking.connect(alice).stake(BOOST_THRESHOLD * 20n);
      expect(await staking.reputationMultiplier(alice.address)).to.equal(300);
    });
  });

  // ============ lockStake() / unlockStake() ============

  describe("lockStake() / unlockStake()", function () {
    beforeEach(async function () {
      await staking.connect(alice).stake(STAKE_AMOUNT);
      await staking.connect(owner).authorizeEscrow(escrow.address);
    });

    it("locks stake for a job", async function () {
      await expect(staking.connect(escrow).lockStake(alice.address, 1))
        .to.emit(staking, "StakeLocked")
        .withArgs(alice.address, 1);

      const record = await staking.getStake(alice.address);
      expect(record.locked).to.equal(true);
    });

    it("prevents unstake while locked", async function () {
      await staking.connect(escrow).lockStake(alice.address, 1);
      await expect(staking.connect(alice).unstake(SMALL_STAKE)).to.be.revertedWithCustomError(
        staking,
        "StakeIsLocked"
      );
    });

    it("unlocks stake after job completes", async function () {
      await staking.connect(escrow).lockStake(alice.address, 1);
      await expect(staking.connect(escrow).unlockStake(alice.address, 1))
        .to.emit(staking, "StakeUnlocked")
        .withArgs(alice.address, 1);

      const record = await staking.getStake(alice.address);
      expect(record.locked).to.equal(false);
    });

    it("not boosted when stake is locked", async function () {
      await staking.connect(alice).stake(BOOST_THRESHOLD); // reach threshold
      await staking.connect(escrow).lockStake(alice.address, 1);
      expect(await staking.isBoosted(alice.address)).to.equal(false);
    });

    it("reverts lockStake from non-escrow", async function () {
      await expect(
        staking.connect(alice).lockStake(alice.address, 1)
      ).to.be.revertedWithCustomError(staking, "NotJobEscrow");
    });
  });

  // ============ slash() ============

  describe("slash()", function () {
    beforeEach(async function () {
      await staking.connect(alice).stake(STAKE_AMOUNT);
      await staking.connect(owner).authorizeEscrow(escrow.address);
    });

    it("slashes 10% of stake on dispute loss", async function () {
      const expectedSlash = (STAKE_AMOUNT * 1000n) / 10000n; // 10%
      await expect(staking.connect(escrow).slash(alice.address, "dispute lost"))
        .to.emit(staking, "Slashed")
        .withArgs(alice.address, expectedSlash, "dispute lost");

      expect(await staking.stakedAmount(alice.address)).to.equal(
        STAKE_AMOUNT - expectedSlash
      );
    });

    it("increments slash count", async function () {
      await staking.connect(escrow).slash(alice.address, "dispute");
      const record = await staking.getStake(alice.address);
      expect(record.slashCount).to.equal(1);
    });

    it("reverts slash from non-escrow", async function () {
      await expect(
        staking.connect(alice).slash(alice.address, "test")
      ).to.be.revertedWithCustomError(staking, "NotJobEscrow");
    });

    it("reverts second slash during cooldown", async function () {
      await staking.connect(escrow).slash(alice.address, "first");
      await expect(
        staking.connect(escrow).slash(alice.address, "second")
      ).to.be.revertedWithCustomError(staking, "CooldownActive");
    });
  });

  // ============ Admin ============

  describe("admin functions", function () {
    it("owner can set boost threshold", async function () {
      const newThreshold = ethers.parseUnits("2000", 0);
      await expect(staking.connect(owner).setBoostThreshold(newThreshold))
        .to.emit(staking, "BoostThresholdUpdated")
        .withArgs(newThreshold);
      expect(await staking.boostThreshold()).to.equal(newThreshold);
    });

    it("owner can set slash rate", async function () {
      await staking.connect(owner).setSlashRate(2000); // 20%
      expect(await staking.slashRateBps()).to.equal(2000);
    });

    it("reverts slash rate > 50%", async function () {
      await expect(staking.connect(owner).setSlashRate(5001)).to.be.reverted;
    });

    it("owner can update treasury", async function () {
      await staking.connect(owner).setTreasury(bob.address);
      expect(await staking.treasury()).to.equal(bob.address);
    });

    it("owner can authorize and revoke escrow", async function () {
      await staking.connect(owner).authorizeEscrow(escrow.address);
      expect(await staking.isAuthorizedEscrow(escrow.address)).to.equal(true);

      await staking.connect(owner).revokeEscrow(escrow.address);
      expect(await staking.isAuthorizedEscrow(escrow.address)).to.equal(false);
    });

    it("non-owner cannot call admin functions", async function () {
      await expect(
        staking.connect(alice).setBoostThreshold(1)
      ).to.be.reverted;
    });
  });

  // ============ getStake() view ============

  describe("getStake()", function () {
    it("returns zero record for unstaked agent", async function () {
      const record = await staking.getStake(alice.address);
      expect(record.amount).to.equal(0);
      expect(record.slashCount).to.equal(0);
      expect(record.locked).to.equal(false);
    });

    it("returns correct stake after staking", async function () {
      await staking.connect(alice).stake(STAKE_AMOUNT);
      const record = await staking.getStake(alice.address);
      expect(record.amount).to.equal(STAKE_AMOUNT);
      expect(record.slashCount).to.equal(0);
    });
  });
});
