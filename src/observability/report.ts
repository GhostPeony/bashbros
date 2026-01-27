/**
 * Session Reports
 * Generate human-readable reports of agent activity
 */

import type { SessionMetrics } from './metrics.js'
import type { CostEstimate } from './cost.js'

export interface ReportOptions {
  showCommands?: boolean
  showBlocked?: boolean
  showRisk?: boolean
  showPaths?: boolean
  showCost?: boolean
  format?: 'text' | 'json' | 'markdown'
}

const DEFAULT_OPTIONS: ReportOptions = {
  showCommands: true,
  showBlocked: true,
  showRisk: true,
  showPaths: true,
  showCost: true,
  format: 'text'
}

export class ReportGenerator {
  /**
   * Generate a session report
   */
  static generate(
    metrics: SessionMetrics,
    cost?: CostEstimate,
    options: ReportOptions = {}
  ): string {
    const opts = { ...DEFAULT_OPTIONS, ...options }

    switch (opts.format) {
      case 'json':
        return this.generateJSON(metrics, cost)
      case 'markdown':
        return this.generateMarkdown(metrics, cost, opts)
      default:
        return this.generateText(metrics, cost, opts)
    }
  }

  /**
   * Generate text report
   */
  private static generateText(
    metrics: SessionMetrics,
    cost?: CostEstimate,
    opts: ReportOptions = {}
  ): string {
    const lines: string[] = []
    const duration = this.formatDuration(metrics.duration)

    lines.push(`Session Report (${duration})`)
    lines.push('─'.repeat(45))
    lines.push('')

    // Summary line
    const blockedPct = metrics.commandCount > 0
      ? Math.round((metrics.blockedCount / metrics.commandCount) * 100)
      : 0
    lines.push(`Commands: ${metrics.commandCount} total, ${metrics.blockedCount} blocked (${blockedPct}%)`)
    lines.push('')

    // Risk distribution
    if (opts.showRisk) {
      const total = metrics.commandCount || 1
      const { safe, caution, dangerous, critical } = metrics.riskDistribution

      const safePct = Math.round((safe / total) * 100)
      const cautionPct = Math.round((caution / total) * 100)
      const dangerousPct = Math.round((dangerous / total) * 100)
      const criticalPct = Math.round((critical / total) * 100)

      lines.push('Risk Distribution:')
      lines.push(`  ${this.progressBar(safePct, 20)} ${safePct}% safe`)
      lines.push(`  ${this.progressBar(cautionPct, 20)} ${cautionPct}% caution`)
      lines.push(`  ${this.progressBar(dangerousPct, 20)} ${dangerousPct}% dangerous`)
      if (critical > 0) {
        lines.push(`  ${this.progressBar(criticalPct, 20)} ${criticalPct}% CRITICAL`)
      }
      lines.push(`  Average risk score: ${metrics.avgRiskScore.toFixed(1)}/10`)
      lines.push('')
    }

    // Top commands
    if (opts.showCommands && metrics.topCommands.length > 0) {
      lines.push('Top Commands:')
      for (const [cmd, count] of metrics.topCommands.slice(0, 5)) {
        const pct = Math.round((count / metrics.commandCount) * 100)
        lines.push(`  ${cmd.padEnd(15)} ${count.toString().padStart(3)} (${pct}%)`)
      }
      lines.push('')
    }

    // Blocked commands
    if (opts.showBlocked && metrics.blockedCount > 0) {
      lines.push('Violations by Type:')
      for (const [type, count] of Object.entries(metrics.violationsByType)) {
        lines.push(`  ${type}: ${count}`)
      }
      lines.push('')
    }

    // Paths
    if (opts.showPaths) {
      if (metrics.filesModified.length > 0) {
        lines.push(`Files Modified: ${metrics.filesModified.length}`)
        for (const file of metrics.filesModified.slice(0, 5)) {
          lines.push(`  • ${file}`)
        }
        if (metrics.filesModified.length > 5) {
          lines.push(`  ... and ${metrics.filesModified.length - 5} more`)
        }
        lines.push('')
      }

      lines.push(`Paths Accessed: ${metrics.pathsAccessed.length} unique`)
      lines.push('')
    }

    // Cost estimate
    if (opts.showCost && cost) {
      lines.push('Cost Estimate:')
      lines.push(`  Tokens: ~${cost.estimatedTokens.toLocaleString()} (${cost.confidence} confidence)`)
      lines.push(`  Cost: ~${this.formatCost(cost.estimatedCost)} (${cost.model})`)
      lines.push('')
    }

    // Performance
    lines.push('Performance:')
    lines.push(`  Avg execution time: ${metrics.avgExecutionTime.toFixed(0)}ms`)
    lines.push(`  Total execution time: ${this.formatDuration(metrics.totalExecutionTime)}`)
    lines.push('')

    lines.push(`Session ID: ${metrics.sessionId}`)

    return lines.join('\n')
  }

  /**
   * Generate markdown report
   */
  private static generateMarkdown(
    metrics: SessionMetrics,
    cost?: CostEstimate,
    opts: ReportOptions = {}
  ): string {
    const lines: string[] = []
    const duration = this.formatDuration(metrics.duration)

    lines.push(`# Session Report`)
    lines.push('')
    lines.push(`**Duration:** ${duration}`)
    lines.push(`**Session ID:** \`${metrics.sessionId}\``)
    lines.push('')

    // Summary table
    lines.push('## Summary')
    lines.push('')
    lines.push('| Metric | Value |')
    lines.push('|--------|-------|')
    lines.push(`| Commands | ${metrics.commandCount} |`)
    lines.push(`| Blocked | ${metrics.blockedCount} |`)
    lines.push(`| Unique Commands | ${metrics.uniqueCommands} |`)
    lines.push(`| Avg Risk Score | ${metrics.avgRiskScore.toFixed(1)}/10 |`)
    lines.push('')

    // Risk distribution
    if (opts.showRisk) {
      lines.push('## Risk Distribution')
      lines.push('')
      lines.push('| Level | Count | Percentage |')
      lines.push('|-------|-------|------------|')
      const total = metrics.commandCount || 1
      for (const [level, count] of Object.entries(metrics.riskDistribution)) {
        const pct = Math.round((count / total) * 100)
        lines.push(`| ${level} | ${count} | ${pct}% |`)
      }
      lines.push('')
    }

    // Top commands
    if (opts.showCommands && metrics.topCommands.length > 0) {
      lines.push('## Top Commands')
      lines.push('')
      lines.push('| Command | Count |')
      lines.push('|---------|-------|')
      for (const [cmd, count] of metrics.topCommands.slice(0, 10)) {
        lines.push(`| \`${cmd}\` | ${count} |`)
      }
      lines.push('')
    }

    // Cost
    if (opts.showCost && cost) {
      lines.push('## Cost Estimate')
      lines.push('')
      lines.push(`- **Tokens:** ~${cost.estimatedTokens.toLocaleString()}`)
      lines.push(`- **Cost:** ~${this.formatCost(cost.estimatedCost)}`)
      lines.push(`- **Model:** ${cost.model}`)
      lines.push(`- **Confidence:** ${cost.confidence}`)
      lines.push('')
    }

    return lines.join('\n')
  }

  /**
   * Generate JSON report
   */
  private static generateJSON(
    metrics: SessionMetrics,
    cost?: CostEstimate
  ): string {
    return JSON.stringify({ metrics, cost }, null, 2)
  }

  /**
   * Generate a simple progress bar
   */
  private static progressBar(percent: number, width: number): string {
    const filled = Math.round((percent / 100) * width)
    const empty = width - filled
    return '█'.repeat(filled) + '░'.repeat(empty)
  }

  /**
   * Format duration
   */
  private static formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    if (ms < 3600000) {
      const mins = Math.floor(ms / 60000)
      const secs = Math.floor((ms % 60000) / 1000)
      return `${mins}m ${secs}s`
    }
    const hours = Math.floor(ms / 3600000)
    const mins = Math.floor((ms % 3600000) / 60000)
    return `${hours}h ${mins}m`
  }

  /**
   * Format cost
   */
  private static formatCost(cost: number): string {
    if (cost < 0.01) return `$${(cost * 100).toFixed(2)}¢`
    if (cost < 1) return `$${cost.toFixed(3)}`
    return `$${cost.toFixed(2)}`
  }

  /**
   * Generate a one-line summary
   */
  static oneLine(metrics: SessionMetrics): string {
    const duration = this.formatDuration(metrics.duration)
    const blockedPct = metrics.commandCount > 0
      ? Math.round((metrics.blockedCount / metrics.commandCount) * 100)
      : 0

    return `${metrics.commandCount} cmds (${blockedPct}% blocked) | ` +
           `risk: ${metrics.avgRiskScore.toFixed(1)}/10 | ${duration}`
  }
}
