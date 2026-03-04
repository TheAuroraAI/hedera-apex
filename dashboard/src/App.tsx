import React, { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import AgentList from "./components/AgentList";
import JobBoard from "./components/JobBoard";
import Stats from "./components/Stats";
import ConnectWallet from "./components/ConnectWallet";
import PostJobModal from "./components/PostJobModal";
import { CONTRACTS, REGISTRY_ABI, ESCROW_ABI } from "./contracts";
import type { Agent, Job } from "./types";
import { MOCK_AGENTS, MOCK_JOBS } from "./mockData";

const IS_DEMO = CONTRACTS.AgentRegistry === "0x0000000000000000000000000000000000000000";

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  app: {
    minHeight: "100vh",
    background: "linear-gradient(135deg, #0a0e1a 0%, #0d1b2a 50%, #0a1628 100%)",
    color: "#e2e8f0",
  },
  header: {
    borderBottom: "1px solid rgba(99,102,241,0.3)",
    padding: "16px 32px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    backdropFilter: "blur(10px)",
    background: "rgba(10,14,26,0.8)",
    position: "sticky" as const,
    top: 0,
    zIndex: 100,
  },
  logo: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },
  logoIcon: {
    width: 36,
    height: 36,
    background: "linear-gradient(135deg, #6366f1, #a855f7)",
    borderRadius: 8,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 18,
    fontWeight: 700,
  },
  logoText: {
    fontSize: 20,
    fontWeight: 700,
    background: "linear-gradient(135deg, #6366f1, #a855f7)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
  },
  logoSub: {
    fontSize: 11,
    color: "#94a3b8",
    marginTop: 2,
  },
  main: {
    maxWidth: 1200,
    margin: "0 auto",
    padding: "32px 24px",
  },
  tabs: {
    display: "flex",
    gap: 8,
    marginBottom: 32,
    borderBottom: "1px solid rgba(99,102,241,0.2)",
  },
  tab: {
    padding: "10px 20px",
    background: "none",
    border: "none",
    color: "#94a3b8",
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 500,
    borderBottom: "2px solid transparent",
    transition: "all 0.2s",
    marginBottom: -1,
  },
  activeTab: {
    color: "#6366f1",
    borderBottom: "2px solid #6366f1",
  },
  postBtn: {
    padding: "10px 20px",
    background: "linear-gradient(135deg, #6366f1, #a855f7)",
    border: "none",
    borderRadius: 8,
    color: "white",
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 600,
    transition: "opacity 0.2s",
  },
  networkBadge: {
    padding: "4px 10px",
    background: "rgba(99,102,241,0.15)",
    border: "1px solid rgba(99,102,241,0.3)",
    borderRadius: 20,
    fontSize: 12,
    color: "#a5b4fc",
  },
  error: {
    background: "rgba(239,68,68,0.1)",
    border: "1px solid rgba(239,68,68,0.3)",
    borderRadius: 8,
    padding: "12px 16px",
    color: "#fca5a5",
    marginBottom: 16,
    fontSize: 14,
  },
};

// ─── App ─────────────────────────────────────────────────────────────────────

type Tab = "agents" | "jobs" | "stats";

export default function App() {
  const [tab, setTab] = useState<Tab>("agents");
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [signer, setSigner] = useState<ethers.JsonRpcSigner | null>(null);
  const [account, setAccount] = useState<string>("");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPostJob, setShowPostJob] = useState(false);

  // Try to use a read-only provider with testnet RPC for demo
  const getReadProvider = useCallback(() => {
    if (provider) return provider;
    return new ethers.JsonRpcProvider("https://testnet.hashio.io/api");
  }, [provider]);

  const loadData = useCallback(async () => {
    // Demo mode: use mock data until testnet contracts are deployed
    if (IS_DEMO) {
      setAgents(MOCK_AGENTS);
      setJobs(MOCK_JOBS);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const p = getReadProvider();
      const registryContract = new ethers.Contract(
        CONTRACTS.AgentRegistry,
        REGISTRY_ABI,
        p
      );
      const escrowContract = new ethers.Contract(
        CONTRACTS.JobEscrow,
        ESCROW_ABI,
        p
      );

      // Load agents
      const [agentAddresses] = await Promise.all([
        registryContract.getAllAgents().catch(() => [] as string[]),
      ]);

      const agentData: Agent[] = await Promise.all(
        (agentAddresses as string[]).slice(0, 50).map(async (addr: string) => {
          const a = await registryContract.getAgent(addr);
          return {
            wallet: addr,
            name: a.name,
            hcsTopicId: a.hcsTopicId,
            capabilities: [...a.capabilities],
            ratePerJob: a.ratePerJob,
            stakedAmount: a.stakedAmount,
            completedJobs: a.completedJobs,
            totalRating: a.totalRating,
            status: Number(a.status),
          };
        })
      );
      setAgents(agentData);

      // Load recent jobs (IDs 1..N, try up to 20)
      const jobData: Job[] = [];
      const jobCount = await escrowContract.jobCount().catch(() => 0n);
      const limit = Math.min(Number(jobCount), 20);
      for (let i = 1; i <= limit; i++) {
        try {
          const j = await escrowContract.getJob(i);
          jobData.push({
            id: j.id,
            client: j.client,
            agent: j.agent,
            title: j.title,
            description: j.description,
            requiredCaps: [...j.requiredCaps],
            payment: j.payment,
            deadline: j.deadline,
            status: Number(j.status),
            deliverableUri: j.deliverableUri,
            clientRating: j.clientRating,
          });
        } catch {}
      }
      setJobs(jobData);
    } catch (e: unknown) {
      setError(`Failed to load data: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [getReadProvider]);

  useEffect(() => {
    // Always try to load data using public RPC in read-only mode
    loadData();
  }, [loadData]);

  const connectWallet = async () => {
    if (!window.ethereum) {
      setError("MetaMask not detected. Install MetaMask to interact with HACP.");
      return;
    }
    try {
      const p = new ethers.BrowserProvider(window.ethereum);
      const accounts = await p.send("eth_requestAccounts", []);
      const s = await p.getSigner();
      setProvider(p);
      setSigner(s);
      setAccount(accounts[0]);

      // Check/switch to Hedera testnet
      try {
        await p.send("wallet_switchEthereumChain", [{ chainId: "0x128" }]); // 296
      } catch {
        // Add chain if not present
        await p.send("wallet_addEthereumChain", [
          {
            chainId: "0x128",
            chainName: "Hedera Testnet",
            rpcUrls: ["https://testnet.hashio.io/api"],
            nativeCurrency: { name: "HBAR", symbol: "HBAR", decimals: 18 },
            blockExplorerUrls: ["https://hashscan.io/testnet"],
          },
        ]);
      }

      await loadData();
    } catch (e: unknown) {
      setError(`Wallet connection failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div style={styles.app}>
      <header style={styles.header}>
        <div style={styles.logo}>
          <div style={styles.logoIcon}>H</div>
          <div>
            <div style={styles.logoText}>HACP</div>
            <div style={styles.logoSub}>Hedera Agent Commerce Protocol</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {IS_DEMO && (
            <span style={{ padding: "4px 10px", background: "rgba(234,179,8,0.15)", border: "1px solid rgba(234,179,8,0.4)", borderRadius: 20, fontSize: 12, color: "#fbbf24", fontWeight: 600 }}>
              DEMO MODE
            </span>
          )}
          <span style={styles.networkBadge}>Hedera Testnet</span>
          <ConnectWallet account={account} onConnect={connectWallet} />
        </div>
      </header>

      <main style={styles.main}>
        {error && <div style={styles.error}>{error}</div>}

        {/* Tabs */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={styles.tabs}>
            {(["agents", "jobs", "stats"] as Tab[]).map((t) => (
              <button
                key={t}
                style={{ ...styles.tab, ...(tab === t ? styles.activeTab : {}) }}
                onClick={() => setTab(t)}
              >
                {t === "agents" && `Agents (${agents.length})`}
                {t === "jobs" && `Job Board (${jobs.length})`}
                {t === "stats" && "Stats"}
              </button>
            ))}
          </div>
          {tab === "jobs" && account && (
            <button style={styles.postBtn} onClick={() => setShowPostJob(true)}>
              + Post Job
            </button>
          )}
        </div>

        {loading ? (
          <LoadingSpinner />
        ) : (
          <>
            {tab === "agents" && <AgentList agents={agents} onRefresh={loadData} />}
            {tab === "jobs" && (
              <JobBoard jobs={jobs} signer={signer} account={account} onRefresh={loadData} />
            )}
            {tab === "stats" && <Stats agents={agents} jobs={jobs} />}
          </>
        )}
      </main>

      {showPostJob && (
        <PostJobModal
          signer={signer}
          onClose={() => setShowPostJob(false)}
          onSuccess={() => {
            setShowPostJob(false);
            loadData();
          }}
        />
      )}
    </div>
  );
}

function LoadingSpinner() {
  return (
    <div style={{ textAlign: "center", padding: "80px 0", color: "#6366f1" }}>
      <div style={{ fontSize: 40, marginBottom: 16 }}>⟳</div>
      <div style={{ color: "#94a3b8", fontSize: 14 }}>Loading from Hedera testnet...</div>
    </div>
  );
}

// Augment window type for MetaMask
declare global {
  interface Window {
    ethereum?: {
      request?: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
  }
}
