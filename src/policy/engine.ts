import type { BashBrosConfig, PolicyViolation } from '../types.js'
import { CommandFilter } from './command-filter.js'
import { PathSandbox } from './path-sandbox.js'
import { SecretsGuard } from './secrets-guard.js'
import { RateLimiter } from './rate-limiter.js'
import { isAllowedForSession } from '../session.js'

export class PolicyEngine {
  private commandFilter: CommandFilter
  private pathSandbox: PathSandbox
  private secretsGuard: SecretsGuard
  private rateLimiter: RateLimiter

  constructor(private config: BashBrosConfig) {
    this.commandFilter = new CommandFilter(config.commands)
    this.pathSandbox = new PathSandbox(config.paths)
    this.secretsGuard = new SecretsGuard(config.secrets)
    this.rateLimiter = new RateLimiter(config.rateLimit)
  }

  validate(command: string): PolicyViolation[] {
    const violations: PolicyViolation[] = []

    // Check rate limit first
    const rateViolation = this.rateLimiter.check()
    if (rateViolation) {
      violations.push(rateViolation)
      return violations // Early exit on rate limit
    }

    // Check session allowlist first (temporary permissions)
    if (isAllowedForSession(command)) {
      this.rateLimiter.record()
      return [] // Allowed for this session
    }

    // Check command against allow/block lists
    const commandViolation = this.commandFilter.check(command)
    if (commandViolation) {
      violations.push(commandViolation)
    }

    // Extract paths from command and check sandbox
    const paths = this.extractPaths(command)
    for (const path of paths) {
      const pathViolation = this.pathSandbox.check(path)
      if (pathViolation) {
        violations.push(pathViolation)
      }
    }

    // Check for secrets access
    if (this.config.secrets.enabled) {
      const secretsViolation = this.secretsGuard.check(command, paths)
      if (secretsViolation) {
        violations.push(secretsViolation)
      }
    }

    // Record for rate limiting
    this.rateLimiter.record()

    return violations
  }

  private extractPaths(command: string): string[] {
    const paths: string[] = []

    // Simple path extraction - look for file-like arguments
    const tokens = command.split(/\s+/)

    for (const token of tokens) {
      // Skip flags
      if (token.startsWith('-')) continue

      // Check if it looks like a path
      if (
        token.startsWith('/') ||
        token.startsWith('./') ||
        token.startsWith('../') ||
        token.startsWith('~/') ||
        token.includes('.env') ||
        token.includes('.pem') ||
        token.includes('.key')
      ) {
        paths.push(token)
      }
    }

    return paths
  }

  isAllowed(command: string): boolean {
    return this.validate(command).length === 0
  }
}
