import type { CommandPolicy, PolicyViolation } from '../types.js'

export class CommandFilter {
  private allowPatterns: RegExp[]
  private blockPatterns: RegExp[]

  constructor(private policy: CommandPolicy) {
    this.allowPatterns = policy.allow.map(p => this.globToRegex(p))
    this.blockPatterns = policy.block.map(p => this.globToRegex(p))
  }

  check(command: string): PolicyViolation | null {
    // Check block list first (higher priority)
    for (let i = 0; i < this.blockPatterns.length; i++) {
      if (this.blockPatterns[i].test(command)) {
        return {
          type: 'command',
          rule: `block[${i}]: ${this.policy.block[i]}`,
          message: `Blocked: '${command.slice(0, 60)}' matches dangerous pattern: ${this.policy.block[i]}`,
          remediation: [
            `If safe, run: bashbros allow "${this.extractBase(command)} *" --once`
          ],
          severity: 'high'
        }
      }
    }

    // If allow list is empty or contains '*', allow by default
    if (this.policy.allow.length === 0 || this.policy.allow.includes('*')) {
      return null
    }

    // Check if command matches any allow pattern
    const allowed = this.allowPatterns.some(pattern => pattern.test(command))

    if (!allowed) {
      return {
        type: 'command',
        rule: 'allow (no match)',
        message: `Blocked: '${command.slice(0, 60)}' not in allowlist`,
        remediation: [
          `To allow for this session: bashbros allow "${this.extractBase(command)} *" --once`,
          `To allow permanently: add "${this.extractBase(command)} *" to .bashbros.yml commands.allow`
        ],
        severity: 'medium'
      }
    }

    return null
  }

  private extractBase(command: string): string {
    return command.split(/\s+/)[0] || command
  }

  private globToRegex(glob: string): RegExp {
    // Escape special regex chars except *
    const escaped = glob
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')

    return new RegExp(`^${escaped}$`, 'i')
  }
}
