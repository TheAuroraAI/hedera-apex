export interface Agent {
  wallet: string;
  name: string;
  hcsTopicId: string;
  capabilities: string[];
  ratePerJob: bigint;
  stakedAmount: bigint;
  completedJobs: bigint;
  totalRating: bigint;
  status: number; // 0=Inactive, 1=Active, 2=Suspended
}

export interface Job {
  id: bigint;
  client: string;
  agent: string;
  title: string;
  description: string;
  requiredCaps: string[];
  payment: bigint;
  deadline: bigint;
  status: number; // 0=Open, 1=Accepted, 2=Submitted, 3=Released, 4=Disputed, 5=Cancelled
  deliverableUri: string;
  clientRating: number;
}

export const JOB_STATUS_LABELS = [
  "Open",
  "Accepted",
  "Submitted",
  "Released",
  "Disputed",
  "Cancelled",
];

export const JOB_STATUS_COLORS = [
  "#22c55e", // Open - green
  "#3b82f6", // Accepted - blue
  "#a855f7", // Submitted - purple
  "#94a3b8", // Released - gray
  "#ef4444", // Disputed - red
  "#6b7280", // Cancelled - dark gray
];
