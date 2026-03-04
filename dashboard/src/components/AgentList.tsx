import React from "react";
import { Agent } from "../types";

interface AgentListProps {
  agents: Agent[];
  onRefresh: () => void;
}

const AGENT_STATUS_LABELS: Record<number, string> = {
  0: "Inactive",
  1: "Active",
  2: "Suspended",
};

const AGENT_STATUS_COLORS: Record<number, string> = {
  0: "#6b7280",
  1: "#22c55e",
  2: "#ef4444",
};

const AgentList: React.FC<AgentListProps> = ({ agents, onRefresh }) => {
  const formatWallet = (wallet: string): string =>
    wallet.length >= 12 ? `${wallet.slice(0, 8)}...${wallet.slice(-4)}` : wallet;

  const formatHBAR = (tinybar: bigint): string => {
    const hbar = Number(tinybar) / 1e8;
    return `${hbar.toFixed(2)} HBAR`;
  };

  const avgRating = (agent: Agent): string => {
    if (agent.completedJobs > 0n) {
      const avg = Number(agent.totalRating) / Number(agent.completedJobs);
      return avg.toFixed(1);
    }
    return "0.0";
  };

  return (
    <div>
      {/* Header row */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20,
        }}
      >
        <h2 style={{ margin: 0, color: "#e2e8f0", fontSize: 20, fontWeight: 700 }}>
          Registered Agents
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
      {agents.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "60px 20px",
            color: "#64748b",
            fontSize: 15,
          }}
        >
          No agents registered yet.
        </div>
      ) : (
        /* Grid */
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 20,
          }}
        >
          {agents.map((agent) => {
            const statusColor = AGENT_STATUS_COLORS[agent.status] ?? "#6b7280";
            const statusLabel = AGENT_STATUS_LABELS[agent.status] ?? "Unknown";

            return (
              <div
                key={agent.wallet}
                style={{
                  background: "rgba(15,23,42,0.8)",
                  border: "1px solid rgba(99,102,241,0.2)",
                  borderRadius: 12,
                  padding: 20,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                {/* Name + status badge */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                  }}
                >
                  <span
                    style={{
                      fontWeight: 700,
                      fontSize: 16,
                      color: "#e2e8f0",
                    }}
                  >
                    {agent.name}
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
                    }}
                  >
                    {statusLabel}
                  </span>
                </div>

                {/* Wallet */}
                <div style={{ fontSize: 12, color: "#94a3b8" }}>
                  {formatWallet(agent.wallet)}
                </div>

                {/* Capabilities chips */}
                {agent.capabilities.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {agent.capabilities.map((cap) => (
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

                {/* Stats row */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginTop: 4,
                    paddingTop: 10,
                    borderTop: "1px solid rgba(99,102,241,0.12)",
                  }}
                >
                  <div style={{ fontSize: 12, color: "#94a3b8" }}>
                    <span style={{ color: "#e2e8f0", fontWeight: 600 }}>
                      {Number(agent.completedJobs)}
                    </span>{" "}
                    jobs
                  </div>
                  <div style={{ fontSize: 12, color: "#94a3b8" }}>
                    ★{" "}
                    <span style={{ color: "#fbbf24", fontWeight: 600 }}>
                      {avgRating(agent)}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "#94a3b8" }}>
                    <span style={{ color: "#e2e8f0", fontWeight: 600 }}>
                      {formatHBAR(agent.stakedAmount)}
                    </span>{" "}
                    staked
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AgentList;
