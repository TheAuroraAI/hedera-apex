#!/bin/bash
# HACP Demo Script — runs key project commands for asciinema recording
# Run: asciinema rec hacp-demo.cast -c "bash scripts/demo-run.sh"

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

step() {
  echo ""
  echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
  echo -e "${CYAN}  $1${NC}"
  echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
  sleep 1
}

cmd() {
  echo -e "${YELLOW}\$ $1${NC}"
  sleep 0.5
  eval "$1"
  sleep 0.8
}

clear

echo -e "${GREEN}"
cat << 'BANNER'
██╗  ██╗ █████╗  ██████╗██████╗
██║  ██║██╔══██╗██╔════╝██╔══██╗
███████║███████║██║     ██████╔╝
██╔══██║██╔══██║██║     ██╔═══╝
██║  ██║██║  ██║╚██████╗██║
╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝╚═╝
BANNER
echo -e "${NC}"
echo -e "  ${BOLD}Hedera Agent Commerce Protocol${NC}"
echo "  Hello Future Apex 2026 — AI & Agents Track"
echo ""
echo "  Trustless marketplace for AI agents to discover,"
echo "  hire, and pay each other on Hedera."
echo ""
sleep 2

step "1. Test Suite — 110 Tests (AgentRegistry + JobEscrow + ReputationStaking)"
cmd "npm test 2>&1 | grep -E 'passing|failing|✓|✗' | tail -20"

step "2. Deployed Contracts (Hedera Testnet, 2026-03-06)"
echo ""
echo -e "  ${BOLD}4 contracts live on Hedera testnet:${NC}"
echo ""
echo "  AgentRegistry     → 0x1fca2Bc...E434677D1F5CC34B9ce9ca"
echo "  JobEscrow         → 0xFD41170...9de337863d3469729dFb8"
echo "  ReputationStaking → 0x909A60F...01c7F2FFFb6cdFe3F659bd9c26"
echo "  HACPToken (HTS)   → 0x466968A...Ba0EF56CF7Cf948b0747eed"
echo "  HCS Topic         → 0.0.8099681 (OpenConvAI discovery)"
echo ""
sleep 2

step "3. CLI — Query Bob's Agent Profile (registered on testnet)"
cmd "npm run cli -- agent info 0x660732C5D1e41ef5b38fbcffEfDc19B82A05160d 2>&1"

step "4. CLI — Alice's Agent Profile"
cmd "npm run cli -- agent info 0x515eE6A84cAd452a7328048d4907653b2F60846d 2>&1"

step "5. AI Agent Demo — Two Gemini Agents on Hedera Testnet"
echo "  Alice: autonomous client agent (powered by Gemini 2.0 Flash)"
echo "  Bob:   autonomous security auditor agent"
echo ""
echo "  Each agent step = a real Hedera testnet transaction."
echo "  Full AI reasoning when Gemini API quota is available."
echo ""
sleep 2
cmd "npm run ai-demo 2>&1"

step "6. Live Dashboard"
echo ""
echo -e "  ${BOLD}https://dashboard-fawn-sigma.vercel.app${NC}"
echo ""
echo "  Real-time agent list, job board, and reputation scores"
echo "  built with React + ethers.js → Hedera testnet."
sleep 3

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  HACP — Trustless Commerce for the Agent Economy          ${NC}"
echo -e "${GREEN}  github.com/TheAuroraAI/hedera-apex                       ${NC}"
echo -e "${GREEN}  Dashboard: dashboard-fawn-sigma.vercel.app               ${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo ""
