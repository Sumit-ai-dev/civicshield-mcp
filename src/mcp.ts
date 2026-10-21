/**
 * CivicShield Model Context Protocol (MCP) Server
 * Exposes 7 community tools for AI agents, Claude, Cursor, and custom clients
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { memoryStore } from './memoryStore.js';
import { wal } from './wal.js';
import {
  DEFAULT_ALPHA,
  DEFAULT_BETA,
  DEFAULT_QUARANTINE_THRESHOLD,
  computeQuarantineSteps,
} from './trust.js';
import { MemoryCategory } from './types.js';

export const mcpServer = new McpServer({
  name: 'civicshield-community-immune-mcp',
  version: '1.0.0',
});

// Tool 1: Retrieve Reliable Community Guidance
mcpServer.tool(
  'civic_retrieve',
  'Retrieve verified, non-quarantined community guidance for civic emergencies, public healthcare, or disaster relief. Strictly filters out quarantined records to prevent negative transfer.',
  {
    query: z.string().min(1).describe('The problem or situation description (e.g., "water contamination Koramangala", "sparking transformer", "flood route")'),
    minTrust: z.number().min(0.0).max(1.0).optional().describe('Minimum trust score cutoff (default: 0.35)'),
    category: z.enum(['civic', 'health', 'disaster', 'welfare']).optional().describe('Scope category filter'),
    location: z.string().optional().describe('Optional geographic locality filter (e.g. "Koramangala", "Bengaluru Central")'),
  },
  async ({ query, minTrust, category, location }) => {
    const results = memoryStore.retrieve(
      query,
      minTrust ?? DEFAULT_QUARANTINE_THRESHOLD,
      category as MemoryCategory,
      location
    );

    if (results.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `[NOTICE] No verified community guidance matching criteria found for "${query}".\nNote: Any unverified, low-trust, or quarantined records were strictly omitted to maintain citizen safety.`,
          },
        ],
      };
    }

    const formatted = results.map((r, i) => {
      const fixtureTag = r.memory.isTestFixture ? ' [TEST FIXTURE - DO NOT USE IN REAL LIFE]' : '';
      return `### [${i + 1}] ${r.memory.task.toUpperCase()}${fixtureTag}\n` +
        `- **Memory ID**: \`${r.memory.id}\`\n` +
        `- **Trust Score**: ${(r.memory.trustScore * 100).toFixed(1)}% | Effective Rank: ${r.effectiveScore}\n` +
        `- **Verification Status**: \`${r.memory.verificationStatus.toUpperCase()}\`\n` +
        `- **Authority / Provenance**: ${r.memory.authority} (${r.memory.location})\n` +
        `- **Guidance Action**:\n> ${r.memory.solution}\n` +
        `- **Reliability Heuristic**: ${r.isReliable ? '[VERIFIED RELIABLE]' : '[PROVISIONAL / MONITOR]'}`;
    }).join('\n\n---\n\n');

    return {
      content: [
        {
          type: 'text',
          text: `Found ${results.length} eligible community protocols (quarantined items strictly excluded):\n\n${formatted}`,
        },
      ],
    };
  }
);

// Tool 2: Store New Community Guidance (Secure Ingestion Policy)
mcpServer.tool(
  'civic_store',
  'Submit a community relief tip or official procedure. Ingestion policy: client submissions are stored as unverified/provisional with capped initial trust (max 0.60) to prevent unverified rumors from bypassing safety bounds.',
  {
    task: z.string().min(5).max(500).describe('Description of the community situation or emergency need'),
    solution: z.string().min(5).max(1500).describe('The suggested action, protocol, or official helpline'),
    category: z.enum(['civic', 'health', 'disaster', 'welfare']).describe('Category of guidance'),
    location: z.string().max(150).optional().describe('Locality or jurisdiction (e.g. "Koramangala", "Bengaluru Central")'),
    claimedAuthority: z.string().max(150).optional().describe('Claimed issuing organization or source'),
    initialTrust: z.number().min(0.0).max(0.60).optional().describe('Proposed initial trust (capped at 0.60 for unverified submissions; default: 0.50)'),
  },
  async ({ task, solution, category, location, claimedAuthority, initialTrust }) => {
    try {
      const mem = memoryStore.store(
        task,
        solution,
        category,
        location ?? 'Bengaluru',
        claimedAuthority ?? 'Community Contributor',
        initialTrust
      );

      return {
        content: [
          {
            type: 'text',
            text: `[INGESTED] Registered provisional community memory [${mem.id}].\n` +
              `- Category: ${mem.category.toUpperCase()}\n` +
              `- Verification Status: ${mem.verificationStatus.toUpperCase()} (Provisional submission)\n` +
              `- Assigned Trust Score: ${(mem.trustScore * 100).toFixed(1)}% (capped at 60% until verified)\n` +
              `- Quarantined: ${mem.isQuarantined ? 'YES' : 'NO'}\n` +
              `- Status: Logged to durable Write-Ahead Log`,
          },
        ],
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `[ERROR] Failed to ingest memory: ${err.message}` }],
      };
    }
  }
);

// Tool 3: Record Feedback & Theorem 1 Quarantine
mcpServer.tool(
  'civic_feedback',
  'Record an execution outcome for community guidance. Decays trust using Asymmetric EMA (beta = 0.70). Automatically quarantines records when trust falls strictly below 0.35, permanently excluding them from normal retrieval.',
  {
    memoryId: z.string().describe('ID of the memory record (e.g., "exp_rumor_kerosene" or "exp_water_01")'),
    outcome: z.enum(['success', 'failure']).describe('Observed outcome: "success" reinforces trust; "failure" penalizes trust'),
    reason: z.string().optional().describe('Incident report or verification reason'),
    eventId: z.string().optional().describe('Optional idempotency key to prevent double-applying retried events'),
  },
  async ({ memoryId, outcome, reason, eventId }) => {
    try {
      const result = memoryStore.recordFeedback(memoryId, outcome, reason, eventId);

      let text = `Feedback Evaluation for [${memoryId}]:\n` +
        `- Event ID: ${result.eventId}\n` +
        `- Outcome: ${outcome.toUpperCase()}\n` +
        `- Trust Score: ${(result.previousScore * 100).toFixed(1)}% -> ${(result.newScore * 100).toFixed(1)}%\n` +
        `- Idempotent Retry: ${result.isDuplicate ? 'YES (No score re-application)' : 'NO'}\n\n`;

      if (result.isQuarantined) {
        text += `[THEOREM 1 QUARANTINE ACTIVATED]\n` +
          `Trust score fell strictly below cutoff (${DEFAULT_QUARANTINE_THRESHOLD * 100}%).\n` +
          `This record is isolated in the quarantine vault and will never be returned by standard retrieval queries.`;
      } else {
        text += `Status: Active in operational store.`;
      }

      return {
        content: [{ type: 'text', text }],
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `[ERROR] Feedback failed: ${err.message}` }],
      };
    }
  }
);

// Tool 4: System Audit & Health Report
mcpServer.tool(
  'civic_audit',
  'Run health diagnostics on the memory bank: calculate average trust, quarantine count, and Negative Transfer Risk Index.',
  {},
  async () => {
    const report = memoryStore.audit();
    const text = `## CivicShield Memory Bank Audit Report\n\n` +
      `- **Overall Health Status**: \`${report.healthStatus}\`\n` +
      `- **Total Records**: ${report.totalMemories}\n` +
      `- **Active Non-Quarantined Records**: ${report.activeCount}\n` +
      `- **Quarantined Records**: ${report.quarantinedCount} (${(report.quarantineRatio * 100).toFixed(1)}%)\n` +
      `- **Average Trust Score**: ${(report.averageTrustScore * 100).toFixed(1)}%\n` +
      `- **Negative Transfer Risk Index**: ${(report.negativeTransferRiskScore * 100).toFixed(1)}% (measures active records with trust < 50%)\n\n` +
      `### Operational Notes:\n` +
      report.recommendations.map(r => `- ${r}`).join('\n');

    return {
      content: [{ type: 'text', text }],
    };
  }
);

// Tool 5: Write-Ahead Log Forensic Audit Trail
mcpServer.tool(
  'civic_wal',
  'Inspect recent append-only Write-Ahead Log records from durable storage for transparent forensic audit of memory mutations and quarantine triggers.',
  {
    limit: z.number().min(1).max(100).optional().describe('Number of recent audit records to fetch (default: 10)'),
  },
  async ({ limit }) => {
    const entries = wal.getRecent(limit ?? 10);
    if (entries.length === 0) {
      return { content: [{ type: 'text', text: 'Write-Ahead Log contains no records.' }] };
    }

    const lines = entries.map((e, idx) => {
      const prev = e.previousTrust !== undefined ? `${(e.previousTrust * 100).toFixed(0)}%` : 'N/A';
      const curr = e.newTrust !== undefined ? `${(e.newTrust * 100).toFixed(0)}%` : 'N/A';
      return `[${idx + 1}] **${e.timestamp.slice(11, 19)}** | Event: \`${e.eventType}\` | Memory: \`${e.memoryId}\` | Trust: ${prev} -> ${curr} | Quarantined: ${e.quarantined ? '[YES]' : '[NO]'}\n` +
        `    *Note: ${e.reason || 'Standard update'}*`;
    }).join('\n');

    return {
      content: [
        {
          type: 'text',
          text: `## Durable Write-Ahead Log (WAL) Audit Trail\n\n${lines}`,
        },
      ],
    };
  }
);

// Tool 6: System Status & Mathematical Parameters
mcpServer.tool(
  'civic_status',
  'Inspect mathematical hyperparameters (alpha, beta, theta) and view the active quarantine vault.',
  {},
  async () => {
    const all = memoryStore.getAll();
    const quarantined = all.filter(m => m.isQuarantined);
    const stepsToQuarantine = computeQuarantineSteps(1.0, DEFAULT_QUARANTINE_THRESHOLD, DEFAULT_BETA);

    let text = `## CivicShield A-EMA Engine Parameters\n\n` +
      `- **Success Smoothing Factor (alpha)**: \`${DEFAULT_ALPHA}\`\n` +
      `- **Failure Penalty Decay (beta)**: \`${DEFAULT_BETA}\`\n` +
      `- **Theorem 1 Quarantine Cutoff (theta)**: \`${DEFAULT_QUARANTINE_THRESHOLD}\`\n` +
      `- **Consecutive Failures from 100% to Quarantine**: \`${stepsToQuarantine}\` failures\n\n` +
      `### Quarantined Memory Vault (${quarantined.length} records isolated):\n`;

    if (quarantined.length === 0) {
      text += `*No memories quarantined. All active records operate above safety cutoff.*`;
    } else {
      text += quarantined.map(q => 
        `- **ID**: \`${q.id}\` | Trust: ${(q.trustScore * 100).toFixed(1)}% | Failures: ${q.failureCount}\n  *Task:* "${q.task}"\n  *Quarantined Action:* "${q.solution}"\n  *Quarantined At:* ${q.quarantinedAt || 'N/A'}\n  *Reason:* ${q.quarantineReason || 'Trust fell below cutoff'}`
      ).join('\n\n');
    }

    return {
      content: [{ type: 'text', text }],
    };
  }
);

// Tool 7: Meteorological Precipitation & Transit Context (Open-Meteo API)
mcpServer.tool(
  'civic_rain_alert',
  'Fetch live meteorological precipitation from the Open-Meteo meteorological API for Bengaluru coordinates (12.9716, 77.5946). Note: Observed precipitation rates provide general meteorological context and do not constitute an engineered hydraulic flood forecast or route guarantee.',
  {
    latitude: z.number().optional().describe('Latitude (defaults to Bengaluru: 12.9716)'),
    longitude: z.number().optional().describe('Longitude (defaults to Bengaluru: 77.5946)'),
  },
  async ({ latitude, longitude }) => {
    const lat = latitude ?? 12.9716;
    const lon = longitude ?? 77.5946;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=precipitation,rain&timezone=Asia%2FKolkata`;

    try {
      const response = await fetch(url);
      const data: any = await response.json();
      const current = data.current || {};
      const rain = current.rain ?? 0.0;
      const precipitation = current.precipitation ?? 0.0;

      let rainfallCategory = 'LIGHT / DRY';
      let cautionaryAdvisory = 'Normal traffic operations. Observe routine driving precautions.';
      if (precipitation > 15.0) {
        rainfallCategory = 'HEAVY PRECIPITATION';
        cautionaryAdvisory = 'Heavy rain detected. Low-lying railway underpasses (Windsor Manor, Okalipuram, Bellandur) historically experience waterlogging. Exercise caution; seek high-elevation routes.';
      } else if (precipitation > 2.0) {
        rainfallCategory = 'MODERATE RAINFALL';
        cautionaryAdvisory = 'Moderate rainfall detected. Wet pavement advisory; maintain safe vehicle following distance.';
      }

      const text = `## Bengaluru Meteorological Weather Context\n\n` +
        `- **Coordinates**: [${lat}, ${lon}]\n` +
        `- **Observed Precipitation**: ${precipitation} mm / hr (Rain: ${rain} mm)\n` +
        `- **Precipitation Category**: **${rainfallCategory}**\n` +
        `- **Contextual Advisory**: ${cautionaryAdvisory}\n` +
        `- **Data Source**: Open-Meteo Global Meteorological API\n\n` +
        `*Limitation Notice: Precipitation rates provide general meteorological context. They do not constitute an engineered hydraulic flood prediction or individual route safety guarantee.*`;

      return {
        content: [{ type: 'text', text }],
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Failed to fetch meteorological data: ${err.message}` }],
      };
    }
  }
);
