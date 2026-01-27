/**
 * Anomaly Detection
 * Flag unusual patterns without ML
 */

export interface AnomalyConfig {
  workingHours?: [number, number]     // [startHour, endHour] in 24h format
  typicalCommandsPerMinute?: number   // Normal rate
  knownPaths?: string[]               // Expected paths for this project
  suspiciousPatterns?: RegExp[]       // Additional patterns to flag
  enabled?: boolean
}

export interface Anomaly {
  type: 'timing' | 'frequency' | 'path' | 'pattern' | 'behavior'
  severity: 'info' | 'warning' | 'alert'
  message: string
  details: Record<string, unknown>
}

interface CommandRecord {
  command: string
  timestamp: number
  path?: string
}

const DEFAULT_CONFIG: Required<AnomalyConfig> = {
  workingHours: [6, 22],  // 6 AM to 10 PM
  typicalCommandsPerMinute: 30,
  knownPaths: [],
  suspiciousPatterns: [],
  enabled: true
}

// Default suspicious patterns
const DEFAULT_SUSPICIOUS_PATTERNS: RegExp[] = [
  /\bpasswd\b/,
  /\bshadow\b/,
  /\/root\//,
  /\.ssh\//,
  /\.gnupg\//,
  /\.aws\//,
  /\.kube\//,
  /wallet/i,
  /crypto/i,
  /bitcoin/i,
  /ethereum/i,
  /private.*key/i,
]

export class AnomalyDetector {
  private config: Required<AnomalyConfig>
  private commands: CommandRecord[] = []
  private baselinePaths: Set<string> = new Set()
  private baselineCommands: Set<string> = new Set()
  private learningMode: boolean = true
  private learningCount: number = 0
  private readonly LEARNING_THRESHOLD = 50

  constructor(config: AnomalyConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Check a command for anomalies
   */
  check(command: string, cwd?: string): Anomaly[] {
    if (!this.config.enabled) return []

    const anomalies: Anomaly[] = []
    const now = Date.now()

    // Record for learning/baseline
    this.commands.push({ command, timestamp: now, path: cwd })
    if (this.commands.length > 1000) {
      this.commands = this.commands.slice(-500)
    }

    // Learning mode: build baseline
    if (this.learningMode) {
      this.learn(command, cwd)
      if (this.learningCount >= this.LEARNING_THRESHOLD) {
        this.learningMode = false
      }
      return anomalies // Don't flag during learning
    }

    // Check timing
    const timingAnomaly = this.checkTiming(now)
    if (timingAnomaly) anomalies.push(timingAnomaly)

    // Check frequency
    const freqAnomaly = this.checkFrequency(now)
    if (freqAnomaly) anomalies.push(freqAnomaly)

    // Check paths
    if (cwd) {
      const pathAnomaly = this.checkPath(cwd)
      if (pathAnomaly) anomalies.push(pathAnomaly)
    }

    // Check patterns
    const patternAnomalies = this.checkPatterns(command)
    anomalies.push(...patternAnomalies)

    // Check behavior
    const behaviorAnomaly = this.checkBehavior(command)
    if (behaviorAnomaly) anomalies.push(behaviorAnomaly)

    return anomalies
  }

  /**
   * Learn from command (build baseline)
   */
  private learn(command: string, cwd?: string): void {
    this.learningCount++

    // Learn command patterns
    const baseCmd = command.split(/\s+/)[0]
    this.baselineCommands.add(baseCmd)

    // Learn paths
    if (cwd) {
      this.baselinePaths.add(cwd)
      // Also add parent directories
      const parts = cwd.split(/[/\\]/)
      for (let i = 1; i <= parts.length; i++) {
        this.baselinePaths.add(parts.slice(0, i).join('/'))
      }
    }
  }

  /**
   * Check for timing anomalies
   */
  private checkTiming(now: number): Anomaly | null {
    const hour = new Date(now).getHours()
    const [start, end] = this.config.workingHours

    if (hour < start || hour >= end) {
      return {
        type: 'timing',
        severity: 'info',
        message: `Activity outside normal hours (${hour}:00)`,
        details: { hour, workingHours: this.config.workingHours }
      }
    }

    return null
  }

  /**
   * Check for frequency anomalies
   */
  private checkFrequency(now: number): Anomaly | null {
    const oneMinuteAgo = now - 60000
    const recentCommands = this.commands.filter(c => c.timestamp > oneMinuteAgo)
    const rate = recentCommands.length

    if (rate > this.config.typicalCommandsPerMinute * 2) {
      return {
        type: 'frequency',
        severity: 'warning',
        message: `High command rate: ${rate}/min (typical: ${this.config.typicalCommandsPerMinute})`,
        details: { rate, typical: this.config.typicalCommandsPerMinute }
      }
    }

    // Check for burst (many commands in very short time)
    const fiveSecondsAgo = now - 5000
    const burstCommands = this.commands.filter(c => c.timestamp > fiveSecondsAgo)
    if (burstCommands.length > 10) {
      return {
        type: 'frequency',
        severity: 'alert',
        message: `Burst detected: ${burstCommands.length} commands in 5 seconds`,
        details: { count: burstCommands.length, window: '5s' }
      }
    }

    return null
  }

  /**
   * Check for unusual path access
   */
  private checkPath(path: string): Anomaly | null {
    // Skip if we have known paths configured
    if (this.config.knownPaths.length > 0) {
      const isKnown = this.config.knownPaths.some(p =>
        path.startsWith(p) || path.includes(p)
      )
      if (!isKnown) {
        return {
          type: 'path',
          severity: 'warning',
          message: `Access to unexpected path: ${path}`,
          details: { path, knownPaths: this.config.knownPaths }
        }
      }
    }

    // Check against learned baseline
    if (!this.learningMode && this.baselinePaths.size > 0) {
      const isBaseline = this.baselinePaths.has(path) ||
        [...this.baselinePaths].some(p => path.startsWith(p))

      if (!isBaseline) {
        return {
          type: 'path',
          severity: 'info',
          message: `New path accessed: ${path}`,
          details: { path, isNew: true }
        }
      }
    }

    return null
  }

  /**
   * Check for suspicious patterns
   */
  private checkPatterns(command: string): Anomaly[] {
    const anomalies: Anomaly[] = []
    const allPatterns = [...DEFAULT_SUSPICIOUS_PATTERNS, ...this.config.suspiciousPatterns]

    for (const pattern of allPatterns) {
      if (pattern.test(command)) {
        anomalies.push({
          type: 'pattern',
          severity: 'warning',
          message: `Suspicious pattern detected: ${pattern.source}`,
          details: { command: command.slice(0, 100), pattern: pattern.source }
        })
      }
    }

    return anomalies
  }

  /**
   * Check for behavioral anomalies
   */
  private checkBehavior(command: string): Anomaly | null {
    const baseCmd = command.split(/\s+/)[0]

    // Check for new command type after learning
    if (!this.learningMode && this.baselineCommands.size > 0) {
      if (!this.baselineCommands.has(baseCmd)) {
        // Only flag if it's potentially sensitive
        const sensitiveCommands = new Set([
          'curl', 'wget', 'nc', 'netcat', 'ssh', 'scp', 'rsync',
          'sudo', 'su', 'chmod', 'chown', 'mount', 'umount'
        ])

        if (sensitiveCommands.has(baseCmd)) {
          return {
            type: 'behavior',
            severity: 'warning',
            message: `New sensitive command type: ${baseCmd}`,
            details: { command: baseCmd, isNew: true }
          }
        }
      }
    }

    return null
  }

  /**
   * Get anomaly stats
   */
  getStats(): {
    learningMode: boolean
    learningProgress: number
    baselineCommands: number
    baselinePaths: number
    recentCommandRate: number
  } {
    const now = Date.now()
    const oneMinuteAgo = now - 60000
    const recentRate = this.commands.filter(c => c.timestamp > oneMinuteAgo).length

    return {
      learningMode: this.learningMode,
      learningProgress: Math.min(100, Math.round((this.learningCount / this.LEARNING_THRESHOLD) * 100)),
      baselineCommands: this.baselineCommands.size,
      baselinePaths: this.baselinePaths.size,
      recentCommandRate: recentRate
    }
  }

  /**
   * Force end learning mode
   */
  endLearning(): void {
    this.learningMode = false
  }

  /**
   * Reset and restart learning
   */
  reset(): void {
    this.commands = []
    this.baselinePaths.clear()
    this.baselineCommands.clear()
    this.learningMode = true
    this.learningCount = 0
  }
}
