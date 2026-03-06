import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "../deployments/testnet.json"), "utf8"));
  const [deployer] = await ethers.getSigners();
  
  const Registry = await ethers.getContractAt("AgentRegistry", dep.contracts.AgentRegistry);
  
  // Check contract state
  const minStake = await Registry.minStake();
  const paused = await Registry.paused();
  console.log("minStake:", minStake.toString());
  console.log("paused:", paused);
  console.log("deployer:", deployer.address);
  
  // Try register with 1 ETH (should be > minStake in any unit system)
  console.log("\nAttempting register with 1 ETH...");
  try {
    const tx = await Registry.register(
      "Aurora-Test",
      "0.0.8099681",
      ["code-review"],
      ethers.parseEther("0.001"),
      "ipfs://test",
      { value: ethers.parseEther("1"), gasLimit: 500000 }
    );
    const r = await tx.wait();
    console.log("SUCCESS! TX:", r?.hash);
  } catch(e: any) {
    console.error("FAILED:", e.message?.slice(0, 200));
    // Try static call to get actual revert reason
    try {
      await Registry.register.staticCall(
        "Aurora-Test",
        "0.0.8099681",
        ["code-review"],
        ethers.parseEther("0.001"),
        "ipfs://test",
        { value: ethers.parseEther("1") }
      );
    } catch(se: any) {
      console.error("Static call error:", se.message?.slice(0, 300));
    }
  }
}

main().catch(console.error);
