# Hedera Agent Commerce Protocol (HACP)
## Hello Future Apex 2026 — AI & Agents Track

### Core Concept
A decentralized marketplace for AI agents to discover, hire, and pay each other for services on Hedera.
Implements the OpenConvAI specification using HCS (messaging), HSCS (escrow/registry), and HTS (tokens).

### Why This Wins
1. OpenConvAI is a REQUIRED tech for AI & Agents track — few teams implement it fully
2. HCS + HSCS + HTS integration shows deep Hedera knowledge
3. Production quality: tests, SDK, CLI, live demo
4. Economic model: agent staking → reputation → job matching → trustless payment

### Architecture
```
[Agent Registry Contract] ← HSCS (EVM Solidity)
  - Register agent with capabilities, rates, stake
  - Query agents by capability type
  - Slash/reward based on job outcomes

[Job Escrow Contract] ← HSCS  
  - Post jobs with HBAR payment locked in escrow
  - Accept bid → lock payment
  - Release on approval / refund on dispute
  - On-chain job state machine

[Reputation Staking Contract] ← HSCS
  - Stake HACP tokens for reputation multiplier
  - Slash on dispute loss, bonus on job success
  - Track lifetime jobs completed + ratings

[HCS Topic: Agent Discovery] ← HCS
  - Agents publish availability/capabilities to topic
  - Clients subscribe to find matching agents
  - Messages: REGISTER, OFFER, REQUEST, ACCEPT, COMPLETE

[HTS: HACP Service Token]
  - Used for reputation staking
  - Distributable as rewards for quality completions
  - Not required for job execution (HBAR used for payment)
```

### Deliverables
1. Smart contracts (3): AgentRegistry, JobEscrow, ReputationStaking (~700 lines Solidity)
2. TypeScript SDK (~800 lines): wrap contracts + HCS + HTS
3. CLI (12 commands): agent register/list/hire/submit/release...
4. React dashboard: live agent list, job board, reputation scores
5. Full test suite (60+ tests)
6. Demo: 2 agents complete a code review job from post to payment
7. Demo video + pitch deck

### Track
- **Primary**: AI & Agents (OpenConvAI + Hedera Agent Kit)
- **Secondary bounty**: DeFi & Tokenization (HBAR escrow + HTS staking)

### Timeline (20 days)
- Days 1-3: Smart contracts + unit tests
- Days 4-6: TypeScript SDK
- Days 7-8: CLI
- Days 9-11: Frontend dashboard
- Days 12-15: Integration tests + demo setup
- Days 16-18: Documentation + pitch deck
- Days 19-20: Demo video + final polish

### Tech Stack
- Solidity 0.8.x, Hardhat, OpenZeppelin
- TypeScript, Hedera JS SDK, ethers.js
- React + Vite (dashboard)
- Hedera Testnet (demo), Mainnet (production config)
