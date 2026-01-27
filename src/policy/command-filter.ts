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
          message: `Command matches blocked pattern: ${this.policy.block[i]}`
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
        message: 'Command not in allowlist'
      }
    }

    return null
  }

  private globToRegex(glob: string): RegExp {
    // Escape special regex chars except *
    const escaped = glob
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')

    return new RegExp(`^${escaped}$`, 'i')
  }
}
