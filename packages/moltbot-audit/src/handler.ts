/**
 * BashBros Audit Hook for Moltbot
 *
 * Listens to tool_result_persist events and:
 * - Records commands to BashBros audit log
 * - Scans output for secrets
 * - Calculates risk scores
 * - Collects session metrics
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

/**
 * Moltbot tool_result_persist event structure
 */
interface ToolResultPersistEvent {
  type: 'tool_result_persist'
  timestamp: Date
  toolName: string
  toolInput: unknown
  toolResult: unknown
  sessionKey: string
  context: {
    agentId?: string
    senderId?: string
    [key: string]: unknown
  }
}

/**
 * Audit log entry
 */
interface AuditEntry {
  timestamp: string
  command: string
  toolName: string
  riskScore: number
  allowed: boolean
  agent: string
  sessionKey: string
  secretsFound: boolean
  redacted: boolean
  outputLength?: number
}

// Common secret patterns
const SECRET_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/g,           // OpenAI API key
  /ghp_[a-zA-Z0-9]{36}/g,           // GitHub PAT
  /gho_[a-zA-Z0-9]{36}/g,           // GitHub OAuth
  /glpat-[a-zA-Z0-9\-]{20,}/g,      // GitLab PAT
  /xox[baprs]-[a-zA-Z0-9\-]+/g,     // Slack tokens
  /AKIA[A-Z0-9]{16}/g,              // AWS access key
  /-----BEGIN.*PRIVATE KEY-----/g,  // Private keys
  /Bearer\s+[a-zA-Z0-9\-._~+\/]+=*/gi, // Bearer tokens
  /api[_-]?key['":\s]*[=:]\s*['"]?[a-zA-Z0-9]{20,}/gi, // Generic API keys
  /password['":\s]*[=:]\s*['"]?[^\s'"]+/gi, // Passwords
]

// Risk patterns for commands
const RISK_PATTERNS: Array<{ pattern: RegExp; score: number; factor: string }> = [
  { pattern: /rm\s+(-rf?|--recursive).*[\/~]/, score: 9, factor: 'Recursive delete' },
  { pattern: /curl.*\|\s*(ba)?sh/, score: 10, factor: 'Remote code execution' },
  { pattern: /wget.*\|\s*(ba)?sh/, score: 10, factor: 'Remote code execution' },
  { pattern: /chmod\s+777/, score: 7, factor: 'World writable permissions' },
  { pattern: /sudo\s+/, score: 6, factor: 'Elevated privileges' },
  { pattern: />\s*\/dev\/sd[a-z]/, score: 10, factor: 'Direct disk write' },
  { pattern: /mkfs/, score: 10, factor: 'Filesystem format' },
  { pattern: /dd\s+.*of=\/dev/, score: 10, factor: 'Direct disk write' },
  { pattern: /:(){ :\|:& };:/, score: 10, factor: 'Fork bomb' },
  { pattern: /\/etc\/passwd/, score: 5, factor: 'System file access' },
  { pattern: /\/etc\/shadow/, score: 8, factor: 'Password file access' },
  { pattern: /\.ssh\//, score: 6, factor: 'SSH directory access' },
  { pattern: /\.env/, score: 5, factor: 'Environment file access' },
  { pattern: /base64\s+-d/, score: 4, factor: 'Encoded content' },
  { pattern: /eval\s+/, score: 6, factor: 'Dynamic evaluation' },
]

const BASHBROS_DIR = path.join(os.homedir(), '.bashbros')
const AUDIT_LOG = path.join(BASHBROS_DIR, 'audit.log')

/**
 * Calculate risk score for a command
 */
function calculateRiskScore(command: string): { score: number; factors: string[] } {
  let score = 1
  const factors: string[] = []

  for (const { pattern, score: patternScore, factor } of RISK_PATTERNS) {
    if (pattern.test(command)) {
      score = Math.max(score, patternScore)
      factors.push(factor)
    }
  }

  return { score, factors }
}

/**
 * Check if output contains secrets
 */
function containsSecrets(output: string): boolean {
  for (const pattern of SECRET_PATTERNS) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0
    if (pattern.test(output)) {
      return true
    }
  }
  return false
}

/**
 * Redact secrets from output
 */
function redactSecrets(output: string): string {
  let redacted = output

  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0
    redacted = redacted.replace(pattern, '[REDACTED]')
  }

  return redacted
}

/**
 * Extract command from tool input
 */
function extractCommand(toolName: string, toolInput: unknown): string | null {
  if (toolName !== 'Bash' && toolName !== 'bash' && toolName !== 'exec') {
    return null
  }

  if (typeof toolInput === 'string') {
    return toolInput
  }

  if (typeof toolInput === 'object' && toolInput !== null) {
    const input = toolInput as Record<string, unknown>
    if (typeof input.command === 'string') {
      return input.command
    }
    if (typeof input.cmd === 'string') {
      return input.cmd
    }
  }

  return null
}

/**
 * Write audit entry to log
 */
async function writeAuditEntry(entry: AuditEntry): Promise<void> {
  try {
    // Ensure directory exists
    await fs.mkdir(BASHBROS_DIR, { recursive: true })

    // Append to audit log
    const line = JSON.stringify(entry) + '\n'
    await fs.appendFile(AUDIT_LOG, line, 'utf-8')
  } catch (err) {
    console.error('[bashbros-audit] Failed to write audit entry:', err instanceof Error ? err.message : String(err))
  }
}

/**
 * Process tool result event (async, fire-and-forget)
 */
async function processToolResult(event: ToolResultPersistEvent): Promise<void> {
  // Extract command from tool input
  const command = extractCommand(event.toolName, event.toolInput)
  if (!command) {
    // Not a bash/exec command, skip
    return
  }

  try {
    // Calculate risk score
    const { score: riskScore } = calculateRiskScore(command)

    // Check output for secrets
    const outputStr = typeof event.toolResult === 'string'
      ? event.toolResult
      : JSON.stringify(event.toolResult)

    const secretsFound = containsSecrets(outputStr)

    // Create audit entry
    const entry: AuditEntry = {
      timestamp: event.timestamp.toISOString(),
      command,
      toolName: event.toolName,
      riskScore,
      allowed: true, // Already executed at this point
      agent: 'moltbot',
      sessionKey: event.sessionKey,
      secretsFound,
      redacted: secretsFound,
      outputLength: outputStr.length
    }

    // Write to audit log
    await writeAuditEntry(entry)

    // Log warning for high-risk commands
    if (riskScore >= 7) {
      console.warn(`[bashbros-audit] High-risk command executed (score: ${riskScore}): ${command.substring(0, 50)}...`)
    }

    // Log warning for secrets in output
    if (secretsFound) {
      console.warn(`[bashbros-audit] Secrets detected in command output: ${command.substring(0, 50)}...`)
    }
  } catch (err) {
    console.error('[bashbros-audit] Error processing event:', err instanceof Error ? err.message : String(err))
  }
}

/**
 * Main hook handler for tool_result_persist events
 * Must be synchronous per moltbot hook requirements
 * Spawns async audit work without blocking
 */
const bashbrosAudit = (event: ToolResultPersistEvent): void => {
  // Only process tool_result_persist events
  if (event.type !== 'tool_result_persist') {
    return
  }

  // Fire-and-forget async processing
  processToolResult(event).catch(err => {
    console.error('[bashbros-audit] Unhandled error:', err instanceof Error ? err.message : String(err))
  })

  // Return undefined to keep original payload
  return undefined
}

export default bashbrosAudit
