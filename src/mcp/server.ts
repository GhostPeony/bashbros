import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { DashboardDB } from '../dashboard/db.js'
import { OllamaClient } from '../bro/ollama.js'
import { CommandSuggester } from '../bro/suggester.js'
import { SecretsGuard } from '../policy/secrets-guard.js'
import {
  sessionSummary,
  traceSearch,
  historySuggest,
  secretScan,
  codeTask,
  detectCapabilityTier,
  type CapabilityTier,
} from './tools.js'
import { homedir } from 'os'
import { join } from 'path'

export async function startMCPServer(): Promise<void> {
  // Initialize shared resources
  const dbPath = join(homedir(), '.bashbros', 'dashboard.db')
  const db = new DashboardDB(dbPath)
  const ollama = new OllamaClient()
  const suggester = new CommandSuggester(null, ollama)
  const guard = new SecretsGuard({ enabled: true, mode: 'block', patterns: ['*.env', '*.pem', '*.key'] })

  // Detect capability tier from active model
  let tier: CapabilityTier = 'basic'
  try {
    if (await ollama.isAvailable()) {
      const modelInfo = await ollama.showModel(ollama.getModel())
      if (modelInfo?.details?.parameter_size) {
        tier = detectCapabilityTier(modelInfo.details.parameter_size)
      }
    }
  } catch {
    // Default to basic
  }

  const server = new Server(
    {
      name: 'bashbros',
      version: '0.1.5',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  )

  // List tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'session_summary',
        description: 'Get structured summaries of recent coding sessions. Shows what was worked on, errors hit, and resolutions across sessions.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            count: { type: 'number', description: 'Number of recent sessions to summarize (default 3)' },
            agent: { type: 'string', description: 'Filter by agent name (e.g., "claude-code", "gemini")' },
          },
        },
      },
      {
        name: 'trace_search',
        description: 'Search past sessions for matching commands and patterns. Find how a problem was solved before or what commands were used for a task.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            query: { type: 'string', description: 'Search query -- command fragment or keyword' },
            limit: { type: 'number', description: 'Max results (default 10)' },
            session_id: { type: 'string', description: 'Scope search to a specific session' },
          },
          required: ['query'],
        },
      },
      {
        name: 'history_suggest',
        description: 'Get command suggestions based on local usage patterns and project-specific workflows. Suggests what to run next based on actual history.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            last_command: { type: 'string', description: 'The most recent command that was run' },
            last_output: { type: 'string', description: 'Output of the last command (first 500 chars)' },
            cwd: { type: 'string', description: 'Current working directory' },
          },
          required: ['last_command'],
        },
      },
      {
        name: 'secret_scan',
        description: 'Scan text for leaked credentials, API keys, tokens, and private keys. Use before committing code or sharing output.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            text: { type: 'string', description: 'Text to scan for secrets' },
          },
          required: ['text'],
        },
      },
      {
        name: 'code_task',
        description: `Perform a bounded coding task on provided code using a local model. Capability tier: ${tier}. ${
          tier === 'basic' ? 'Handles: formatting, renames, imports, boilerplate, type annotations.'
          : tier === 'moderate' ? 'Handles: tests, error handling, function refactors, interface implementations.'
          : 'Handles: complex logic, multi-function refactors, pattern-following generation.'
        }`,
        inputSchema: {
          type: 'object' as const,
          properties: {
            task: { type: 'string', description: 'What to do with the code' },
            code: { type: 'string', description: 'The source code to work on' },
            language: { type: 'string', description: 'Language hint (ts, py, etc.)' },
            context: { type: 'string', description: 'Additional context (related types, imports)' },
          },
          required: ['task', 'code'],
        },
      },
    ],
  }))

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params

    try {
      switch (name) {
        case 'session_summary': {
          const result = await sessionSummary(args as any, db, ollama)
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
        }
        case 'trace_search': {
          const result = await traceSearch(args as any, db)
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
        }
        case 'history_suggest': {
          const result = await historySuggest(args as any, suggester)
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
        }
        case 'secret_scan': {
          const result = secretScan(args as any, guard)
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
        }
        case 'code_task': {
          if (!await ollama.isAvailable()) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'Ollama not available. Start Ollama to use code_task.' }) }] }
          }
          const result = await codeTask(args as any, ollama, tier)
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
        }
        default:
          return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true }
      }
    } catch (error: any) {
      return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true }
    }
  })

  // Start server on stdio
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
