// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./AgentRegistry.sol";

/**
 * @title ReputationStaking
 * @notice Agents stake HACP tokens (via HTS precompile) for reputation multiplier.
 *         Higher stake → higher discovery ranking → more jobs.
 *         Slash mechanism: failed disputes reduce stake proportionally.
 *
 * @dev Interacts with Hedera Token Service via precompile at 0x167.
 *      HACP token is created as HTS fungible token by the deployer.
 */
contract ReputationStaking is Ownable, ReentrancyGuard {
    // ============ HTS Precompile ============

    address constant HTS_PRECOMPILE = 0x0000000000000000000000000000000000000167;

    // HACP HTS token address (set at deployment)
    address public immutable hacpToken;

    // ============ Types ============

    struct StakeRecord {
        uint256 amount;         // HACP tokens staked
        uint256 stakedAt;
        uint256 slashCount;
        uint256 lastSlashAt;
        bool locked;            // locked while job is active
    }

    // ============ Storage ============

    AgentRegistry public immutable registry;

    mapping(address => StakeRecord) private _stakes;

    // Slash parameters
    uint256 public slashRateBps = 1000; // 10% slash per dispute loss
    uint256 public slashCooldown = 7 days;

    // Minimum stake for "boosted" discovery tier
    uint256 public boostThreshold;

    // Slashed tokens go to treasury
    address public treasury;

    uint256 public totalStaked;

    // ============ Events ============

    event Staked(address indexed agent, uint256 amount, uint256 totalStake);
    event Unstaked(address indexed agent, uint256 amount, uint256 remainingStake);
    event Slashed(address indexed agent, uint256 amount, string reason);
    event StakeLocked(address indexed agent, uint256 jobId);
    event StakeUnlocked(address indexed agent, uint256 jobId);
    event BoostThresholdUpdated(uint256 newThreshold);

    // ============ Errors ============

    error InsufficientStake(uint256 staked, uint256 required);
    error StakeIsLocked();
    error AgentNotRegistered();
    error CooldownActive();
    error HTSTransferFailed();
    error NotJobEscrow();
    error ZeroAmount();

    // ============ Constructor ============

    constructor(address _registry, address _hacpToken, address _treasury, uint256 _boostThreshold)
        Ownable(msg.sender)
    {
        registry = AgentRegistry(_registry);
        hacpToken = _hacpToken;
        treasury = _treasury;
        boostThreshold = _boostThreshold;
    }

    // ============ Staking ============

    /**
     * @notice Stake HACP tokens for reputation. Requires prior HTS allowance.
     * @param amount Number of HACP tokens to stake
     */
    function stake(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (!registry.isRegistered(msg.sender)) revert AgentNotRegistered();

        // Transfer HACP tokens from agent to this contract via HTS precompile
        bool success = _htsTransferFrom(hacpToken, msg.sender, address(this), int64(uint64(amount)));
        if (!success) revert HTSTransferFailed();

        _stakes[msg.sender].amount += amount;
        _stakes[msg.sender].stakedAt = block.timestamp;
        totalStaked += amount;

        emit Staked(msg.sender, amount, _stakes[msg.sender].amount);
    }

    /**
     * @notice Unstake HACP tokens. Cannot unstake while job is locked.
     * @param amount Number of tokens to unstake
     */
    function unstake(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        StakeRecord storage s = _stakes[msg.sender];
        if (s.locked) revert StakeIsLocked();
        if (s.amount < amount) revert InsufficientStake(s.amount, amount);

        s.amount -= amount;
        totalStaked -= amount;

        bool success = _htsTransfer(hacpToken, msg.sender, int64(uint64(amount)));
        if (!success) revert HTSTransferFailed();

        emit Unstaked(msg.sender, amount, s.amount);
    }

    // ============ Lock/Unlock (called by JobEscrow) ============

    mapping(address => bool) public isAuthorizedEscrow;

    modifier onlyEscrow() {
        if (!isAuthorizedEscrow[msg.sender]) revert NotJobEscrow();
        _;
    }

    function lockStake(address agent, uint256 jobId) external onlyEscrow {
        _stakes[agent].locked = true;
        emit StakeLocked(agent, jobId);
    }

    function unlockStake(address agent, uint256 jobId) external onlyEscrow {
        _stakes[agent].locked = false;
        emit StakeUnlocked(agent, jobId);
    }

    /**
     * @notice Slash agent stake on dispute loss.
     */
    function slash(address agent, string calldata reason) external onlyEscrow nonReentrant {
        StakeRecord storage s = _stakes[agent];
        if (block.timestamp < s.lastSlashAt + slashCooldown) revert CooldownActive();

        uint256 slashAmount = (s.amount * slashRateBps) / 10000;
        if (slashAmount == 0) return;

        s.amount -= slashAmount;
        s.slashCount += 1;
        s.lastSlashAt = block.timestamp;
        totalStaked -= slashAmount;

        // Transfer slashed tokens to treasury
        bool success = _htsTransfer(hacpToken, treasury, int64(uint64(slashAmount)));
        if (!success) revert HTSTransferFailed();

        emit Slashed(agent, slashAmount, reason);
    }

    // ============ View Functions ============

    function getStake(address agent) external view returns (StakeRecord memory) {
        return _stakes[agent];
    }

    function stakedAmount(address agent) external view returns (uint256) {
        return _stakes[agent].amount;
    }

    function isBoosted(address agent) external view returns (bool) {
        return _stakes[agent].amount >= boostThreshold && !_stakes[agent].locked;
    }

    function reputationMultiplier(address agent) external view returns (uint256) {
        uint256 s = _stakes[agent].amount;
        if (s == 0) return 100; // 1x (base 100 = 1.0x)
        if (s < boostThreshold) return 120;           // 1.2x
        if (s < boostThreshold * 5) return 150;       // 1.5x
        if (s < boostThreshold * 20) return 200;      // 2.0x
        return 300;                                    // 3.0x max
    }

    // ============ Admin ============

    function authorizeEscrow(address escrow) external onlyOwner {
        isAuthorizedEscrow[escrow] = true;
    }

    function revokeEscrow(address escrow) external onlyOwner {
        isAuthorizedEscrow[escrow] = false;
    }

    function setSlashRate(uint256 bps) external onlyOwner {
        require(bps <= 5000, "Max 50%");
        slashRateBps = bps;
    }

    function setBoostThreshold(uint256 threshold) external onlyOwner {
        boostThreshold = threshold;
        emit BoostThresholdUpdated(threshold);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        treasury = newTreasury;
    }

    // ============ HTS Precompile Interface ============

    /**
     * @notice Transfer HTS tokens from one address to another.
     *         Uses the HTS System Contract precompile at 0x167.
     */
    function _htsTransferFrom(
        address token,
        address from,
        address to,
        int64 amount
    ) internal returns (bool) {
        (bool success, bytes memory result) = HTS_PRECOMPILE.call(
            abi.encodeWithSignature(
                "transferFrom(address,address,address,int64)",
                token, from, to, amount
            )
        );
        if (!success || result.length == 0) return false;
        int64 responseCode = abi.decode(result, (int64));
        return responseCode == 22; // SUCCESS = 22 in HTS
    }

    function _htsTransfer(
        address token,
        address to,
        int64 amount
    ) internal returns (bool) {
        (bool success, bytes memory result) = HTS_PRECOMPILE.call(
            abi.encodeWithSignature(
                "transferToken(address,address,address,int64)",
                token, address(this), to, amount
            )
        );
        if (!success || result.length == 0) return false;
        int64 responseCode = abi.decode(result, (int64));
        return responseCode == 22;
    }
}
