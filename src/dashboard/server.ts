/**
 * Dashboard Server Module
 * Express HTTP server with WebSocket support for real-time dashboard updates
 */

import express, { type Express, type Request, type Response } from 'express'
import { WebSocketServer, type WebSocket } from 'ws'
import { createServer, type Server } from 'http'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { homedir } from 'os'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { parse, stringify } from 'yaml'
import { DashboardDB } from './db.js'
import { findConfig } from '../config.js'
import { ClaudeCodeHooks } from '../hooks/claude-code.js'
import { MoltbotHooks } from '../hooks/moltbot.js'
import { GeminiCLIHooks } from '../hooks/gemini-cli.js'
import { CopilotCLIHooks } from '../hooks/copilot-cli.js'
import { OpenCodeHooks } from '../hooks/opencode.js'

// Default dashboard database path
function getDefaultDbPath(): string {
  const bashbrosDir = join(homedir(), '.bashbros')
  if (!existsSync(bashbrosDir)) {
    mkdirSync(bashbrosDir, { recursive: true })
  }
  return join(bashbrosDir, 'dashboard.db')
}

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface ServerConfig {
  port?: number
  bind?: string
  dbPath?: string
}

// ─────────────────────────────────────────────────────────────
// Dashboard Server Class
// ─────────────────────────────────────────────────────────────

export class DashboardServer {
  private app: Express
  private server: Server | null = null
  private wss: WebSocketServer | null = null
  private db: DashboardDB
  private port: number
  private bind: string
  private clients: Set<WebSocket> = new Set()

  constructor(config: ServerConfig = {}) {
    this.port = config.port ?? 17800
    this.bind = config.bind ?? '127.0.0.1'
    // Use persistent database path by default for shared access with watch mode
    this.db = new DashboardDB(config.dbPath ?? getDefaultDbPath())
    this.app = express()

    this.setupMiddleware()
    this.setupRoutes()
  }

  private setupMiddleware(): void {
    this.app.use(express.json())

    // CORS headers for local development
    this.app.use((_req: Request, res: Response, next) => {
      res.header('Access-Control-Allow-Origin', '*')
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
      res.header('Access-Control-Allow-Headers', 'Content-Type')
      next()
    })
  }

  private setupRoutes(): void {
    // Health check endpoint
    this.app.get('/api/health', (_req: Request, res: Response) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() })
    })

    // Get dashboard stats
    this.app.get('/api/stats', (_req: Request, res: Response) => {
      try {
        const stats = this.db.getStats()
        res.json(stats)
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch stats' })
      }
    })

    // Get events with optional filtering
    this.app.get('/api/events', (req: Request, res: Response) => {
      try {
        const filter: Record<string, unknown> = {}

        if (req.query.source) filter.source = req.query.source
        if (req.query.level) filter.level = req.query.level
        if (req.query.category) filter.category = req.query.category
        if (req.query.limit) filter.limit = parseInt(req.query.limit as string, 10)
        if (req.query.offset) filter.offset = parseInt(req.query.offset as string, 10)
        if (req.query.since) filter.since = new Date(req.query.since as string)

        const events = this.db.getEvents(filter)
        res.json(events)
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch events' })
      }
    })

    // Get unique connectors
    this.app.get('/api/connectors', (_req: Request, res: Response) => {
      try {
        // Get all connector events and extract unique connector names
        const events = this.db.getAllConnectorEvents(1000)
        const connectors = [...new Set(events.map(e => e.connector))]
        res.json(connectors)
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch connectors' })
      }
    })

    // Get events for a specific connector
    this.app.get('/api/connectors/:name/events', (req: Request, res: Response) => {
      try {
        const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100
        const events = this.db.getConnectorEvents(String(req.params.name), limit)
        res.json(events)
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch connector events' })
      }
    })

    // Get pending egress blocks
    this.app.get('/api/blocked', (_req: Request, res: Response) => {
      try {
        const blocks = this.db.getPendingBlocks()
        res.json(blocks)
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch blocked items' })
      }
    })

    // Approve a blocked egress
    this.app.post('/api/blocked/:id/approve', (req: Request, res: Response) => {
      try {
        const id = String(req.params.id)
        const approvedBy = req.body?.approvedBy ?? 'dashboard-user'

        const block = this.db.getBlock(id)
        if (!block) {
          res.status(404).json({ error: 'Block not found' })
          return
        }

        this.db.approveBlock(id, approvedBy)
        this.broadcast({ type: 'block-approved', id })
        res.json({ success: true })
      } catch (error) {
        res.status(500).json({ error: 'Failed to approve block' })
      }
    })

    // Deny a blocked egress
    this.app.post('/api/blocked/:id/deny', (req: Request, res: Response) => {
      try {
        const id = String(req.params.id)
        const deniedBy = req.body?.deniedBy ?? 'dashboard-user'

        const block = this.db.getBlock(id)
        if (!block) {
          res.status(404).json({ error: 'Block not found' })
          return
        }

        this.db.denyBlock(id, deniedBy)
        this.broadcast({ type: 'block-denied', id })
        res.json({ success: true })
      } catch (error) {
        res.status(500).json({ error: 'Failed to deny block' })
      }
    })

    // ─────────────────────────────────────────────────────────────
    // Session Endpoints
    // ─────────────────────────────────────────────────────────────

    // List sessions with pagination and filters
    this.app.get('/api/sessions', (req: Request, res: Response) => {
      try {
        const filter: Record<string, unknown> = {}

        if (req.query.status) filter.status = req.query.status
        if (req.query.agent) filter.agent = req.query.agent
        if (req.query.limit) filter.limit = parseInt(req.query.limit as string, 10)
        if (req.query.offset) filter.offset = parseInt(req.query.offset as string, 10)
        if (req.query.since) filter.since = new Date(req.query.since as string)
        if (req.query.until) filter.until = new Date(req.query.until as string)

        const sessions = this.db.getSessions(filter)
        res.json(sessions)
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch sessions' })
      }
    })

    // Get active session (single - backwards compat)
    this.app.get('/api/sessions/active', (_req: Request, res: Response) => {
      try {
        const session = this.db.getActiveSession()
        if (!session) {
          res.json(null)
          return
        }
        res.json(session)
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch active session' })
      }
    })

    // Get ALL active sessions (multi-session support)
    this.app.get('/api/sessions/active-all', (_req: Request, res: Response) => {
      try {
        const sessions = this.db.getActiveSessions()
        res.json(sessions)
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch active sessions' })
      }
    })

    // Get session details
    this.app.get('/api/sessions/:id', (req: Request, res: Response) => {
      try {
        const session = this.db.getSession(String(req.params.id))
        if (!session) {
          res.status(404).json({ error: 'Session not found' })
          return
        }
        res.json(session)
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch session' })
      }
    })

    // Get commands for a session
    this.app.get('/api/sessions/:id/commands', (req: Request, res: Response) => {
      try {
        const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100
        const commands = this.db.getCommandsBySession(String(req.params.id), limit)
        res.json(commands)
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch session commands' })
      }
    })

    // Get session metrics
    this.app.get('/api/sessions/:id/metrics', (req: Request, res: Response) => {
      try {
        const session = this.db.getSession(String(req.params.id))
        if (!session) {
          res.status(404).json({ error: 'Session not found' })
          return
        }
        const metrics = this.db.getSessionMetrics(String(req.params.id))
        res.json(metrics)
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch session metrics' })
      }
    })

    // ─────────────────────────────────────────────────────────────
    // Command Endpoints
    // ─────────────────────────────────────────────────────────────

    // Get live commands (most recent), with optional session filter
    this.app.get('/api/commands/live', (req: Request, res: Response) => {
      try {
        const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20
        if (req.query.sessionId) {
          const commands = this.db.getCommands({
            sessionId: req.query.sessionId as string,
            limit
          })
          res.json(commands)
        } else {
          const commands = this.db.getLiveCommands(limit)
          res.json(commands)
        }
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch live commands' })
      }
    })

    // Get commands with incremental fetch support
    this.app.get('/api/commands', (req: Request, res: Response) => {
      try {
        const filter: Record<string, unknown> = {}

        if (req.query.sessionId) filter.sessionId = req.query.sessionId
        if (req.query.allowed !== undefined) filter.allowed = req.query.allowed === 'true'
        if (req.query.riskLevel) filter.riskLevel = req.query.riskLevel
        if (req.query.afterId) filter.afterId = req.query.afterId
        if (req.query.since) filter.since = new Date(req.query.since as string)
        if (req.query.limit) filter.limit = parseInt(req.query.limit as string, 10)
        if (req.query.offset) filter.offset = parseInt(req.query.offset as string, 10)

        const commands = this.db.getCommands(filter)
        res.json(commands)
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch commands' })
      }
    })

    // ─────────────────────────────────────────────────────────────
    // Tool Uses Endpoints (all Claude Code tools)
    // ─────────────────────────────────────────────────────────────

    // Get live tool uses (most recent)
    this.app.get('/api/tools/live', (req: Request, res: Response) => {
      try {
        const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50
        const tools = this.db.getLiveToolUses(limit)
        res.json(tools)
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch live tool uses' })
      }
    })

    // Get tool uses with filtering
    this.app.get('/api/tools', (req: Request, res: Response) => {
      try {
        const filter: Record<string, unknown> = {}

        if (req.query.toolName) filter.toolName = req.query.toolName
        if (req.query.sessionId) filter.sessionId = req.query.sessionId
        if (req.query.since) filter.since = new Date(req.query.since as string)
        if (req.query.limit) filter.limit = parseInt(req.query.limit as string, 10)
        if (req.query.offset) filter.offset = parseInt(req.query.offset as string, 10)

        const tools = this.db.getToolUses(filter)
        res.json(tools)
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch tool uses' })
      }
    })

    // Get tool use stats
    this.app.get('/api/tools/stats', (_req: Request, res: Response) => {
      try {
        const stats = this.db.getToolUseStats()
        res.json(stats)
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch tool use stats' })
      }
    })

    // ─────────────────────────────────────────────────────────────
    // User Prompts Endpoints
    // ─────────────────────────────────────────────────────────────

    // Get prompts with filtering
    this.app.get('/api/prompts', (req: Request, res: Response) => {
      try {
        const filter: Record<string, unknown> = {}

        if (req.query.sessionId) filter.sessionId = req.query.sessionId
        if (req.query.since) filter.since = new Date(req.query.since as string)
        if (req.query.limit) filter.limit = parseInt(req.query.limit as string, 10)
        if (req.query.offset) filter.offset = parseInt(req.query.offset as string, 10)

        const prompts = this.db.getUserPrompts(filter)
        res.json(prompts)
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch prompts' })
      }
    })

    // Get prompt stats
    this.app.get('/api/prompts/stats', (_req: Request, res: Response) => {
      try {
        const stats = this.db.getUserPromptStats()
        res.json(stats)
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch prompt stats' })
      }
    })

    // ─────────────────────────────────────────────────────────────
    // Bash Bro Endpoints
    // ─────────────────────────────────────────────────────────────

    // Get Bash Bro status
    this.app.get('/api/bro/status', (_req: Request, res: Response) => {
      try {
        const status = this.db.getLatestBroStatus()
        res.json(status)
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch Bro status' })
      }
    })

    // Get Bash Bro events
    this.app.get('/api/bro/events', (req: Request, res: Response) => {
      try {
        const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100
        const sessionId = req.query.sessionId as string | undefined
        const events = this.db.getBroEvents(limit, sessionId)
        res.json(events)
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch Bro events' })
      }
    })

    // Get available Ollama models
    this.app.get('/api/bro/models', async (_req: Request, res: Response) => {
      try {
        // Try to fetch models from Ollama
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 5000)

        const response = await fetch('http://localhost:11434/api/tags', {
          signal: controller.signal
        })

        clearTimeout(timeout)

        if (!response.ok) {
          res.json({ available: false, models: [] })
          return
        }

        const data = await response.json() as { models?: { name: string }[] }
        const models = data.models?.map((m) => m.name) || []
        res.json({ available: true, models })
      } catch (error) {
        res.json({ available: false, models: [] })
      }
    })

    // Change Ollama model (writes to a control file that watch mode can pick up)
    this.app.post('/api/bro/model', (req: Request, res: Response) => {
      try {
        const { model } = req.body
        if (!model) {
          res.status(400).json({ error: 'Model name required' })
          return
        }

        // Write to control file in .bashbros directory
        const controlPath = join(homedir(), '.bashbros', 'model-control.json')
        writeFileSync(controlPath, JSON.stringify({
          model,
          timestamp: new Date().toISOString()
        }), 'utf-8')

        res.json({ success: true, model })
      } catch (error) {
        res.status(500).json({ error: 'Failed to change model' })
      }
    })

    // Trigger system scan (writes control file)
    this.app.post('/api/bro/scan', (_req: Request, res: Response) => {
      try {
        const controlPath = join(homedir(), '.bashbros', 'scan-control.json')
        writeFileSync(controlPath, JSON.stringify({
          action: 'scan',
          timestamp: new Date().toISOString()
        }), 'utf-8')

        res.json({ success: true, message: 'Scan requested' })
      } catch (error) {
        res.status(500).json({ error: 'Failed to trigger scan' })
      }
    })

    // ─────────────────────────────────────────────────────────────
    // Model Management Endpoints
    // ─────────────────────────────────────────────────────────────

    // Get running models
    this.app.get('/api/bro/models/running', async (_req: Request, res: Response) => {
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 5000)
        const response = await fetch('http://localhost:11434/api/ps', { signal: controller.signal })
        clearTimeout(timeout)
        if (!response.ok) { res.json({ models: [] }); return }
        const data = await response.json()
        res.json(data)
      } catch { res.json({ models: [] }) }
    })

    // Get model details
    this.app.get('/api/bro/models/:name', async (req: Request, res: Response) => {
      try {
        const name = decodeURIComponent(String(req.params.name))
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 5000)
        const response = await fetch('http://localhost:11434/api/show', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
          signal: controller.signal
        })
        clearTimeout(timeout)
        if (!response.ok) { res.status(404).json({ error: 'Model not found' }); return }
        res.json(await response.json())
      } catch { res.status(500).json({ error: 'Failed to fetch model details' }) }
    })

    // Pull a model
    this.app.post('/api/bro/models/pull', async (req: Request, res: Response) => {
      try {
        const { name } = req.body
        if (!name) { res.status(400).json({ error: 'Model name required' }); return }
        this.broadcast({ type: 'model:pull:start', name })
        const response = await fetch('http://localhost:11434/api/pull', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, stream: false })
        })
        if (response.ok) {
          this.broadcast({ type: 'model:pull:complete', name })
          res.json({ success: true })
        } else {
          this.broadcast({ type: 'model:pull:error', name })
          res.status(500).json({ error: 'Pull failed' })
        }
      } catch { res.status(500).json({ error: 'Failed to pull model' }) }
    })

    // Delete a model
    this.app.delete('/api/bro/models/:name', async (req: Request, res: Response) => {
      try {
        const name = decodeURIComponent(String(req.params.name))
        const response = await fetch('http://localhost:11434/api/delete', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name })
        })
        res.json({ success: response.ok })
      } catch { res.status(500).json({ error: 'Failed to delete model' }) }
    })

    // ─────────────────────────────────────────────────────────────
    // Adapter Endpoints
    // ─────────────────────────────────────────────────────────────

    // List discovered adapters
    this.app.get('/api/bro/adapters', async (_req: Request, res: Response) => {
      try {
        const { AdapterRegistry } = await import('../bro/adapters.js')
        const registry = new AdapterRegistry()
        res.json(registry.discover())
      } catch { res.json([]) }
    })

    // Get adapter events
    this.app.get('/api/bro/adapters/events', (_req: Request, res: Response) => {
      try { res.json(this.db.getAdapterEvents()) } catch { res.json([]) }
    })

    // Activate an adapter
    this.app.post('/api/bro/adapters/:name/activate', async (req: Request, res: Response) => {
      try {
        const adapterName = String(req.params.name)
        const { AdapterRegistry } = await import('../bro/adapters.js')
        const registry = new AdapterRegistry()
        const adapters = registry.discover()
        const adapter = adapters.find((a: any) => a.name === adapterName)
        if (!adapter) { res.status(404).json({ error: 'Adapter not found' }); return }

        const modelfile = registry.generateModelfile(adapter)
        const ollamaName = registry.ollamaModelName(adapterName)
        const response = await fetch('http://localhost:11434/api/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: ollamaName, modelfile, stream: false })
        })
        if (response.ok) {
          this.db.insertAdapterEvent({
            adapterName, baseModel: adapter.baseModel,
            purpose: adapter.purpose, action: 'activated', success: true
          })
          this.broadcast({ type: 'adapter:activated', name: adapterName })
          res.json({ success: true, ollamaModel: ollamaName })
        } else {
          res.status(500).json({ error: 'Failed to create Ollama model from adapter' })
        }
      } catch { res.status(500).json({ error: 'Failed to activate adapter' }) }
    })

    // ─────────────────────────────────────────────────────────────
    // Profile Endpoints
    // ─────────────────────────────────────────────────────────────

    this.app.get('/api/bro/profiles', async (_req: Request, res: Response) => {
      try {
        const { ProfileManager } = await import('../bro/profiles.js')
        res.json(new ProfileManager().list())
      } catch { res.json([]) }
    })

    this.app.post('/api/bro/profiles', async (req: Request, res: Response) => {
      try {
        const { ProfileManager } = await import('../bro/profiles.js')
        new ProfileManager().save(req.body)
        res.json({ success: true })
      } catch { res.status(500).json({ error: 'Failed to save profile' }) }
    })

    this.app.delete('/api/bro/profiles/:name', async (req: Request, res: Response) => {
      try {
        const { ProfileManager } = await import('../bro/profiles.js')
        new ProfileManager().delete(String(req.params.name))
        res.json({ success: true })
      } catch { res.status(500).json({ error: 'Failed to delete profile' }) }
    })

    // ─────────────────────────────────────────────────────────────
    // Context Endpoints
    // ─────────────────────────────────────────────────────────────

    this.app.get('/api/context/index', async (_req: Request, res: Response) => {
      try {
        const { ContextStore } = await import('../context/store.js')
        res.json(new ContextStore(process.cwd()).getIndex())
      } catch { res.json({ lastUpdated: '', agents: [], sessionCount: 0, commandFileCount: 0, errorFileCount: 0 }) }
    })

    this.app.get('/api/context/memory', async (_req: Request, res: Response) => {
      try {
        const { ContextStore } = await import('../context/store.js')
        const store = new ContextStore(process.cwd())
        const files = store.listMemoryFiles()
        const result: Record<string, string | null> = {}
        for (const file of files) { result[file] = store.readMemory(file) }
        res.json(result)
      } catch { res.json({}) }
    })

    this.app.put('/api/context/memory/:name', async (req: Request, res: Response) => {
      try {
        const { ContextStore } = await import('../context/store.js')
        const store = new ContextStore(process.cwd())
        store.writeMemory(String(req.params.name), req.body.content)
        this.broadcast({ type: 'context:updated', file: req.params.name })
        res.json({ success: true })
      } catch { res.status(500).json({ error: 'Failed to write memory file' }) }
    })

    // ─────────────────────────────────────────────────────────────
    // Achievements Endpoint
    // ─────────────────────────────────────────────────────────────

    this.app.get('/api/achievements', (_req: Request, res: Response) => {
      try {
        const stats = this.db.getAchievementStats()
        const badges = this.db.computeAchievements(stats)
        const xp = this.db.computeXP(stats, badges)
        res.json({ stats, badges, xp })
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch achievements' })
      }
    })

    // ─────────────────────────────────────────────────────────────
    // Security Summary Endpoints
    // ─────────────────────────────────────────────────────────────

    // Get security summary (last 24h)
    this.app.get('/api/security/summary', (_req: Request, res: Response) => {
      try {
        const summary = this.db.getSecuritySummary()
        res.json(summary)
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch security summary' })
      }
    })

    // Get recent blocked commands
    this.app.get('/api/security/blocked-commands', (req: Request, res: Response) => {
      try {
        const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 25
        const commands = this.db.getBlockedCommandsRecent(limit)
        res.json(commands)
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch blocked commands' })
      }
    })

    // ─────────────────────────────────────────────────────────────
    // Exposure Endpoints
    // ─────────────────────────────────────────────────────────────

    // Get recent exposures
    this.app.get('/api/exposures', (req: Request, res: Response) => {
      try {
        const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100
        const exposures = this.db.getRecentExposures(limit)
        res.json(exposures)
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch exposures' })
      }
    })

    // Get config
    this.app.get('/api/config', (_req: Request, res: Response) => {
      try {
        const configPath = findConfig()
        if (!configPath) {
          res.status(404).json({ error: 'No config file found' })
          return
        }
        const content = readFileSync(configPath, 'utf-8')
        const config = parse(content)
        res.json(config)
      } catch (error) {
        res.status(500).json({ error: 'Failed to load config' })
      }
    })

    // Save config
    this.app.post('/api/config', (req: Request, res: Response) => {
      try {
        const configPath = findConfig()
        if (!configPath) {
          res.status(404).json({ error: 'No config file found' })
          return
        }
        const config = req.body
        const content = stringify(config)
        writeFileSync(configPath, content, 'utf-8')
        res.json({ success: true })
      } catch (error) {
        res.status(500).json({ error: 'Failed to save config' })
      }
    })

    // ─────────────────────────────────────────────────────────────
    // Agent Integration Status
    // ─────────────────────────────────────────────────────────────

    this.app.get('/api/agents/status', async (_req: Request, res: Response) => {
      try {
        const claude = ClaudeCodeHooks.getStatus()
        const moltbot = MoltbotHooks.getStatus()
        const gemini = GeminiCLIHooks.getStatus()
        const copilot = CopilotCLIHooks.getStatus()
        const opencode = OpenCodeHooks.getStatus()

        // Check Moltbot gateway asynchronously
        let gatewayRunning = false
        let sandboxMode: string | null = null
        try {
          const gw = await MoltbotHooks.getGatewayStatus()
          gatewayRunning = gw.running
          sandboxMode = gw.sandboxMode ? 'strict' : null
        } catch {
          // Gateway check failed; use sync fallback values
          gatewayRunning = moltbot.gatewayRunning
          sandboxMode = moltbot.sandboxMode
        }

        const agents = [
          {
            name: 'Claude Code',
            key: 'claude-code',
            installed: claude.claudeInstalled,
            hooksInstalled: claude.hooksInstalled,
            hooks: claude.hooks,
            extra: { allToolsRecording: claude.allToolsInstalled }
          },
          {
            name: 'Moltbot',
            key: 'moltbot',
            installed: moltbot.moltbotInstalled || moltbot.clawdbotInstalled,
            hooksInstalled: moltbot.hooksInstalled,
            hooks: moltbot.hooks,
            extra: { gatewayRunning, sandboxMode }
          },
          {
            name: 'Gemini CLI',
            key: 'gemini-cli',
            installed: gemini.geminiInstalled,
            hooksInstalled: gemini.hooksInstalled,
            hooks: gemini.hooks
          },
          {
            name: 'GitHub Copilot CLI',
            key: 'copilot-cli',
            installed: copilot.copilotInstalled,
            hooksInstalled: copilot.hooksInstalled,
            hooks: copilot.hooks
          },
          {
            name: 'OpenCode',
            key: 'opencode',
            installed: opencode.openCodeInstalled,
            hooksInstalled: opencode.pluginInstalled,
            hooks: opencode.pluginInstalled ? ['plugin (gate + record)'] : []
          }
        ]

        res.json({ agents })
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch agent status' })
      }
    })

    // Static file serving - resolve relative to this file
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = dirname(__filename)
    const staticPath = join(__dirname, 'static')
    this.app.use(express.static(staticPath))

    // Fallback to index.html for SPA routing (Express 5 path-to-regexp syntax)
    this.app.get('/{*path}', (_req: Request, res: Response) => {
      res.sendFile(join(staticPath, 'index.html'))
    })
  }

  private setupWebSocket(): void {
    if (!this.server) return

    this.wss = new WebSocketServer({ server: this.server })

    this.wss.on('connection', (ws: WebSocket) => {
      this.clients.add(ws)

      ws.on('close', () => {
        this.clients.delete(ws)
      })

      ws.on('error', () => {
        this.clients.delete(ws)
      })

      // Send initial stats on connection
      try {
        const stats = this.db.getStats()
        ws.send(JSON.stringify({ type: 'stats', data: stats }))
      } catch {
        // Ignore errors on initial send
      }
    })
  }

  /**
   * Start the dashboard server
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer(this.app)
      this.setupWebSocket()

      this.server.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          reject(new Error(`Port ${this.port} is already in use`))
        } else {
          reject(error)
        }
      })

      this.server.listen(this.port, this.bind, () => {
        resolve()
      })
    })
  }

  /**
   * Stop the dashboard server
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      // Close all WebSocket connections
      for (const client of this.clients) {
        client.close()
      }
      this.clients.clear()

      if (this.wss) {
        this.wss.close()
        this.wss = null
      }

      if (this.server) {
        this.server.close(() => {
          this.server = null
          this.db.close()
          resolve()
        })
      } else {
        this.db.close()
        resolve()
      }
    })
  }

  /**
   * Broadcast a message to all connected WebSocket clients
   */
  broadcast(message: unknown): void {
    const data = JSON.stringify(message)
    for (const client of this.clients) {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(data)
      }
    }
  }

  /**
   * Get the database instance for external use
   */
  getDB(): DashboardDB {
    return this.db
  }

  /**
   * Get the port the server is running on
   */
  getPort(): number {
    return this.port
  }
}

export default DashboardServer
