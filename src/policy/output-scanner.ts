/**
 * Output Scanner
 * Scan command output for leaked secrets and sensitive data
 */

import type { OutputScanningPolicy } from '../types.js'

export interface ScanResult {
  hasSecrets: boolean
  hasErrors: boolean
  redactedOutput: string
  findings: Finding[]
}

export interface Finding {
  type: 'secret' | 'error' | 'sensitive'
  pattern: string
  message: string
  line?: number
}

// Built-in secret patterns
const SECRET_PATTERNS: { pattern: RegExp; name: string }[] = [
  // API Keys
  { pattern: /sk-[A-Za-z0-9]{20,}/, name: 'OpenAI API Key' },
  { pattern: /sk-ant-[A-Za-z0-9\-]{20,}/, name: 'Anthropic API Key' },
  { pattern: /ghp_[A-Za-z0-9]{36}/, name: 'GitHub Token' },
  { pattern: /gho_[A-Za-z0-9]{36}/, name: 'GitHub OAuth Token' },
  { pattern: /github_pat_[A-Za-z0-9_]{22,}/, name: 'GitHub PAT' },
  { pattern: /glpat-[A-Za-z0-9\-]{20,}/, name: 'GitLab Token' },
  { pattern: /xox[baprs]-[A-Za-z0-9\-]{10,}/, name: 'Slack Token' },
  { pattern: /sk_live_[A-Za-z0-9]{24,}/, name: 'Stripe Secret Key' },
  { pattern: /sq0atp-[A-Za-z0-9\-_]{22,}/, name: 'Square Token' },
  { pattern: /AKIA[A-Z0-9]{16}/, name: 'AWS Access Key' },
  { pattern: /amzn\.mws\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/, name: 'Amazon MWS Key' },

  // OAuth/JWT
  { pattern: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/, name: 'Bearer Token' },
  { pattern: /eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/, name: 'JWT Token' },

  // Credentials in output
  { pattern: /password\s*[=:]\s*['"]?[^\s'"]{4,}['"]?/i, name: 'Password' },
  { pattern: /passwd\s*[=:]\s*['"]?[^\s'"]{4,}['"]?/i, name: 'Password' },
  { pattern: /api[_-]?key\s*[=:]\s*['"]?[^\s'"]{8,}['"]?/i, name: 'API Key' },
  { pattern: /secret\s*[=:]\s*['"]?[^\s'"]{8,}['"]?/i, name: 'Secret' },
  { pattern: /token\s*[=:]\s*['"]?[^\s'"]{8,}['"]?/i, name: 'Token' },

  // Private keys
  { pattern: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/, name: 'Private Key' },
  { pattern: /-----BEGIN\s+EC\s+PRIVATE\s+KEY-----/, name: 'EC Private Key' },
  { pattern: /-----BEGIN\s+OPENSSH\s+PRIVATE\s+KEY-----/, name: 'SSH Private Key' },
  { pattern: /-----BEGIN\s+PGP\s+PRIVATE\s+KEY\s+BLOCK-----/, name: 'PGP Private Key' },

  // Database URLs
  { pattern: /mongodb(\+srv)?:\/\/[^:]+:[^@]+@/, name: 'MongoDB Connection String' },
  { pattern: /postgres(ql)?:\/\/[^:]+:[^@]+@/, name: 'PostgreSQL Connection String' },
  { pattern: /mysql:\/\/[^:]+:[^@]+@/, name: 'MySQL Connection String' },
  { pattern: /redis:\/\/[^:]+:[^@]+@/, name: 'Redis Connection String' },

  // SSH
  { pattern: /ssh-rsa\s+[A-Za-z0-9+/]+[=]{0,2}/, name: 'SSH Public Key' },
  { pattern: /ssh-ed25519\s+[A-Za-z0-9+/]+/, name: 'SSH ED25519 Key' },
]

// Error patterns to detect
const ERROR_PATTERNS: { pattern: RegExp; name: string }[] = [
  { pattern: /EACCES|EPERM|permission denied/i, name: 'Permission Error' },
  { pattern: /ENOENT|no such file|not found/i, name: 'File Not Found' },
  { pattern: /ECONNREFUSED|connection refused/i, name: 'Connection Refused' },
  { pattern: /ETIMEDOUT|timed out/i, name: 'Timeout Error' },
  { pattern: /segmentation fault|core dumped/i, name: 'Crash' },
  { pattern: /out of memory|OOM|cannot allocate/i, name: 'Memory Error' },
  { pattern: /stack trace|traceback|at\s+\S+:\d+:\d+/i, name: 'Stack Trace' },
  { pattern: /error:|fatal:|failed:/i, name: 'Error Message' },
]

export class OutputScanner {
  private secretPatterns: RegExp[]
  private redactPatterns: RegExp[]
  private policy: OutputScanningPolicy

  constructor(policy: OutputScanningPolicy) {
    this.policy = policy

    // Compile secret patterns
    this.secretPatterns = SECRET_PATTERNS.map(p => p.pattern)

    // Compile custom redact patterns
    this.redactPatterns = (policy.redactPatterns || [])
      .map(p => {
        try {
          return new RegExp(p, 'gi')
        } catch {
          return null
        }
      })
      .filter((p): p is RegExp => p !== null)
  }

  /**
   * Scan output for secrets and sensitive data
   */
  scan(output: string): ScanResult {
    if (!this.policy.enabled) {
      return {
        hasSecrets: false,
        hasErrors: false,
        redactedOutput: output,
        findings: []
      }
    }

    const findings: Finding[] = []
    let hasSecrets = false
    let hasErrors = false

    // Truncate if needed
    let processedOutput = output
    if (output.length > this.policy.maxOutputLength) {
      processedOutput = output.slice(0, this.policy.maxOutputLength) + '\n... [truncated]'
    }

    // Scan for secrets
    if (this.policy.scanForSecrets) {
      const secretFindings = this.scanForSecrets(processedOutput)
      if (secretFindings.length > 0) {
        hasSecrets = true
        findings.push(...secretFindings)
      }
    }

    // Scan for errors
    if (this.policy.scanForErrors) {
      const errorFindings = this.scanForErrors(processedOutput)
      if (errorFindings.length > 0) {
        hasErrors = true
        findings.push(...errorFindings)
      }
    }

    // Redact sensitive data
    const redactedOutput = this.redact(processedOutput)

    return {
      hasSecrets,
      hasErrors,
      redactedOutput,
      findings
    }
  }

  /**
   * Scan for secrets in output
   */
  private scanForSecrets(output: string): Finding[] {
    const findings: Finding[] = []
    const lines = output.split('\n')

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      for (const { pattern, name } of SECRET_PATTERNS) {
        if (pattern.test(line)) {
          findings.push({
            type: 'secret',
            pattern: name,
            message: `Potential ${name} found in output`,
            line: i + 1
          })
        }
      }
    }

    return findings
  }

  /**
   * Scan for error patterns in output
   */
  private scanForErrors(output: string): Finding[] {
    const findings: Finding[] = []
    const lines = output.split('\n')

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      for (const { pattern, name } of ERROR_PATTERNS) {
        if (pattern.test(line)) {
          findings.push({
            type: 'error',
            pattern: name,
            message: `${name} detected`,
            line: i + 1
          })
          break // Only report first error type per line
        }
      }
    }

    return findings
  }

  /**
   * Redact sensitive data from output
   */
  redact(output: string): string {
    let redacted = output

    // Redact built-in secret patterns
    for (const { pattern, name } of SECRET_PATTERNS) {
      redacted = redacted.replace(new RegExp(pattern.source, 'g'), `[REDACTED ${name}]`)
    }

    // Redact custom patterns
    for (const pattern of this.redactPatterns) {
      redacted = redacted.replace(pattern, '[REDACTED]')
    }

    return redacted
  }

  /**
   * Check if output contains any secrets
   */
  hasSecrets(output: string): boolean {
    for (const pattern of this.secretPatterns) {
      if (pattern.test(output)) {
        return true
      }
    }
    return false
  }

  /**
   * Get summary of findings
   */
  static summarize(findings: Finding[]): string {
    if (findings.length === 0) {
      return 'No issues found'
    }

    const secrets = findings.filter(f => f.type === 'secret')
    const errors = findings.filter(f => f.type === 'error')

    const parts: string[] = []
    if (secrets.length > 0) {
      parts.push(`${secrets.length} potential secret(s)`)
    }
    if (errors.length > 0) {
      parts.push(`${errors.length} error(s)`)
    }

    return parts.join(', ')
  }
}
