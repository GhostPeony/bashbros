/**
 * DB-backed cross-process security checks
 * Each function takes a DashboardDB + config section and returns a violation or warning.
 */

import type { DashboardDB } from '../dashboard/db.js'
import type {
  LoopDetectionPolicy,
  AnomalyDetectionPolicy,
  RateLimitPolicy,
  PolicyViolation
} from '../types.js'

export interface CheckResult {
  violation: PolicyViolation | null
  warning: string | null
}

// ─────────────────────────────────────────────────────────────
// Helpers (mirrored from LoopDetector for DB-backed checks)
// ─────────────────────────────────────────────────────────────

function normalize(command: string): string {
  return command
    .toLowerCase()
    .replace(/["']/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\d+/g, 'N')
    .replace(/[a-f0-9]{8,}/gi, 'H')
    .trim()
}

function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.split(/\s+/))
  const wordsB = new Set(b.split(/\s+/))
  const intersection = new Set([...wordsA].filter(x => wordsB.has(x)))
  const union = new Set([...wordsA, ...wordsB])
  if (union.size === 0) return 1
  return intersection.size / union.size
}

// ─────────────────────────────────────────────────────────────
// Loop Detection (DB-backed)
// ─────────────────────────────────────────────────────────────

export function checkLoopDetection(
  command: string,
  config: LoopDetectionPolicy,
  db: DashboardDB
): CheckResult {
  if (!config.enabled) return { violation: null, warning: null }

  // Check max turns
  const totalCount = db.getTotalCommandCount()
  if (totalCount >= config.maxTurns) {
    const msg = `Maximum turns reached (${config.maxTurns}). Session may be stuck.`
    if (config.action === 'block') {
      return { violation: { type: 'loop', rule: 'max_turns', message: msg }, warning: null }
    }
    return { violation: null, warning: msg }
  }

  // Check recent commands for repeats
  const recent = db.getRecentCommandTexts(config.windowSize)

  // Exact repeats
  const exactCount = recent.filter(r => r.command === command).length
  if (exactCount >= config.maxRepeats) {
    const msg = `Command repeated ${exactCount + 1} times: "${command.slice(0, 50)}"`
    if (config.action === 'block') {
      return { violation: { type: 'loop', rule: 'exact_repeat', message: msg }, warning: null }
    }
    return { violation: null, warning: msg }
  }

  // Semantic repeats
  const normalizedCmd = normalize(command)
  const similarCount = recent.filter(
    r => jaccardSimilarity(normalize(r.command), normalizedCmd) >= config.similarityThreshold
  ).length
  if (similarCount >= config.maxRepeats) {
    const msg = `Similar commands repeated ${similarCount + 1} times`
    if (config.action === 'block') {
      return { violation: { type: 'loop', rule: 'semantic_repeat', message: msg }, warning: null }
    }
    return { violation: null, warning: msg }
  }

  return { violation: null, warning: null }
}

// ─────────────────────────────────────────────────────────────
// Anomaly Detection (DB-backed)
// ─────────────────────────────────────────────────────────────

// Default suspicious patterns (same as anomaly-detector.ts)
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

export function checkAnomalyDetection(
  command: string,
  config: AnomalyDetectionPolicy,
  db: DashboardDB
): CheckResult {
  if (!config.enabled) return { violation: null, warning: null }

  // Still learning — skip checks
  const totalCount = db.getTotalCommandCount()
  if (totalCount < config.learningCommands) {
    return { violation: null, warning: null }
  }

  const findings: string[] = []

  // Check working hours
  const hour = new Date().getHours()
  const [start, end] = config.workingHours
  if (hour < start || hour >= end) {
    findings.push(`Activity outside working hours (${hour}:00, allowed ${start}-${end})`)
  }

  // Check frequency (commands in last minute)
  const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString()
  const recentCount = db.getCommandCountSince(oneMinuteAgo)
  if (recentCount > config.typicalCommandsPerMinute * 2) {
    findings.push(`High command rate: ${recentCount}/min (typical: ${config.typicalCommandsPerMinute})`)
  }

  // Check suspicious patterns (config + built-in)
  const configPatterns = (config.suspiciousPatterns || []).map(p => {
    try { return new RegExp(p, 'i') } catch { return null }
  }).filter((p): p is RegExp => p !== null)

  const allPatterns = [...DEFAULT_SUSPICIOUS_PATTERNS, ...configPatterns]
  for (const pattern of allPatterns) {
    if (pattern.test(command)) {
      findings.push(`Suspicious pattern: ${pattern.source}`)
      break // one is enough
    }
  }

  if (findings.length === 0) return { violation: null, warning: null }

  const msg = `Anomaly: ${findings.join('; ')}`
  if (config.action === 'block') {
    return { violation: { type: 'anomaly', rule: 'anomaly_detection', message: msg }, warning: null }
  }
  return { violation: null, warning: msg }
}

// ─────────────────────────────────────────────────────────────
// Rate Limiting (DB-backed)
// ─────────────────────────────────────────────────────────────

export function checkRateLimit(
  config: RateLimitPolicy,
  db: DashboardDB
): CheckResult {
  if (!config.enabled) return { violation: null, warning: null }

  // Per-minute check
  const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString()
  const perMinute = db.getCommandCountSince(oneMinuteAgo)
  if (perMinute >= config.maxPerMinute) {
    return {
      violation: {
        type: 'rate_limit',
        rule: 'rate_per_minute',
        message: `Rate limit exceeded: ${perMinute}/${config.maxPerMinute} per minute`
      },
      warning: null
    }
  }

  // Per-hour check
  const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString()
  const perHour = db.getCommandCountSince(oneHourAgo)
  if (perHour >= config.maxPerHour) {
    return {
      violation: {
        type: 'rate_limit',
        rule: 'rate_per_hour',
        message: `Rate limit exceeded: ${perHour}/${config.maxPerHour} per hour`
      },
      warning: null
    }
  }

  return { violation: null, warning: null }
}
