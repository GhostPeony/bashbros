/**
 * Loop Detection
 * Detects when agents get stuck in repetitive patterns
 */

export interface LoopConfig {
  maxRepeats: number          // Same command N times triggers alert
  maxTurns: number            // Total commands before hard stop
  similarityThreshold: number // 0-1, how similar commands must be
  cooldownMs: number          // Min time between identical commands
  windowSize: number          // Commands to look back
}

export interface LoopAlert {
  type: 'exact_repeat' | 'semantic_repeat' | 'tool_hammering' | 'max_turns'
  command: string
  count: number
  message: string
}

interface CommandEntry {
  command: string
  timestamp: number
  normalized: string
}

const DEFAULT_CONFIG: LoopConfig = {
  maxRepeats: 3,
  maxTurns: 100,
  similarityThreshold: 0.85,
  cooldownMs: 1000,
  windowSize: 20
}

export class LoopDetector {
  private config: LoopConfig
  private history: CommandEntry[] = []
  private turnCount: number = 0

  constructor(config: Partial<LoopConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Record a command and check for loops
   */
  check(command: string): LoopAlert | null {
    const now = Date.now()
    const normalized = this.normalize(command)

    this.turnCount++

    // Check max turns first
    if (this.turnCount >= this.config.maxTurns) {
      return {
        type: 'max_turns',
        command,
        count: this.turnCount,
        message: `Maximum turns reached (${this.config.maxTurns}). Session may be stuck.`
      }
    }

    // Check for exact repeats
    const exactMatches = this.history.filter(h => h.command === command)
    if (exactMatches.length >= this.config.maxRepeats) {
      return {
        type: 'exact_repeat',
        command,
        count: exactMatches.length + 1,
        message: `Command repeated ${exactMatches.length + 1} times: "${command.slice(0, 50)}..."`
      }
    }

    // Check cooldown (same command too fast)
    const lastSame = exactMatches[exactMatches.length - 1]
    if (lastSame && (now - lastSame.timestamp) < this.config.cooldownMs) {
      return {
        type: 'exact_repeat',
        command,
        count: 2,
        message: `Rapid repeat detected (${now - lastSame.timestamp}ms apart)`
      }
    }

    // Check for semantic repeats (similar commands)
    const recentWindow = this.history.slice(-this.config.windowSize)
    const similarCount = recentWindow.filter(h =>
      this.similarity(h.normalized, normalized) >= this.config.similarityThreshold
    ).length

    if (similarCount >= this.config.maxRepeats) {
      return {
        type: 'semantic_repeat',
        command,
        count: similarCount + 1,
        message: `Similar commands repeated ${similarCount + 1} times`
      }
    }

    // Check for tool hammering (same base command)
    const baseCommand = command.split(/\s+/)[0]
    const toolCount = recentWindow.filter(h =>
      h.command.split(/\s+/)[0] === baseCommand
    ).length

    if (toolCount >= this.config.maxRepeats * 2) {
      return {
        type: 'tool_hammering',
        command,
        count: toolCount + 1,
        message: `Tool "${baseCommand}" called ${toolCount + 1} times in last ${this.config.windowSize} commands`
      }
    }

    // Record this command
    this.history.push({ command, timestamp: now, normalized })

    // Trim history
    if (this.history.length > this.config.windowSize * 2) {
      this.history = this.history.slice(-this.config.windowSize)
    }

    return null
  }

  /**
   * Normalize command for comparison
   */
  private normalize(command: string): string {
    return command
      .toLowerCase()
      .replace(/["']/g, '')           // Remove quotes
      .replace(/\s+/g, ' ')           // Normalize whitespace
      .replace(/\d+/g, 'N')           // Replace numbers
      .replace(/[a-f0-9]{8,}/gi, 'H') // Replace hashes
      .trim()
  }

  /**
   * Calculate similarity between two strings (Jaccard index on words)
   */
  private similarity(a: string, b: string): number {
    const wordsA = new Set(a.split(/\s+/))
    const wordsB = new Set(b.split(/\s+/))

    const intersection = new Set([...wordsA].filter(x => wordsB.has(x)))
    const union = new Set([...wordsA, ...wordsB])

    if (union.size === 0) return 1
    return intersection.size / union.size
  }

  /**
   * Get current turn count
   */
  getTurnCount(): number {
    return this.turnCount
  }

  /**
   * Get command frequency map
   */
  getFrequencyMap(): Map<string, number> {
    const freq = new Map<string, number>()
    for (const entry of this.history) {
      const base = entry.command.split(/\s+/)[0]
      freq.set(base, (freq.get(base) || 0) + 1)
    }
    return freq
  }

  /**
   * Reset detector state
   */
  reset(): void {
    this.history = []
    this.turnCount = 0
  }

  /**
   * Get stats for reporting
   */
  getStats(): {
    turnCount: number
    uniqueCommands: number
    topCommands: [string, number][]
  } {
    const freq = this.getFrequencyMap()
    const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1])

    return {
      turnCount: this.turnCount,
      uniqueCommands: freq.size,
      topCommands: sorted.slice(0, 5)
    }
  }
}
