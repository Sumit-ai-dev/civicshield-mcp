/**
 * CivicShield Production HTTP / SSE Server
 * Deployed to SpringWinter AWS Cloud Platform
 *
 * Implements:
 * - Multi-client session-aware MCP SSE transport management
 * - Protected reset endpoint with token authorization
 * - Proportionate rate limiting and payload size enforcement
 * - Groq LLM integration with deterministic fallback
 * - Cloud health check endpoint for AWS load balancers
 */

import express, { Request, Response, NextFunction } from 'express';
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

// Restrict CORS if configured, or default safely
const corsOrigin = process.env.CORS_ORIGIN || '*';
app.use(cors({ origin: corsOrigin }));

// Strict body limit to prevent memory exhaustion
app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, '../public')));

// Simple in-memory rate limiter for mutation routes
const ipRateLimits = new Map<string, { count: number; resetAt: number }>();
function mutationRateLimit(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip || req.socket.remoteAddress || '127.0.0.1';
  const now = Date.now();
  const record = ipRateLimits.get(ip);

  if (!record || now > record.resetAt) {
    ipRateLimits.set(ip, { count: 1, resetAt: now + 60000 });
    return next();
  }

  if (record.count >= 60) {
    return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });
  }

  record.count++;
  next();
}

// Multi-Client Session-Aware MCP Transports Map
const sseTransports = new Map<string, SSEServerTransport>();

// 1. MCP Server-Sent Events (SSE) Endpoint (Multi-Client Session Aware)
app.get('/sse', async (req: Request, res: Response) => {
  const transport = new SSEServerTransport('/messages', res);
  const sessionId = transport.sessionId;
  sseTransports.set(sessionId, transport);

  console.log(`[MCP SSE] Client session established: ${sessionId} (Active: ${sseTransports.size})`);

  req.on('close', () => {
    console.log(`[MCP SSE] Client session closed: ${sessionId}`);
    sseTransports.delete(sessionId);
  });

  await mcpServer.connect(transport);
});

// 2. MCP POST Messages Endpoint (Session-Routed)
app.post('/messages', async (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string;

  if (sessionId) {
    const transport = sseTransports.get(sessionId);
    if (!transport) {
      return res.status(404).json({ error: `MCP session "${sessionId}" not found or already closed.` });
    }
    await transport.handlePostMessage(req, res);
  } else if (sseTransports.size === 1) {
    // Graceful fallback for single-client environments without query param
    const [singleTransport] = sseTransports.values();
    await singleTransport.handlePostMessage(req, res);
  } else if (sseTransports.size === 0) {
    res.status(400).json({ error: 'No active SSE sessions. Connect to /sse first.' });
  } else {
    res.status(400).json({ error: 'Multiple active sessions. Must provide ?sessionId=<id> query parameter.' });
  }
});

// 3. Cloud Load Balancer Health Check (SpringWinter AWS Requirement)
app.get('/health', (req: Request, res: Response) => {
  const audit = memoryStore.audit();
  res.status(200).json({
    status: 'healthy',
    platform: 'SpringWinter Cloud Platform',
    service: 'CivicShield-MCP',
    uptimeSeconds: Math.floor(process.uptime()),
    activeSessions: sseTransports.size,
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
  const limit = parseInt(req.query.limit as string || '20', 10);
  res.json(wal.getRecent(Math.min(100, Math.max(1, limit))));
});

app.get('/api/audit', (req: Request, res: Response) => {
  res.json(memoryStore.audit());
});

// Trigger feedback from UI / client (protected against spam & invalid bodies)
app.post('/api/feedback', mutationRateLimit, (req: Request, res: Response) => {
  const { memoryId, outcome, reason, eventId } = req.body;

  if (typeof memoryId !== 'string' || !memoryId.trim()) {
    return res.status(400).json({ error: 'Field "memoryId" is required and must be a string.' });
  }

  if (outcome !== 'success' && outcome !== 'failure') {
    return res.status(400).json({ error: 'Field "outcome" must be "success" or "failure".' });
  }

  const cleanReason = typeof reason === 'string' ? reason.slice(0, 500) : undefined;
  const cleanEventId = typeof eventId === 'string' ? eventId.slice(0, 100) : undefined;

  try {
    const result = memoryStore.recordFeedback(memoryId, outcome, cleanReason, cleanEventId);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Feedback evaluation failed.' });
  }
});

// Protected Reset Endpoint (Disabled in production unless authorized)
app.post('/api/reset', mutationRateLimit, (req: Request, res: Response) => {
  const configuredToken = process.env.DEMO_RESET_TOKEN;
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction && !configuredToken) {
    return res.status(403).json({
      error: 'State reset is disabled in production. Set DEMO_RESET_TOKEN in environment to authorize.',
    });
  }

  if (configuredToken) {
    const providedToken = req.headers['x-reset-token'] || req.query.token;
    if (providedToken !== configuredToken) {
      return res.status(401).json({ error: 'Unauthorized: invalid or missing reset token.' });
    }
  }

  memoryStore.resetToDefaults();
  res.json({ message: 'Memory bank reset to verified defaults.' });
});

// Community Hotline AI Chat (Powered by Groq LLM + CivicShield MCP Immune Memory)
app.post('/api/chat', mutationRateLimit, async (req: Request, res: Response) => {
  const { message } = req.body;
  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Field "message" is required and must be a string.' });
  }

  const query = message.trim().slice(0, 500);

  // 1. Query CivicShield MCP memory bank
  const matches = memoryStore.retrieve(query);
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
              { role: 'user', content: query }
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
          query,
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
            { role: 'user', content: query }
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
        query,
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
