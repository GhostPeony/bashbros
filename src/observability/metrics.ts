/**
 * Session Metrics
 * Track what the agent is doing for observability
 */

import type { PolicyViolation } from '../types.js'
import type { RiskScore } from '../policy/risk-scorer.js'

export interface CommandMetric {
  command: string
  timestamp: Date
  duration: number
  allowed: boolean
  riskScore: RiskScore
  violations: PolicyViolation[]
  exitCode?: number
}

export interface SessionMetrics {
  sessionId: string
  startTime: Date
  endTime?: Date
  duration: number

  // Command stats
  commandCount: number
  blockedCount: number
  uniqueCommands: number
  topCommands: [string, number][]

  // Risk distribution
  riskDistribution: {
    safe: number
    caution: number
    dangerous: number
    critical: number
  }
  avgRiskScore: number

  // Performance
  avgExecutionTime: number
  totalExecutionTime: number

  // File/path tracking
  filesModified: string[]
  pathsAccessed: string[]

  // Violations
  violationsByType: Record<string, number>
}

export class MetricsCollector {
  private sessionId: string
  private startTime: Date
  private commands: CommandMetric[] = []
  private filesModified: Set<string> = new Set()
  private pathsAccessed: Set<string> = new Set()

  constructor() {
    this.sessionId = this.generateSessionId()
    this.startTime = new Date()
  }

  private generateSessionId(): string {
    const now = new Date()
    const date = now.toISOString().slice(0, 10).replace(/-/g, '')
    const time = now.toTimeString().slice(0, 8).replace(/:/g, '')
    const rand = Math.random().toString(36).slice(2, 6)
    return `${date}-${time}-${rand}`
  }

  /**
   * Record a command execution
   */
  record(metric: CommandMetric): void {
    this.commands.push(metric)

    // Track paths
    const paths = this.extractPaths(metric.command)
    for (const path of paths) {
      this.pathsAccessed.add(path)
    }

    // Track file modifications
    if (this.isWriteCommand(metric.command)) {
      for (const path of paths) {
        this.filesModified.add(path)
      }
    }
  }

  /**
   * Get current session metrics
   */
  getMetrics(): SessionMetrics {
    const now = new Date()
    const duration = now.getTime() - this.startTime.getTime()

    // Count risk distribution
    const riskDist = { safe: 0, caution: 0, dangerous: 0, critical: 0 }
    let totalRisk = 0

    for (const cmd of this.commands) {
      riskDist[cmd.riskScore.level]++
      totalRisk += cmd.riskScore.score
    }

    // Count command frequency
    const cmdFreq = new Map<string, number>()
    for (const cmd of this.commands) {
      const base = cmd.command.split(/\s+/)[0]
      cmdFreq.set(base, (cmdFreq.get(base) || 0) + 1)
    }
    const topCommands = [...cmdFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)

    // Count violations by type
    const violationsByType: Record<string, number> = {}
    for (const cmd of this.commands) {
      for (const v of cmd.violations) {
        violationsByType[v.type] = (violationsByType[v.type] || 0) + 1
      }
    }

    // Calculate execution times
    const totalExecTime = this.commands.reduce((sum, c) => sum + c.duration, 0)
    const avgExecTime = this.commands.length > 0 ? totalExecTime / this.commands.length : 0

    return {
      sessionId: this.sessionId,
      startTime: this.startTime,
      duration,

      commandCount: this.commands.length,
      blockedCount: this.commands.filter(c => !c.allowed).length,
      uniqueCommands: cmdFreq.size,
      topCommands,

      riskDistribution: riskDist,
      avgRiskScore: this.commands.length > 0 ? totalRisk / this.commands.length : 0,

      avgExecutionTime: avgExecTime,
      totalExecutionTime: totalExecTime,

      filesModified: [...this.filesModified],
      pathsAccessed: [...this.pathsAccessed],

      violationsByType
    }
  }

  /**
   * Extract paths from a command
   */
  private extractPaths(command: string): string[] {
    const paths: string[] = []
    const tokens = command.split(/\s+/)

    for (const token of tokens) {
      if (token.startsWith('-')) continue

      if (
        token.startsWith('/') ||
        token.startsWith('./') ||
        token.startsWith('../') ||
        token.startsWith('~/') ||
        token.includes('.')
      ) {
        paths.push(token)
      }
    }

    return paths
  }

  /**
   * Check if command modifies files
   */
  private isWriteCommand(command: string): boolean {
    const writePatterns = [
      /^(vim|vi|nano|emacs|code)\s/,
      /^(touch|mkdir|cp|mv|rm)\s/,
      /^(echo|cat|printf).*>/,
      /^(git\s+(add|commit|checkout|reset))/,
      /^(npm|yarn|pnpm)\s+(install|uninstall)/,
      /^(pip|pip3)\s+(install|uninstall)/,
      /^chmod\s/,
      /^chown\s/,
    ]

    return writePatterns.some(p => p.test(command))
  }

  /**
   * Get recent commands
   */
  getRecentCommands(n: number = 10): CommandMetric[] {
    return this.commands.slice(-n)
  }

  /**
   * Get blocked commands
   */
  getBlockedCommands(): CommandMetric[] {
    return this.commands.filter(c => !c.allowed)
  }

  /**
   * Get high-risk commands
   */
  getHighRiskCommands(threshold: number = 6): CommandMetric[] {
    return this.commands.filter(c => c.riskScore.score >= threshold)
  }

  /**
   * Format duration for display
   */
  static formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
    return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`
  }

  /**
   * Reset collector
   */
  reset(): void {
    this.sessionId = this.generateSessionId()
    this.startTime = new Date()
    this.commands = []
    this.filesModified.clear()
    this.pathsAccessed.clear()
  }
}
