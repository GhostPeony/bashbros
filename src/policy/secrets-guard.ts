import type { SecretsPolicy, PolicyViolation } from '../types.js'

export class SecretsGuard {
  private patterns: RegExp[]

  constructor(private policy: SecretsPolicy) {
    this.patterns = policy.patterns.map(p => this.globToRegex(p))
  }

  check(command: string, paths: string[]): PolicyViolation | null {
    if (!this.policy.enabled) {
      return null
    }

    // Check command for secret file access
    for (const path of paths) {
      if (this.isSecretPath(path)) {
        return {
          type: 'secrets',
          rule: `pattern match: ${path}`,
          message: `Attempted access to sensitive file: ${path}`
        }
      }
    }

    // Check for common secret-leaking patterns in commands
    const dangerousPatterns = [
      /cat\s+.*\.env/i,
      /cat\s+.*\.pem/i,
      /cat\s+.*\.key/i,
      /cat\s+.*credentials/i,
      /echo\s+\$\w*(KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)/i,
      /printenv.*(KEY|SECRET|TOKEN|PASSWORD)/i,
      /curl.*-d.*\$\w*(KEY|SECRET|TOKEN)/i,
      /base64.*\.env/i
    ]

    for (const pattern of dangerousPatterns) {
      if (pattern.test(command)) {
        return {
          type: 'secrets',
          rule: 'dangerous pattern',
          message: 'Command may expose secrets'
        }
      }
    }

    return null
  }

  private isSecretPath(path: string): boolean {
    const lowerPath = path.toLowerCase()

    return this.patterns.some(pattern => pattern.test(lowerPath))
  }

  private globToRegex(glob: string): RegExp {
    const escaped = glob
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')

    return new RegExp(escaped, 'i')
  }
}
