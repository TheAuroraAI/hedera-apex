// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title AgentRegistry
 * @notice Central registry for AI agents in the Hedera Agent Commerce Protocol.
 *         Agents register with capabilities, rates, and stake for reputation.
 *         Implements OpenConvAI agent discovery standard.
 */
contract AgentRegistry is Ownable, Pausable, ReentrancyGuard {
    // ============ Types ============

    enum AgentStatus { Inactive, Active, Suspended }

    struct Agent {
        address wallet;
        string name;
        string hcsTopicId;        // HCS topic for direct messaging (OpenConvAI standard)
        string[] capabilities;    // e.g. ["code-review", "smart-contract-audit", "writing"]
        uint256 ratePerJob;       // HBAR (in tinybars) minimum rate
        uint256 stakedAmount;     // HBAR staked for reputation
        uint256 completedJobs;
        uint256 totalRating;      // Sum of ratings (divide by completedJobs for avg)
        uint256 registeredAt;
        AgentStatus status;
        string metadataUri;       // IPFS/HCS URI for extended agent metadata
    }

    // ============ Storage ============

    mapping(address => Agent) private _agents;
    mapping(address => bool) private _registered;
    address[] private _agentList;

    // capability => list of agent addresses
    mapping(bytes32 => address[]) private _capabilityIndex;

    // Minimum stake to register (anti-spam)
    uint256 public minStake;

    // Protocol fee on stake (basis points, e.g. 100 = 1%)
    uint256 public constant STAKE_FEE_BPS = 100;
    uint256 public accumulatedFees;

    // ============ Events ============

    event AgentRegistered(address indexed agent, string name, string[] capabilities, uint256 stake);
    event AgentUpdated(address indexed agent, string[] capabilities, uint256 ratePerJob);
    event AgentSuspended(address indexed agent, string reason);
    event AgentReinstated(address indexed agent);
    event AgentDeregistered(address indexed agent, uint256 stakeReturned);
    event ReputationUpdated(address indexed agent, uint256 completedJobs, uint256 avgRating);
    event MinStakeUpdated(uint256 oldStake, uint256 newStake);

    // ============ Errors ============

    error AlreadyRegistered();
    error NotRegistered();
    error InsufficientStake(uint256 required, uint256 provided);
    error AgentSuspendedError();
    error NotAuthorized();
    error InvalidCapabilities();
    error ZeroCapabilities();

    // ============ Constructor ============

    constructor(uint256 _minStake) Ownable(msg.sender) {
        minStake = _minStake;
    }

    // ============ Registration ============

    /**
     * @notice Register as an AI agent. Requires staking HBAR.
     * @param name Human-readable agent name
     * @param hcsTopicId HCS topic ID for OpenConvAI direct messaging
     * @param capabilities List of service capabilities offered
     * @param ratePerJob Minimum job rate in tinybars
     * @param metadataUri Extended metadata URI (IPFS or HCS)
     */
    function register(
        string calldata name,
        string calldata hcsTopicId,
        string[] calldata capabilities,
        uint256 ratePerJob,
        string calldata metadataUri
    ) external payable whenNotPaused nonReentrant {
        if (_registered[msg.sender]) revert AlreadyRegistered();
        if (msg.value < minStake) revert InsufficientStake(minStake, msg.value);
        if (capabilities.length == 0) revert ZeroCapabilities();
        if (capabilities.length > 20) revert InvalidCapabilities();

        uint256 fee = (msg.value * STAKE_FEE_BPS) / 10000;
        accumulatedFees += fee;

        string[] memory caps = new string[](capabilities.length);
        for (uint256 i = 0; i < capabilities.length; i++) {
            caps[i] = capabilities[i];
            _capabilityIndex[keccak256(abi.encodePacked(capabilities[i]))].push(msg.sender);
        }

        _agents[msg.sender] = Agent({
            wallet: msg.sender,
            name: name,
            hcsTopicId: hcsTopicId,
            capabilities: caps,
            ratePerJob: ratePerJob,
            stakedAmount: msg.value - fee,
            completedJobs: 0,
            totalRating: 0,
            registeredAt: block.timestamp,
            status: AgentStatus.Active,
            metadataUri: metadataUri
        });

        _registered[msg.sender] = true;
        _agentList.push(msg.sender);

        emit AgentRegistered(msg.sender, name, caps, msg.value - fee);
    }

    /**
     * @notice Update agent capabilities and rate. Cannot update while job is active (enforced by JobEscrow).
     */
    function updateProfile(
        string[] calldata capabilities,
        uint256 ratePerJob,
        string calldata metadataUri
    ) external whenNotPaused {
        if (!_registered[msg.sender]) revert NotRegistered();
        if (_agents[msg.sender].status == AgentStatus.Suspended) revert AgentSuspendedError();
        if (capabilities.length == 0) revert ZeroCapabilities();
        if (capabilities.length > 20) revert InvalidCapabilities();

        Agent storage agent = _agents[msg.sender];

        // Remove from old capability indices
        for (uint256 i = 0; i < agent.capabilities.length; i++) {
            _removeFromCapabilityIndex(keccak256(abi.encodePacked(agent.capabilities[i])), msg.sender);
        }

        // Update capabilities
        agent.capabilities = capabilities;
        agent.ratePerJob = ratePerJob;
        agent.metadataUri = metadataUri;

        // Add to new capability indices
        for (uint256 i = 0; i < capabilities.length; i++) {
            _capabilityIndex[keccak256(abi.encodePacked(capabilities[i]))].push(msg.sender);
        }

        emit AgentUpdated(msg.sender, capabilities, ratePerJob);
    }

    /**
     * @notice Deregister and reclaim stake (minus protocol fee already taken).
     */
    function deregister() external nonReentrant {
        if (!_registered[msg.sender]) revert NotRegistered();
        if (_agents[msg.sender].status == AgentStatus.Suspended) revert AgentSuspendedError();

        Agent storage agent = _agents[msg.sender];
        uint256 stakeToReturn = agent.stakedAmount;

        // Clean up capability indices
        for (uint256 i = 0; i < agent.capabilities.length; i++) {
            _removeFromCapabilityIndex(
                keccak256(abi.encodePacked(agent.capabilities[i])),
                msg.sender
            );
        }

        // Remove from agent list
        _removeFromAgentList(msg.sender);
        _registered[msg.sender] = false;
        delete _agents[msg.sender];

        if (stakeToReturn > 0) {
            (bool success, ) = msg.sender.call{value: stakeToReturn}("");
            require(success, "Stake return failed");
        }

        emit AgentDeregistered(msg.sender, stakeToReturn);
    }

    // ============ Discovery (OpenConvAI Standard) ============

    /**
     * @notice Find agents by capability. Returns up to `limit` active agents.
     */
    function findByCapability(
        string calldata capability,
        uint256 offset,
        uint256 limit
    ) external view returns (Agent[] memory results, uint256 total) {
        address[] storage candidates = _capabilityIndex[keccak256(abi.encodePacked(capability))];

        // Count active agents
        uint256 activeCount = 0;
        for (uint256 i = 0; i < candidates.length; i++) {
            if (_registered[candidates[i]] && _agents[candidates[i]].status == AgentStatus.Active) {
                activeCount++;
            }
        }
        total = activeCount;

        if (offset >= activeCount) {
            return (new Agent[](0), total);
        }

        uint256 end = offset + limit;
        if (end > activeCount) end = activeCount;
        results = new Agent[](end - offset);

        uint256 resultIdx = 0;
        uint256 idx = 0;
        for (uint256 i = 0; i < candidates.length && resultIdx < (end - offset); i++) {
            address addr = candidates[i];
            if (_registered[addr] && _agents[addr].status == AgentStatus.Active) {
                if (idx >= offset) {
                    results[resultIdx] = _agents[addr];
                    resultIdx++;
                }
                idx++;
            }
        }
    }

    /**
     * @notice Get all agents sorted by reputation (completedJobs * avgRating).
     *         Returns top `limit` agents from offset.
     */
    function getTopAgents(uint256 offset, uint256 limit)
        external view returns (Agent[] memory results, uint256 total)
    {
        // Build active list
        address[] memory active = new address[](_agentList.length);
        uint256 count = 0;
        for (uint256 i = 0; i < _agentList.length; i++) {
            if (_registered[_agentList[i]] && _agents[_agentList[i]].status == AgentStatus.Active) {
                active[count++] = _agentList[i];
            }
        }
        total = count;

        if (offset >= count) return (new Agent[](0), total);

        uint256 end = offset + limit;
        if (end > count) end = count;

        // Simple insertion sort on reputation score (ok for small lists)
        for (uint256 i = 1; i < count; i++) {
            address key = active[i];
            uint256 keyScore = _reputationScore(key);
            int256 j = int256(i) - 1;
            while (j >= 0 && _reputationScore(active[uint256(j)]) < keyScore) {
                active[uint256(j + 1)] = active[uint256(j)];
                j--;
            }
            active[uint256(j + 1)] = key;
        }

        results = new Agent[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            results[i - offset] = _agents[active[i]];
        }
    }

    // ============ Reputation (called by JobEscrow) ============

    /**
     * @notice Record a completed job and update agent reputation.
     * @dev Only callable by authorized JobEscrow contract.
     */
    function recordJobCompletion(address agent, uint8 rating) external {
        if (!_registered[agent]) revert NotRegistered();
        require(msg.sender == owner() || _isAuthorizedEscrow(msg.sender), "Not authorized");
        require(rating >= 1 && rating <= 5, "Rating must be 1-5");

        _agents[agent].completedJobs += 1;
        _agents[agent].totalRating += rating;

        emit ReputationUpdated(agent, _agents[agent].completedJobs, avgRating(agent));
    }

    // ============ Admin ============

    function suspendAgent(address agent, string calldata reason) external onlyOwner {
        if (!_registered[agent]) revert NotRegistered();
        _agents[agent].status = AgentStatus.Suspended;
        emit AgentSuspended(agent, reason);
    }

    function reinstateAgent(address agent) external onlyOwner {
        if (!_registered[agent]) revert NotRegistered();
        _agents[agent].status = AgentStatus.Active;
        emit AgentReinstated(agent);
    }

    function setMinStake(uint256 newMinStake) external onlyOwner {
        emit MinStakeUpdated(minStake, newMinStake);
        minStake = newMinStake;
    }

    function withdrawFees(address payable recipient) external onlyOwner nonReentrant {
        uint256 amount = accumulatedFees;
        accumulatedFees = 0;
        (bool success, ) = recipient.call{value: amount}("");
        require(success, "Fee withdrawal failed");
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // ============ View Functions ============

    function getAgent(address wallet) external view returns (Agent memory) {
        if (!_registered[wallet]) revert NotRegistered();
        return _agents[wallet];
    }

    function isRegistered(address wallet) external view returns (bool) {
        return _registered[wallet];
    }

    function isActive(address wallet) external view returns (bool) {
        return _registered[wallet] && _agents[wallet].status == AgentStatus.Active;
    }

    function avgRating(address wallet) public view returns (uint256) {
        Agent storage a = _agents[wallet];
        if (a.completedJobs == 0) return 0;
        return a.totalRating / a.completedJobs;
    }

    function totalAgents() external view returns (uint256) {
        return _agentList.length;
    }

    // ============ Internal ============

    // authorized escrow contracts set by owner
    mapping(address => bool) private _authorizedEscrows;

    function authorizeEscrow(address escrow) external onlyOwner {
        _authorizedEscrows[escrow] = true;
    }

    function revokeEscrow(address escrow) external onlyOwner {
        _authorizedEscrows[escrow] = false;
    }

    function _isAuthorizedEscrow(address addr) internal view returns (bool) {
        return _authorizedEscrows[addr];
    }

    function _reputationScore(address wallet) internal view returns (uint256) {
        Agent storage a = _agents[wallet];
        if (a.completedJobs == 0) return 0;
        uint256 avg = a.totalRating / a.completedJobs;
        return a.completedJobs * avg * (a.stakedAmount / 1e6 + 1);
    }

    function _removeFromCapabilityIndex(bytes32 capHash, address agent) internal {
        address[] storage list = _capabilityIndex[capHash];
        for (uint256 i = 0; i < list.length; i++) {
            if (list[i] == agent) {
                list[i] = list[list.length - 1];
                list.pop();
                break;
            }
        }
    }

    function _removeFromAgentList(address agent) internal {
        for (uint256 i = 0; i < _agentList.length; i++) {
            if (_agentList[i] == agent) {
                _agentList[i] = _agentList[_agentList.length - 1];
                _agentList.pop();
                break;
            }
        }
    }
}
