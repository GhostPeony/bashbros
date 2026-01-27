import { describe, it, expect, beforeEach } from 'vitest'
import { LoopDetector } from './loop-detector.js'

describe('LoopDetector', () => {
  let detector: LoopDetector

  beforeEach(() => {
    // High similarity threshold to avoid semantic repeat false positives
    detector = new LoopDetector({ maxRepeats: 3, maxTurns: 100, similarityThreshold: 0.99 })
  })

  describe('exact repeats', () => {
    it('eventually detects repeated commands', () => {
      const d = new LoopDetector({ maxRepeats: 2, maxTurns: 100, similarityThreshold: 1.0, windowSize: 100 })

      // First occurrence - no alert
      const first = d.check('ls -la')
      expect(first).toBeNull()

      // After enough repeats, should alert
      let alert = null
      for (let i = 0; i < 5; i++) {
        const result = d.check('ls -la')
        if (result) {
          alert = result
          break
        }
      }

      // Should have detected a repeat eventually
      expect(alert).not.toBeNull()
      expect(alert?.type).toBe('exact_repeat')
    })

    it('tracks unique commands', () => {
      const d = new LoopDetector({ maxRepeats: 10, maxTurns: 100, similarityThreshold: 1.0, windowSize: 100 })

      // Different commands should not trigger exact repeat
      const r1 = d.check('git status')
      const r2 = d.check('npm run build')
      const r3 = d.check('python --version')

      expect(r1).toBeNull()
      expect(r2).toBeNull()
      expect(r3).toBeNull()
    })
  })

  describe('semantic repeats', () => {
    it('detects semantically similar commands', () => {
      const d = new LoopDetector({ maxRepeats: 2, similarityThreshold: 0.7, maxTurns: 100 })

      d.check('cat /home/user/file1.txt')
      d.check('cat /home/user/file2.txt')

      const alert = d.check('cat /home/user/file3.txt')
      expect(alert?.type).toBe('semantic_repeat')
    })
  })

  describe('tool hammering', () => {
    it('tracks command frequency in map', () => {
      // Very high thresholds to ensure no alerts
      const d = new LoopDetector({ maxRepeats: 100, windowSize: 100, maxTurns: 200, similarityThreshold: 0.99 })

      for (let i = 0; i < 6; i++) {
        d.check(`grep pattern${i} file${i}.txt`)
      }

      expect(d.getFrequencyMap().get('grep')).toBe(6)
    })
  })

  describe('max turns', () => {
    it('alerts on max turns reached', () => {
      const d = new LoopDetector({
        maxTurns: 5,
        maxRepeats: 100,
        similarityThreshold: 0.99,
        windowSize: 100
      })

      // Use completely different commands
      expect(d.check('git status')).toBeNull()
      expect(d.check('npm install lodash')).toBeNull()
      expect(d.check('python --version')).toBeNull()
      expect(d.check('docker ps')).toBeNull()

      // 5th command should trigger max turns
      const alert = d.check('cargo build --release')
      expect(alert).not.toBeNull()
      expect(alert?.type).toBe('max_turns')
    })
  })

  describe('turn counting', () => {
    it('tracks turn count', () => {
      detector.check('a')
      detector.check('b')
      detector.check('c')

      expect(detector.getTurnCount()).toBe(3)
    })
  })

  describe('reset', () => {
    it('resets all state', () => {
      detector.check('a')
      detector.check('b')
      expect(detector.getTurnCount()).toBe(2)

      detector.reset()
      expect(detector.getTurnCount()).toBe(0)
    })
  })

  describe('stats', () => {
    it('provides useful stats', () => {
      detector.check('git status')
      detector.check('git diff')
      detector.check('ls')
      detector.check('git add .')

      const stats = detector.getStats()
      expect(stats.turnCount).toBe(4)
      expect(stats.uniqueCommands).toBe(2)  // git and ls
      expect(stats.topCommands[0][0]).toBe('git')
      expect(stats.topCommands[0][1]).toBe(3)
    })
  })
})
