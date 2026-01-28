/**
 * Dashboard Database Module
 * SQLite-based storage for security events, connector activity, and egress blocks
 */

import Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import type {
  EventSource,
  EventLevel,
  UnifiedEvent,
  ConnectorEvent,
  EgressMatch,
  EgressPattern,
  RedactedPayload,
  ExposureResult
} from '../policy/ward/types.js'

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface EventFilter {
  source?: EventSource
  level?: EventLevel
  category?: string
  since?: Date
  limit?: number
  offset?: number
}

export interface InsertEventInput {
  source: EventSource
  level: EventLevel
  category: string
  message: string
  data?: Record<string, unknown>
}

export interface InsertConnectorEventInput {
  connector: string
  method: string
  direction: 'inbound' | 'outbound'
  payload: RedactedPayload
  resourcesAccessed: string[]
}

export interface InsertEgressBlockInput {
  pattern: EgressPattern
  matchedText: string
  redactedText: string
  connector?: string
  destination?: string
}

export interface DashboardStats {
  totalEvents: number
  eventsBySource: Record<string, number>
  eventsByLevel: Record<string, number>
  pendingBlocks: number
  connectorCount: number
  recentExposures: number
}

// ─────────────────────────────────────────────────────────────
// Database Class
// ─────────────────────────────────────────────────────────────

export class DashboardDB {
  private db: Database.Database

  constructor(dbPath: string = '.bashbros.db') {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.initTables()
  }

  private initTables(): void {
    // Events table - unified security events
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        source TEXT NOT NULL,
        level TEXT NOT NULL,
        category TEXT NOT NULL,
        message TEXT NOT NULL,
        data TEXT
      )
    `)

    // Connector events table - MCP connector activity
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS connector_events (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        connector TEXT NOT NULL,
        method TEXT NOT NULL,
        direction TEXT NOT NULL,
        payload TEXT NOT NULL,
        resources_accessed TEXT NOT NULL
      )
    `)

    // Egress blocks table - blocked sensitive data
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS egress_blocks (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        pattern TEXT NOT NULL,
        matched_text TEXT NOT NULL,
        redacted_text TEXT NOT NULL,
        connector TEXT,
        destination TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        approved_by TEXT,
        approved_at TEXT
      )
    `)

    // Exposure scans table - network exposure scan results
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS exposure_scans (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        agent TEXT NOT NULL,
        pid INTEGER,
        port INTEGER NOT NULL,
        bind_address TEXT NOT NULL,
        has_auth TEXT NOT NULL,
        severity TEXT NOT NULL,
        action TEXT NOT NULL,
        message TEXT NOT NULL
      )
    `)

    // Create indexes for common queries
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_events_source ON events(source);
      CREATE INDEX IF NOT EXISTS idx_events_level ON events(level);
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_connector_events_connector ON connector_events(connector);
      CREATE INDEX IF NOT EXISTS idx_egress_blocks_status ON egress_blocks(status);
    `)
  }

  // ─────────────────────────────────────────────────────────────
  // Events
  // ─────────────────────────────────────────────────────────────

  insertEvent(input: InsertEventInput): string {
    const id = randomUUID()
    const timestamp = new Date().toISOString()
    const data = input.data ? JSON.stringify(input.data) : null

    const stmt = this.db.prepare(`
      INSERT INTO events (id, timestamp, source, level, category, message, data)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(id, timestamp, input.source, input.level, input.category, input.message, data)
    return id
  }

  getEvents(filter: EventFilter = {}): UnifiedEvent[] {
    const conditions: string[] = []
    const params: unknown[] = []

    if (filter.source) {
      conditions.push('source = ?')
      params.push(filter.source)
    }

    if (filter.level) {
      conditions.push('level = ?')
      params.push(filter.level)
    }

    if (filter.category) {
      conditions.push('category = ?')
      params.push(filter.category)
    }

    if (filter.since) {
      conditions.push('timestamp >= ?')
      params.push(filter.since.toISOString())
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = filter.limit ?? 100
    const offset = filter.offset ?? 0

    const stmt = this.db.prepare(`
      SELECT * FROM events
      ${whereClause}
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `)

    params.push(limit, offset)
    const rows = stmt.all(...params) as Array<{
      id: string
      timestamp: string
      source: EventSource
      level: EventLevel
      category: string
      message: string
      data: string | null
    }>

    return rows.map(row => ({
      id: row.id,
      timestamp: new Date(row.timestamp),
      source: row.source,
      level: row.level,
      category: row.category,
      message: row.message,
      data: row.data ? JSON.parse(row.data) : undefined
    }))
  }

  // ─────────────────────────────────────────────────────────────
  // Connector Events
  // ─────────────────────────────────────────────────────────────

  insertConnectorEvent(input: InsertConnectorEventInput): string {
    const id = randomUUID()
    const timestamp = new Date().toISOString()

    const stmt = this.db.prepare(`
      INSERT INTO connector_events (id, timestamp, connector, method, direction, payload, resources_accessed)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      id,
      timestamp,
      input.connector,
      input.method,
      input.direction,
      JSON.stringify(input.payload),
      JSON.stringify(input.resourcesAccessed)
    )

    return id
  }

  getConnectorEvents(connector: string, limit: number = 100): ConnectorEvent[] {
    const stmt = this.db.prepare(`
      SELECT * FROM connector_events
      WHERE connector = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `)

    const rows = stmt.all(connector, limit) as Array<{
      id: string
      timestamp: string
      connector: string
      method: string
      direction: 'inbound' | 'outbound'
      payload: string
      resources_accessed: string
    }>

    return rows.map(row => ({
      id: row.id,
      timestamp: new Date(row.timestamp),
      connector: row.connector,
      method: row.method,
      direction: row.direction,
      payload: JSON.parse(row.payload),
      resourcesAccessed: JSON.parse(row.resources_accessed)
    }))
  }

  getAllConnectorEvents(limit: number = 100): ConnectorEvent[] {
    const stmt = this.db.prepare(`
      SELECT * FROM connector_events
      ORDER BY timestamp DESC
      LIMIT ?
    `)

    const rows = stmt.all(limit) as Array<{
      id: string
      timestamp: string
      connector: string
      method: string
      direction: 'inbound' | 'outbound'
      payload: string
      resources_accessed: string
    }>

    return rows.map(row => ({
      id: row.id,
      timestamp: new Date(row.timestamp),
      connector: row.connector,
      method: row.method,
      direction: row.direction,
      payload: JSON.parse(row.payload),
      resourcesAccessed: JSON.parse(row.resources_accessed)
    }))
  }

  // ─────────────────────────────────────────────────────────────
  // Egress Blocks
  // ─────────────────────────────────────────────────────────────

  insertEgressBlock(input: InsertEgressBlockInput): string {
    const id = randomUUID()
    const timestamp = new Date().toISOString()

    const stmt = this.db.prepare(`
      INSERT INTO egress_blocks (id, timestamp, pattern, matched_text, redacted_text, connector, destination, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    `)

    stmt.run(
      id,
      timestamp,
      JSON.stringify(input.pattern),
      input.matchedText,
      input.redactedText,
      input.connector ?? null,
      input.destination ?? null
    )

    return id
  }

  getPendingBlocks(): EgressMatch[] {
    const stmt = this.db.prepare(`
      SELECT * FROM egress_blocks
      WHERE status = 'pending'
      ORDER BY timestamp DESC
    `)

    const rows = stmt.all() as Array<{
      id: string
      timestamp: string
      pattern: string
      matched_text: string
      redacted_text: string
      connector: string | null
      destination: string | null
      status: 'pending' | 'approved' | 'denied'
      approved_by: string | null
      approved_at: string | null
    }>

    return rows.map(row => this.rowToEgressMatch(row))
  }

  getBlock(id: string): EgressMatch | null {
    const stmt = this.db.prepare(`
      SELECT * FROM egress_blocks WHERE id = ?
    `)

    const row = stmt.get(id) as {
      id: string
      timestamp: string
      pattern: string
      matched_text: string
      redacted_text: string
      connector: string | null
      destination: string | null
      status: 'pending' | 'approved' | 'denied'
      approved_by: string | null
      approved_at: string | null
    } | undefined

    if (!row) return null
    return this.rowToEgressMatch(row)
  }

  approveBlock(id: string, approvedBy: string): void {
    const stmt = this.db.prepare(`
      UPDATE egress_blocks
      SET status = 'approved', approved_by = ?, approved_at = ?
      WHERE id = ?
    `)

    stmt.run(approvedBy, new Date().toISOString(), id)
  }

  denyBlock(id: string, deniedBy: string): void {
    const stmt = this.db.prepare(`
      UPDATE egress_blocks
      SET status = 'denied', approved_by = ?, approved_at = ?
      WHERE id = ?
    `)

    stmt.run(deniedBy, new Date().toISOString(), id)
  }

  private rowToEgressMatch(row: {
    id: string
    timestamp: string
    pattern: string
    matched_text: string
    redacted_text: string
    connector: string | null
    destination: string | null
    status: 'pending' | 'approved' | 'denied'
    approved_by: string | null
    approved_at: string | null
  }): EgressMatch {
    return {
      id: row.id,
      timestamp: new Date(row.timestamp),
      pattern: JSON.parse(row.pattern),
      matchedText: row.matched_text,
      redactedText: row.redacted_text,
      connector: row.connector ?? undefined,
      destination: row.destination ?? undefined,
      status: row.status,
      approvedBy: row.approved_by ?? undefined,
      approvedAt: row.approved_at ? new Date(row.approved_at) : undefined
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Exposure Scans
  // ─────────────────────────────────────────────────────────────

  insertExposureScan(result: ExposureResult): string {
    const id = randomUUID()
    const timestamp = result.timestamp.toISOString()

    const stmt = this.db.prepare(`
      INSERT INTO exposure_scans (id, timestamp, agent, pid, port, bind_address, has_auth, severity, action, message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      id,
      timestamp,
      result.agent,
      result.pid ?? null,
      result.port,
      result.bindAddress,
      String(result.hasAuth),
      result.severity,
      result.action,
      result.message
    )

    return id
  }

  getRecentExposures(limit: number = 100): ExposureResult[] {
    const stmt = this.db.prepare(`
      SELECT * FROM exposure_scans
      ORDER BY timestamp DESC
      LIMIT ?
    `)

    const rows = stmt.all(limit) as Array<{
      id: string
      timestamp: string
      agent: string
      pid: number | null
      port: number
      bind_address: string
      has_auth: string
      severity: string
      action: string
      message: string
    }>

    return rows.map(row => ({
      agent: row.agent,
      pid: row.pid ?? undefined,
      port: row.port,
      bindAddress: row.bind_address,
      hasAuth: row.has_auth === 'true' ? true : row.has_auth === 'false' ? false : 'unknown' as const,
      severity: row.severity as ExposureResult['severity'],
      action: row.action as ExposureResult['action'],
      message: row.message,
      timestamp: new Date(row.timestamp)
    }))
  }

  // ─────────────────────────────────────────────────────────────
  // Stats
  // ─────────────────────────────────────────────────────────────

  getStats(): DashboardStats {
    // Total events
    const totalEventsRow = this.db.prepare('SELECT COUNT(*) as count FROM events').get() as { count: number }

    // Events by source
    const sourceRows = this.db.prepare(`
      SELECT source, COUNT(*) as count FROM events GROUP BY source
    `).all() as Array<{ source: string; count: number }>

    const eventsBySource: Record<string, number> = {}
    for (const row of sourceRows) {
      eventsBySource[row.source] = row.count
    }

    // Events by level
    const levelRows = this.db.prepare(`
      SELECT level, COUNT(*) as count FROM events GROUP BY level
    `).all() as Array<{ level: string; count: number }>

    const eventsByLevel: Record<string, number> = {}
    for (const row of levelRows) {
      eventsByLevel[row.level] = row.count
    }

    // Pending blocks
    const pendingBlocksRow = this.db.prepare(`
      SELECT COUNT(*) as count FROM egress_blocks WHERE status = 'pending'
    `).get() as { count: number }

    // Unique connectors
    const connectorCountRow = this.db.prepare(`
      SELECT COUNT(DISTINCT connector) as count FROM connector_events
    `).get() as { count: number }

    // Recent exposures (last 24 hours)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const recentExposuresRow = this.db.prepare(`
      SELECT COUNT(*) as count FROM exposure_scans WHERE timestamp >= ?
    `).get(oneDayAgo) as { count: number }

    return {
      totalEvents: totalEventsRow.count,
      eventsBySource,
      eventsByLevel,
      pendingBlocks: pendingBlocksRow.count,
      connectorCount: connectorCountRow.count,
      recentExposures: recentExposuresRow.count
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Maintenance
  // ─────────────────────────────────────────────────────────────

  cleanup(olderThanDays: number = 30): number {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString()

    const eventsDeleted = this.db.prepare('DELETE FROM events WHERE timestamp < ?').run(cutoff).changes
    const connectorDeleted = this.db.prepare('DELETE FROM connector_events WHERE timestamp < ?').run(cutoff).changes
    const blocksDeleted = this.db.prepare(`
      DELETE FROM egress_blocks WHERE timestamp < ? AND status != 'pending'
    `).run(cutoff).changes
    const exposuresDeleted = this.db.prepare('DELETE FROM exposure_scans WHERE timestamp < ?').run(cutoff).changes

    return eventsDeleted + connectorDeleted + blocksDeleted + exposuresDeleted
  }

  close(): void {
    this.db.close()
  }
}

export default DashboardDB
