// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./AgentRegistry.sol";

/**
 * @title JobEscrow
 * @notice Trustless escrow for AI agent jobs. Clients post jobs with HBAR locked,
 *         agents bid, client accepts, agent delivers, client releases payment.
 *         Dispute resolution included via arbitration window.
 *
 * @dev State machine per job:
 *   Open → Accepted → Submitted → Completed (payment released)
 *                              → Disputed → Resolved
 *   Open → Cancelled (refund if no agent accepted)
 */
contract JobEscrow is Ownable, Pausable, ReentrancyGuard {
    // ============ Types ============

    enum JobStatus {
        Open,       // Posted, accepting bids
        Accepted,   // Agent accepted, work in progress
        Submitted,  // Agent submitted deliverable, awaiting client approval
        Completed,  // Client approved, payment released
        Disputed,   // Client raised dispute after submission
        Cancelled   // Cancelled before acceptance or by arbitrator
    }

    struct Job {
        uint256 id;
        address client;
        address agent;          // zero until accepted
        string title;
        string description;
        string[] requiredCaps;  // Required capabilities
        uint256 payment;        // HBAR in tinybars, locked in contract
        uint256 postedAt;
        uint256 deadline;       // Unix timestamp
        uint256 acceptedAt;
        uint256 submittedAt;
        JobStatus status;
        string deliverableUri;  // IPFS or HCS URI after submission
        uint8 clientRating;     // 1-5, set on completion
        string disputeReason;
    }

    struct Bid {
        address agent;
        uint256 proposedRate;   // Can differ from job payment (agent negotiates)
        string proposal;
        uint256 createdAt;
    }

    // ============ Storage ============

    AgentRegistry public immutable registry;

    uint256 private _jobCounter;
    mapping(uint256 => Job) private _jobs;
    mapping(uint256 => Bid[]) private _bids;
    mapping(address => uint256[]) private _clientJobs;
    mapping(address => uint256[]) private _agentJobs;

    // Protocol fee on payment release (basis points)
    uint256 public protocolFeeBps = 250; // 2.5%
    uint256 public accumulatedFees;

    // Dispute window: client has this long after submission to raise dispute
    uint256 public disputeWindowSeconds = 3 days;

    // Arbitrators can resolve disputes
    mapping(address => bool) public isArbitrator;

    // ============ Events ============

    event JobPosted(uint256 indexed jobId, address indexed client, uint256 payment, string title);
    event BidPlaced(uint256 indexed jobId, address indexed agent, uint256 proposedRate);
    event BidAccepted(uint256 indexed jobId, address indexed agent);
    event JobSubmitted(uint256 indexed jobId, address indexed agent, string deliverableUri);
    event JobCompleted(uint256 indexed jobId, address indexed agent, uint256 payment, uint8 rating);
    event JobDisputed(uint256 indexed jobId, address indexed client, string reason);
    event DisputeResolved(uint256 indexed jobId, bool clientWon, uint256 agentPayment, uint256 clientRefund);
    event JobCancelled(uint256 indexed jobId, address indexed by, uint256 refundAmount);
    event AutoReleased(uint256 indexed jobId, uint256 payment);

    // ============ Errors ============

    error JobNotFound(uint256 jobId);
    error InvalidStatus(JobStatus current, JobStatus expected);
    error NotClient(uint256 jobId);
    error NotAgent(uint256 jobId);
    error AgentNotActive(address agent);
    error DeadlinePassed();
    error InsufficientPayment();
    error DisputeWindowClosed();
    error NotArbitrator();
    error NoBids();
    error BidNotFound();

    // ============ Constructor ============

    constructor(address _registry) Ownable(msg.sender) {
        registry = AgentRegistry(_registry);
    }

    // ============ Client Actions ============

    /**
     * @notice Post a new job with HBAR payment locked in escrow.
     */
    function postJob(
        string calldata title,
        string calldata description,
        string[] calldata requiredCaps,
        uint256 deadline
    ) external payable whenNotPaused nonReentrant returns (uint256 jobId) {
        if (msg.value == 0) revert InsufficientPayment();
        if (deadline <= block.timestamp) revert DeadlinePassed();

        jobId = ++_jobCounter;
        _jobs[jobId] = Job({
            id: jobId,
            client: msg.sender,
            agent: address(0),
            title: title,
            description: description,
            requiredCaps: requiredCaps,
            payment: msg.value,
            postedAt: block.timestamp,
            deadline: deadline,
            acceptedAt: 0,
            submittedAt: 0,
            status: JobStatus.Open,
            deliverableUri: "",
            clientRating: 0,
            disputeReason: ""
        });

        _clientJobs[msg.sender].push(jobId);

        emit JobPosted(jobId, msg.sender, msg.value, title);
    }

    /**
     * @notice Accept a bid from a specific agent to work on this job.
     */
    function acceptBid(uint256 jobId, address agent) external whenNotPaused nonReentrant {
        Job storage job = _jobs[jobId];
        if (job.id == 0) revert JobNotFound(jobId);
        if (job.client != msg.sender) revert NotClient(jobId);
        if (job.status != JobStatus.Open) revert InvalidStatus(job.status, JobStatus.Open);
        if (block.timestamp > job.deadline) revert DeadlinePassed();
        if (!registry.isActive(agent)) revert AgentNotActive(agent);

        // Verify agent placed a bid
        bool found = false;
        for (uint256 i = 0; i < _bids[jobId].length; i++) {
            if (_bids[jobId][i].agent == agent) { found = true; break; }
        }
        if (!found) revert BidNotFound();

        job.agent = agent;
        job.acceptedAt = block.timestamp;
        job.status = JobStatus.Accepted;

        _agentJobs[agent].push(jobId);

        emit BidAccepted(jobId, agent);
    }

    /**
     * @notice Release payment to agent after reviewing submission. Provide rating.
     * @param rating Quality rating 1-5
     */
    function releasePayment(uint256 jobId, uint8 rating) external nonReentrant {
        Job storage job = _jobs[jobId];
        if (job.id == 0) revert JobNotFound(jobId);
        if (job.client != msg.sender) revert NotClient(jobId);
        if (job.status != JobStatus.Submitted) revert InvalidStatus(job.status, JobStatus.Submitted);
        require(rating >= 1 && rating <= 5, "Rating must be 1-5");

        job.status = JobStatus.Completed;
        job.clientRating = rating;

        _releaseToAgent(job, rating);
    }

    /**
     * @notice Raise a dispute within the dispute window after agent submission.
     */
    function raiseDispute(uint256 jobId, string calldata reason) external {
        Job storage job = _jobs[jobId];
        if (job.id == 0) revert JobNotFound(jobId);
        if (job.client != msg.sender) revert NotClient(jobId);
        if (job.status != JobStatus.Submitted) revert InvalidStatus(job.status, JobStatus.Submitted);
        if (block.timestamp > job.submittedAt + disputeWindowSeconds) revert DisputeWindowClosed();

        job.status = JobStatus.Disputed;
        job.disputeReason = reason;

        emit JobDisputed(jobId, msg.sender, reason);
    }

    /**
     * @notice Cancel an open job and reclaim payment.
     */
    function cancelJob(uint256 jobId) external nonReentrant {
        Job storage job = _jobs[jobId];
        if (job.id == 0) revert JobNotFound(jobId);
        if (job.client != msg.sender) revert NotClient(jobId);
        if (job.status != JobStatus.Open) revert InvalidStatus(job.status, JobStatus.Open);

        job.status = JobStatus.Cancelled;
        uint256 refund = job.payment;
        job.payment = 0;

        (bool success, ) = msg.sender.call{value: refund}("");
        require(success, "Refund failed");

        emit JobCancelled(jobId, msg.sender, refund);
    }

    // ============ Agent Actions ============

    /**
     * @notice Place a bid on an open job.
     */
    function placeBid(
        uint256 jobId,
        uint256 proposedRate,
        string calldata proposal
    ) external whenNotPaused {
        Job storage job = _jobs[jobId];
        if (job.id == 0) revert JobNotFound(jobId);
        if (job.status != JobStatus.Open) revert InvalidStatus(job.status, JobStatus.Open);
        if (block.timestamp > job.deadline) revert DeadlinePassed();
        if (!registry.isActive(msg.sender)) revert AgentNotActive(msg.sender);

        // Prevent duplicate bids
        for (uint256 i = 0; i < _bids[jobId].length; i++) {
            require(_bids[jobId][i].agent != msg.sender, "Already bid");
        }

        _bids[jobId].push(Bid({
            agent: msg.sender,
            proposedRate: proposedRate,
            proposal: proposal,
            createdAt: block.timestamp
        }));

        emit BidPlaced(jobId, msg.sender, proposedRate);
    }

    /**
     * @notice Submit completed work with deliverable URI.
     */
    function submitDeliverable(uint256 jobId, string calldata deliverableUri) external {
        Job storage job = _jobs[jobId];
        if (job.id == 0) revert JobNotFound(jobId);
        if (job.agent != msg.sender) revert NotAgent(jobId);
        if (job.status != JobStatus.Accepted) revert InvalidStatus(job.status, JobStatus.Accepted);

        job.status = JobStatus.Submitted;
        job.submittedAt = block.timestamp;
        job.deliverableUri = deliverableUri;

        emit JobSubmitted(jobId, msg.sender, deliverableUri);
    }

    /**
     * @notice Auto-release payment if client doesn't respond within dispute window.
     *         Anyone can trigger this after the window expires.
     */
    function autoRelease(uint256 jobId) external nonReentrant {
        Job storage job = _jobs[jobId];
        if (job.id == 0) revert JobNotFound(jobId);
        if (job.status != JobStatus.Submitted) revert InvalidStatus(job.status, JobStatus.Submitted);
        require(
            block.timestamp > job.submittedAt + disputeWindowSeconds,
            "Dispute window still open"
        );

        job.status = JobStatus.Completed;
        job.clientRating = 3; // neutral if auto-released

        _releaseToAgent(job, 3);
        emit AutoReleased(jobId, job.payment);
    }

    // ============ Arbitrator Actions ============

    /**
     * @notice Resolve a dispute. Splits payment between agent and client.
     * @param agentShareBps Basis points of payment going to agent (0-10000)
     */
    function resolveDispute(uint256 jobId, uint256 agentShareBps, uint8 agentRating) external nonReentrant {
        if (!isArbitrator[msg.sender]) revert NotArbitrator();
        Job storage job = _jobs[jobId];
        if (job.id == 0) revert JobNotFound(jobId);
        if (job.status != JobStatus.Disputed) revert InvalidStatus(job.status, JobStatus.Disputed);
        require(agentShareBps <= 10000, "Share > 100%");
        require(agentRating <= 5, "Rating must be 0-5");

        job.status = JobStatus.Completed;

        uint256 total = job.payment;
        uint256 fee = (total * protocolFeeBps) / 10000;
        uint256 net = total - fee;

        uint256 agentAmount = (net * agentShareBps) / 10000;
        uint256 clientAmount = net - agentAmount;

        accumulatedFees += fee;
        job.payment = 0;

        if (agentAmount > 0) {
            if (agentRating > 0) {
                try registry.recordJobCompletion(job.agent, agentRating) {} catch {}
            }
            (bool s1, ) = job.agent.call{value: agentAmount}("");
            require(s1, "Agent payment failed");
        }

        if (clientAmount > 0) {
            (bool s2, ) = job.client.call{value: clientAmount}("");
            require(s2, "Client refund failed");
        }

        emit DisputeResolved(jobId, clientAmount > agentAmount, agentAmount, clientAmount);
    }

    // ============ Admin ============

    function addArbitrator(address arbitrator) external onlyOwner {
        isArbitrator[arbitrator] = true;
    }

    function removeArbitrator(address arbitrator) external onlyOwner {
        isArbitrator[arbitrator] = false;
    }

    function setProtocolFee(uint256 bps) external onlyOwner {
        require(bps <= 1000, "Max 10%");
        protocolFeeBps = bps;
    }

    function setDisputeWindow(uint256 seconds_) external onlyOwner {
        require(seconds_ >= 1 hours && seconds_ <= 30 days, "Invalid window");
        disputeWindowSeconds = seconds_;
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

    function getJob(uint256 jobId) external view returns (Job memory) {
        if (_jobs[jobId].id == 0) revert JobNotFound(jobId);
        return _jobs[jobId];
    }

    function getBids(uint256 jobId) external view returns (Bid[] memory) {
        return _bids[jobId];
    }

    function getClientJobs(address client) external view returns (uint256[] memory) {
        return _clientJobs[client];
    }

    function getAgentJobs(address agent) external view returns (uint256[] memory) {
        return _agentJobs[agent];
    }

    function totalJobs() external view returns (uint256) {
        return _jobCounter;
    }

    // ============ Internal ============

    function _releaseToAgent(Job storage job, uint8 rating) internal {
        uint256 total = job.payment;
        uint256 fee = (total * protocolFeeBps) / 10000;
        uint256 agentPayment = total - fee;

        accumulatedFees += fee;
        job.payment = 0;

        // Record job completion on registry
        try registry.recordJobCompletion(job.agent, rating) {} catch {}

        (bool success, ) = job.agent.call{value: agentPayment}("");
        require(success, "Payment failed");

        emit JobCompleted(job.id, job.agent, agentPayment, rating);
    }
}
