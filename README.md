# CivicShield MCP

> **An MCP-accessible memory safety layer that tracks experiential reliability, penalizes negative outcomes, and excludes quarantined memories from normal retrieval.**

Built for the **MCP for Good** Hackathon in Bengaluru (co-hosted by **SpringWinter** and **Antigravity**).

---

## 1. Problem Statement
When community organizations and public services deploy conversational AI assistants for civic emergencies (water contamination, high-voltage electrical hazards, urban transit routes), conventional RAG and agent architectures suffer from **negative transfer**:

* An agent retrieves an unverified recommendation, toxic community rumor, or outdated procedure from past memory.
* If that advice causes real-world harm or failure, standard memory systems continue retrieving and repeating that same faulty memory to subsequent citizens.
* Foundational LLMs cannot distinguish an experiential memory that recently failed from one with a proven track record of safe community outcomes.

---

## 2. Architecture & Core Mechanism

```
                                  +-------------------------------------------+
                                  |  AI Agent (Claude / Cursor / Web Console) |
                                  +-------------------------------------------+
                                                        |
                                                        | MCP over SSE (/sse, /messages?sessionId=)
                                                        v
                                  +-------------------------------------------+
                                  |     CivicShield MCP Protocol Server       |
                                  |     (Express + @modelcontextprotocol/sdk) |
                                  +-------------------------------------------+
                                                        |
                         +------------------------------+------------------------------+
                         |                                                             |
                         v                                                             v
        +----------------------------------+                         +----------------------------------+
        |   Safe Retrieval Filter Engine   |                         |  A-EMA Trust & Quarantine Engine |
        |                                  |                         |                                  |
        | - Excludes if isQuarantined=true |                         | Success: S_t = 0.85*S + 0.15     |
        | - Excludes if trustScore < theta |                         | Failure: S_t = 0.70*S            |
        | - Composite rank: lexical + trust|                         | Cutoff:  theta = 0.35 (strict)   |
        +----------------------------------+                         +----------------------------------+
                         |                                                             |
                         +------------------------------+------------------------------+
                                                        |
                                                        v
                                  +-------------------------------------------+
                                  |        Durable ACID SQLite Storage        |
                                  |                                           |
                                  |  - memories: state, trust, provenance     |
                                  |  - applied_feedback_events: idempotency   |
                                  |  - wal_events: append-only audit trail    |
                                  +-------------------------------------------+
```

### Trust Score Definition
> **Important Distinction:** A trust score in CivicShield is an **operational reliability heuristic** tracking historical success and failure outcomes. It is **NOT** a calibrated statistical probability that an empirical claim is scientifically true.

### Trust Update Equations (Asymmetric EMA)
Feedback modifies a memory's reliability score deterministically:

$$\text{Success: } S_t = \alpha S_{t-1} + (1 - \alpha) \cdot 1.0 \quad (\alpha = 0.85)$$

$$\text{Failure: } S_t = \beta S_{t-1} \quad (\beta = 0.70)$$

All scores are deterministically rounded to 4 decimal places and bounded in $[0.0, 1.0]$.

### Theorem 1 Quarantine Bound
A memory transitions into quarantine **strictly when its trust score falls below the cutoff**:

$$\text{Quarantine Triggered: } S_t < \theta \quad (\theta = 0.35)$$

* **Exact Boundary Behavior:** If $S_t = 0.35$, the memory is **NOT** quarantined (condition is strict inequality).
* **Guaranteed Exclusion:** Normal retrieval enforces a dual-condition safety filter: any memory with `isQuarantined === true` **OR** `trustScore < 0.35` is completely excluded from candidate results.
* **Provisional Ingestion:** Client-submitted memories are ingested in a provisional `unverified` status, and their initial trust is capped at $0.60$ so untrusted inputs cannot bypass safety thresholds.

---

## 3. MCP Tools Exposed

| Tool | Parameters | Description |
|---|---|---|
| `civic_retrieve` | `query`, `minTrust?`, `category?`, `location?` | Retrieves eligible guidance. **Quarantined records are strictly excluded.** |
| `civic_store` | `task`, `solution`, `category`, `location?`, `claimedAuthority?`, `initialTrust?` | Ingests community advice under safe provisional status (capped at 0.60 trust). |
| `civic_feedback` | `memoryId`, `outcome: success\|failure`, `reason?`, `eventId?` | Applies A-EMA update. Enforces idempotency via `eventId`. Triggers quarantine if score $< 0.35$. |
| `civic_audit` | *(none)* | Calculates system health diagnostics and Negative Transfer Risk Index. |
| `civic_wal` | `limit?` | Inspects append-only audit records from durable SQLite storage. |
| `civic_status` | *(none)* | Inspects mathematical bounds and lists all currently quarantined records. |
| `civic_rain_alert` | `latitude?`, `longitude?` | Fetches live precipitation from Open-Meteo API for situational transit context. |

---

## 4. Installation & Local Execution

### Prerequisites
* Node.js v22+ or v26+ (supports native `node:sqlite`)
* npm v10+

### Setup Commands
```bash
# 1. Clone repository
git clone https://github.com/Sumit-ai-dev/civicshield-mcp.git
cd civicshield-mcp

# 2. Install dependencies
npm install

# 3. Run automated test suite
npm test

# 4. Build TypeScript to dist/
npm run build

# 5. Start server on port 8000
npm start
```

* **Interactive Web Console**: [http://localhost:8000/](http://localhost:8000/)
* **MCP SSE Endpoint**: `http://localhost:8000/sse`
* **Health Check**: `http://localhost:8000/health`

---

## 5. Configuration & Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8000` | HTTP and SSE listening port. |
| `DATABASE_PATH` | `./data/civicshield.sqlite` | SQLite database file location (`:memory:` for ephemeral tests). |
| `DEMO_RESET_TOKEN` | *(empty)* | Optional authorization token required for `POST /api/reset` in production. |
| `CORS_ORIGIN` | `*` | Allowed CORS origins (set to specific domain in production). |
| `GROQ_API_KEY` | *(empty)* | Optional Groq key for natural language response formatting. Core MCP works 100% offline without it. |
| `GROQ_MODEL` | `qwen/qwen3.8-27b` | Groq model identifier for dispatch synthesis. |

---

## 6. Multi-Client Transport Architecture
Unlike naive implementations that store a single global transport, CivicShield implements **session-aware SSE connection routing**:
* Each connected client receives a unique session ID (`transport.sessionId`).
* POST messages are routed via `/messages?sessionId=<uuid>`.
* Disconnected sessions are automatically cleaned up on socket close events.

---

## 7. Connecting to AI Agents

### Cursor / VS Code
1. Open Cursor Settings $\rightarrow$ Features $\rightarrow$ **MCP Servers** $\rightarrow$ **Add New MCP Server**.
2. Set Type: `sse`, URL: `http://localhost:8000/sse` (or your SpringWinter deployment URL).

### Claude Desktop
Add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "civicshield": {
      "url": "http://localhost:8000/sse"
    }
  }
}
```

---

## 8. Deterministic Live Demo Workflow (For Judges)

The core demonstration proves the failure-to-quarantine-to-exclusion pipeline:

1. **Step 1 (Inspect the Benchmark Fixture):**
   * View the seeded benchmark fixture: `exp_rumor_kerosene` (*"kill mosquito larvae in drinking water"*).
   * Note its starting trust score of **$45.0\%$** and status **ACTIVE**.
2. **Step 2 (Initial Retrieval):**
   * Query: *"Can I add kerosene to drinking water to kill mosquito larvae?"*
   * Observe that prior to failure reporting, the query surfaces the candidate memory.
3. **Step 3 (Submit Failure Outcome):**
   * Click **"Flag Incident / Failure"** on the card (or call `civic_feedback` with `outcome: "failure"`).
   * **Trust calculation:** $0.45 \times 0.70 = 0.315$.
   * Because $0.315 < 0.35$, **Theorem 1 Quarantine triggers immediately**.
   * The record is locked in the quarantine vault, and the WAL audit log records the isolation event.
4. **Step 4 (Proof of Quarantine Exclusion):**
   * Submit the exact same query again.
   * Observe that normal retrieval **strictly excludes** the quarantined advice. The client refuses to provide dangerous advice and directs the user to verified official emergency resources.
5. **Step 5 (Durable Persistence Check):**
   * Restart the server process (`npm start`).
   * Observe in the logs that SQLite restores the memory with its quarantined status intact.

---

## 9. Security Assumptions & Known Limitations

1. **Durability Model:** Storage uses SQLite WAL mode on the local filesystem. It provides process-restart crash resilience on a single container or VM. It is not a distributed Byzantine consensus system.
2. **Audit Integrity:** Write-Ahead Logging is append-only at the application layer. It is not backed by cryptographic Merkle trees or external digital signatures.
3. **Retrieval Mechanism:** Retrieval uses deterministic lexical token overlap combined with historical trust score weighting. It does not run high-dimensional vector embeddings, avoiding external vector DB dependencies during hackathon execution.
4. **Meteorological Advisory:** The `civic_rain_alert` tool reports observed atmospheric precipitation from Open-Meteo. It provides general weather context and does not constitute a certified civil hydraulic flood forecast.
