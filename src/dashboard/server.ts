/**
 * Dashboard Server Module
 * Express HTTP server with WebSocket support for real-time dashboard updates
 */

import express, { type Express, type Request, type Response } from 'express'
import { WebSocketServer, type WebSocket } from 'ws'
import { createServer, type Server } from 'http'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { DashboardDB } from './db.js'

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
    this.db = new DashboardDB(config.dbPath ?? ':memory:')
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
