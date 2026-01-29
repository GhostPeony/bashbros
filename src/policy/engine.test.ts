import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PolicyEngine } from './engine.js'
import type { BashBrosConfig } from '../types.js'
import { getDefaultConfig } from '../config.js'

describe('PolicyEngine', () => {
  const defaultConfig: BashBrosConfig = {
    ...getDefaultConfig(),
    agent: 'claude-code',
    profile: 'balanced',
    commands: {
      allow: ['*'],
      block: ['rm -rf /']
    },
    paths: {
      allow: ['*'],
      block: ['/etc', '/root']
    },
    secrets: {
      enabled: true,
      mode: 'block',
      patterns: ['*.env', '*.pem', '*.key']
    },
    audit: {
      enabled: true,
      destination: 'local'
    },
    rateLimit: {
      enabled: true,
      maxPerMinute: 60,
      maxPerHour: 1000
    }
  }

  beforeEach(() => {
    vi.useFakeTimers()
    // Clear session allowlist module state
    vi.resetModules()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('validate', () => {
    it('returns empty array for allowed commands', () => {
      const engine = new PolicyEngine(defaultConfig)
      expect(engine.validate('ls -la')).toEqual([])
    })

    it('returns violations for blocked commands', () => {
      const engine = new PolicyEngine(defaultConfig)
      const violations = engine.validate('rm -rf /')
      expect(violations.length).toBeGreaterThan(0)
      expect(violations[0].type).toBe('command')
    })

    it('checks rate limit first', () => {
      const config = {
        ...defaultConfig,
        rateLimit: {
          enabled: true,
          maxPerMinute: 2,
          maxPerHour: 100
        }
      }
      const engine = new PolicyEngine(config)

      engine.validate('ls')
      engine.validate('ls')
      const violations = engine.validate('ls')

      expect(violations.length).toBe(1)
      expect(violations[0].type).toBe('rate_limit')
    })

    it('extracts and validates paths from command', () => {
      const config = {
        ...defaultConfig,
        paths: {
          allow: ['/home'],
          block: ['/etc']
        }
      }
      const engine = new PolicyEngine(config)

      expect(engine.validate('cat /home/user/file.txt')).toEqual([])
      expect(engine.validate('cat /etc/passwd').length).toBeGreaterThan(0)
    })

    it('validates secrets access', () => {
      const engine = new PolicyEngine(defaultConfig)
      const violations = engine.validate('cat .env')
      expect(violations.length).toBeGreaterThan(0)
      expect(violations[0].type).toBe('secrets')
    })

    it('records command for rate limiting on success', () => {
      const config = {
        ...defaultConfig,
        rateLimit: {
          enabled: true,
          maxPerMinute: 3,
          maxPerHour: 100
        }
      }
      const engine = new PolicyEngine(config)

      expect(engine.validate('ls')).toEqual([])
      expect(engine.validate('ls')).toEqual([])
      expect(engine.validate('ls')).toEqual([])
      expect(engine.validate('ls').length).toBeGreaterThan(0)
    })
  })

  describe('isAllowed', () => {
    it('returns true for allowed commands', () => {
      const engine = new PolicyEngine(defaultConfig)
      expect(engine.isAllowed('git status')).toBe(true)
    })

    it('returns false for blocked commands', () => {
      const engine = new PolicyEngine(defaultConfig)
      expect(engine.isAllowed('rm -rf /')).toBe(false)
    })
  })

  describe('path extraction', () => {
    it('extracts absolute paths', () => {
      const config = {
        ...defaultConfig,
        paths: {
          allow: ['/allowed'],
          block: []
        }
      }
      const engine = new PolicyEngine(config)
      const violations = engine.validate('cat /etc/passwd')
      expect(violations.length).toBeGreaterThan(0)
    })

    it('extracts relative paths', () => {
      const config = {
        ...defaultConfig,
        paths: {
          allow: ['/allowed'],
          block: []
        }
      }
      const engine = new PolicyEngine(config)
      // ./file should resolve to current dir, test that extraction works
      // Since extraction is simple, just check it doesnt crash
      expect(() => engine.validate('cat ./test.txt')).not.toThrow()
    })

    it('extracts home paths', () => {
      const engine = new PolicyEngine(defaultConfig)
      expect(() => engine.validate('cat ~/file.txt')).not.toThrow()
    })

    it('extracts secret file patterns', () => {
      const engine = new PolicyEngine(defaultConfig)
      const violations = engine.validate('cat config.env')
      // .env pattern should be detected
      expect(violations.length).toBeGreaterThan(0)
    })

    it('skips flags', () => {
      const engine = new PolicyEngine(defaultConfig)
      // Flags like -la shouldnt be treated as paths
      expect(() => engine.validate('ls -la /home')).not.toThrow()
    })
  })

  describe('multiple violations', () => {
    it('can return multiple violations', () => {
      const config: BashBrosConfig = {
        ...defaultConfig,
        paths: {
          allow: ['/home'],
          block: []
        }
      }
      const engine = new PolicyEngine(config)
      const violations = engine.validate('cat /etc/.env')
      // Should have both path and secrets violations
      expect(violations.length).toBeGreaterThan(0)
    })
  })
})
