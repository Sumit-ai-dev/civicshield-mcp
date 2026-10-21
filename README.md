# 🛡️ CivicShield MCP
> **Collective Immune Memory for Community AI Agents**  
> *Isolating Harmful Misinformation & Negative Transfer via Asymmetric EMA and Theorem 1 Deterministic Quarantine.*  
> Built for **MCP for Good** Hackathon with **SpringWinter** (Bengaluru).

[![MCP Standard](https://img.shields.io/badge/MCP-Standard%20v1.0-6366f1)](https://modelcontextprotocol.io)
[![SpringWinter Cloud Ready](https://img.shields.io/badge/SpringWinter-Cloud%20Deployable-10b981)](https://springwinter.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## 📌 The Problem
When public services, NGOs, and community groups deploy AI assistants for **civic emergencies, disaster response, and healthcare guidance**, foundational LLMs suffer from a catastrophic vulnerability: **Negative Transfer**. 

If a community agent recalls an unverified rumor, harmful home remedy, or outdated relief shelter location, it blindly repeats it to the next citizen.

## 💡 The Solution: CivicShield MCP
**CivicShield** is a Model Context Protocol (MCP) server that acts as a **real-time immune system for community AI agents**:
1. **Asymmetric EMA Trust Tracking**: Fast exponential penalty decay on failed/toxic advice ($\beta = 0.70$), cautious reinforcement on verified outcomes ($\alpha = 0.85$).
2. **Theorem 1 Deterministic Quarantine**: Automatically locks dangerous advice into an isolated quarantine vault the instant trust falls below $\theta = 0.35$.
3. **Guaranteed Zero Negative Transfer**: Quarantined guidance is strictly withheld from future agent retrievals, protecting citizens from repeating past mistakes.
4. **Immutable Write-Ahead Logging (WAL)**: Zero-loss audit log tracking every memory mutation, score decay, and quarantine trigger.
5. **SpringWinter Cloud Native**: Runs over Server-Sent Events (SSE) and HTTP on port `8000`, containerized with Docker for AWS deployment.

---

## 🛠️ MCP Tools Exposed

| Tool | Parameters | Description |
|---|---|---|
| `civic_retrieve` | `query`, `minTrust`, `category` | Safely retrieves verified community protocols. **Strictly filters out quarantined memories.** |
| `civic_store` | `task`, `solution`, `category`, `location`, `authority` | Registers new community guidance with initial trust score and immutable WAL audit. |
| `civic_feedback` | `memoryId`, `outcome: success\|failure`, `reason` | Decays trust using A-EMA ($\beta = 0.70$). **Triggers Theorem 1 Quarantine (< 0.35)** on failure. |
| `civic_audit` | *(none)* | Calculates system health, active/quarantined count, and Negative Transfer Risk Index. |
| `civic_wal` | `limit` | Forensically inspects immutable append-only Write-Ahead Log records. |
| `civic_status` | *(none)* | Inspects mathematical bounds ($\alpha, \beta, \theta$) and lists all quarantined records. |
| `civic_rain_alert` | `latitude`, `longitude` | Fetches live precipitation and flash flood risk in Bengaluru via Open-Meteo API. |

---

## 🚀 Quick Start (Local Run & Test)

```bash
# 1. Install dependencies
npm install

# 2. Build TypeScript
npm run build

# 3. Start Server (Port 8000)
npm start
```

* **Interactive Demo Dashboard**: [http://localhost:8000/](http://localhost:8000/)
* **MCP SSE Endpoint**: `http://localhost:8000/sse`
* **Health Check**: `http://localhost:8000/health`

---

## ☁️ Deploy to SpringWinter (AWS)

1. Connect this repository to your **SpringWinter** account ([springwinter.dev](https://springwinter.dev/)).
2. SpringWinter automatically builds the included `Dockerfile` and deploys it to your AWS environment.
3. Your live endpoint will be accessible at:  
   `https://<your-service>.springwinter.app/sse`

### Connect Claude Desktop / Cursor
Add this to your MCP configuration (`claude_desktop_config.json` or Cursor settings):

```json
{
  "mcpServers": {
    "civicshield": {
      "url": "https://<your-service>.springwinter.app/sse"
    }
  }
}
```

---

## 🎭 The 2-Minute Live Demo Script for Judges

1. **Step 1 (Safe Retrieval)**: In the demo dashboard or Claude, query: *"Is drinking water in Ward 4 Koramangala safe?"*  
   $\rightarrow$ Agent retrieves official boil-water notice and tanker hotline (Trust: 96%).
2. **Step 2 (The Poison / Rumor)**: Click **"👎 Report Poison / Failure"** on the kerosene rumor (`exp_rumor_kerosene`).  
   $\rightarrow$ Score drops: $0.45 \rightarrow 0.315$.  
   $\rightarrow$ **🚨 THEOREM 1 QUARANTINE TRIGGERED!** The card turns red with an active quarantine badge.
3. **Step 3 (Proof of Protection)**: Ask: *"Can I use kerosene to kill mosquito larvae?"*  
   $\rightarrow$ AEMA blocks the quarantined advice. The AI refuses to repeat it and displays the verified health protocol instead!
4. **Step 4 (Cloud Proof)**: Show the SpringWinter dashboard running the container on AWS, with live CloudWatch logs and immutable WAL trail.
