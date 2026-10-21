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
  'Retrieve verified, non-quarantined community guidance for civic emergencies, public healthcare, or disaster relief. Guarantees zero negative transfer by strictly filtering out quarantined records.',
  {
    query: z.string().describe('The problem or situation description (e.g., "water contamination Koramangala", "sparking transformer", "flood route")'),
    minTrust: z.number().optional().describe('Minimum trust score cutoff (default: 0.35)'),
    category: z.enum(['civic', 'health', 'disaster', 'welfare']).optional().describe('Scope category filter'),
  },
  async ({ query, minTrust, category }) => {
    const results = memoryStore.retrieve(query, minTrust ?? DEFAULT_QUARANTINE_THRESHOLD, category as MemoryCategory);

    if (results.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `[WARNING] No verified safe community guidance found for "${query}".\nNote: Any unverified or quarantined advice was strictly omitted to protect citizen safety.`,
          },
        ],
      };
    }

    const formatted = results.map((r, i) => {
      return `### [${i + 1}] ${r.memory.task.toUpperCase()}\n` +
        `- **Memory ID**: \`${r.memory.id}\`\n` +
        `- **Trust Score**: ${(r.memory.trustScore * 100).toFixed(1)}% | Effective Rank: ${r.effectiveScore}\n` +
        `- **Authority / Source**: ${r.memory.authority} (${r.memory.location})\n` +
        `- **Verified Guidance**:\n> ${r.memory.solution}\n` +
        `- **Reliability Status**: ${r.isReliable ? '[VERIFIED SAFE]' : '[PROBATIONARY]'}`;
    }).join('\n\n---\n\n');

    return {
      content: [
        {
          type: 'text',
          text: `Found ${results.length} verified community protocols:\n\n${formatted}`,
        },
      ],
    };
  }
);

// Tool 2: Store New Community Guidance
mcpServer.tool(
  'civic_store',
  'Store a newly verified community relief procedure or official civic contact with an initial trust score and immutable Write-Ahead Log audit.',
  {
    task: z.string().describe('The problem or community need description'),
    solution: z.string().describe('The official or verified procedure to solve the issue'),
    category: z.enum(['civic', 'health', 'disaster', 'welfare']).describe('Category of guidance'),
    location: z.string().optional().describe('Locality or jurisdiction (e.g. "Koramangala", "Bengaluru Central")'),
    authority: z.string().optional().describe('Issuing department or entity (e.g. "BBMP", "BWSSB", "PHC")'),
    initialTrust: z.number().optional().describe('Starting trust score between 0.0 and 1.0 (default: 0.85)'),
  },
  async ({ task, solution, category, location, authority, initialTrust }) => {
    const mem = memoryStore.store(
      task,
      solution,
      category,
      location ?? 'Bengaluru',
      authority ?? 'Community Official',
      initialTrust ?? 0.85
    );

    return {
      content: [
        {
          type: 'text',
          text: `[SUCCESS] Registered new community memory [${mem.id}].\n` +
            `- Category: ${mem.category.toUpperCase()}\n` +
            `- Trust Score: ${(mem.trustScore * 100).toFixed(1)}%\n` +
            `- Status: ACTIVE (Logged to immutable Write-Ahead Log)`,
        },
      ],
    };
  }
);

// Tool 3: Record Feedback & Theorem 1 Quarantine
mcpServer.tool(
  'civic_feedback',
  'Record outcome of community guidance. Decays trust using Asymmetric EMA (beta = 0.70). Automatically locks harmful or failed advice into Theorem 1 Quarantine (< 0.35) so no other citizen receives it.',
  {
    memoryId: z.string().describe('ID of the memory to evaluate (e.g., "exp_rumor_kerosene" or "exp_water_01")'),
    outcome: z.enum(['success', 'failure']).describe('Execution outcome: "success" reinforces trust; "failure" penalizes trust'),
    reason: z.string().optional().describe('Reason or incident report explaining the outcome'),
  },
  async ({ memoryId, outcome, reason }) => {
    try {
      const result = memoryStore.recordFeedback(memoryId, outcome, reason);

      let text = `Updated evaluation for [${memoryId}]:\n` +
        `- Outcome: ${outcome.toUpperCase()}\n` +
        `- Trust Score: ${(result.previousScore * 100).toFixed(1)}% -> ${(result.newScore * 100).toFixed(1)}%\n\n`;

      if (result.isQuarantined) {
        text += `[THEOREM 1 QUARANTINE ACTIVATED]\n` +
          `Trust score fell below critical cutoff (${DEFAULT_QUARANTINE_THRESHOLD * 100}%).\n` +
          `This memory is permanently isolated. AI agents will never retrieve or repeat this guidance.`;
      } else {
        text += `Status: ACTIVE (Reliable for community use).`;
      }

      return {
        content: [{ type: 'text', text }],
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Error updating feedback: ${err.message}` }],
      };
    }
  }
);

// Tool 4: System Audit & Negative Transfer Risk Index
mcpServer.tool(
  'civic_audit',
  'Run full health diagnostics on the community memory bank: calculate average trust, quarantine ratios, and Negative Transfer Risk Index.',
  {},
  async () => {
    const report = memoryStore.audit();
    const text = `## CivicShield Memory Bank Audit Report\n\n` +
      `- **Overall Health Status**: \`${report.healthStatus}\`\n` +
      `- **Total Records**: ${report.totalMemories}\n` +
      `- **Active Reliable Records**: ${report.activeCount}\n` +
      `- **Quarantined Records**: ${report.quarantinedCount} (${(report.quarantineRatio * 100).toFixed(1)}%)\n` +
      `- **Average Trust Score**: ${(report.averageTrustScore * 100).toFixed(1)}%\n` +
      `- **Negative Transfer Risk Index**: ${(report.negativeTransferRiskScore * 100).toFixed(1)}% (0% = completely immune to bad advice)\n\n` +
      `### Security Recommendations:\n` +
      report.recommendations.map(r => `- ${r}`).join('\n');

    return {
      content: [{ type: 'text', text }],
    };
  }
);

// Tool 5: Write-Ahead Log Forensic Audit Trail
mcpServer.tool(
  'civic_wal',
  'Inspect recent immutable Write-Ahead Log entries for forensic transparency of memory updates and quarantine decisions.',
  {
    limit: z.number().optional().describe('Number of recent audit records to fetch (default: 10)'),
  },
  async ({ limit }) => {
    const entries = wal.getRecent(limit ?? 10);
    if (entries.length === 0) {
      return { content: [{ type: 'text', text: 'Write-Ahead Log is empty.' }] };
    }

    const lines = entries.map((e, idx) => {
      const prev = e.previousTrust !== undefined ? `${(e.previousTrust * 100).toFixed(0)}%` : 'N/A';
      const curr = e.newTrust !== undefined ? `${(e.newTrust * 100).toFixed(0)}%` : 'N/A';
      return `[${idx + 1}] **${e.timestamp.slice(11, 19)}** | Event: \`${e.eventType}\` | Target: \`${e.memoryId}\` | Trust: ${prev} -> ${curr} | Quarantined: ${e.quarantined ? '[YES]' : '[NO]'}\n` +
        `    *Note: ${e.reason || 'Standard update'}*`;
    }).join('\n');

    return {
      content: [
        {
          type: 'text',
          text: `## Immutable Write-Ahead Log (WAL)\n\n${lines}`,
        },
      ],
    };
  }
);

// Tool 6: System Status & Mathematical Hyperparameters
mcpServer.tool(
  'civic_status',
  'Inspect the mathematical parameters of the AEMA immune system and view all currently quarantined memories.',
  {},
  async () => {
    const all = memoryStore.getAll();
    const quarantined = all.filter(m => m.isQuarantined);
    const stepsToQuarantine = computeQuarantineSteps(1.0, DEFAULT_QUARANTINE_THRESHOLD, DEFAULT_BETA);

    let text = `## CivicShield AEMA Mathematical Parameters\n\n` +
      `- **Success Smoothing Factor (alpha)**: \`${DEFAULT_ALPHA}\` (Cautious reinforcement)\n` +
      `- **Failure Penalty Decay (beta)**: \`${DEFAULT_BETA}\` (Fast exponential penalty on harm)\n` +
      `- **Theorem 1 Quarantine Cutoff (theta)**: \`${DEFAULT_QUARANTINE_THRESHOLD}\`\n` +
      `- **Consecutive Failures from 100% to Quarantine**: \`${stepsToQuarantine}\` steps\n\n` +
      `### Quarantined Memory Vault (${quarantined.length}):\n`;

    if (quarantined.length === 0) {
      text += `*No memories quarantined. All active memories operate within verified safety bounds.*`;
    } else {
      text += quarantined.map(q => 
        `- **ID**: \`${q.id}\` | Trust: ${(q.trustScore * 100).toFixed(1)}% | Failures: ${q.failureCount}\n  *Task:* "${q.task}"\n  *Quarantined Solution:* "${q.solution}"`
      ).join('\n\n');
    }

    return {
      content: [{ type: 'text', text }],
    };
  }
);

// Tool 7: Live Weather & Flash Flood Risk (Open-Meteo API)
mcpServer.tool(
  'civic_rain_alert',
  'Fetch live real-time precipitation and flash flood risk for Bengaluru using the Open-Meteo meteorological API (zero API key needed).',
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

      let riskLevel = 'LOW';
      let advisory = 'Normal road conditions. Underpasses operational.';
      if (precipitation > 15.0) {
        riskLevel = 'CRITICAL / FLASH FLOOD';
        advisory = 'Severe waterlogging expected. Avoid railway underpasses (Windsor Manor, Okalipuram, Bellandur). Emergency response active.';
      } else if (precipitation > 2.0) {
        riskLevel = 'MODERATE';
        advisory = 'Moderate rainfall detected. Drive with caution; slow traffic on Outer Ring Road.';
      }

      const text = `## Live Bengaluru Weather & Flash Flood Alert\n\n` +
        `- **Location Coordinates**: [${lat}, ${lon}]\n` +
        `- **Current Precipitation**: ${precipitation} mm / hr (Rain: ${rain} mm)\n` +
        `- **Flood Risk Level**: **${riskLevel}**\n` +
        `- **Transit Advisory**: ${advisory}\n` +
        `- **Source**: Open-Meteo Real-Time Meteorological API`;

      return {
        content: [{ type: 'text', text }],
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `Failed to fetch live weather: ${err.message}` }],
      };
    }
  }
);
