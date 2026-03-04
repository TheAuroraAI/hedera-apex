/**
 * HACP SDK — Utilities
 */

// 1 HBAR = 100,000,000 tinybars
export const TINYBARS_PER_HBAR = BigInt(100_000_000);

/**
 * Convert HBAR (as number or string) to tinybars (BigInt)
 */
export function hbarToTinybars(hbar: number | string | bigint): bigint {
  if (typeof hbar === "bigint") return hbar * TINYBARS_PER_HBAR;
  const [whole, frac = ""] = String(hbar).split(".");
  const fracPadded = frac.padEnd(8, "0").slice(0, 8);
  return BigInt(whole) * TINYBARS_PER_HBAR + BigInt(fracPadded);
}

/**
 * Convert tinybars (BigInt) to HBAR string (e.g. "1.23456789")
 */
export function tinybarsTohbar(tinybars: bigint): string {
  const whole = tinybars / TINYBARS_PER_HBAR;
  const frac = tinybars % TINYBARS_PER_HBAR;
  if (frac === 0n) return String(whole);
  return `${whole}.${String(frac).padStart(8, "0").replace(/0+$/, "")}`;
}

/**
 * Format a timestamp as ISO string
 */
export function formatTimestamp(ts: bigint | number): string {
  return new Date(Number(ts) * 1000).toISOString();
}

/**
 * Validate Hedera account ID format (e.g. "0.0.12345")
 */
export function isValidHederaAccountId(id: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(id);
}

/**
 * Encode capability string as bytes32 key (matches contract logic)
 */
export function capabilityKey(capability: string): string {
  // Contract uses keccak256(abi.encodePacked(capability))
  // For display/comparison we just return the string
  return capability;
}

/**
 * Parse a private key, normalizing 0x prefix
 */
export function parsePrivateKey(key: string): string {
  return key.startsWith("0x") ? key : `0x${key}`;
}

/**
 * Format job status as human-readable string
 */
export function formatJobStatus(status: number): string {
  const statuses = [
    "Open",
    "Assigned",
    "Submitted",
    "Completed",
    "Disputed",
    "Cancelled",
  ];
  return statuses[status] ?? "Unknown";
}

/**
 * Format agent status as human-readable string
 */
export function formatAgentStatus(status: number): string {
  const statuses = ["Inactive", "Active", "Suspended"];
  return statuses[status] ?? "Unknown";
}

/**
 * Parse an integer safely, returning undefined on NaN
 */
export function parseIntSafe(value: string): number | undefined {
  const n = parseInt(value, 10);
  return isNaN(n) ? undefined : n;
}

/**
 * Truncate an Ethereum address for display (e.g. "0x1234...5678")
 */
export function truncateAddress(addr: string): string {
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/**
 * Compute deadline timestamp from "N days from now"
 */
export function deadlineFromDays(days: number): number {
  return Math.floor(Date.now() / 1000) + days * 86400;
}

/**
 * Average rating from totalRating / completedJobs (returns 0 if no jobs)
 */
export function computeAvgRating(
  totalRating: bigint,
  completedJobs: bigint
): number {
  if (completedJobs === 0n) return 0;
  return Number((totalRating * 100n) / completedJobs) / 100;
}
