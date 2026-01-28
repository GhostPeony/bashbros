/**
 * Egress Monitor - Monitors and blocks sensitive data in outbound traffic
 *
 * Provides inspection of content for sensitive patterns (API keys, PII, etc.)
 * with support for connector-based allowlisting and pattern-specific exceptions.
 */

import { EgressPatternMatcher, type PatternMatch } from './patterns.js'
import type {
  EgressPattern,
  EgressConfig,
  EgressAllowlistEntry,
  EgressMatch,
} from './types.js'

// Optional database import - gracefully handle if unavailable
let DashboardDB: typeof import('../../dashboard/db.js').DashboardDB | null = null
try {
  const dbModule = await import('../../dashboard/db.js')
  DashboardDB = dbModule.DashboardDB
} catch {
  // Database unavailable - operate without persistence
}

/**
 * Result of content inspection
 */
export interface InspectionResult {
  /** Whether the content was blocked */
  blocked: boolean
  /** Whether the content was allowlisted (skipped inspection) */
  allowlisted: boolean
  /** Patterns that matched */
  matches: PatternMatch[]
  /** Content with sensitive data redacted */
  redacted: string
  /** Block ID if content was recorded to database */
  blockId?: string
}

/**
 * Default egress configuration
 */
const DEFAULT_EGRESS_CONFIG: EgressConfig = {
  enabled: true,
  defaultAction: 'block',
  allowlist: [],
}

/**
 * EgressMonitor - Monitors outbound content for sensitive data
 */
export class EgressMonitor {
  private config: EgressConfig
  private matcher: EgressPatternMatcher
  private db: InstanceType<typeof import('../../dashboard/db.js').DashboardDB> | null = null
  private allowlist: EgressAllowlistEntry[]

  constructor(config?: Partial<EgressConfig>) {
    this.config = { ...DEFAULT_EGRESS_CONFIG, ...config }
    this.matcher = new EgressPatternMatcher()
    this.allowlist = [...this.config.allowlist]

    // Try to initialize database
    if (DashboardDB) {
      try {
        this.db = new DashboardDB()
      } catch {
        // Database initialization failed - operate without persistence
      }
    }
  }

  /**
   * Inspect content for sensitive data
   *
   * @param content - The content to inspect
   * @param connector - Optional connector name for allowlist checking
   * @param destination - Optional destination for allowlist checking
   * @returns Inspection result with blocking decision and matches
   */
  inspect(content: string, connector?: string, destination?: string): InspectionResult {
    // Check if fully allowlisted (skip all inspection)
    if (this.isAllowlisted(connector, destination)) {
      return {
        blocked: false,
        allowlisted: true,
        matches: [],
        redacted: content,
      }
    }

    // Get all matches
    const allMatches = this.matcher.match(content)

    // Filter out pattern-specific allowlisted matches
    const effectiveMatches = allMatches.filter(match => {
      return !this.isPatternAllowlisted(match.pattern.name, connector, destination)
    })

    // Check if any remaining matches should block
    const shouldBlock = effectiveMatches.some(m => m.pattern.action === 'block')

    // Redact content based on effective matches
    let redacted = content
    if (effectiveMatches.length > 0) {
      // Sort by index descending to preserve positions during replacement
      const sortedMatches = [...effectiveMatches].sort((a, b) => b.index - a.index)
      for (const m of sortedMatches) {
        const replacement = `[REDACTED:${m.pattern.name}]`
        redacted =
          redacted.substring(0, m.index) +
          replacement +
          redacted.substring(m.index + m.matchedText.length)
      }
    }

    // Check if all matched patterns were allowlisted
    const wasAllowlisted = allMatches.length > 0 && effectiveMatches.length === 0

    const result: InspectionResult = {
      blocked: shouldBlock,
      allowlisted: wasAllowlisted,
      matches: effectiveMatches,
      redacted,
    }

    // Record to database if blocking
    if (shouldBlock && this.db) {
      try {
        // Record each blocking match
        for (const match of effectiveMatches.filter(m => m.pattern.action === 'block')) {
          const blockId = this.db.insertEgressBlock({
            pattern: match.pattern,
            matchedText: match.matchedText.substring(0, 100), // Truncate for safety
            redactedText: redacted,
            connector,
            destination,
          })
          result.blockId = blockId
        }

        // Log the event
        this.db.insertEvent({
          source: 'ward',
          level: 'warn',
          category: 'egress',
          message: `Blocked egress: ${effectiveMatches.map(m => m.pattern.name).join(', ')}`,
          data: {
            connector,
            destination,
            patternNames: effectiveMatches.map(m => m.pattern.name),
          },
        })
      } catch {
        // Database operation failed - continue without persistence
      }
    }

    return result
  }

  /**
   * Check if connector/destination combination is fully allowlisted
   */
  private isAllowlisted(connector?: string, destination?: string): boolean {
    return this.allowlist.some(entry => {
      // Skip pattern-specific entries (they don't allowlist all inspection)
      if (entry.pattern) return false

      // Check connector match
      if (entry.connector && entry.destination) {
        // Both specified - must match both
        return entry.connector === connector && entry.destination === destination
      }

      if (entry.connector) {
        return entry.connector === connector
      }

      if (entry.destination) {
        return entry.destination === destination
      }

      return false
    })
  }

  /**
   * Check if a specific pattern is allowlisted for the connector/destination
   */
  private isPatternAllowlisted(
    patternName: string,
    connector?: string,
    destination?: string
  ): boolean {
    return this.allowlist.some(entry => {
      // Only check pattern-specific entries
      if (!entry.pattern || entry.pattern !== patternName) return false

      // Check connector/destination match
      if (entry.connector && entry.destination) {
        return entry.connector === connector && entry.destination === destination
      }

      if (entry.connector) {
        return entry.connector === connector
      }

      if (entry.destination) {
        return entry.destination === destination
      }

      // Pattern allowlist with no connector/destination matches all
      return true
    })
  }

  /**
   * Add an allowlist entry
   */
  addAllowlistEntry(entry: EgressAllowlistEntry): void {
    this.allowlist.push(entry)
  }

  /**
   * Add a custom pattern
   */
  addPattern(pattern: EgressPattern): void {
    this.matcher.addPattern(pattern)
  }

  /**
   * Get pending blocks from database
   */
  getPendingBlocks(): EgressMatch[] {
    if (!this.db) return []
    try {
      return this.db.getPendingBlocks()
    } catch {
      return []
    }
  }

  /**
   * Approve a pending block
   */
  approveBlock(id: string, approvedBy?: string): void {
    if (!this.db) return
    try {
      this.db.approveBlock(id, approvedBy ?? 'system')
    } catch {
      // Database operation failed
    }
  }

  /**
   * Deny a pending block
   */
  denyBlock(id: string): void {
    if (!this.db) return
    try {
      this.db.denyBlock(id, 'system')
    } catch {
      // Database operation failed
    }
  }

  /**
   * Test content without recording to database
   * Useful for CLI testing of patterns
   */
  test(content: string): {
    blocked: boolean
    matches: PatternMatch[]
    redacted: string
  } {
    const matches = this.matcher.match(content)
    const shouldBlock = matches.some(m => m.pattern.action === 'block')

    // Redact content
    let redacted = content
    if (matches.length > 0) {
      const sortedMatches = [...matches].sort((a, b) => b.index - a.index)
      for (const m of sortedMatches) {
        const replacement = `[REDACTED:${m.pattern.name}]`
        redacted =
          redacted.substring(0, m.index) +
          replacement +
          redacted.substring(m.index + m.matchedText.length)
      }
    }

    return {
      blocked: shouldBlock,
      matches,
      redacted,
    }
  }
}
