import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RateLimiter } from './rate-limiter.js'

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('enabled/disabled', () => {
    it('allows all when disabled', () => {
      const limiter = new RateLimiter({
        enabled: false,
        maxPerMinute: 10,
        maxPerHour: 100
      })
      for (let i = 0; i < 20; i++) {
        limiter.record()
      }
      expect(limiter.check()).toBeNull()
    })

    it('checks when enabled', () => {
      const limiter = new RateLimiter({
        enabled: true,
        maxPerMinute: 5,
        maxPerHour: 100
      })
      for (let i = 0; i < 5; i++) {
        limiter.record()
      }
      expect(limiter.check()).not.toBeNull()
    })
  })

  describe('per-minute limit', () => {
    it('allows up to maxPerMinute', () => {
      const limiter = new RateLimiter({
        enabled: true,
        maxPerMinute: 5,
        maxPerHour: 100
      })
      for (let i = 0; i < 4; i++) {
        limiter.record()
      }
      expect(limiter.check()).toBeNull()
    })

    it('blocks when exceeding maxPerMinute', () => {
      const limiter = new RateLimiter({
        enabled: true,
        maxPerMinute: 5,
        maxPerHour: 100
      })
      for (let i = 0; i < 5; i++) {
        limiter.record()
      }
      const result = limiter.check()
      expect(result).not.toBeNull()
      expect(result?.type).toBe('rate_limit')
      expect(result?.message).toContain('per minute')
    })

    it('resets after one minute', () => {
      const limiter = new RateLimiter({
        enabled: true,
        maxPerMinute: 5,
        maxPerHour: 100
      })
      for (let i = 0; i < 5; i++) {
        limiter.record()
      }
      expect(limiter.check()).not.toBeNull()

      // Advance time by 61 seconds
      vi.advanceTimersByTime(61 * 1000)

      expect(limiter.check()).toBeNull()
    })
  })

  describe('per-hour limit', () => {
    it('allows up to maxPerHour', () => {
      const limiter = new RateLimiter({
        enabled: true,
        maxPerMinute: 100,
        maxPerHour: 10
      })
      for (let i = 0; i < 9; i++) {
        limiter.record()
        vi.advanceTimersByTime(70 * 1000) // Pass minute window
      }
      expect(limiter.check()).toBeNull()
    })

    it('blocks when exceeding maxPerHour', () => {
      const limiter = new RateLimiter({
        enabled: true,
        maxPerMinute: 100,
        maxPerHour: 10
      })
      for (let i = 0; i < 10; i++) {
        limiter.record()
        vi.advanceTimersByTime(70 * 1000) // Pass minute window
      }
      const result = limiter.check()
      expect(result).not.toBeNull()
      expect(result?.type).toBe('rate_limit')
      expect(result?.message).toContain('per hour')
    })

    it('resets after one hour', () => {
      const limiter = new RateLimiter({
        enabled: true,
        maxPerMinute: 100,
        maxPerHour: 10
      })
      for (let i = 0; i < 10; i++) {
        limiter.record()
      }
      expect(limiter.check()).not.toBeNull()

      // Advance time by 61 minutes
      vi.advanceTimersByTime(61 * 60 * 1000)

      expect(limiter.check()).toBeNull()
    })
  })

  describe('getStats', () => {
    it('returns current counts', () => {
      const limiter = new RateLimiter({
        enabled: true,
        maxPerMinute: 100,
        maxPerHour: 1000
      })
      limiter.record()
      limiter.record()
      limiter.record()

      const stats = limiter.getStats()
      expect(stats.minute).toBe(3)
      expect(stats.hour).toBe(3)
    })

    it('cleans up old entries', () => {
      const limiter = new RateLimiter({
        enabled: true,
        maxPerMinute: 100,
        maxPerHour: 1000
      })
      limiter.record()
      limiter.record()

      vi.advanceTimersByTime(61 * 1000) // Past minute window
      limiter.record()

      const stats = limiter.getStats()
      expect(stats.minute).toBe(1) // Only the recent one
      expect(stats.hour).toBe(3) // All three
    })
  })
})
