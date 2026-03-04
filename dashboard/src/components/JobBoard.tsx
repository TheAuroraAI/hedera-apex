import React, { useState } from "react";
import { ethers } from "ethers";
import { Job, JOB_STATUS_LABELS, JOB_STATUS_COLORS } from "../types";
import { CONTRACTS, ESCROW_ABI } from "../contracts";

interface JobBoardProps {
  jobs: Job[];
  signer: ethers.JsonRpcSigner | null;
  account: string;
  onRefresh: () => void;
}

interface BidState {
  proposal: string;
  rateHBAR: string;
  submitting: boolean;
  error: string;
}

const DEFAULT_BID: BidState = {
  proposal: "",
  rateHBAR: "",
  submitting: false,
  error: "",
};

const JobBoard: React.FC<JobBoardProps> = ({ jobs, signer, account, onRefresh }) => {
  const [openBidJobId, setOpenBidJobId] = useState<string | null>(null);
  const [bidStates, setBidStates] = useState<Record<string, BidState>>({});

  const getBidState = (jobId: string): BidState =>
    bidStates[jobId] ?? { ...DEFAULT_BID };

  const setBidState = (jobId: string, patch: Partial<BidState>) => {
    setBidStates((prev) => ({
      ...prev,
      [jobId]: { ...getBidState(jobId), ...patch },
    }));
  };

  const formatHBAR = (tinybar: bigint): string => {
    const hbar = Number(tinybar) / 1e8;
    return `${hbar.toFixed(2)} HBAR`;
  };

  const formatDeadline = (deadline: bigint): string => {
    const ts = Number(deadline) * 1000;
    return new Date(ts).toLocaleString();
  };

  const truncate = (text: string, max: number): string =>
    text.length > max ? `${text.slice(0, max)}...` : text;

  const handlePlaceBid = async (jobId: bigint) => {
    const key = jobId.toString();
    const state = getBidState(key);

    if (!signer) return;
    if (!state.proposal.trim()) {
      setBidState(key, { error: "Proposal text is required." });
      return;
    }
    if (!state.rateHBAR || isNaN(Number(state.rateHBAR))) {
      setBidState(key, { error: "Enter a valid rate in HBAR." });
      return;
    }

    setBidState(key, { submitting: true, error: "" });

    try {
      const escrow = new ethers.Contract(CONTRACTS.JobEscrow, ESCROW_ABI, signer);
      // proposedRate in tinybar (HBAR * 1e8)
      const rateTinybar = BigInt(Math.round(Number(state.rateHBAR) * 1e8));
      const tx = await escrow.placeBid(jobId, rateTinybar, state.proposal.trim());
      await tx.wait();
      setBidState(key, { submitting: false, error: "", proposal: "", rateHBAR: "" });
      setOpenBidJobId(null);
      onRefresh();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Transaction failed.";
      setBidState(key, { submitting: false, error: message.slice(0, 120) });
    }
  };

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20,
        }}
      >
        <h2 style={{ margin: 0, color: "#e2e8f0", fontSize: 20, fontWeight: 700 }}>
          Job Board
        </h2>
        <button
          onClick={onRefresh}
          style={{
            padding: "6px 14px",
            background: "linear-gradient(135deg, #6366f1, #a855f7)",
            borderRadius: 6,
            color: "white",
            cursor: "pointer",
            fontSize: 13,
            border: "none",
            fontWeight: 600,
          }}
        >
          Refresh
        </button>
      </div>

      {/* Empty state */}
      {jobs.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "60px 20px",
            color: "#64748b",
            fontSize: 15,
          }}
        >
          No jobs posted yet.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {jobs.map((job) => {
            const key = job.id.toString();
            const statusLabel = JOB_STATUS_LABELS[job.status] ?? "Unknown";
            const statusColor = JOB_STATUS_COLORS[job.status] ?? "#6b7280";
            const canBid = job.status === 0 && !!account && !!signer;
            const bidOpen = openBidJobId === key;
            const state = getBidState(key);

            return (
              <div
                key={key}
                style={{
                  background: "rgba(15,23,42,0.8)",
                  border: "1px solid rgba(99,102,241,0.2)",
                  borderRadius: 12,
                  padding: 20,
                }}
              >
                {/* Top row: title + status */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    marginBottom: 10,
                  }}
                >
                  <span
                    style={{ fontWeight: 700, fontSize: 16, color: "#e2e8f0" }}
                  >
                    {job.title}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: statusColor,
                      background: `${statusColor}22`,
                      border: `1px solid ${statusColor}55`,
                      borderRadius: 20,
                      padding: "2px 8px",
                      whiteSpace: "nowrap",
                      marginLeft: 12,
                    }}
                  >
                    {statusLabel}
                  </span>
                </div>

                {/* Description */}
                <p
                  style={{
                    margin: "0 0 12px",
                    fontSize: 13,
                    color: "#94a3b8",
                    lineHeight: 1.5,
                  }}
                >
                  {truncate(job.description, 100)}
                </p>

                {/* Capabilities */}
                {job.requiredCaps.length > 0 && (
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 6,
                      marginBottom: 12,
                    }}
                  >
                    {job.requiredCaps.map((cap) => (
                      <span
                        key={cap}
                        style={{
                          fontSize: 11,
                          color: "#c084fc",
                          background: "rgba(168,85,247,0.12)",
                          border: "1px solid rgba(168,85,247,0.3)",
                          borderRadius: 12,
                          padding: "2px 8px",
                        }}
                      >
                        {cap}
                      </span>
                    ))}
                  </div>
                )}

                {/* Meta row */}
                <div
                  style={{
                    display: "flex",
                    gap: 20,
                    fontSize: 12,
                    color: "#64748b",
                    marginBottom: canBid ? 12 : 0,
                  }}
                >
                  <span>
                    Payment:{" "}
                    <strong style={{ color: "#e2e8f0" }}>
                      {formatHBAR(job.payment)}
                    </strong>
                  </span>
                  <span>
                    Deadline:{" "}
                    <strong style={{ color: "#e2e8f0" }}>
                      {formatDeadline(job.deadline)}
                    </strong>
                  </span>
                </div>

                {/* Place Bid */}
                {canBid && (
                  <div style={{ marginTop: 12 }}>
                    {!bidOpen ? (
                      <button
                        onClick={() => setOpenBidJobId(key)}
                        style={{
                          padding: "6px 14px",
                          background: "linear-gradient(135deg, #6366f1, #a855f7)",
                          borderRadius: 6,
                          color: "white",
                          cursor: "pointer",
                          fontSize: 13,
                          border: "none",
                          fontWeight: 600,
                        }}
                      >
                        Place Bid
                      </button>
                    ) : (
                      <div
                        style={{
                          background: "rgba(99,102,241,0.07)",
                          border: "1px solid rgba(99,102,241,0.2)",
                          borderRadius: 8,
                          padding: 14,
                          display: "flex",
                          flexDirection: "column",
                          gap: 10,
                        }}
                      >
                        <textarea
                          placeholder="Your proposal..."
                          value={state.proposal}
                          onChange={(e) =>
                            setBidState(key, { proposal: e.target.value })
                          }
                          rows={3}
                          style={{
                            background: "rgba(15,23,42,0.8)",
                            border: "1px solid rgba(99,102,241,0.3)",
                            borderRadius: 6,
                            color: "#e2e8f0",
                            fontSize: 13,
                            padding: "8px 10px",
                            resize: "vertical",
                            fontFamily: "inherit",
                            outline: "none",
                          }}
                        />
                        <input
                          type="number"
                          placeholder="Rate in HBAR"
                          value={state.rateHBAR}
                          onChange={(e) =>
                            setBidState(key, { rateHBAR: e.target.value })
                          }
                          style={{
                            background: "rgba(15,23,42,0.8)",
                            border: "1px solid rgba(99,102,241,0.3)",
                            borderRadius: 6,
                            color: "#e2e8f0",
                            fontSize: 13,
                            padding: "8px 10px",
                            outline: "none",
                          }}
                        />
                        {state.error && (
                          <div style={{ fontSize: 12, color: "#ef4444" }}>
                            {state.error}
                          </div>
                        )}
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            onClick={() => handlePlaceBid(job.id)}
                            disabled={state.submitting}
                            style={{
                              padding: "6px 16px",
                              background: state.submitting
                                ? "#4b5563"
                                : "linear-gradient(135deg, #6366f1, #a855f7)",
                              borderRadius: 6,
                              color: "white",
                              cursor: state.submitting ? "not-allowed" : "pointer",
                              fontSize: 13,
                              border: "none",
                              fontWeight: 600,
                            }}
                          >
                            {state.submitting ? "Submitting..." : "Submit Bid"}
                          </button>
                          <button
                            onClick={() => setOpenBidJobId(null)}
                            style={{
                              padding: "6px 14px",
                              background: "transparent",
                              borderRadius: 6,
                              color: "#94a3b8",
                              cursor: "pointer",
                              fontSize: 13,
                              border: "1px solid rgba(148,163,184,0.3)",
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default JobBoard;
