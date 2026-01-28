/**
 * Dashboard Writer Module
 * Bridge for watch mode to write monitoring data to the dashboard database
 */

import { homedir } from 'os'
import { join } from 'path'
import { mkdirSync, existsSync } from 'fs'
import { DashboardDB, type InsertCommandInput, type InsertBroEventInput, type InsertBroStatusInput, type InsertToolUseInput } from './db.js'
import type { RiskScore } from '../policy/risk-scorer.js'
import type { PolicyViolation } from '../types.js'

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface BroEventInput {
  eventType: string
  inputContext: string
  outputSummary: string
  modelUsed: string
  latencyMs: number
  success: boolean
}

export interface BroStatusInput {
  ollamaAvailable: boolean
  ollamaModel: string
  platform: string
  shell: string
  projectType?: string
}

export interface ToolUseInput {
  toolName: string
  toolInput: string
  toolOutput: string
  exitCode?: number | null
  success?: boolean | null
  cwd: string
  repoName?: string | null
  repoPath?: string | null
}

// ─────────────────────────────────────────────────────────────
// Default Database Path
// ─────────────────────────────────────────────────────────────

function getDefaultDbPath(): string {
  const bashbrosDir = join(homedir(), '.bashbros')

  // Ensure directory exists
  if (!existsSync(bashbrosDir)) {
    mkdirSync(bashbrosDir, { recursive: true })
  }

  return join(bashbrosDir, 'dashboard.db')
}

// ─────────────────────────────────────────────────────────────
// Dashboard Writer Class
// ─────────────────────────────────────────────────────────────

export class DashboardWriter {
  private db: DashboardDB
  private sessionId: string | null = null
  private commandCount: number = 0
  private blockedCount: number = 0
  private totalRiskScore: number = 0

  constructor(dbPath?: string) {
    const path = dbPath ?? getDefaultDbPath()
    this.db = new DashboardDB(path)
  }

  /**
   * Start a new watch session
   */
  startSession(agent: string, workingDir: string): string {
    this.sessionId = this.db.insertSession({
      agent,
      pid: process.pid,
      workingDir
    })

    this.commandCount = 0
    this.blockedCount = 0
    this.totalRiskScore = 0

    return this.sessionId
  }

  /**
   * End the current session
   */
  endSession(): void {
    if (!this.sessionId) return

    const avgRiskScore = this.commandCount > 0
      ? this.totalRiskScore / this.commandCount
      : 0

    this.db.updateSession(this.sessionId, {
      endTime: new Date(),
      status: 'completed',
      commandCount: this.commandCount,
      blockedCount: this.blockedCount,
      avgRiskScore
    })

    this.sessionId = null
  }

  /**
   * Mark session as crashed (for unexpected exits)
   */
  crashSession(): void {
    if (!this.sessionId) return

    const avgRiskScore = this.commandCount > 0
      ? this.totalRiskScore / this.commandCount
      : 0

    this.db.updateSession(this.sessionId, {
      endTime: new Date(),
      status: 'crashed',
      commandCount: this.commandCount,
      blockedCount: this.blockedCount,
      avgRiskScore
    })

    this.sessionId = null
  }

  /**
   * Record a command execution
   */
  recordCommand(
    command: string,
    allowed: boolean,
    riskScore: RiskScore,
    violations: PolicyViolation[],
    durationMs: number
  ): string | null {
    if (!this.sessionId) return null

    const input: InsertCommandInput = {
      sessionId: this.sessionId,
      command,
      allowed,
      riskScore: riskScore.score,
      riskLevel: riskScore.level,
      riskFactors: riskScore.factors,
      durationMs,
      violations: violations.map(v => v.message)
    }

    const id = this.db.insertCommand(input)

    // Update session stats
    this.commandCount++
    this.totalRiskScore += riskScore.score
    if (!allowed) {
      this.blockedCount++
    }

    // Update session in DB periodically (every 10 commands)
    if (this.commandCount % 10 === 0) {
      const avgRiskScore = this.totalRiskScore / this.commandCount
      this.db.updateSession(this.sessionId, {
        commandCount: this.commandCount,
        blockedCount: this.blockedCount,
        avgRiskScore
      })
    }

    return id
  }

  /**
   * Record a Bash Bro AI event
   */
  recordBroEvent(input: BroEventInput): string {
    const dbInput: InsertBroEventInput = {
      sessionId: this.sessionId ?? undefined,
      eventType: input.eventType,
      inputContext: input.inputContext,
      outputSummary: input.outputSummary,
      modelUsed: input.modelUsed,
      latencyMs: input.latencyMs,
      success: input.success
    }

    return this.db.insertBroEvent(dbInput)
  }

  /**
   * Update Bash Bro status
   */
  updateBroStatus(status: BroStatusInput): string {
    const dbInput: InsertBroStatusInput = {
      ollamaAvailable: status.ollamaAvailable,
      ollamaModel: status.ollamaModel,
      platform: status.platform,
      shell: status.shell,
      projectType: status.projectType
    }

    return this.db.updateBroStatus(dbInput)
  }

  /**
   * Record a generic tool use (for all Claude Code tools)
   */
  recordToolUse(input: ToolUseInput): string {
    const dbInput: InsertToolUseInput = {
      toolName: input.toolName,
      toolInput: input.toolInput,
      toolOutput: input.toolOutput,
      exitCode: input.exitCode,
      success: input.success,
      cwd: input.cwd,
      repoName: input.repoName,
      repoPath: input.repoPath
    }

    return this.db.insertToolUse(dbInput)
  }

  /**
   * Get current session ID
   */
  getSessionId(): string | null {
    return this.sessionId
  }

  /**
   * Get current session stats
   */
  getSessionStats(): {
    commandCount: number
    blockedCount: number
    avgRiskScore: number
  } {
    return {
      commandCount: this.commandCount,
      blockedCount: this.blockedCount,
      avgRiskScore: this.commandCount > 0 ? this.totalRiskScore / this.commandCount : 0
    }
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close()
  }

  /**
   * Get the underlying database instance (for advanced use)
   */
  getDB(): DashboardDB {
    return this.db
  }
}

export default DashboardWriter
