import { describe, it, expect, beforeEach } from 'vitest'
import { MetricsCollector } from './metrics.js'

describe('MetricsCollector', () => {
  let collector: MetricsCollector

  beforeEach(() => {
    collector = new MetricsCollector()
  })

  describe('session tracking', () => {
    it('generates unique session ID', () => {
      const c2 = new MetricsCollector()
      const m1 = collector.getMetrics()
      const m2 = c2.getMetrics()
      expect(m1.sessionId).not.toBe(m2.sessionId)
    })

    it('tracks session start time', () => {
      const metrics = collector.getMetrics()
      expect(metrics.startTime).toBeInstanceOf(Date)
      expect(metrics.duration).toBeGreaterThanOrEqual(0)
    })
  })

  describe('command recording', () => {
    it('records commands', () => {
      collector.record({
        command: 'ls -la',
        timestamp: new Date(),
        duration: 50,
        allowed: true,
        riskScore: { score: 1, level: 'safe', factors: [] },
        violations: []
      })

      const metrics = collector.getMetrics()
      expect(metrics.commandCount).toBe(1)
    })

    it('tracks blocked commands', () => {
      collector.record({
        command: 'rm -rf /',
        timestamp: new Date(),
        duration: 0,
        allowed: false,
        riskScore: { score: 10, level: 'critical', factors: [] },
        violations: [{ type: 'command', rule: 'block:rm -rf /', message: 'Blocked' }]
      })

      const metrics = collector.getMetrics()
      expect(metrics.blockedCount).toBe(1)
    })

    it('tracks risk distribution', () => {
      collector.record({
        command: 'ls',
        timestamp: new Date(),
        duration: 10,
        allowed: true,
        riskScore: { score: 1, level: 'safe', factors: [] },
        violations: []
      })

      collector.record({
        command: 'crontab -e',
        timestamp: new Date(),
        duration: 10,
        allowed: true,
        riskScore: { score: 7, level: 'dangerous', factors: [] },
        violations: []
      })

      const metrics = collector.getMetrics()
      expect(metrics.riskDistribution.safe).toBe(1)
      expect(metrics.riskDistribution.dangerous).toBe(1)
    })
  })

  describe('path tracking', () => {
    it('extracts and tracks paths', () => {
      collector.record({
        command: 'cat /etc/passwd',
        timestamp: new Date(),
        duration: 10,
        allowed: true,
        riskScore: { score: 5, level: 'caution', factors: [] },
        violations: []
      })

      const metrics = collector.getMetrics()
      expect(metrics.pathsAccessed).toContain('/etc/passwd')
    })

    it('tracks file modifications', () => {
      collector.record({
        command: 'touch /tmp/newfile.txt',
        timestamp: new Date(),
        duration: 10,
        allowed: true,
        riskScore: { score: 2, level: 'safe', factors: [] },
        violations: []
      })

      const metrics = collector.getMetrics()
      expect(metrics.filesModified).toContain('/tmp/newfile.txt')
    })
  })

  describe('command frequency', () => {
    it('tracks top commands', () => {
      for (let i = 0; i < 5; i++) {
        collector.record({
          command: 'git status',
          timestamp: new Date(),
          duration: 10,
          allowed: true,
          riskScore: { score: 1, level: 'safe', factors: [] },
          violations: []
        })
      }

      collector.record({
        command: 'ls',
        timestamp: new Date(),
        duration: 10,
        allowed: true,
        riskScore: { score: 1, level: 'safe', factors: [] },
        violations: []
      })

      const metrics = collector.getMetrics()
      expect(metrics.topCommands[0][0]).toBe('git')
      expect(metrics.topCommands[0][1]).toBe(5)
    })

    it('counts unique commands', () => {
      collector.record({
        command: 'git status',
        timestamp: new Date(),
        duration: 10,
        allowed: true,
        riskScore: { score: 1, level: 'safe', factors: [] },
        violations: []
      })

      collector.record({
        command: 'ls -la',
        timestamp: new Date(),
        duration: 10,
        allowed: true,
        riskScore: { score: 1, level: 'safe', factors: [] },
        violations: []
      })

      const metrics = collector.getMetrics()
      expect(metrics.uniqueCommands).toBe(2)
    })
  })

  describe('violations tracking', () => {
    it('aggregates violations by type', () => {
      collector.record({
        command: 'rm -rf /',
        timestamp: new Date(),
        duration: 0,
        allowed: false,
        riskScore: { score: 10, level: 'critical', factors: [] },
        violations: [{ type: 'command', rule: 'block:rm -rf /', message: 'Blocked' }]
      })

      collector.record({
        command: 'cat /etc/shadow',
        timestamp: new Date(),
        duration: 0,
        allowed: false,
        riskScore: { score: 9, level: 'critical', factors: [] },
        violations: [{ type: 'path', rule: 'block:/etc/shadow', message: 'Protected path' }]
      })

      const metrics = collector.getMetrics()
      expect(metrics.violationsByType['command']).toBe(1)
      expect(metrics.violationsByType['path']).toBe(1)
    })
  })

  describe('execution time', () => {
    it('calculates average execution time', () => {
      collector.record({
        command: 'cmd1',
        timestamp: new Date(),
        duration: 100,
        allowed: true,
        riskScore: { score: 1, level: 'safe', factors: [] },
        violations: []
      })

      collector.record({
        command: 'cmd2',
        timestamp: new Date(),
        duration: 200,
        allowed: true,
        riskScore: { score: 1, level: 'safe', factors: [] },
        violations: []
      })

      const metrics = collector.getMetrics()
      expect(metrics.avgExecutionTime).toBe(150)
      expect(metrics.totalExecutionTime).toBe(300)
    })
  })

  describe('helpers', () => {
    it('gets recent commands', () => {
      for (let i = 0; i < 15; i++) {
        collector.record({
          command: `cmd${i}`,
          timestamp: new Date(),
          duration: 10,
          allowed: true,
          riskScore: { score: 1, level: 'safe', factors: [] },
          violations: []
        })
      }

      const recent = collector.getRecentCommands(5)
      expect(recent).toHaveLength(5)
      expect(recent[4].command).toBe('cmd14')
    })

    it('gets blocked commands', () => {
      collector.record({
        command: 'allowed',
        timestamp: new Date(),
        duration: 10,
        allowed: true,
        riskScore: { score: 1, level: 'safe', factors: [] },
        violations: []
      })

      collector.record({
        command: 'blocked',
        timestamp: new Date(),
        duration: 0,
        allowed: false,
        riskScore: { score: 10, level: 'critical', factors: [] },
        violations: [{ type: 'command', rule: 'block:blocked', message: 'Blocked' }]
      })

      const blocked = collector.getBlockedCommands()
      expect(blocked).toHaveLength(1)
      expect(blocked[0].command).toBe('blocked')
    })

    it('gets high risk commands', () => {
      collector.record({
        command: 'safe',
        timestamp: new Date(),
        duration: 10,
        allowed: true,
        riskScore: { score: 1, level: 'safe', factors: [] },
        violations: []
      })

      collector.record({
        command: 'risky',
        timestamp: new Date(),
        duration: 10,
        allowed: true,
        riskScore: { score: 7, level: 'dangerous', factors: [] },
        violations: []
      })

      const risky = collector.getHighRiskCommands(6)
      expect(risky).toHaveLength(1)
      expect(risky[0].command).toBe('risky')
    })
  })

  describe('format duration', () => {
    it('formats milliseconds', () => {
      expect(MetricsCollector.formatDuration(500)).toBe('500ms')
    })

    it('formats seconds', () => {
      expect(MetricsCollector.formatDuration(5000)).toBe('5.0s')
    })

    it('formats minutes', () => {
      expect(MetricsCollector.formatDuration(125000)).toBe('2m 5s')
    })

    it('formats hours', () => {
      expect(MetricsCollector.formatDuration(3725000)).toBe('1h 2m')
    })
  })

  describe('reset', () => {
    it('clears all data', () => {
      collector.record({
        command: 'test',
        timestamp: new Date(),
        duration: 10,
        allowed: true,
        riskScore: { score: 1, level: 'safe', factors: [] },
        violations: []
      })

      collector.reset()
      const metrics = collector.getMetrics()
      expect(metrics.commandCount).toBe(0)
    })
  })
})
