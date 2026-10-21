/**
 * CivicShield Production HTTP / SSE Server
 * Deployed to SpringWinter AWS Cloud Platform
 * Exposes MCP over Server-Sent Events (SSE) + Live Visual Demo Dashboard
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { mcpServer } from './mcp.js';
import { memoryStore } from './memoryStore.js';
import { wal } from './wal.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Dynamically load .env file if available
const envFilePath = path.join(__dirname, '../.env');
if (fs.existsSync(envFilePath)) {
  const content = fs.readFileSync(envFilePath, 'utf8');
  content.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        if (key && !process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  });
}

const app = express();
const PORT = parseInt(process.env.PORT || '8000', 10);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Active MCP SSE transport
let sseTransport: SSEServerTransport | null = null;

// 1. MCP Server-Sent Events (SSE) Endpoint (for Claude Desktop / Cursor / SpringWinter)
app.get('/sse', async (req: Request, res: Response) => {
  console.log('[MCP SSE] Client connected to /sse');
  sseTransport = new SSEServerTransport('/messages', res);
  await mcpServer.connect(sseTransport);

  req.on('close', () => {
    console.log('[MCP SSE] Client connection closed');
    sseTransport = null;
  });
});

// 2. MCP POST Messages Endpoint
app.post('/messages', async (req: Request, res: Response) => {
  if (sseTransport) {
    await sseTransport.handlePostMessage(req, res);
  } else {
    res.status(400).json({ error: 'SSE session not established. Connect to /sse first.' });
  }
});

// 3. Cloud Load Balancer Health Check (SpringWinter requirement)
app.get('/health', (req: Request, res: Response) => {
  const audit = memoryStore.audit();
  res.status(200).json({
    status: 'healthy',
    platform: 'SpringWinter Cloud Platform',
    service: 'CivicShield-MCP',
    uptimeSeconds: Math.floor(process.uptime()),
    activeMemories: audit.activeCount,
    quarantinedCount: audit.quarantinedCount,
    negativeTransferRisk: `${(audit.negativeTransferRiskScore * 100).toFixed(1)}%`,
    timestamp: new Date().toISOString(),
  });
});

// 4. REST API for Live Demo Dashboard
app.get('/api/memories', (req: Request, res: Response) => {
  res.json(memoryStore.getAll());
});

app.get('/api/wal', (req: Request, res: Response) => {
  res.json(wal.getRecent(15));
});

app.get('/api/audit', (req: Request, res: Response) => {
  res.json(memoryStore.audit());
});

// Trigger feedback from the Demo UI (e.g. click "Report Poison / Failure")
app.post('/api/feedback', (req: Request, res: Response) => {
  const { memoryId, outcome, reason } = req.body;
  if (!memoryId || !outcome) {
    return res.status(400).json({ error: 'memoryId and outcome are required' });
  }
  try {
    const result = memoryStore.recordFeedback(memoryId, outcome, reason);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Reset memory bank to defaults for clean demo runs
app.post('/api/reset', (req: Request, res: Response) => {
  memoryStore.resetToDefaults();
  res.json({ message: 'Memory bank reset to verified defaults' });
});

// Community Hotline AI Chat (Powered by Groq LLM + CivicShield MCP Immune Memory)
app.post('/api/chat', async (req: Request, res: Response) => {
  const { message } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  // 1. Query CivicShield MCP memory bank
  const matches = memoryStore.retrieve(message);
  const groqKey = process.env.GROQ_API_KEY;
  const groqModel = process.env.GROQ_MODEL || 'qwen/qwen3.8-27b';

  // If no safe matches found (e.g. advice is quarantined)
  if (matches.length === 0) {
    let agentResponse = `Advice withheld: unverified or quarantined under Theorem 1 bounds to prevent harm. Contact emergency dispatch at 112 or BBMP control room at 1533.`;

    if (groqKey) {
      try {
        const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${groqKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: groqModel,
            messages: [
              {
                role: 'system',
                content: 'You are the CivicShield Public Safety Dispatcher. State in 1 direct, firm sentence that the requested advice is unverified or quarantined by CivicShield due to hazard. Direct the citizen to call 112 or BBMP 1533. Zero filler or apologies.'
              },
              { role: 'user', content: message }
            ],
            max_tokens: 80,
            temperature: 0.1,
          }),
        });
        if (groqRes.ok) {
          const gData: any = await groqRes.json();
          const cleanText = gData.choices[0]?.message?.content?.trim();
          if (cleanText) agentResponse = cleanText;
        }
      } catch (e) {
        // Fallback to concise default
      }
    }

    return res.json({
      agentResponse,
      toolCalls: [
        {
          tool: 'civic_retrieve',
          query: message,
          result: 'No verified high-trust memories found (> 0.35 threshold)',
          quarantinedBlockedCount: memoryStore.getAll().filter(m => m.isQuarantined).length,
        },
      ],
      safetyStatus: 'PROTECTED',
    });
  }

  // When verified memory IS found:
  const top = matches[0];
  let agentResponse = top.memory.solution;

  if (groqKey) {
    try {
      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${groqKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: groqModel,
          messages: [
            {
              role: 'system',
              content: `You are the CivicShield Public Safety Dispatcher. State the exact verified protocol and official contact directly in 2 short sentences. No pleasantries, no conversational preamble, no repetition of the prompt. Rely strictly on: "${top.memory.solution}" from authority: "${top.memory.authority}".`
            },
            { role: 'user', content: message }
          ],
          max_tokens: 120,
          temperature: 0.1,
        }),
      });
      if (groqRes.ok) {
        const gData: any = await groqRes.json();
        const llmContent = gData.choices[0]?.message?.content?.trim();
        if (llmContent) {
          agentResponse = llmContent;
        }
      }
    } catch (e) {
      // Fallback
    }
  }

  return res.json({
    agentResponse,
    authority: top.memory.authority,
    trustScore: top.memory.trustScore,
    matchedId: top.memory.id,
    toolCalls: [
      {
        tool: 'civic_retrieve',
        query: message,
        matchedId: top.memory.id,
        trustScore: top.memory.trustScore,
        effectiveRank: top.effectiveScore,
      },
    ],
    safetyStatus: 'VERIFIED_SAFE',
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`[INFO] CivicShield MCP Server running on port ${PORT}`);
  console.log(`[INFO] MCP SSE Endpoint: http://0.0.0.0:${PORT}/sse`);
  console.log(`[INFO] Health Check:     http://0.0.0.0:${PORT}/health`);
  console.log(`[INFO] Web Dashboard:    http://0.0.0.0:${PORT}/`);
  console.log(`====================================================`);
});
