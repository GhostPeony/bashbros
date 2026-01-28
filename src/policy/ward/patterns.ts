/**
 * Egress Patterns - Pattern matching for sensitive data detection
 *
 * Provides pattern definitions and matching utilities for detecting
 * credentials, PII, and other sensitive data in egress traffic.
 */

import type {
  EgressPattern,
  PatternSeverity,
  RedactedPayload,
  RedactionInfo,
} from './types.js'

/**
 * Default patterns for detecting sensitive data
 */
export const DEFAULT_PATTERNS: EgressPattern[] = [
  // Credential patterns
  {
    name: 'api_key',
    regex: '(?:api[_-]?key|apikey)[\\s]*[=:][\\s]*["\']?([a-zA-Z0-9_\\-]{20,})["\']?',
    severity: 'high',
    action: 'block',
    category: 'credentials',
    description: 'Generic API key pattern',
  },
  {
    name: 'aws_secret',
    regex: '(?:AWS_SECRET_ACCESS_KEY|aws_secret_access_key)[\\s]*[=:][\\s]*["\']?([a-zA-Z0-9/+=]{40})["\']?',
    severity: 'critical',
    action: 'block',
    category: 'credentials',
    description: 'AWS Secret Access Key',
  },
  {
    name: 'private_key',
    regex: '-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----',
    severity: 'critical',
    action: 'block',
    category: 'credentials',
    description: 'Private key header',
  },
  {
    name: 'github_token',
    regex: '(?:gh[pousr]_[a-zA-Z0-9]{36,}|github_pat_[a-zA-Z0-9]{22}_[a-zA-Z0-9]{59})',
    severity: 'critical',
    action: 'block',
    category: 'credentials',
    description: 'GitHub personal access token',
  },
  {
    name: 'openai_key',
    regex: 'sk-[a-zA-Z0-9]{20,}T3BlbkFJ[a-zA-Z0-9]{20,}',
    severity: 'critical',
    action: 'block',
    category: 'credentials',
    description: 'OpenAI API key',
  },
  {
    name: 'jwt_token',
    regex: 'eyJ[a-zA-Z0-9_-]*\\.eyJ[a-zA-Z0-9_-]*\\.[a-zA-Z0-9_-]*',
    severity: 'high',
    action: 'alert',
    category: 'credentials',
    description: 'JSON Web Token',
  },

  // PII patterns
  {
    name: 'ssn',
    regex: '\\b\\d{3}[- ]?\\d{2}[- ]?\\d{4}\\b',
    severity: 'critical',
    action: 'block',
    category: 'pii',
    description: 'US Social Security Number',
  },
  {
    name: 'credit_card',
    regex: '\\b(?:4[0-9]{3}|5[1-5][0-9]{2}|6(?:011|5[0-9]{2})|3[47][0-9]{2})[- ]?[0-9]{4}[- ]?[0-9]{4}[- ]?[0-9]{4}\\b',
    severity: 'critical',
    action: 'block',
    category: 'pii',
    description: 'Credit card number (Visa, MasterCard, Amex, Discover)',
  },
  {
    name: 'email',
    regex: '\\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}\\b',
    severity: 'low',
    action: 'log',
    category: 'pii',
    description: 'Email address',
  },
  {
    name: 'phone_us',
    regex: '\\b(?:\\+1[- ]?)?(?:\\([0-9]{3}\\)|[0-9]{3})[- ]?[0-9]{3}[- ]?[0-9]{4}\\b',
    severity: 'medium',
    action: 'alert',
    category: 'pii',
    description: 'US phone number',
  },
]

/**
 * Pattern match result
 */
export interface PatternMatch {
  pattern: EgressPattern
  matchedText: string
  index: number
}

/**
 * Severity ordering for comparison
 */
const SEVERITY_ORDER: Record<PatternSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
}

/**
 * EgressPatternMatcher - Matches and redacts sensitive data in text
 */
export class EgressPatternMatcher {
  private patterns: EgressPattern[]
  private compiledPatterns: Map<string, RegExp>

  constructor(customPatterns?: EgressPattern[]) {
    this.patterns = [...DEFAULT_PATTERNS]
    this.compiledPatterns = new Map()

    if (customPatterns) {
      for (const pattern of customPatterns) {
        this.patterns.push(pattern)
      }
    }

    // Pre-compile all patterns
    this.compilePatterns()
  }

  /**
   * Compile regex patterns for efficient matching
   */
  private compilePatterns(): void {
    for (const pattern of this.patterns) {
      if (!this.compiledPatterns.has(pattern.name)) {
        try {
          this.compiledPatterns.set(pattern.name, new RegExp(pattern.regex, 'gi'))
        } catch {
          // Invalid regex - skip pattern
          console.warn(`Invalid regex for pattern ${pattern.name}: ${pattern.regex}`)
        }
      }
    }
  }

  /**
   * Find all pattern matches in text
   */
  match(text: string): PatternMatch[] {
    const matches: PatternMatch[] = []

    for (const pattern of this.patterns) {
      const regex = this.compiledPatterns.get(pattern.name)
      if (!regex) continue

      // Reset regex state
      regex.lastIndex = 0

      let match: RegExpExecArray | null
      while ((match = regex.exec(text)) !== null) {
        matches.push({
          pattern,
          matchedText: match[0],
          index: match.index,
        })
      }
    }

    return matches
  }

  /**
   * Check if any blocking patterns match the text
   */
  shouldBlock(text: string): boolean {
    const matches = this.match(text)
    return matches.some(m => m.pattern.action === 'block')
  }

  /**
   * Get the highest severity level from all matches
   */
  getHighestSeverity(text: string): PatternSeverity | null {
    const matches = this.match(text)
    if (matches.length === 0) return null

    let highest: PatternSeverity = 'low'
    for (const m of matches) {
      if (SEVERITY_ORDER[m.pattern.severity] > SEVERITY_ORDER[highest]) {
        highest = m.pattern.severity
      }
    }

    return highest
  }

  /**
   * Redact sensitive data from text
   */
  redact(text: string): RedactedPayload {
    const matches = this.match(text)
    const redactions: RedactionInfo[] = []
    let redacted = text

    // Sort matches by index in reverse order to preserve positions during replacement
    const sortedMatches = [...matches].sort((a, b) => b.index - a.index)

    for (const m of sortedMatches) {
      const replacement = `[REDACTED:${m.pattern.name}]`

      // Map pattern category to RedactionInfo type
      let redactionType: RedactionInfo['type']
      if (m.pattern.name === 'api_key' || m.pattern.name === 'aws_secret' ||
          m.pattern.name === 'private_key' || m.pattern.name === 'github_token' ||
          m.pattern.name === 'openai_key' || m.pattern.name === 'jwt_token') {
        redactionType = 'api_key'
      } else if (m.pattern.name === 'email') {
        redactionType = 'email'
      } else if (m.pattern.name === 'phone_us') {
        redactionType = 'phone'
      } else if (m.pattern.name === 'ssn') {
        redactionType = 'ssn'
      } else if (m.pattern.name === 'credit_card') {
        redactionType = 'credit_card'
      } else {
        redactionType = 'custom'
      }

      redactions.push({
        type: redactionType,
        replacement,
      })

      // Replace the matched text
      redacted =
        redacted.substring(0, m.index) +
        replacement +
        redacted.substring(m.index + m.matchedText.length)
    }

    return {
      original: text,
      redacted,
      redactions: redactions.reverse(), // Return in original order
    }
  }

  /**
   * Add a custom pattern
   */
  addPattern(pattern: EgressPattern): void {
    this.patterns.push(pattern)
    try {
      this.compiledPatterns.set(pattern.name, new RegExp(pattern.regex, 'gi'))
    } catch {
      console.warn(`Invalid regex for pattern ${pattern.name}: ${pattern.regex}`)
    }
  }

  /**
   * Get all configured patterns
   */
  getPatterns(): EgressPattern[] {
    return [...this.patterns]
  }

  /**
   * Test helper - returns matches, shouldBlock, and redacted result
   */
  test(text: string): {
    matches: PatternMatch[]
    shouldBlock: boolean
    redacted: RedactedPayload
  } {
    return {
      matches: this.match(text),
      shouldBlock: this.shouldBlock(text),
      redacted: this.redact(text),
    }
  }
}
