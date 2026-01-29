import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DashboardDB } from '../dashboard/db.js'
import { checkLoopDetection, checkAnomalyDetection, checkRateLimit } from './db-checks.js'
import type { LoopDetectionPolicy, AnomalyDetectionPolicy, RateLimitPolicy } from '../types.js'
import { unlinkSync, existsSync } from 'fs'

const TEST_DB = '.bashbros-dbchecks-test.db'

function insertCmd(db: DashboardDB, command: string): void {
  db.insertCommand({
    command,
    allowed: true,
    riskScore: 1,
    riskLevel: 'safe',
    riskFactors: [],
    durationMs: 10,
    violations: []
  })
}

describe('db-checks', () => {
  let db: DashboardDB

  beforeEach(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB)
    db = new DashboardDB(TEST_DB)
  })

  afterEach(() => {
    db.close()
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB)
  })

  // ──────────────────────────────────────────────────────
  // checkLoopDetection
  // ──────────────────────────────────────────────────────

  describe('checkLoopDetection', () => {
    const baseConfig: LoopDetectionPolicy = {
      enabled: true,
      maxRepeats: 3,
      maxTurns: 100,
      similarityThreshold: 0.85,
      cooldownMs: 1000,
      windowSize: 20,
      action: 'block'
    }

    it('returns null when disabled', () => {
      const result = checkLoopDetection('ls', { ...baseConfig, enabled: false }, db)
      expect(result.violation).toBeNull()
      expect(result.warning).toBeNull()
    })

    it('returns null on first occurrence', () => {
      const result = checkLoopDetection('ls -la', baseConfig, db)
      expect(result.violation).toBeNull()
      expect(result.warning).toBeNull()
    })

    it('detects exact repeats at threshold', () => {
      insertCmd(db, 'git status')
      insertCmd(db, 'git status')
      insertCmd(db, 'git status')

      const result = checkLoopDetection('git status', baseConfig, db)
      expect(result.violation).not.toBeNull()
      expect(result.violation!.type).toBe('loop')
      expect(result.violation!.rule).toBe('exact_repeat')
    })

    it('does not trigger below threshold', () => {
      insertCmd(db, 'git status')
      insertCmd(db, 'git status')

      const result = checkLoopDetection('git status', baseConfig, db)
      expect(result.violation).toBeNull()
    })

    it('detects semantic repeats', () => {
      // Similar commands that normalize to the same thing
      insertCmd(db, 'cat file1.txt')
      insertCmd(db, 'cat file2.txt')
      insertCmd(db, 'cat file3.txt')

      const result = checkLoopDetection('cat file4.txt', baseConfig, db)
      expect(result.violation).not.toBeNull()
      expect(result.violation!.rule).toBe('semantic_repeat')
    })

    it('warns instead of blocking when action is warn', () => {
      insertCmd(db, 'git status')
      insertCmd(db, 'git status')
      insertCmd(db, 'git status')

      const result = checkLoopDetection('git status', { ...baseConfig, action: 'warn' }, db)
      expect(result.violation).toBeNull()
      expect(result.warning).not.toBeNull()
      expect(result.warning).toContain('repeated')
    })

    it('detects max turns exceeded', () => {
      const config = { ...baseConfig, maxTurns: 5 }
      for (let i = 0; i < 5; i++) {
        insertCmd(db, `command-${i}`)
      }

      const result = checkLoopDetection('new-command', config, db)
      expect(result.violation).not.toBeNull()
      expect(result.violation!.rule).toBe('max_turns')
    })
  })

  // ──────────────────────────────────────────────────────
  // checkAnomalyDetection
  // ──────────────────────────────────────────────────────

  describe('checkAnomalyDetection', () => {
    const baseConfig: AnomalyDetectionPolicy = {
      enabled: true,
      workingHours: [6, 22],
      typicalCommandsPerMinute: 30,
      learningCommands: 5,
      suspiciousPatterns: [],
      action: 'warn'
    }

    it('returns null when disabled', () => {
      const result = checkAnomalyDetection('ls', { ...baseConfig, enabled: false }, db)
      expect(result.violation).toBeNull()
      expect(result.warning).toBeNull()
    })

    it('skips during learning phase', () => {
      // Only 3 commands, learningCommands = 5
      insertCmd(db, 'cmd1')
      insertCmd(db, 'cmd2')
      insertCmd(db, 'cmd3')

      const result = checkAnomalyDetection('cat /root/.ssh/id_rsa', baseConfig, db)
      expect(result.violation).toBeNull()
      expect(result.warning).toBeNull()
    })

    it('detects suspicious patterns after learning', () => {
      // Fill up learning threshold
      for (let i = 0; i < 5; i++) {
        insertCmd(db, `normal-cmd-${i}`)
      }

      const result = checkAnomalyDetection('cat /root/.ssh/id_rsa', baseConfig, db)
      expect(result.warning).not.toBeNull()
      expect(result.warning).toContain('Suspicious pattern')
    })

    it('blocks when action is block', () => {
      for (let i = 0; i < 5; i++) {
        insertCmd(db, `normal-cmd-${i}`)
      }

      const result = checkAnomalyDetection('cat /root/.ssh/id_rsa', { ...baseConfig, action: 'block' }, db)
      expect(result.violation).not.toBeNull()
      expect(result.violation!.type).toBe('anomaly')
    })

    it('detects custom suspicious patterns', () => {
      for (let i = 0; i < 5; i++) {
        insertCmd(db, `normal-cmd-${i}`)
      }

      const config = { ...baseConfig, suspiciousPatterns: ['dangerzone'] }
      const result = checkAnomalyDetection('enter the dangerzone', config, db)
      expect(result.warning).not.toBeNull()
      expect(result.warning).toContain('Suspicious pattern')
    })
  })

  // ──────────────────────────────────────────────────────
  // checkRateLimit
  // ──────────────────────────────────────────────────────

  describe('checkRateLimit', () => {
    const baseConfig: RateLimitPolicy = {
      enabled: true,
      maxPerMinute: 5,
      maxPerHour: 100
    }

    it('returns null when disabled', () => {
      const result = checkRateLimit({ ...baseConfig, enabled: false }, db)
      expect(result.violation).toBeNull()
      expect(result.warning).toBeNull()
    })

    it('allows within limits', () => {
      insertCmd(db, 'cmd1')
      insertCmd(db, 'cmd2')

      const result = checkRateLimit(baseConfig, db)
      expect(result.violation).toBeNull()
    })

    it('blocks when per-minute limit exceeded', () => {
      for (let i = 0; i < 5; i++) {
        insertCmd(db, `cmd-${i}`)
      }

      const result = checkRateLimit(baseConfig, db)
      expect(result.violation).not.toBeNull()
      expect(result.violation!.type).toBe('rate_limit')
      expect(result.violation!.rule).toBe('rate_per_minute')
    })

    it('blocks when per-hour limit exceeded', () => {
      const config = { ...baseConfig, maxPerMinute: 1000, maxPerHour: 3 }
      for (let i = 0; i < 3; i++) {
        insertCmd(db, `cmd-${i}`)
      }

      const result = checkRateLimit(config, db)
      expect(result.violation).not.toBeNull()
      expect(result.violation!.type).toBe('rate_limit')
      expect(result.violation!.rule).toBe('rate_per_hour')
    })
  })
})
