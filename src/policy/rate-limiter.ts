import type { RateLimitPolicy, PolicyViolation } from '../types.js'

export class RateLimiter {
  private minuteWindow: number[] = []
  private hourWindow: number[] = []

  constructor(private policy: RateLimitPolicy) {}

  check(): PolicyViolation | null {
    if (!this.policy.enabled) {
      return null
    }

    const now = Date.now()
    this.cleanup(now)

    // Check per-minute limit
    if (this.minuteWindow.length >= this.policy.maxPerMinute) {
      return {
        type: 'rate_limit',
        rule: `maxPerMinute: ${this.policy.maxPerMinute}`,
        message: `Rate limit exceeded: ${this.minuteWindow.length}/${this.policy.maxPerMinute} commands per minute`
      }
    }

    // Check per-hour limit
    if (this.hourWindow.length >= this.policy.maxPerHour) {
      return {
        type: 'rate_limit',
        rule: `maxPerHour: ${this.policy.maxPerHour}`,
        message: `Rate limit exceeded: ${this.hourWindow.length}/${this.policy.maxPerHour} commands per hour`
      }
    }

    return null
  }

  record(): void {
    const now = Date.now()
    this.minuteWindow.push(now)
    this.hourWindow.push(now)
  }

  private cleanup(now: number): void {
    const oneMinuteAgo = now - 60 * 1000
    const oneHourAgo = now - 60 * 60 * 1000

    this.minuteWindow = this.minuteWindow.filter(t => t > oneMinuteAgo)
    this.hourWindow = this.hourWindow.filter(t => t > oneHourAgo)
  }

  getStats(): { minute: number; hour: number } {
    const now = Date.now()
    this.cleanup(now)

    return {
      minute: this.minuteWindow.length,
      hour: this.hourWindow.length
    }
  }
}
