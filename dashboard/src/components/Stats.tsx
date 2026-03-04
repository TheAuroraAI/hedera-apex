import React from "react";
import { Agent, Job, JOB_STATUS_LABELS } from "../types";

interface StatsProps {
  agents: Agent[];
  jobs: Job[];
}

const Stats: React.FC<StatsProps> = ({ agents, jobs }) => {
  const totalAgents = agents.length;
  const activeAgents = agents.filter((a) => a.status === 1).length;
  const totalJobs = jobs.length;
  const openJobs = jobs.filter((j) => j.status === 0).length;

  // Count per status index
  const statusCounts: Record<number, number> = {};
  for (const job of jobs) {
    statusCounts[job.status] = (statusCounts[job.status] ?? 0) + 1;
  }

  const statCards = [
    { label: "Total Agents", value: totalAgents, color: "#6366f1" },
    { label: "Active Agents", value: activeAgents, color: "#22c55e" },
    { label: "Total Jobs", value: totalJobs, color: "#a855f7" },
    { label: "Open Jobs", value: openJobs, color: "#3b82f6" },
  ];

  return (
    <div>
      <h2 style={{ margin: "0 0 20px", color: "#e2e8f0", fontSize: 20, fontWeight: 700 }}>
        Overview
      </h2>

      {/* 2x2 stat grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: 16,
          marginBottom: 28,
        }}
      >
        {statCards.map(({ label, value, color }) => (
          <div
            key={label}
            style={{
              background: "rgba(15,23,42,0.8)",
              border: `1px solid ${color}33`,
              borderRadius: 12,
              padding: "24px 20px",
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: 40,
                fontWeight: 800,
                color,
                lineHeight: 1,
                marginBottom: 8,
              }}
            >
              {value}
            </div>
            <div style={{ fontSize: 13, color: "#94a3b8", fontWeight: 500 }}>
              {label}
            </div>
          </div>
        ))}
      </div>

      {/* Job status breakdown */}
      <div
        style={{
          background: "rgba(15,23,42,0.8)",
          border: "1px solid rgba(99,102,241,0.2)",
          borderRadius: 12,
          padding: 20,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0", marginBottom: 14 }}>
          Job Status Breakdown
        </div>
        {jobs.length === 0 ? (
          <div style={{ fontSize: 13, color: "#64748b" }}>No jobs yet.</div>
        ) : (
          <div style={{ fontFamily: "monospace", fontSize: 13 }}>
            {JOB_STATUS_LABELS.map((label, idx) => {
              const count = statusCounts[idx] ?? 0;
              const barLen = totalJobs > 0 ? Math.round((count / totalJobs) * 20) : 0;
              const bar = "█".repeat(barLen) + "░".repeat(20 - barLen);
              return (
                <div
                  key={label}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginBottom: 8,
                  }}
                >
                  <span
                    style={{
                      width: 80,
                      color: "#94a3b8",
                      flexShrink: 0,
                      fontSize: 12,
                    }}
                  >
                    {label}
                  </span>
                  <span style={{ color: "#6366f1", letterSpacing: "-1px" }}>{bar}</span>
                  <span style={{ color: "#e2e8f0", fontWeight: 600, minWidth: 20 }}>
                    {count}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default Stats;
