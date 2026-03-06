import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "../deployments/testnet.json"), "utf8"));
  const [deployer] = await ethers.getSigners();
  const Escrow = await ethers.getContractAt("JobEscrow", dep.contracts.JobEscrow);
  
  const deadline = Math.floor(Date.now() / 1000) + 86400;
  
  // Try static call first to estimate
  try {
    await Escrow.postJob.staticCall(
      "DeFi Smart Contract Audit",
      "Security audit of DeFi lending protocol", 
      ["smart-contract-audit"],
      deadline,
      { value: ethers.parseEther("0.5") }
    );
    console.log("Static call OK");
  } catch(e: any) {
    console.log("Static call failed:", e.message?.slice(0, 200));
    return;
  }
  
  const tx = await Escrow.postJob(
    "DeFi Smart Contract Audit",
    "Security audit of DeFi lending protocol",
    ["smart-contract-audit"],
    deadline,
    { value: ethers.parseEther("0.5"), gasLimit: 1000000 }
  );
  const r = await tx.wait();
  console.log("TX:", r?.hash);
  const total = await Escrow.totalJobs();
  console.log("Total jobs:", total.toString());
}

main().catch(e => { console.error(e.message?.slice(0,300)); process.exit(1); });
