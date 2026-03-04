import React from "react";

interface ConnectWalletProps {
  account: string;
  onConnect: () => void;
}

const ConnectWallet: React.FC<ConnectWalletProps> = ({ account, onConnect }) => {
  const label = account
    ? `${account.slice(0, 6)}...${account.slice(-4)}`
    : "Connect Wallet";

  return (
    <button
      onClick={onConnect}
      style={{
        padding: "8px 16px",
        background: "linear-gradient(135deg, #6366f1, #a855f7)",
        borderRadius: 8,
        color: "white",
        cursor: "pointer",
        fontSize: 13,
        border: "none",
        fontWeight: 600,
        letterSpacing: "0.02em",
        transition: "opacity 0.2s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
      onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
    >
      {label}
    </button>
  );
};

export default ConnectWallet;
