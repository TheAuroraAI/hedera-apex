import React, { useState } from "react";
import { ethers } from "ethers";
import { CONTRACTS, ESCROW_ABI } from "../contracts";

interface PostJobModalProps {
  signer: ethers.JsonRpcSigner | null;
  onClose: () => void;
  onSuccess: () => void;
}

interface FormState {
  title: string;
  description: string;
  capabilities: string;
  deadline: string;
  paymentHBAR: string;
}

const EMPTY_FORM: FormState = {
  title: "",
  description: "",
  capabilities: "",
  deadline: "",
  paymentHBAR: "",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "rgba(15,23,42,0.9)",
  border: "1px solid rgba(99,102,241,0.3)",
  borderRadius: 6,
  color: "#e2e8f0",
  fontSize: 14,
  padding: "9px 12px",
  outline: "none",
  boxSizing: "border-box",
  fontFamily: "inherit",
};

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#94a3b8",
  marginBottom: 4,
  display: "block",
  fontWeight: 500,
};

const PostJobModal: React.FC<PostJobModalProps> = ({ signer, onClose, onSuccess }) => {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const setField = (field: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setError("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!signer) {
      setError("Wallet not connected.");
      return;
    }
    if (!form.title.trim()) {
      setError("Title is required.");
      return;
    }
    if (!form.deadline) {
      setError("Deadline is required.");
      return;
    }
    const paymentNum = parseFloat(form.paymentHBAR);
    if (isNaN(paymentNum) || paymentNum <= 0) {
      setError("Enter a valid payment amount in HBAR.");
      return;
    }

    const deadlineTs = BigInt(Math.floor(new Date(form.deadline).getTime() / 1000));
    const caps = form.capabilities
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);

    // Convert HBAR to wei-equivalent for value (parseEther treats 1 unit = 1e18)
    const valueWei = ethers.parseEther(form.paymentHBAR);

    setSubmitting(true);
    setError("");

    try {
      const escrow = new ethers.Contract(CONTRACTS.JobEscrow, ESCROW_ABI, signer);
      const tx = await escrow.postJob(
        form.title.trim(),
        form.description.trim(),
        caps,
        deadlineTs,
        { value: valueWei }
      );
      await tx.wait();
      setSubmitting(false);
      onSuccess();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Transaction failed.";
      setError(message.slice(0, 160));
      setSubmitting(false);
    }
  };

  return (
    /* Overlay */
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.7)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Modal box */}
      <div
        style={{
          background: "#0f172a",
          border: "1px solid rgba(99,102,241,0.3)",
          borderRadius: 14,
          padding: 32,
          width: "100%",
          maxWidth: 480,
          position: "relative",
          boxShadow: "0 24px 48px rgba(0,0,0,0.5)",
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            background: "transparent",
            border: "none",
            color: "#64748b",
            fontSize: 20,
            cursor: "pointer",
            lineHeight: 1,
            padding: 4,
          }}
          aria-label="Close"
        >
          ✕
        </button>

        <h2 style={{ margin: "0 0 24px", color: "#e2e8f0", fontSize: 20, fontWeight: 700 }}>
          Post a Job
        </h2>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Title */}
          <div>
            <label style={labelStyle}>Title</label>
            <input
              type="text"
              placeholder="e.g. Smart contract audit"
              value={form.title}
              onChange={(e) => setField("title", e.target.value)}
              style={inputStyle}
            />
          </div>

          {/* Description */}
          <div>
            <label style={labelStyle}>Description</label>
            <textarea
              placeholder="Describe the job..."
              value={form.description}
              onChange={(e) => setField("description", e.target.value)}
              rows={4}
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </div>

          {/* Capabilities */}
          <div>
            <label style={labelStyle}>Required Capabilities (comma-separated)</label>
            <input
              type="text"
              placeholder="e.g. solidity, audit, defi"
              value={form.capabilities}
              onChange={(e) => setField("capabilities", e.target.value)}
              style={inputStyle}
            />
          </div>

          {/* Deadline */}
          <div>
            <label style={labelStyle}>Deadline</label>
            <input
              type="datetime-local"
              value={form.deadline}
              onChange={(e) => setField("deadline", e.target.value)}
              style={{
                ...inputStyle,
                colorScheme: "dark",
              }}
            />
          </div>

          {/* Payment */}
          <div>
            <label style={labelStyle}>Payment (HBAR)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="e.g. 100"
              value={form.paymentHBAR}
              onChange={(e) => setField("paymentHBAR", e.target.value)}
              style={inputStyle}
            />
          </div>

          {/* Error */}
          {error && (
            <div
              style={{
                fontSize: 13,
                color: "#ef4444",
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.3)",
                borderRadius: 6,
                padding: "8px 12px",
              }}
            >
              {error}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <button
              type="submit"
              disabled={submitting}
              style={{
                flex: 1,
                padding: "10px 0",
                background: submitting
                  ? "#4b5563"
                  : "linear-gradient(135deg, #6366f1, #a855f7)",
                borderRadius: 8,
                color: "white",
                cursor: submitting ? "not-allowed" : "pointer",
                fontSize: 14,
                border: "none",
                fontWeight: 700,
              }}
            >
              {submitting ? "Posting..." : "Post Job"}
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "10px 20px",
                background: "transparent",
                borderRadius: 8,
                color: "#94a3b8",
                cursor: "pointer",
                fontSize: 14,
                border: "1px solid rgba(148,163,184,0.3)",
                fontWeight: 600,
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default PostJobModal;
