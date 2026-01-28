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
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
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
        const events = this.db.getConnectorEvents(req.params.name, limit)
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
        const { id } = req.params
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
        const { id } = req.params
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

    // Get active session
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

    // Get session details
    this.app.get('/api/sessions/:id', (req: Request, res: Response) => {
      try {
        const session = this.db.getSession(req.params.id)
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
        const commands = this.db.getCommandsBySession(req.params.id, limit)
        res.json(commands)
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch session commands' })
      }
    })

    // Get session metrics
    this.app.get('/api/sessions/:id/metrics', (req: Request, res: Response) => {
      try {
        const session = this.db.getSession(req.params.id)
        if (!session) {
          res.status(404).json({ error: 'Session not found' })
          return
        }
        const metrics = this.db.getSessionMetrics(req.params.id)
        res.json(metrics)
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch session metrics' })
      }
    })

    // ─────────────────────────────────────────────────────────────
    // Command Endpoints
    // ─────────────────────────────────────────────────────────────

    // Get live commands (most recent)
    this.app.get('/api/commands/live', (req: Request, res: Response) => {
      try {
        const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20
        const commands = this.db.getLiveCommands(limit)
        res.json(commands)
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
