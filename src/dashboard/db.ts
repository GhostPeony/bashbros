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
  // Enhanced stats
  activeSessions: number
  todayCommands: number
  todayViolations: number
  avgRiskScore24h: number
  ollamaStatus: 'connected' | 'disconnected' | 'unknown'
}

// ─────────────────────────────────────────────────────────────
// Session & Command Types
// ─────────────────────────────────────────────────────────────

export interface SessionRecord {
  id: string
  agent: string
  pid: number
  startTime: Date
  endTime?: Date
  status: 'active' | 'completed' | 'crashed'
  commandCount: number
  blockedCount: number
  avgRiskScore: number
  workingDir: string
  repoName: string | null
  metadata: Record<string, unknown>
}

export interface CommandRecord {
  id: string
  sessionId: string
  timestamp: Date
  command: string
  allowed: boolean
  riskScore: number
  riskLevel: 'safe' | 'caution' | 'dangerous' | 'critical'
  riskFactors: string[]
  durationMs: number
  violations: string[]
  repoName?: string | null
}

export interface BroEventRecord {
  id: string
  sessionId: string | null
  timestamp: Date
  eventType: string
  inputContext: string
  outputSummary: string
  modelUsed: string
  latencyMs: number
  success: boolean
}

export interface BroStatusRecord {
  id: string
  timestamp: Date
  ollamaAvailable: boolean
  ollamaModel: string
  platform: string
  shell: string
  projectType: string | null
}

export interface ToolUseRecord {
  id: string
  timestamp: Date
  toolName: string
  toolInput: string
  toolOutput: string
  exitCode: number | null
  success: boolean | null
  cwd: string
  repoName: string | null
  repoPath: string | null
}

export interface InsertSessionInput {
  agent: string
  pid: number
  workingDir: string
  repoName?: string | null
}

export interface InsertCommandInput {
  sessionId?: string
  command: string
  allowed: boolean
  riskScore: number
  riskLevel: 'safe' | 'caution' | 'dangerous' | 'critical'
  riskFactors: string[]
  durationMs: number
  violations: string[]
}

export interface InsertBroEventInput {
  sessionId?: string
  eventType: string
  inputContext: string
  outputSummary: string
  modelUsed: string
  latencyMs: number
  success: boolean
}

export interface InsertBroStatusInput {
  ollamaAvailable: boolean
  ollamaModel: string
  platform: string
  shell: string
  projectType?: string
}

export interface InsertAdapterEventInput {
  adapterName: string
  baseModel: string
  purpose: string
  action: 'activated' | 'deactivated' | 'created' | 'deleted'
  success: boolean
}

export interface AdapterEventRecord {
  id: string
  timestamp: Date
  adapterName: string
  baseModel: string
  purpose: string
  action: string
  success: boolean
}

export interface InsertToolUseInput {
  toolName: string
  toolInput: string
  toolOutput: string
  exitCode?: number | null
  success?: boolean | null
  cwd: string
  repoName?: string | null
  repoPath?: string | null
  sessionId?: string
}

export interface ToolUseFilter {
  toolName?: string
  sessionId?: string
  since?: Date
  limit?: number
  offset?: number
}

// ─────────────────────────────────────────────────────────────
// User Prompt Types
// ─────────────────────────────────────────────────────────────

export interface UserPromptRecord {
  id: string
  sessionId: string | null
  timestamp: Date
  promptText: string
  promptLength: number
  wordCount: number
  cwd: string | null
}

export interface InsertUserPromptInput {
  sessionId?: string
  promptText: string
  cwd?: string
}

export interface UserPromptFilter {
  sessionId?: string
  since?: Date
  limit?: number
  offset?: number
}

export interface UserPromptStats {
  totalPrompts: number
  totalWords: number
  totalChars: number
  avgPromptLength: number
  avgWordCount: number
  longestPrompt: number
  last24h: number
  promptsPerSession: number
}

export interface SessionFilter {
  status?: 'active' | 'completed' | 'crashed'
  since?: Date
  until?: Date
  agent?: string
  limit?: number
  offset?: number
}

export interface CommandFilter {
  sessionId?: string
  allowed?: boolean
  riskLevel?: string
  since?: Date
  afterId?: string
  limit?: number
  offset?: number
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

    // Sessions table - track watch sessions
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        agent TEXT NOT NULL,
        pid INTEGER NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        command_count INTEGER NOT NULL DEFAULT 0,
        blocked_count INTEGER NOT NULL DEFAULT 0,
        avg_risk_score REAL NOT NULL DEFAULT 0,
        working_dir TEXT NOT NULL
      )
    `)

    // Commands table - detailed command history
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS commands (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        timestamp TEXT NOT NULL,
        command TEXT NOT NULL,
        allowed INTEGER NOT NULL,
        risk_score INTEGER NOT NULL,
        risk_level TEXT NOT NULL,
        risk_factors TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        violations TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      )
    `)

    // Migration: relax session_id NOT NULL for hook-mode recording
    this.migrateCommandsNullableSessionId()

    // Bash Bro events table - AI activity log
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS bro_events (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        timestamp TEXT NOT NULL,
        event_type TEXT NOT NULL,
        input_context TEXT NOT NULL,
        output_summary TEXT NOT NULL,
        model_used TEXT NOT NULL,
        latency_ms INTEGER NOT NULL,
        success INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      )
    `)

    // Bash Bro status snapshots table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS bro_status (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        ollama_available INTEGER NOT NULL,
        ollama_model TEXT NOT NULL,
        platform TEXT NOT NULL,
        shell TEXT NOT NULL,
        project_type TEXT
      )
    `)

    // Tool uses table - generic Claude Code tool tracking
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tool_uses (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        tool_input TEXT NOT NULL,
        tool_output TEXT NOT NULL,
        exit_code INTEGER,
        success INTEGER,
        cwd TEXT NOT NULL,
        repo_name TEXT,
        repo_path TEXT
      )
    `)

    // User prompts table - track user prompt submissions
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_prompts (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        timestamp TEXT NOT NULL,
        prompt_text TEXT NOT NULL,
        prompt_length INTEGER NOT NULL,
        word_count INTEGER NOT NULL,
        cwd TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      )
    `)

    // Adapter events table - track adapter activations
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS adapter_events (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        adapter_name TEXT NOT NULL,
        base_model TEXT NOT NULL,
        purpose TEXT NOT NULL,
        action TEXT NOT NULL,
        success INTEGER NOT NULL
      )
    `)

    // Migrations for multi-session support
    this.migrateToolUsesAddSessionId()
    this.migrateSessionsAddMode()
    this.migrateSessionsAddRepoName()
    this.migrateSessionsAddMetadata()

    // Create indexes for new tables
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
      CREATE INDEX IF NOT EXISTS idx_sessions_start_time ON sessions(start_time);
      CREATE INDEX IF NOT EXISTS idx_commands_session_id ON commands(session_id);
      CREATE INDEX IF NOT EXISTS idx_commands_timestamp ON commands(timestamp);
      CREATE INDEX IF NOT EXISTS idx_commands_allowed ON commands(allowed);
      CREATE INDEX IF NOT EXISTS idx_bro_events_session_id ON bro_events(session_id);
      CREATE INDEX IF NOT EXISTS idx_bro_events_timestamp ON bro_events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_bro_status_timestamp ON bro_status(timestamp);
      CREATE INDEX IF NOT EXISTS idx_tool_uses_timestamp ON tool_uses(timestamp);
      CREATE INDEX IF NOT EXISTS idx_tool_uses_tool_name ON tool_uses(tool_name);
      CREATE INDEX IF NOT EXISTS idx_tool_uses_session_id ON tool_uses(session_id);
      CREATE INDEX IF NOT EXISTS idx_adapter_events_timestamp ON adapter_events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_user_prompts_timestamp ON user_prompts(timestamp);
      CREATE INDEX IF NOT EXISTS idx_user_prompts_session_id ON user_prompts(session_id);
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
  // Sessions
  // ─────────────────────────────────────────────────────────────

  insertSession(input: InsertSessionInput): string {
    const id = randomUUID()
    const startTime = new Date().toISOString()

    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, agent, pid, start_time, status, command_count, blocked_count, avg_risk_score, working_dir, repo_name)
      VALUES (?, ?, ?, ?, 'active', 0, 0, 0, ?, ?)
    `)

    stmt.run(id, input.agent, input.pid, startTime, input.workingDir, input.repoName ?? null)
    return id
  }

  updateSession(id: string, updates: {
    endTime?: Date
    status?: 'active' | 'completed' | 'crashed'
    commandCount?: number
    blockedCount?: number
    avgRiskScore?: number
  }): void {
    const setClauses: string[] = []
    const params: unknown[] = []

    if (updates.endTime !== undefined) {
      setClauses.push('end_time = ?')
      params.push(updates.endTime.toISOString())
    }
    if (updates.status !== undefined) {
      setClauses.push('status = ?')
      params.push(updates.status)
    }
    if (updates.commandCount !== undefined) {
      setClauses.push('command_count = ?')
      params.push(updates.commandCount)
    }
    if (updates.blockedCount !== undefined) {
      setClauses.push('blocked_count = ?')
      params.push(updates.blockedCount)
    }
    if (updates.avgRiskScore !== undefined) {
      setClauses.push('avg_risk_score = ?')
      params.push(updates.avgRiskScore)
    }

    if (setClauses.length === 0) return

    params.push(id)
    const stmt = this.db.prepare(`
      UPDATE sessions SET ${setClauses.join(', ')} WHERE id = ?
    `)
    stmt.run(...params)
  }

  getSession(id: string): SessionRecord | null {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE id = ?')
    const row = stmt.get(id) as {
      id: string
      agent: string
      pid: number
      start_time: string
      end_time: string | null
      status: 'active' | 'completed' | 'crashed'
      command_count: number
      blocked_count: number
      avg_risk_score: number
      working_dir: string
      metadata?: string
    } | undefined

    if (!row) return null
    return this.rowToSession(row)
  }

  getSessions(filter: SessionFilter = {}): SessionRecord[] {
    const conditions: string[] = []
    const params: unknown[] = []

    if (filter.status) {
      conditions.push('status = ?')
      params.push(filter.status)
    }
    if (filter.since) {
      conditions.push('start_time >= ?')
      params.push(filter.since.toISOString())
    }
    if (filter.until) {
      conditions.push('start_time <= ?')
      params.push(filter.until.toISOString())
    }
    if (filter.agent) {
      conditions.push('agent = ?')
      params.push(filter.agent)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = filter.limit ?? 100
    const offset = filter.offset ?? 0

    const stmt = this.db.prepare(`
      SELECT * FROM sessions
      ${whereClause}
      ORDER BY start_time DESC
      LIMIT ? OFFSET ?
    `)

    params.push(limit, offset)
    const rows = stmt.all(...params) as Array<{
      id: string
      agent: string
      pid: number
      start_time: string
      end_time: string | null
      status: 'active' | 'completed' | 'crashed'
      command_count: number
      blocked_count: number
      avg_risk_score: number
      working_dir: string
    }>

    return rows.map(row => this.rowToSession(row))
  }

  getActiveSession(): SessionRecord | null {
    const stmt = this.db.prepare(`
      SELECT * FROM sessions WHERE status = 'active' ORDER BY start_time DESC LIMIT 1
    `)
    const row = stmt.get() as {
      id: string
      agent: string
      pid: number
      start_time: string
      end_time: string | null
      status: 'active' | 'completed' | 'crashed'
      command_count: number
      blocked_count: number
      avg_risk_score: number
      working_dir: string
    } | undefined

    if (!row) return null
    return this.rowToSession(row)
  }

  /**
   * Insert a session with an externally-provided ID (for hook-mode sessions).
   * Uses INSERT OR IGNORE for race-safe concurrent hook calls.
   */
  insertSessionWithId(id: string, input: InsertSessionInput & { mode?: string }): string {
    const startTime = new Date().toISOString()

    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO sessions (id, agent, pid, start_time, status, command_count, blocked_count, avg_risk_score, working_dir, mode, repo_name)
      VALUES (?, ?, ?, ?, 'active', 0, 0, 0, ?, ?, ?)
    `)

    stmt.run(id, input.agent, input.pid, startTime, input.workingDir, input.mode ?? 'hook', input.repoName ?? null)
    return id
  }

  /**
   * Get ALL active sessions, ordered by start_time DESC.
   * Used by the multi-session dashboard.
   */
  getActiveSessions(): SessionRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM sessions WHERE status = 'active' ORDER BY start_time DESC
    `)
    const rows = stmt.all() as Array<{
      id: string
      agent: string
      pid: number
      start_time: string
      end_time: string | null
      status: 'active' | 'completed' | 'crashed'
      command_count: number
      blocked_count: number
      avg_risk_score: number
      working_dir: string
    }>

    return rows.map(row => this.rowToSession(row))
  }

  updateSessionMetadata(id: string, metadata: Record<string, unknown>): void {
    const stmt = this.db.prepare('UPDATE sessions SET metadata = ? WHERE id = ?')
    stmt.run(JSON.stringify(metadata), id)
  }

  /**
   * Atomically increment session counters in a single UPDATE.
   * Race-safe for concurrent hook processes (SQLite serializes writes).
   */
  incrementSessionCommand(id: string, blocked: boolean, riskScore: number): void {
    const stmt = this.db.prepare(`
      UPDATE sessions SET
        command_count = command_count + 1,
        blocked_count = blocked_count + ?,
        avg_risk_score = (avg_risk_score * command_count + ?) / (command_count + 1)
      WHERE id = ?
    `)
    stmt.run(blocked ? 1 : 0, riskScore, id)
  }

  private rowToSession(row: {
    id: string
    agent: string
    pid: number
    start_time: string
    end_time: string | null
    status: 'active' | 'completed' | 'crashed'
    command_count: number
    blocked_count: number
    avg_risk_score: number
    working_dir: string
    repo_name?: string | null
    metadata?: string
  }): SessionRecord {
    return {
      id: row.id,
      agent: row.agent,
      pid: row.pid,
      startTime: new Date(row.start_time),
      endTime: row.end_time ? new Date(row.end_time) : undefined,
      status: row.status,
      commandCount: row.command_count,
      blockedCount: row.blocked_count,
      avgRiskScore: row.avg_risk_score,
      workingDir: row.working_dir,
      repoName: row.repo_name ?? null,
      metadata: JSON.parse(row.metadata || '{}')
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Commands
  // ─────────────────────────────────────────────────────────────

  insertCommand(input: InsertCommandInput): string {
    const id = randomUUID()
    const timestamp = new Date().toISOString()

    const stmt = this.db.prepare(`
      INSERT INTO commands (id, session_id, timestamp, command, allowed, risk_score, risk_level, risk_factors, duration_ms, violations)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      id,
      input.sessionId ?? null,
      timestamp,
      input.command,
      input.allowed ? 1 : 0,
      input.riskScore,
      input.riskLevel,
      JSON.stringify(input.riskFactors),
      input.durationMs,
      JSON.stringify(input.violations)
    )

    return id
  }

  getCommands(filter: CommandFilter = {}): CommandRecord[] {
    const conditions: string[] = []
    const params: unknown[] = []

    if (filter.sessionId) {
      conditions.push('session_id = ?')
      params.push(filter.sessionId)
    }
    if (filter.allowed !== undefined) {
      conditions.push('allowed = ?')
      params.push(filter.allowed ? 1 : 0)
    }
    if (filter.riskLevel) {
      conditions.push('risk_level = ?')
      params.push(filter.riskLevel)
    }
    if (filter.since) {
      conditions.push('timestamp >= ?')
      params.push(filter.since.toISOString())
    }
    if (filter.afterId) {
      conditions.push('id > ?')
      params.push(filter.afterId)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = filter.limit ?? 100
    const offset = filter.offset ?? 0

    const stmt = this.db.prepare(`
      SELECT * FROM commands
      ${whereClause}
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `)

    params.push(limit, offset)
    const rows = stmt.all(...params) as Array<{
      id: string
      session_id: string
      timestamp: string
      command: string
      allowed: number
      risk_score: number
      risk_level: 'safe' | 'caution' | 'dangerous' | 'critical'
      risk_factors: string
      duration_ms: number
      violations: string
    }>

    return rows.map(row => this.rowToCommand(row))
  }

  getCommandsBySession(sessionId: string, limit: number = 100): CommandRecord[] {
    return this.getCommands({ sessionId, limit })
  }

  searchCommands(query: string, limit: number = 50): CommandRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM commands
      WHERE command LIKE ?
      ORDER BY timestamp DESC
      LIMIT ?
    `)

    const rows = stmt.all(`%${query}%`, limit) as Array<{
      id: string
      session_id: string
      timestamp: string
      command: string
      allowed: number
      risk_score: number
      risk_level: 'safe' | 'caution' | 'dangerous' | 'critical'
      risk_factors: string
      duration_ms: number
      violations: string
    }>

    return rows.map(row => this.rowToCommand(row))
  }

  getLiveCommands(limit: number = 20): CommandRecord[] {
    const stmt = this.db.prepare(`
      SELECT c.*, s.repo_name, s.working_dir
      FROM commands c
      LEFT JOIN sessions s ON c.session_id = s.id
      ORDER BY c.timestamp DESC
      LIMIT ?
    `)

    const rows = stmt.all(limit) as Array<{
      id: string
      session_id: string
      timestamp: string
      command: string
      allowed: number
      risk_score: number
      risk_level: 'safe' | 'caution' | 'dangerous' | 'critical'
      risk_factors: string
      duration_ms: number
      violations: string
      repo_name: string | null
      working_dir: string | null
    }>

    return rows.map(row => ({
      ...this.rowToCommand(row),
      repoName: row.repo_name ?? (row.working_dir ? row.working_dir.split(/[/\\]/).pop() ?? null : null)
    }))
  }

  private rowToCommand(row: {
    id: string
    session_id: string
    timestamp: string
    command: string
    allowed: number
    risk_score: number
    risk_level: 'safe' | 'caution' | 'dangerous' | 'critical'
    risk_factors: string
    duration_ms: number
    violations: string
  }): CommandRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      timestamp: new Date(row.timestamp),
      command: row.command,
      allowed: row.allowed === 1,
      riskScore: row.risk_score,
      riskLevel: row.risk_level,
      riskFactors: JSON.parse(row.risk_factors),
      durationMs: row.duration_ms,
      violations: JSON.parse(row.violations)
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Bro Events
  // ─────────────────────────────────────────────────────────────

  insertBroEvent(input: InsertBroEventInput): string {
    const id = randomUUID()
    const timestamp = new Date().toISOString()

    const stmt = this.db.prepare(`
      INSERT INTO bro_events (id, session_id, timestamp, event_type, input_context, output_summary, model_used, latency_ms, success)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      id,
      input.sessionId ?? null,
      timestamp,
      input.eventType,
      input.inputContext,
      input.outputSummary,
      input.modelUsed,
      input.latencyMs,
      input.success ? 1 : 0
    )

    return id
  }

  getBroEvents(limit: number = 100, sessionId?: string): BroEventRecord[] {
    let stmt
    let rows

    if (sessionId) {
      stmt = this.db.prepare(`
        SELECT * FROM bro_events
        WHERE session_id = ?
        ORDER BY timestamp DESC
        LIMIT ?
      `)
      rows = stmt.all(sessionId, limit)
    } else {
      stmt = this.db.prepare(`
        SELECT * FROM bro_events
        ORDER BY timestamp DESC
        LIMIT ?
      `)
      rows = stmt.all(limit)
    }

    return (rows as Array<{
      id: string
      session_id: string | null
      timestamp: string
      event_type: string
      input_context: string
      output_summary: string
      model_used: string
      latency_ms: number
      success: number
    }>).map(row => ({
      id: row.id,
      sessionId: row.session_id,
      timestamp: new Date(row.timestamp),
      eventType: row.event_type,
      inputContext: row.input_context,
      outputSummary: row.output_summary,
      modelUsed: row.model_used,
      latencyMs: row.latency_ms,
      success: row.success === 1
    }))
  }

  // ─────────────────────────────────────────────────────────────
  // Bro Status
  // ─────────────────────────────────────────────────────────────

  updateBroStatus(input: InsertBroStatusInput): string {
    const id = randomUUID()
    const timestamp = new Date().toISOString()

    const stmt = this.db.prepare(`
      INSERT INTO bro_status (id, timestamp, ollama_available, ollama_model, platform, shell, project_type)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      id,
      timestamp,
      input.ollamaAvailable ? 1 : 0,
      input.ollamaModel,
      input.platform,
      input.shell,
      input.projectType ?? null
    )

    return id
  }

  getLatestBroStatus(): BroStatusRecord | null {
    const stmt = this.db.prepare(`
      SELECT * FROM bro_status
      ORDER BY timestamp DESC
      LIMIT 1
    `)

    const row = stmt.get() as {
      id: string
      timestamp: string
      ollama_available: number
      ollama_model: string
      platform: string
      shell: string
      project_type: string | null
    } | undefined

    if (!row) return null

    return {
      id: row.id,
      timestamp: new Date(row.timestamp),
      ollamaAvailable: row.ollama_available === 1,
      ollamaModel: row.ollama_model,
      platform: row.platform,
      shell: row.shell,
      projectType: row.project_type
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Adapter Events
  // ─────────────────────────────────────────────────────────────

  insertAdapterEvent(input: InsertAdapterEventInput): string {
    const id = randomUUID()
    const timestamp = new Date().toISOString()

    const stmt = this.db.prepare(`
      INSERT INTO adapter_events (id, timestamp, adapter_name, base_model, purpose, action, success)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      id,
      timestamp,
      input.adapterName,
      input.baseModel,
      input.purpose,
      input.action,
      input.success ? 1 : 0
    )

    return id
  }

  getAdapterEvents(limit: number = 50): AdapterEventRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM adapter_events
      ORDER BY timestamp DESC
      LIMIT ?
    `)

    const rows = stmt.all(limit) as any[]

    return rows.map(row => ({
      id: row.id,
      timestamp: new Date(row.timestamp),
      adapterName: row.adapter_name,
      baseModel: row.base_model,
      purpose: row.purpose,
      action: row.action,
      success: row.success === 1
    }))
  }

  // ─────────────────────────────────────────────────────────────
  // Tool Uses
  // ─────────────────────────────────────────────────────────────

  insertToolUse(input: InsertToolUseInput): string {
    const id = randomUUID()
    const timestamp = new Date().toISOString()

    const stmt = this.db.prepare(`
      INSERT INTO tool_uses (id, timestamp, tool_name, tool_input, tool_output, exit_code, success, cwd, repo_name, repo_path, session_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      id,
      timestamp,
      input.toolName,
      input.toolInput.substring(0, 50000), // Truncate very long inputs
      input.toolOutput.substring(0, 50000), // Truncate very long outputs
      input.exitCode ?? null,
      input.success === undefined ? null : (input.success ? 1 : 0),
      input.cwd,
      input.repoName ?? null,
      input.repoPath ?? null,
      input.sessionId ?? null
    )

    return id
  }

  getToolUses(filter: ToolUseFilter = {}): ToolUseRecord[] {
    const conditions: string[] = []
    const params: unknown[] = []

    if (filter.toolName) {
      conditions.push('tool_name = ?')
      params.push(filter.toolName)
    }
    if (filter.sessionId) {
      conditions.push('session_id = ?')
      params.push(filter.sessionId)
    }
    if (filter.since) {
      conditions.push('timestamp >= ?')
      params.push(filter.since.toISOString())
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = filter.limit ?? 100
    const offset = filter.offset ?? 0

    const stmt = this.db.prepare(`
      SELECT * FROM tool_uses
      ${whereClause}
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `)

    params.push(limit, offset)
    const rows = stmt.all(...params) as Array<{
      id: string
      timestamp: string
      tool_name: string
      tool_input: string
      tool_output: string
      exit_code: number | null
      success: number | null
      cwd: string
      repo_name: string | null
      repo_path: string | null
    }>

    return rows.map(row => ({
      id: row.id,
      timestamp: new Date(row.timestamp),
      toolName: row.tool_name,
      toolInput: row.tool_input,
      toolOutput: row.tool_output,
      exitCode: row.exit_code,
      success: row.success === null ? null : row.success === 1,
      cwd: row.cwd,
      repoName: row.repo_name,
      repoPath: row.repo_path
    }))
  }

  getLiveToolUses(limit: number = 50): ToolUseRecord[] {
    return this.getToolUses({ limit })
  }

  getToolUseStats(): {
    totalUses: number
    byTool: Record<string, number>
    last24h: number
  } {
    const totalRow = this.db.prepare('SELECT COUNT(*) as count FROM tool_uses').get() as { count: number }

    const toolRows = this.db.prepare(`
      SELECT tool_name, COUNT(*) as count FROM tool_uses GROUP BY tool_name ORDER BY count DESC
    `).all() as Array<{ tool_name: string; count: number }>

    const byTool: Record<string, number> = {}
    for (const row of toolRows) {
      byTool[row.tool_name] = row.count
    }

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const last24hRow = this.db.prepare(`
      SELECT COUNT(*) as count FROM tool_uses WHERE timestamp >= ?
    `).get(oneDayAgo) as { count: number }

    return {
      totalUses: totalRow.count,
      byTool,
      last24h: last24hRow.count
    }
  }

  // ─────────────────────────────────────────────────────────────
  // User Prompts
  // ─────────────────────────────────────────────────────────────

  insertUserPrompt(input: InsertUserPromptInput): string {
    const id = randomUUID()
    const timestamp = new Date().toISOString()
    const originalLength = input.promptText.length
    // Truncate text to 50KB but preserve original length for stats
    const promptText = input.promptText.substring(0, 50000)
    const wordCount = promptText.trim() === '' ? 0 : promptText.trim().split(/\s+/).length

    const stmt = this.db.prepare(`
      INSERT INTO user_prompts (id, session_id, timestamp, prompt_text, prompt_length, word_count, cwd)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      id,
      input.sessionId ?? null,
      timestamp,
      promptText,
      originalLength,
      wordCount,
      input.cwd ?? null
    )

    return id
  }

  getUserPrompts(filter: UserPromptFilter = {}): UserPromptRecord[] {
    const conditions: string[] = []
    const params: unknown[] = []

    if (filter.sessionId) {
      conditions.push('session_id = ?')
      params.push(filter.sessionId)
    }
    if (filter.since) {
      conditions.push('timestamp >= ?')
      params.push(filter.since.toISOString())
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = filter.limit ?? 100
    const offset = filter.offset ?? 0

    const stmt = this.db.prepare(`
      SELECT * FROM user_prompts
      ${whereClause}
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `)

    params.push(limit, offset)
    const rows = stmt.all(...params) as Array<{
      id: string
      session_id: string | null
      timestamp: string
      prompt_text: string
      prompt_length: number
      word_count: number
      cwd: string | null
    }>

    return rows.map(row => ({
      id: row.id,
      sessionId: row.session_id,
      timestamp: new Date(row.timestamp),
      promptText: row.prompt_text,
      promptLength: row.prompt_length,
      wordCount: row.word_count,
      cwd: row.cwd
    }))
  }

  getUserPromptStats(): UserPromptStats {
    const totalRow = this.db.prepare('SELECT COUNT(*) as count FROM user_prompts').get() as { count: number }

    const sumRow = this.db.prepare(`
      SELECT
        COALESCE(SUM(word_count), 0) as total_words,
        COALESCE(SUM(prompt_length), 0) as total_chars,
        COALESCE(AVG(prompt_length), 0) as avg_length,
        COALESCE(AVG(word_count), 0) as avg_words,
        COALESCE(MAX(prompt_length), 0) as longest
      FROM user_prompts
    `).get() as { total_words: number; total_chars: number; avg_length: number; avg_words: number; longest: number }

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const last24hRow = this.db.prepare(`
      SELECT COUNT(*) as count FROM user_prompts WHERE timestamp >= ?
    `).get(oneDayAgo) as { count: number }

    // Prompts per session (average across sessions that have prompts)
    const perSessionRow = this.db.prepare(`
      SELECT COALESCE(AVG(cnt), 0) as avg_per_session FROM (
        SELECT COUNT(*) as cnt FROM user_prompts WHERE session_id IS NOT NULL GROUP BY session_id
      )
    `).get() as { avg_per_session: number }

    return {
      totalPrompts: totalRow.count,
      totalWords: sumRow.total_words,
      totalChars: sumRow.total_chars,
      avgPromptLength: Math.round(sumRow.avg_length),
      avgWordCount: Math.round(sumRow.avg_words),
      longestPrompt: sumRow.longest,
      last24h: last24hRow.count,
      promptsPerSession: Math.round(perSessionRow.avg_per_session)
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Session Metrics
  // ─────────────────────────────────────────────────────────────

  getSessionMetrics(sessionId: string): {
    totalCommands: number
    allowedCommands: number
    blockedCommands: number
    avgRiskScore: number
    riskDistribution: Record<string, number>
    topCommands: Array<{ command: string; count: number }>
  } {
    // Total commands
    const totalRow = this.db.prepare(`
      SELECT COUNT(*) as count FROM commands WHERE session_id = ?
    `).get(sessionId) as { count: number }

    // Allowed/blocked counts
    const allowedRow = this.db.prepare(`
      SELECT COUNT(*) as count FROM commands WHERE session_id = ? AND allowed = 1
    `).get(sessionId) as { count: number }

    const blockedRow = this.db.prepare(`
      SELECT COUNT(*) as count FROM commands WHERE session_id = ? AND allowed = 0
    `).get(sessionId) as { count: number }

    // Average risk score
    const avgRow = this.db.prepare(`
      SELECT AVG(risk_score) as avg FROM commands WHERE session_id = ?
    `).get(sessionId) as { avg: number | null }

    // Risk distribution
    const riskRows = this.db.prepare(`
      SELECT risk_level, COUNT(*) as count FROM commands WHERE session_id = ? GROUP BY risk_level
    `).all(sessionId) as Array<{ risk_level: string; count: number }>

    const riskDistribution: Record<string, number> = {}
    for (const row of riskRows) {
      riskDistribution[row.risk_level] = row.count
    }

    // Top commands (by base command, first word)
    const cmdRows = this.db.prepare(`
      SELECT command, COUNT(*) as count FROM commands WHERE session_id = ?
      GROUP BY command ORDER BY count DESC LIMIT 10
    `).all(sessionId) as Array<{ command: string; count: number }>

    return {
      totalCommands: totalRow.count,
      allowedCommands: allowedRow.count,
      blockedCommands: blockedRow.count,
      avgRiskScore: avgRow.avg ?? 0,
      riskDistribution,
      topCommands: cmdRows
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Security Summary
  // ─────────────────────────────────────────────────────────────

  getSecuritySummary(): {
    totalCommands24h: number
    blockedCount24h: number
    avgRiskScore24h: number
    riskDistribution: Record<string, number>
    violationTypes: Array<{ type: string; count: number }>
    highRiskCount24h: number
  } {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    // Total commands in last 24h
    const totalRow = this.db.prepare(`
      SELECT COUNT(*) as count FROM commands WHERE timestamp >= ?
    `).get(oneDayAgo) as { count: number }

    // Blocked count in last 24h
    const blockedRow = this.db.prepare(`
      SELECT COUNT(*) as count FROM commands WHERE timestamp >= ? AND allowed = 0
    `).get(oneDayAgo) as { count: number }

    // Average risk score in last 24h
    const avgRow = this.db.prepare(`
      SELECT AVG(risk_score) as avg FROM commands WHERE timestamp >= ?
    `).get(oneDayAgo) as { avg: number | null }

    // Risk distribution in last 24h
    const riskRows = this.db.prepare(`
      SELECT risk_level, COUNT(*) as count FROM commands WHERE timestamp >= ? GROUP BY risk_level
    `).all(oneDayAgo) as Array<{ risk_level: string; count: number }>

    const riskDistribution: Record<string, number> = {}
    for (const row of riskRows) {
      riskDistribution[row.risk_level] = row.count
    }

    // High risk count (dangerous + critical)
    const highRiskRow = this.db.prepare(`
      SELECT COUNT(*) as count FROM commands WHERE timestamp >= ? AND risk_level IN ('dangerous', 'critical')
    `).get(oneDayAgo) as { count: number }

    // Violation types from blocked commands
    const violationRows = this.db.prepare(`
      SELECT violations FROM commands WHERE timestamp >= ? AND allowed = 0 AND violations != '[]'
    `).all(oneDayAgo) as Array<{ violations: string }>

    const typeCounts: Record<string, number> = {}
    for (const row of violationRows) {
      try {
        const violations = JSON.parse(row.violations) as string[]
        for (const v of violations) {
          const type = v.includes(':') ? v.split(':')[0] : v
          typeCounts[type] = (typeCounts[type] || 0) + 1
        }
      } catch {
        // skip malformed JSON
      }
    }

    const violationTypes = Object.entries(typeCounts)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)

    return {
      totalCommands24h: totalRow.count,
      blockedCount24h: blockedRow.count,
      avgRiskScore24h: avgRow.avg ?? 0,
      riskDistribution,
      violationTypes,
      highRiskCount24h: highRiskRow.count
    }
  }

  getBlockedCommandsRecent(limit: number = 25): CommandRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM commands WHERE allowed = 0 ORDER BY timestamp DESC LIMIT ?
    `)

    const rows = stmt.all(limit) as Array<{
      id: string
      session_id: string
      timestamp: string
      command: string
      allowed: number
      risk_score: number
      risk_level: 'safe' | 'caution' | 'dangerous' | 'critical'
      risk_factors: string
      duration_ms: number
      violations: string
    }>

    return rows.map(row => this.rowToCommand(row))
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

    // Active sessions
    const activeSessionsRow = this.db.prepare(`
      SELECT COUNT(*) as count FROM sessions WHERE status = 'active'
    `).get() as { count: number }

    // Today's commands
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const todayCommandsRow = this.db.prepare(`
      SELECT COUNT(*) as count FROM commands WHERE timestamp >= ?
    `).get(todayStart.toISOString()) as { count: number }

    // Today's violations (blocked commands)
    const todayViolationsRow = this.db.prepare(`
      SELECT COUNT(*) as count FROM commands WHERE timestamp >= ? AND allowed = 0
    `).get(todayStart.toISOString()) as { count: number }

    // Average risk score in last 24 hours
    const avgRiskRow = this.db.prepare(`
      SELECT AVG(risk_score) as avg FROM commands WHERE timestamp >= ?
    `).get(oneDayAgo) as { avg: number | null }

    // Ollama status from latest bro_status
    const latestStatus = this.getLatestBroStatus()
    let ollamaStatus: 'connected' | 'disconnected' | 'unknown' = 'unknown'
    if (latestStatus) {
      ollamaStatus = latestStatus.ollamaAvailable ? 'connected' : 'disconnected'
    }

    return {
      totalEvents: totalEventsRow.count,
      eventsBySource,
      eventsByLevel,
      pendingBlocks: pendingBlocksRow.count,
      connectorCount: connectorCountRow.count,
      recentExposures: recentExposuresRow.count,
      activeSessions: activeSessionsRow.count,
      todayCommands: todayCommandsRow.count,
      todayViolations: todayViolationsRow.count,
      avgRiskScore24h: avgRiskRow.avg ?? 0,
      ollamaStatus
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Cross-process Query Helpers (for db-checks)
  // ─────────────────────────────────────────────────────────────

  getRecentCommandTexts(windowSize: number): { command: string; timestamp: string }[] {
    const stmt = this.db.prepare(`
      SELECT command, timestamp FROM commands
      ORDER BY timestamp DESC
      LIMIT ?
    `)
    return stmt.all(windowSize) as { command: string; timestamp: string }[]
  }

  getCommandCountSince(sinceISO: string): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) as count FROM commands WHERE timestamp >= ?
    `).get(sinceISO) as { count: number }
    return row.count
  }

  getTotalCommandCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM commands').get() as { count: number }
    return row.count
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

    // Cleanup new tables - commands first (due to foreign key), then sessions
    const commandsDeleted = this.db.prepare('DELETE FROM commands WHERE timestamp < ?').run(cutoff).changes
    const sessionsDeleted = this.db.prepare(`
      DELETE FROM sessions WHERE start_time < ? AND status != 'active'
    `).run(cutoff).changes
    const broEventsDeleted = this.db.prepare('DELETE FROM bro_events WHERE timestamp < ?').run(cutoff).changes
    const broStatusDeleted = this.db.prepare('DELETE FROM bro_status WHERE timestamp < ?').run(cutoff).changes
    const toolUsesDeleted = this.db.prepare('DELETE FROM tool_uses WHERE timestamp < ?').run(cutoff).changes
    const promptsDeleted = this.db.prepare('DELETE FROM user_prompts WHERE timestamp < ?').run(cutoff).changes

    return eventsDeleted + connectorDeleted + blocksDeleted + exposuresDeleted +
           commandsDeleted + sessionsDeleted + broEventsDeleted + broStatusDeleted + toolUsesDeleted + promptsDeleted
  }

  /**
   * Migration: add session_id column to tool_uses table for session tracking
   */
  private migrateToolUsesAddSessionId(): void {
    try {
      const tableInfo = this.db.pragma('table_info(tool_uses)') as Array<{ name: string }>
      const hasSessionId = tableInfo.some(col => col.name === 'session_id')
      if (!hasSessionId) {
        this.db.exec('ALTER TABLE tool_uses ADD COLUMN session_id TEXT')
      }
    } catch {
      // Table doesn't exist yet or already migrated
    }
  }

  /**
   * Migration: add mode column to sessions table to distinguish watch vs hook sessions
   */
  private migrateSessionsAddMode(): void {
    try {
      const tableInfo = this.db.pragma('table_info(sessions)') as Array<{ name: string }>
      const hasMode = tableInfo.some(col => col.name === 'mode')
      if (!hasMode) {
        this.db.exec("ALTER TABLE sessions ADD COLUMN mode TEXT DEFAULT 'watch'")
      }
    } catch {
      // Table doesn't exist yet or already migrated
    }
  }

  /**
   * Migration: add repo_name column to sessions table
   */
  private migrateSessionsAddRepoName(): void {
    try {
      const tableInfo = this.db.pragma('table_info(sessions)') as Array<{ name: string }>
      const hasRepoName = tableInfo.some(col => col.name === 'repo_name')
      if (!hasRepoName) {
        this.db.exec('ALTER TABLE sessions ADD COLUMN repo_name TEXT')
      }
    } catch {
      // Table doesn't exist yet or already migrated
    }
  }

  /**
   * Migration: add metadata column to sessions table
   */
  private migrateSessionsAddMetadata(): void {
    try {
      const tableInfo = this.db.pragma('table_info(sessions)') as Array<{ name: string }>
      const hasMetadata = tableInfo.some(col => col.name === 'metadata')
      if (!hasMetadata) {
        this.db.exec("ALTER TABLE sessions ADD COLUMN metadata TEXT DEFAULT '{}'")
      }
    } catch {
      // Table doesn't exist yet or already migrated
    }
  }

  /**
   * Migration: allow NULL session_id in commands table for hook-mode recording
   * (each hook invocation is a separate process with no long-running session)
   */
  private migrateCommandsNullableSessionId(): void {
    try {
      const tableInfo = this.db.pragma('table_info(commands)') as Array<{ name: string; notnull: number }>
      const sessionCol = tableInfo.find(col => col.name === 'session_id')
      if (sessionCol && sessionCol.notnull === 1) {
        this.db.exec(`
          CREATE TABLE commands_mig (
            id TEXT PRIMARY KEY,
            session_id TEXT,
            timestamp TEXT NOT NULL,
            command TEXT NOT NULL,
            allowed INTEGER NOT NULL,
            risk_score INTEGER NOT NULL,
            risk_level TEXT NOT NULL,
            risk_factors TEXT NOT NULL,
            duration_ms INTEGER NOT NULL,
            violations TEXT NOT NULL,
            FOREIGN KEY (session_id) REFERENCES sessions(id)
          );
          INSERT INTO commands_mig SELECT * FROM commands;
          DROP TABLE commands;
          ALTER TABLE commands_mig RENAME TO commands;
          CREATE INDEX IF NOT EXISTS idx_commands_session_id ON commands(session_id);
          CREATE INDEX IF NOT EXISTS idx_commands_timestamp ON commands(timestamp);
          CREATE INDEX IF NOT EXISTS idx_commands_allowed ON commands(allowed);
        `)
      }
    } catch {
      // Table doesn't exist yet or already migrated — no action needed
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Achievement System
  // ─────────────────────────────────────────────────────────────

  static readonly BADGE_DEFINITIONS: BadgeDefinition[] = [
    // Volume
    { id: 'first_blood', name: 'First Blood', description: 'Execute commands', category: 'volume', icon: '\u2694', stat: 'totalCommands', tiers: [1, 100, 1000, 10000, 100000] },
    { id: 'marathon_runner', name: 'Marathon Runner', description: 'Complete sessions', category: 'volume', icon: '\ud83c\udfc3', stat: 'totalSessions', tiers: [1, 10, 50, 200, 1000] },
    { id: 'watchdog', name: 'Watchdog', description: 'Time under watch', category: 'volume', icon: '\u23f1', stat: 'totalWatchTimeMinutes', tiers: [60, 1440, 10080, 43200, 525600] },
    // Security
    { id: 'shield_bearer', name: 'Shield Bearer', description: 'Threats blocked', category: 'security', icon: '\ud83d\udee1', stat: 'totalBlocked', tiers: [1, 25, 100, 500, 2000] },
    { id: 'clean_hands', name: 'Clean Hands', description: 'Consecutive clean commands', category: 'security', icon: '\u2728', stat: 'cleanestStreak', tiers: [10, 50, 200, 1000, 5000] },
    { id: 'risk_taker', name: 'Risk Taker', description: 'High risk commands executed', category: 'security', icon: '\ud83c\udfb2', stat: 'highRiskCount', tiers: [1, 5, 10, 25, 50] },
    // Agents
    { id: 'buddy_system', name: 'Buddy System', description: 'Use 2+ agents', category: 'agents', icon: '\ud83e\udd1d', stat: 'uniqueAgents', tiers: [2, 2, 2, 2, 2] },
    { id: 'squad_up', name: 'Squad Up', description: 'Use multiple agents', category: 'agents', icon: '\ud83d\udc6b', stat: 'uniqueAgents', tiers: [2, 3, 4, 5, 5] },
    { id: 'loyal', name: 'Loyal', description: '1000 commands from one agent', category: 'agents', icon: '\ud83d\udc51', stat: 'maxAgentCommands', tiers: [100, 250, 500, 1000, 5000] },
    { id: 'polyglot', name: 'Polyglot', description: '100+ commands from multiple agents', category: 'agents', icon: '\ud83c\udf0d', stat: 'agentsWith100', tiers: [1, 2, 3, 4, 5] },
    // Behavioral
    { id: 'night_owl', name: 'Night Owl', description: 'Commands after midnight', category: 'behavioral', icon: '\ud83e\udd89', stat: 'lateNightCount', tiers: [10, 100, 500, 2000, 10000] },
    { id: 'speed_demon', name: 'Speed Demon', description: 'Commands in a single hour', category: 'behavioral', icon: '\u26a1', stat: 'peakHourCount', tiers: [60, 100, 150, 200, 300] },
    { id: 'one_liner', name: 'One-Liner', description: 'Longest command (chars)', category: 'behavioral', icon: '\ud83d\udcdd', stat: 'longestCommandLength', tiers: [500, 1000, 2000, 5000, 10000] },
    { id: 'creature_of_habit', name: 'Creature of Habit', description: 'Same command repeated', category: 'behavioral', icon: '\ud83d\udd01', stat: 'mostUsedCommandCount', tiers: [50, 200, 500, 1000, 5000] },
    { id: 'explorer', name: 'Explorer', description: 'Unique commands used', category: 'behavioral', icon: '\ud83e\udded', stat: 'uniqueCommands', tiers: [25, 50, 100, 250, 500] },
    // Repo
    { id: 'home_base', name: 'Home Base', description: 'Protect a repo', category: 'repo', icon: '\ud83c\udfe0', stat: 'uniqueRepos', tiers: [1, 1, 1, 1, 1] },
    { id: 'empire', name: 'Empire', description: 'Protect multiple repos', category: 'repo', icon: '\ud83c\udff0', stat: 'uniqueRepos', tiers: [3, 5, 10, 25, 50] },
    // Prompt
    { id: 'conversationalist', name: 'Conversationalist', description: 'Submit prompts', category: 'prompt', icon: '\ud83d\udcac', stat: 'totalPrompts', tiers: [1, 50, 500, 5000, 50000] },
    { id: 'wordsmith', name: 'Wordsmith', description: 'Total words prompted', category: 'prompt', icon: '\u270d', stat: 'totalPromptWords', tiers: [100, 1000, 10000, 100000, 1000000] },
    { id: 'novelist', name: 'Novelist', description: 'Longest single prompt', category: 'prompt', icon: '\ud83d\udcd6', stat: 'longestPromptLength', tiers: [500, 1000, 2000, 5000, 10000] },
    { id: 'chatty', name: 'Chatty', description: 'Prompts per session avg', category: 'prompt', icon: '\ud83d\udde3', stat: 'promptsPerSession', tiers: [5, 10, 25, 50, 100] },
  ]

  getAchievementStats(): AchievementStats {
    // Core totals
    const totalCommands = (this.db.prepare('SELECT COUNT(*) as c FROM commands').get() as any).c
    const totalBlocked = (this.db.prepare('SELECT COUNT(*) as c FROM commands WHERE allowed = 0').get() as any).c
    const totalSessions = (this.db.prepare('SELECT COUNT(*) as c FROM sessions').get() as any).c
    const totalCharacters = (this.db.prepare('SELECT COALESCE(SUM(LENGTH(command)), 0) as c FROM commands').get() as any).c

    // Watch time in minutes (sum of session durations)
    const watchTimeRow = this.db.prepare(`
      SELECT COALESCE(SUM(
        (julianday(COALESCE(end_time, datetime('now'))) - julianday(start_time)) * 1440
      ), 0) as minutes FROM sessions
    `).get() as any
    const totalWatchTimeMinutes = Math.round(watchTimeRow.minutes)

    // Unique repos
    const uniqueRepos = (this.db.prepare(`
      SELECT COUNT(DISTINCT repo_name) as c FROM sessions WHERE repo_name IS NOT NULL AND repo_name != ''
    `).get() as any).c

    // First command timestamp
    const firstCommandRow = this.db.prepare('SELECT MIN(timestamp) as t FROM commands').get() as any
    const memberSince = firstCommandRow.t || null

    // Agent breakdown
    const agentRows = this.db.prepare(`
      SELECT s.agent, COUNT(*) as count
      FROM commands c
      JOIN sessions s ON c.session_id = s.id
      GROUP BY s.agent
      ORDER BY count DESC
    `).all() as Array<{ agent: string; count: number }>
    const agentBreakdown: Record<string, number> = {}
    for (const row of agentRows) {
      agentBreakdown[row.agent] = row.count
    }
    const uniqueAgents = Object.keys(agentBreakdown).length
    const maxAgentCommands = agentRows.length > 0 ? agentRows[0].count : 0
    const favoriteAgent = agentRows.length > 0 ? agentRows[0].agent : null
    const agentsWith100 = agentRows.filter(r => r.count >= 100).length

    // Behavioral stats
    const mostUsedRow = this.db.prepare(`
      SELECT command, COUNT(*) as count FROM commands
      GROUP BY command ORDER BY count DESC LIMIT 1
    `).get() as { command: string; count: number } | undefined
    const mostUsedCommand = mostUsedRow?.command || null
    const mostUsedCommandCount = mostUsedRow?.count || 0

    const uniqueCommands = (this.db.prepare('SELECT COUNT(DISTINCT command) as c FROM commands').get() as any).c

    const longestCommandLength = (this.db.prepare('SELECT COALESCE(MAX(LENGTH(command)), 0) as c FROM commands').get() as any).c

    // Peak hour
    const peakHourRow = this.db.prepare(`
      SELECT CAST(strftime('%H', timestamp) AS INTEGER) as hour, COUNT(*) as count
      FROM commands GROUP BY hour ORDER BY count DESC LIMIT 1
    `).get() as { hour: number; count: number } | undefined
    const peakHour = peakHourRow?.hour ?? null
    const peakHourCount = peakHourRow?.count ?? 0

    // Peak day of week (0=Sunday)
    const peakDayRow = this.db.prepare(`
      SELECT CAST(strftime('%w', timestamp) AS INTEGER) as day, COUNT(*) as count
      FROM commands GROUP BY day ORDER BY count DESC LIMIT 1
    `).get() as { day: number; count: number } | undefined
    const peakDay = peakDayRow?.day ?? null

    // Busiest single day
    const busiestDayRow = this.db.prepare(`
      SELECT DATE(timestamp) as day, COUNT(*) as count
      FROM commands GROUP BY day ORDER BY count DESC LIMIT 1
    `).get() as { day: string; count: number } | undefined
    const busiestDay = busiestDayRow?.day || null
    const busiestDayCount = busiestDayRow?.count || 0

    // Avg commands per session
    const avgCommandsPerSession = totalSessions > 0 ? Math.round(totalCommands / totalSessions) : 0

    // Longest session (minutes)
    const longestSessionRow = this.db.prepare(`
      SELECT MAX(
        (julianday(COALESCE(end_time, datetime('now'))) - julianday(start_time)) * 1440
      ) as minutes FROM sessions
    `).get() as any
    const longestSessionMinutes = Math.round(longestSessionRow.minutes || 0)

    // Late night commands (midnight to 5 AM)
    const lateNightCount = (this.db.prepare(`
      SELECT COUNT(*) as c FROM commands
      WHERE CAST(strftime('%H', timestamp) AS INTEGER) < 5
    `).get() as any).c

    // Lifetime average risk
    const avgRiskRow = this.db.prepare('SELECT AVG(risk_score) as avg FROM commands').get() as any
    const lifetimeAvgRisk = avgRiskRow.avg ?? 0

    // Cleanest streak (longest run of allowed commands)
    const allAllowed = this.db.prepare(
      'SELECT allowed FROM commands ORDER BY timestamp ASC'
    ).all() as Array<{ allowed: number }>
    let cleanestStreak = 0
    let currentStreak = 0
    for (const row of allAllowed) {
      if (row.allowed === 1) {
        currentStreak++
        if (currentStreak > cleanestStreak) cleanestStreak = currentStreak
      } else {
        currentStreak = 0
      }
    }

    // Highest risk command
    const highestRiskRow = this.db.prepare(
      'SELECT command, risk_score FROM commands ORDER BY risk_score DESC LIMIT 1'
    ).get() as { command: string; risk_score: number } | undefined
    const highestRiskCommand = highestRiskRow?.command || null
    const highestRiskScore = highestRiskRow?.risk_score || 0

    // High risk count (risk_score >= 8)
    const highRiskCount = (this.db.prepare(
      'SELECT COUNT(*) as c FROM commands WHERE risk_score >= 8'
    ).get() as any).c

    // Prompt stats (backward compat: try/catch for DBs without user_prompts table)
    let totalPrompts = 0
    let totalPromptWords = 0
    let totalPromptChars = 0
    let longestPromptLength = 0
    let promptsPerSession = 0
    try {
      totalPrompts = (this.db.prepare('SELECT COUNT(*) as c FROM user_prompts').get() as any).c
      const promptSums = this.db.prepare(`
        SELECT
          COALESCE(SUM(word_count), 0) as words,
          COALESCE(SUM(prompt_length), 0) as chars,
          COALESCE(MAX(prompt_length), 0) as longest
        FROM user_prompts
      `).get() as any
      totalPromptWords = promptSums.words
      totalPromptChars = promptSums.chars
      longestPromptLength = promptSums.longest
      const perSessionRow = this.db.prepare(`
        SELECT COALESCE(AVG(cnt), 0) as avg FROM (
          SELECT COUNT(*) as cnt FROM user_prompts WHERE session_id IS NOT NULL GROUP BY session_id
        )
      `).get() as any
      promptsPerSession = Math.round(perSessionRow.avg)
    } catch {
      // Table may not exist in older DBs
    }

    return {
      totalCommands, totalBlocked, totalSessions, totalCharacters,
      totalWatchTimeMinutes, uniqueRepos, memberSince,
      agentBreakdown, uniqueAgents, maxAgentCommands, favoriteAgent, agentsWith100,
      mostUsedCommand, mostUsedCommandCount, uniqueCommands, longestCommandLength,
      peakHour, peakHourCount, peakDay, busiestDay, busiestDayCount,
      avgCommandsPerSession, longestSessionMinutes, lateNightCount,
      lifetimeAvgRisk, cleanestStreak, currentCleanStreak: currentStreak,
      highestRiskCommand, highestRiskScore, highRiskCount,
      totalPrompts, totalPromptWords, totalPromptChars, longestPromptLength, promptsPerSession,
    }
  }

  computeAchievements(stats: AchievementStats): BadgeResult[] {
    return DashboardDB.BADGE_DEFINITIONS.map(badge => {
      const value = (stats as any)[badge.stat] as number ?? 0
      let currentTier = 0
      for (let i = 0; i < badge.tiers.length; i++) {
        if (value >= badge.tiers[i]) currentTier = i + 1
      }
      const nextThreshold = currentTier < badge.tiers.length ? badge.tiers[currentTier] : badge.tiers[badge.tiers.length - 1]
      const prevThreshold = currentTier > 0 ? badge.tiers[currentTier - 1] : 0
      const progress = currentTier >= badge.tiers.length
        ? 1
        : (value - prevThreshold) / Math.max(1, nextThreshold - prevThreshold)

      return {
        id: badge.id,
        name: badge.name,
        description: badge.description,
        category: badge.category,
        icon: badge.icon,
        tier: currentTier as BadgeTier,
        tierName: TIER_NAMES[currentTier as BadgeTier],
        value,
        nextThreshold,
        progress: Math.min(1, Math.max(0, progress)),
        maxed: currentTier >= 5,
      }
    })
  }

  computeXP(stats: AchievementStats, badges: BadgeResult[]): XPResult {
    const TIER_XP = [0, 50, 100, 200, 500, 1000]
    const RANK_THRESHOLDS: Array<{ rank: string; xp: number }> = [
      { rank: 'Obsidian', xp: 100000 },
      { rank: 'Diamond', xp: 25000 },
      { rank: 'Gold', xp: 5000 },
      { rank: 'Silver', xp: 1000 },
      { rank: 'Bronze', xp: 0 },
    ]

    let totalXP = 0

    // +1 per command
    totalXP += stats.totalCommands
    // +3 per block
    totalXP += stats.totalBlocked * 3
    // +10 per session
    totalXP += stats.totalSessions * 10
    // +2 per late night command
    totalXP += stats.lateNightCount * 2
    // +25 per 100-clean-streak segments
    totalXP += Math.floor(stats.cleanestStreak / 100) * 25
    // +1 per 2 prompts
    totalXP += Math.floor(stats.totalPrompts / 2)
    // +1 per 500 prompt words
    totalXP += Math.floor(stats.totalPromptWords / 500)

    // Badge tier XP
    for (const badge of badges) {
      if (badge.tier > 0) {
        totalXP += TIER_XP[badge.tier]
      }
    }

    // Determine rank
    let rank = 'Bronze'
    let nextRankXP = 1000
    for (const t of RANK_THRESHOLDS) {
      if (totalXP >= t.xp) {
        rank = t.rank
        // next rank is the one above, if any
        const idx = RANK_THRESHOLDS.indexOf(t)
        nextRankXP = idx > 0 ? RANK_THRESHOLDS[idx - 1].xp : totalXP
        break
      }
    }

    const currentRankXP = RANK_THRESHOLDS.find(t => t.rank === rank)!.xp
    const progress = rank === 'Obsidian'
      ? 1
      : (totalXP - currentRankXP) / Math.max(1, nextRankXP - currentRankXP)

    return {
      totalXP,
      rank,
      nextRankXP,
      progress: Math.min(1, Math.max(0, progress)),
    }
  }

  close(): void {
    this.db.close()
  }
}

// ─────────────────────────────────────────────────────────────
// Achievement Types
// ─────────────────────────────────────────────────────────────

export type BadgeTier = 0 | 1 | 2 | 3 | 4 | 5

const TIER_NAMES: Record<BadgeTier, string> = {
  0: 'Locked',
  1: 'Bronze',
  2: 'Silver',
  3: 'Gold',
  4: 'Diamond',
  5: 'Obsidian',
}

export interface BadgeDefinition {
  id: string
  name: string
  description: string
  category: string
  icon: string
  stat: string
  tiers: [number, number, number, number, number]
}

export interface BadgeResult {
  id: string
  name: string
  description: string
  category: string
  icon: string
  tier: BadgeTier
  tierName: string
  value: number
  nextThreshold: number
  progress: number
  maxed: boolean
}

export interface AchievementStats {
  totalCommands: number
  totalBlocked: number
  totalSessions: number
  totalCharacters: number
  totalWatchTimeMinutes: number
  uniqueRepos: number
  memberSince: string | null
  agentBreakdown: Record<string, number>
  uniqueAgents: number
  maxAgentCommands: number
  favoriteAgent: string | null
  agentsWith100: number
  mostUsedCommand: string | null
  mostUsedCommandCount: number
  uniqueCommands: number
  longestCommandLength: number
  peakHour: number | null
  peakHourCount: number
  peakDay: number | null
  busiestDay: string | null
  busiestDayCount: number
  avgCommandsPerSession: number
  longestSessionMinutes: number
  lateNightCount: number
  lifetimeAvgRisk: number
  cleanestStreak: number
  currentCleanStreak: number
  highestRiskCommand: string | null
  highestRiskScore: number
  highRiskCount: number
  // Prompt stats
  totalPrompts: number
  totalPromptWords: number
  totalPromptChars: number
  longestPromptLength: number
  promptsPerSession: number
}

export interface XPResult {
  totalXP: number
  rank: string
  nextRankXP: number
  progress: number
}

export default DashboardDB
