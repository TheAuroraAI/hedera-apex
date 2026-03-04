/**
 * Contract addresses and ABIs for HACP Dashboard
 * Update CONTRACTS after testnet deployment.
 */

export const CONTRACTS = {
  AgentRegistry: "0x0000000000000000000000000000000000000000", // TODO: replace after deploy
  JobEscrow: "0x0000000000000000000000000000000000000000",
  ReputationStaking: "0x0000000000000000000000000000000000000000",
};

// Minimal ABIs for dashboard read operations

export const REGISTRY_ABI = [
  "function getAllAgents() view returns (address[])",
  "function getAgent(address wallet) view returns (tuple(address wallet, string name, string hcsTopicId, string[] capabilities, uint256 ratePerJob, uint256 stakedAmount, uint256 completedJobs, uint256 totalRating, uint256 registeredAt, uint8 status, string metadataUri))",
  "function isActive(address agent) view returns (bool)",
  "function getByCapability(string capability) view returns (address[])",
  "function reputationScore(address agent) view returns (uint256)",
  "event AgentRegistered(address indexed agent, string name, string[] capabilities, uint256 stake)",
  "event ReputationUpdated(address indexed agent, uint256 completedJobs, uint256 avgRating)",
];

export const ESCROW_ABI = [
  "function jobCount() view returns (uint256)",
  "function getJob(uint256 jobId) view returns (tuple(uint256 id, address client, address agent, string title, string description, string[] requiredCaps, uint256 payment, uint256 postedAt, uint256 deadline, uint256 acceptedAt, uint256 submittedAt, uint8 status, string deliverableUri, uint8 clientRating, string disputeReason))",
  "function getBids(uint256 jobId) view returns (tuple(address agent, uint256 proposedRate, string proposal, uint256 createdAt)[])",
  "function getClientJobs(address client) view returns (uint256[])",
  "function getAgentJobs(address agent) view returns (uint256[])",
  "function postJob(string title, string description, string[] requiredCaps, uint256 deadline) payable returns (uint256 jobId)",
  "function placeBid(uint256 jobId, uint256 proposedRate, string proposal)",
  "function acceptBid(uint256 jobId, address agent)",
  "function submitDeliverable(uint256 jobId, string deliverableUri)",
  "function releasePayment(uint256 jobId, uint8 rating)",
  "event JobPosted(uint256 indexed jobId, address indexed client, uint256 payment, string title)",
  "event BidPlaced(uint256 indexed jobId, address indexed agent, uint256 proposedRate)",
  "event JobAccepted(uint256 indexed jobId, address indexed agent)",
  "event PaymentReleased(uint256 indexed jobId, address indexed agent, uint256 amount)",
];

export const STAKING_ABI = [
  "function getStake(address agent) view returns (uint256)",
  "function reputationBoost(address agent) view returns (uint256)",
  "function stake(uint256 amount)",
  "function unstake(uint256 amount)",
];
